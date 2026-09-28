// Interfaz del juego: HUD, panel de unidad, editor, manual, ranking, informes.
import { API } from '../sim/api';
import { checkSyntax } from '../sim/lang/compiler';
import { Game, cargoCount, fmtDur } from '../sim/world/game';
import { RES_KINDS, RESOURCES, T, TERRAIN, UNIT_TYPES, type LogEntry, type ResKind, type Unit } from '../sim/world/types';
import type { PracticeSession, Session } from './session';
import { DEFAULT_PROGRAM } from '../sim/world/content';
import { BUILDINGS, HACK } from '../sim/world/types';
import { Minimap } from './render/minimap';
import { Renderer } from './render/renderer';
import { drawGallery } from './render/gallery';
import { CodeEditor, apiHtml } from './ui/editor';
import { ICON, resIcon } from './ui/icons';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const $ = <E extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as E;

const STATUS_LABEL: Record<string, string> = {
  RUNNING: 'Activo', IDLE: 'En espera', DONE: 'Terminado', ERROR: 'Error', HIBERNATING: 'Hibernando', BLOCKED: 'Bloqueado',
};
const INV_DEFAULT: Record<string, true> = { 'minero.py': true, 'granjero.py': true, 'constructor.py': true, 'hacker.py': true, 'aspersor.py': true, 'base.py': true };
const TERRAIN_LABEL: Record<string, string> = {
  hierba: 'Hierba', carretera: 'Carretera antigua', hormigon: 'Hormigón', maleza: 'Maleza', bosque: 'Bosque', agua: 'Agua',
  ruina: 'Ruina', roca: 'Roca', cultivo: 'Huerto', puente: 'Puente', base: 'Centro operativo', estructura: 'Instalación',
  puente_roto: 'Puente derruido', huerto: 'Huerto', camino: 'Camino', edificio: 'Edificio',
};

const LOGO = `<svg class="logo" viewBox="0 0 32 32"><path d="M16 2l12 7v14l-12 7-12-7V9z" fill="none" stroke="#2fd4c0" stroke-width="2"/><path d="M16 9l6 3.5v7L16 23l-6-3.5v-7z" fill="#2fd4c0" opacity=".25"/><path d="M10 12.5L16 16l6-3.5M16 16v7" stroke="#2fd4c0" stroke-width="1.6" fill="none"/><circle cx="16" cy="16" r="2" fill="#f2a93b"/></svg>`;

function unitStatus(u: Unit): string {
  if (u.status === 'RUNNING' && u.blocked && u.blocked.attempts >= 5) return 'BLOCKED';
  return u.status;
}

function fmtClock(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtHM(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function batClass(b: number): string {
  return b < 20 ? 'low' : b < 45 ? 'mid' : '';
}

interface Objective { text: string; progress: () => [number, number] }

export interface AppOptions {
  zoom?: number;
  onReady?: (app: App) => void;
  /** panel lateral personalizado (tutorial, partida) en lugar de los objetivos */
  sidePanel?: (app: App, el: HTMLElement) => void;
  hideSettings?: boolean;
}

export class App {
  r: Renderer;
  mm: Minimap;
  ed!: CodeEditor;
  selected: string | null = null;
  editorOpen = false;
  target: string | null = null;
  currentFile = 'minero.py';
  dirty = new Set<string>();
  rkTab = 'general';
  lastUi = 0;
  lastSave = 0;
  prevStorage: Record<string, number> = {};
  seenEvents = 0;
  simResult: { text: string; logs: LogEntry[]; unit: string } | null = null;

  raf = 0;
  alive = true;
  private cleanups: (() => void)[] = [];

  constructor(public be: Session, public opts: AppOptions = {}) {
    this.buildDom();
    const canvas = $<HTMLCanvasElement>('#world');
    this.r = new Renderer(canvas, be.game, be.me);
    this.r.god = be.god;
    this.mm = new Minimap($<HTMLCanvasElement>('#minimap'), be.game, be.me, this.r);
    this.mm.god = be.god;
    this.r.resize();
    const pl = be.game.player(be.me);
    if (pl) {
      this.r.centerOn(pl.p.base.x + 1, pl.p.base.y + 3);
      this.r.cam.zoom = opts.zoom ?? 1.25;
    } else {
      this.r.centerOn(be.game.cfg.w / 2, be.game.cfg.h / 2);
      this.r.cam.zoom = opts.zoom ?? 0.55;
    }
    const first = this.myUnits()[0];
    this.select(be.god ? null : first?.id ?? null, false);
    this.target = first?.id ?? null;
    this.initEditor();
    this.bindInput();
    this.seenEvents = be.game.events.length ? be.game.events[be.game.events.length - 1].t : 0;
    this.prevStorage = { ...(this.viewPlayer()?.p.storage ?? {}) };
    const onResize = () => this.r.resize();
    const onUnload = () => this.be.save();
    const onVis = () => { if (document.hidden) this.be.save(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('visibilitychange', onVis);
    this.cleanups.push(() => window.removeEventListener('resize', onResize), () => window.removeEventListener('beforeunload', onUnload), () => document.removeEventListener('visibilitychange', onVis));
    if (/galeria/.test(location.search + location.hash)) this.showGallery();
    else if (be.kind === 'practica' && be.isNew) this.showWelcome();
    else if (be.report) this.showReport();
    if (!be.storageOk) this.toast('Este navegador no permite guardar: la partida no persistirá al cerrar', 'warn');
    opts.onReady?.(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.cleanups.forEach((f) => f());
    this.be.save();
  }

  /** unidades que este jugador controla (todas en modo profesor) */
  myUnits(): Unit[] {
    if (this.be.god) return [...this.game.units.values()].map((r) => r.u);
    return this.game.unitsOf(this.be.me);
  }

  /** jugador cuyo código/almacén se está mirando */
  owner(): string {
    if (!this.be.god) return this.be.me;
    const u = this.target ? this.game.units.get(this.target)?.u : null;
    return u?.owner ?? [...this.game.players.keys()][0] ?? this.be.me;
  }

  viewPlayer() {
    return this.game.player(this.owner());
  }

  files(): Record<string, string> {
    return this.be.filesOf(this.owner());
  }

  defaultFileFor(u: Unit | null | undefined): string {
    if (!u) return Object.keys(this.files())[0] ?? 'minero.py';
    if (u.program && (u.program.name + '.py') in this.files()) return u.program.name + '.py';
    const d = DEFAULT_PROGRAM[u.type];
    return d && d in this.files() ? d : Object.keys(this.files())[0] ?? d;
  }

  get game(): Game { return this.be.game; }

  // ───────────── DOM ─────────────
  buildDom(): void {
    $('#app').innerHTML = `
      <canvas id="world"></canvas>
      <header id="topbar" class="panel">
        <div class="brand">${LOGO}<div><div class="title">G.R.I.D.</div><div class="colony" id="colony"></div></div></div>
        <div class="res-bar" id="resbar"></div>
        <div class="spacer"></div>
        <div class="clock" title="Hora del mundo">${ICON.clock}<b id="clock">--:--</b></div>
        <div id="hostctl"></div>
        <div class="seg" id="speed" title="Acelerar el tiempo (sólo en práctica)">
          <button data-s="1" class="on">1×</button><button data-s="10">10×</button><button data-s="60">60×</button>
        </div>
        <button class="tb-btn" id="btn-rank" title="Ranking diario (R)">${ICON.trophy}<span class="lbl">Ranking</span></button>
        <button class="tb-btn" id="btn-set" title="Ajustes">${ICON.gear}</button>
        <button class="tb-btn primary" id="btn-code" title="Editor de código (E)">${ICON.code}<span class="lbl">Código</span><span class="kbd">E</span></button>
      </header>
      <aside id="units" class="panel">
        <div class="sec-title"><span>Unidades</span><span id="ucount"></span></div>
        <div class="unit-list" id="ulist"></div>
        <div class="objective" id="objective"></div>
      </aside>
      <aside id="inspector" class="panel hidden"></aside>
      <section id="editor" class="panel">
        <div class="ed-head"><div class="tabs" id="tabs"></div>
          <button class="icon-btn" id="ed-new" title="Nuevo archivo">${ICON.plus}</button>
          <button class="icon-btn" id="ed-close" title="Cerrar (Esc)">${ICON.close}</button>
        </div>
        <div class="ed-tools">
          <span class="chip" title="Unidad que ejecutará el programa">${ICON.dron} Ejecutar en</span>
          <select class="sel" id="ed-target"></select>
          <button class="btn go" id="ed-run" title="Ctrl+Enter">${ICON.play} Ejecutar</button>
          <button class="btn danger" id="ed-stop">${ICON.stop} Detener</button>
          <button class="btn" id="ed-sim" title="Simula 5 minutos usando sólo el mapa que conoce tu colonia">🧪 Probar 5 min</button>
          <span class="grow"></span>
          <button class="btn" id="ed-ver" title="Versiones">${ICON.history}</button>
          <button class="btn" id="ed-man" title="Manual (M)">${ICON.book} Manual</button>
        </div>
        <div class="ed-main">
          <div class="ed-code" id="ed-code"></div>
          <div class="manual" id="manual"></div>
        </div>
        <div class="ed-console">
          <div class="head"><span id="con-title">Consola</span><span class="st" id="con-st"></span></div>
          <div id="sim-summary"></div>
          <div class="logs" id="con-logs"></div>
        </div>
        <div class="ed-status"><span id="ed-syntax"></span><span id="ed-pos"></span><span style="margin-left:auto">Ctrl+Enter ejecutar · Ctrl+S guardar</span></div>
      </section>
      <div id="minimap-wrap" class="panel"><canvas id="minimap"></canvas></div>
      <div id="camctl" class="panel">
        <button class="icon-btn" id="z-in" title="Acercar">${ICON.plus}</button>
        <button class="icon-btn" id="z-out" title="Alejar">${ICON.minus}</button>
        <button class="icon-btn" id="c-base" title="Centrar en la base (B)">${ICON.pin}</button>
        <button class="icon-btn on" id="c-grid" title="Mostrar grid (G)">${ICON.grid}</button>
      </div>
      <div id="hint" class="panel">Arrastra para mover la cámara · rueda para zoom · <b>tú programas, las máquinas trabajan</b></div>
      <div id="tileinfo"></div>
      <div id="toasts"></div>
      <div id="modal-root"></div>`;
    if (this.be.kind !== 'practica') $('#speed').style.display = 'none';
    if (this.opts.hideSettings || this.be.kind === 'host' || this.be.kind === 'alumno') $('#btn-set').style.display = 'none';
    $('#resbar').innerHTML = RES_KINDS.map((k) => `<div class="res" id="res-${k}" title="${RESOURCES[k].label}">${resIcon(k)}<span class="n">0</span></div>`).join('');
    this.renderManual('');
  }

  // ───────────── bucle ─────────────
  loop = (t: number): void => {
    if (!this.alive) return;
    this.be.tick(t);
    const now = this.be.now(t);
    this.r.draw(now, t);
    this.mm.draw(now);
    if (t - this.lastUi > 250) {
      this.lastUi = t;
      this.updateUi(now);
    }
    if (t - this.lastSave > 10_000) {
      this.lastSave = t;
      this.be.save();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  updateUi(now: number): void {
    const g = this.game;
    const pl = this.viewPlayer();
    if (!pl) return;
    $('#colony').textContent = this.be.god ? `Profesor · viendo ${pl.p.name}` : pl.p.name;
    const ph = g.phase(now);
    const clock = $('#clock');
    if (ph === 'prep') clock.innerHTML = `<span class="ph prep">Preparación</span> ${fmtLeft(g.playStart - now)}`;
    else if (ph === 'play') clock.innerHTML = `<span class="ph play">Partida</span> ${fmtLeft(g.playEnd - now)}`;
    else if (ph === 'end') clock.innerHTML = '<span class="ph end">Terminada</span>';
    else clock.textContent = fmtClock(now);
    if (this.be.paused) clock.innerHTML += ' <span class="ph end">PAUSA</span>';
    for (const k of RES_KINDS) {
      const el = $(`#res-${k}`);
      const v = Math.floor(pl.p.storage[k]);
      const n = $('.n', el);
      if (n.textContent !== String(v)) {
        if (v > (this.prevStorage[k] ?? 0)) {
          el.classList.add('flash');
          setTimeout(() => el.classList.remove('flash'), 900);
        }
        n.textContent = String(v);
        this.prevStorage[k] = v;
      }
    }
    this.renderUnits(now);
    this.renderInspector(now);
    if (this.opts.sidePanel) this.opts.sidePanel(this, $('#objective'));
    else if (this.be.kind === 'practica') this.renderObjective();
    else this.renderMatchPanel(now);
    if (this.editorOpen) this.renderConsole(now);
    this.checkEvents();
    if ((this.be.filesVersion ?? 0) !== this.seenFilesVersion) {
      this.seenFilesVersion = this.be.filesVersion ?? 0;
      const cur = this.files()[this.currentFile];
      if (cur !== undefined && cur !== this.ed.view.state.doc.toString()) {
        this.ed.forget(this.currentFile);
        this.ed.open(this.currentFile, cur);
        this.toast(`${this.currentFile} ha cambiado desde fuera (profesor o hackeo)`, 'warn');
      }
      this.renderTabs();
    }
  }

  // ───────────── unidades ─────────────
  renderUnits(now: number): void {
    // orden estable (en el espejo del alumno las unidades se reinsertan al llegar parches)
    const ORDER = ['base', 'granjero', 'minero', 'constructor', 'hacker', 'aspersor'];
    const rank = (u: Unit) => ORDER.indexOf(u.type);
    const units = this.myUnits().sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id, 'es', { numeric: true }));
    $('#ucount').textContent = String(units.length);
    const card = (u: Unit) => {
      const st = unitStatus(u);
      const act = u.action && u.action.end > now ? u.action.label : u.program ? u.program.name + '.py' : 'sin programa';
      const info = UNIT_TYPES[u.type];
      const extra = info.cargo ? `${cargoCount(u)}/${info.cargo}` : info.water ? `💧${Math.floor(u.water)}` : '';
      return `<div class="ucard ${u.id === this.selected ? 'sel' : ''}" data-u="${esc(u.id)}">
        <div class="ic ${u.type}">${ICON[u.type]}</div>
        <div class="top"><span class="name">${esc(u.name)}</span><span class="pill ${st}">${STATUS_LABEL[st]}</span></div>
        <div class="sub">${info.fixed ? '' : `<span class="mini-bat"><i class="${batClass(u.battery)}" style="width:${u.battery.toFixed(0)}%"></i></span>`}
          <span>${extra}</span><span class="act">${esc(act)}</span></div>
      </div>`;
    };
    let html: string;
    if (this.be.god) {
      const open = this.selected ? this.game.units.get(this.selected)?.u.owner : null;
      html = [...this.game.players.values()].map((p) => {
        const us = units.filter((u) => u.owner === p.p.id);
        const errs = us.filter((u) => u.status === 'ERROR' || (u.blocked && u.blocked.attempts >= 5)).length;
        const running = us.filter((u) => u.status === 'RUNNING').length;
        return `<div class="pgroup ${open === p.p.id ? 'open' : ''}" data-p="${esc(p.p.id)}">
          <div class="phead"><span class="dot" style="background:${p.p.color}"></span><span class="pn">${esc(p.p.name)}</span>
          <span class="ps">${errs ? `<span class="pill ERROR">${errs}✖</span>` : ''}<span class="pill RUNNING">${running}▶</span><b>${this.game.score(p)}</b></span></div>
          ${open === p.p.id ? us.map(card).join('') : ''}</div>`;
      }).join('');
    } else html = units.map(card).join('');
    const list = $('#ulist');
    if (list.dataset.h !== html) { list.dataset.h = html; list.innerHTML = html; }
    // opciones de destino del editor
    const sel = $<HTMLSelectElement>('#ed-target');
    const pool = this.be.god ? units.filter((u) => u.owner === this.owner()) : units;
    const opts = pool.map((u) => `<option value="${esc(u.id)}" ${u.id === this.target ? 'selected' : ''}>${esc(u.name)} · ${UNIT_TYPES[u.type].label}</option>`).join('');
    if (sel.dataset.sig !== opts) { sel.innerHTML = opts; sel.dataset.sig = opts; }
  }

  select(id: string | null, center = true): void {
    this.selected = id;
    this.r.selectedUnit = id;
    if (id) {
      this.r.selectedTile = null;
      this.target = id;
      if (center) {
        const u = this.game.units.get(id)?.u;
        if (u) this.focus(u.x, u.y);
      }
    }
    this.renderInspector(this.be.now(), true);
    this.renderUnits(this.be.now());
    if (this.editorOpen) this.renderConsole(this.be.now(), true);
  }

  // ───────────── inspector ─────────────
  private inspSig = '';
  renderInspector(now: number, force = false): void {
    const el = $('#inspector');
    const g = this.game;
    if (this.editorOpen) { el.classList.add('hidden'); return; }
    const u = this.selected ? g.units.get(this.selected)?.u : null;
    const tile = this.r.selectedTile;
    if (!u && !tile) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (u && !this.be.canControl(u.id)) {
      const op = g.player(u.owner);
      const sig = JSON.stringify([u.id, u.x, u.y, u.status, u.action?.label]);
      if (sig === this.inspSig && !force) return;
      this.inspSig = sig;
      el.innerHTML = `
        <div class="insp-head"><div class="ic" style="color:${op?.p.color}">${ICON[u.type]}</div><div style="flex:1;min-width:0"><div class="nm">${esc(u.name)}</div><div class="ty">${UNIT_TYPES[u.type].label} de <b style="color:${op?.p.color}">${esc(op?.p.name ?? '?')}</b></div></div>
          <button class="icon-btn" data-act="close" title="Cerrar">${ICON.close}</button></div>
        <div class="insp-body">
          <div class="stat-grid"><div class="stat"><div class="k">Posición</div><div class="v">(${u.x}, ${u.y})</div></div>
          <div class="stat"><div class="k">Haciendo</div><div class="v">${u.action && u.action.end > now ? esc(u.action.label) : '—'}</div></div></div>
          <div class="alert amber" style="border-color:rgba(255,93,115,.4);background:rgba(255,93,115,.07)"><div class="t" style="color:#ff5d73">Unidad rival</div>No puedes ver su código… salvo que tu dron hacker se acerque. Usa <code>radar()</code> para detectarla desde tus programas.</div>
        </div>`;
      return;
    }
    if (u) {
      const info = UNIT_TYPES[u.type];
      const st = unitStatus(u);
      const a = u.action;
      const actHtml = a && a.end > now
        ? `<div class="action-box"><div class="row"><span class="l">▸ ${esc(a.label)}</span><span class="r">${Math.max(0, (a.end - now) / 1000).toFixed(1)} s</span></div>
           <div class="bar"><i class="teal" style="width:${Math.min(100, ((now - a.start) / (a.end - a.start)) * 100).toFixed(0)}%"></i></div></div>`
        : '';
      const blocked = u.blocked && u.blocked.attempts >= 5
        ? `<div class="alert red"><div class="t">Bloqueado</div><div class="kv">
            <span>Última instrucción</span><span>${esc(u.blocked.instr)}</span>
            <span>Intentos fallidos</span><span>${u.blocked.attempts.toLocaleString('es-ES')}</span>
            <span>Tiempo perdido</span><span>${fmtDur(u.blocked.lostMs)}</span>
            <span>Línea</span><span>${u.lastLine}</span></div></div>`
        : '';
      const error = u.status === 'ERROR' && u.error
        ? `<div class="alert red"><div class="t">${esc(u.error.type)} · línea ${u.error.line}${u.error.mod !== '__main__' ? ` de ${esc(u.error.mod)}.py` : ''}</div>
           <div>${esc(u.error.msg)}</div><button class="link-btn" data-act="goerr">Ver en el código →</button></div>`
        : '';
      const hacked = u.hacked && now - u.hacked.t < 120_000
        ? `<div class="alert red"><div class="t">⚠ Hackeado por ${esc(u.hacked.by)}</div><div class="kv"><span>Línea</span><span>${u.hacked.line}</span><span>Antes</span><span>${esc(u.hacked.before)}</span><span>Ahora</span><span>${esc(u.hacked.after)}</span></div>
           <button class="link-btn" data-act="restore">Restaurar la versión anterior del archivo →</button></div>`
        : '';
      const wet = u.wetUntil > now ? `<div class="alert amber" style="border-color:rgba(159,227,240,.5)"><div class="t" style="color:#9fe3f0">Mojado</div>Un aspersor enemigo te ha alcanzado: ${Math.ceil((u.wetUntil - now) / 1000)} s sin actuar.</div>` : '';
      const signal = g.cfg.match && !info.fixed && !g.inSignal(u) ? '<div class="alert amber"><div class="t">Sin señal</div>Fuera del alcance de la base y de tus antenas: cada acción tarda el doble.</div>' : '';
      const hib = u.status === 'HIBERNATING'
        ? `<div class="alert amber"><div class="t">Hibernando</div>Batería agotada. Los paneles recargan ~2 % por minuto; el programa continuará solo. Consejo: vuelve a la base y usa <code>recargar()</code> antes de quedarte sin energía.</div>`
        : '';
      const cargo = Object.entries(u.cargo).filter(([, n]) => n! > 0).map(([k, n]) => `<span class="chip">${resIcon(k)}${n}</span>`).join('') || '<span class="chip">vacía</span>';
      const files = Object.keys(this.files());
      const defFile = this.defaultFileFor(u);
      const fileOpts = files.map((f) => `<option ${f === defFile ? 'selected' : ''}>${esc(f)}</option>`).join('');
      const third = info.cargo
        ? `<div class="stat"><div class="k">Carga</div><div class="v">${cargoCount(u)} / ${info.cargo}</div><div class="bar"><i class="teal" style="width:${(cargoCount(u) / info.cargo) * 100}%"></i></div></div>`
        : info.water
          ? `<div class="stat"><div class="k">Agua</div><div class="v">${Math.floor(u.water)} / ${info.water}</div><div class="bar"><i class="teal" style="width:${(u.water / info.water) * 100}%"></i></div></div>`
          : u.type === 'hacker'
            ? `<div class="stat"><div class="k">Módulo de hackeo</div><div class="v">${u.hackReadyAt > now ? `enfría ${Math.ceil((u.hackReadyAt - now) / 1000)} s` : 'listo'}</div></div>`
            : `<div class="stat"><div class="k">Señal</div><div class="v">${g.inSignal(u) ? 'sí' : 'no'}</div></div>`;
      const sig = JSON.stringify([u.id, st, a?.label, a?.end, u.battery.toFixed(0), cargoCount(u), u.logs.length, u.logs[u.logs.length - 1]?.n, u.blocked?.attempts, u.x, u.y, u.program?.name, files.length, Math.floor(u.water), u.hackReadyAt > now ? Math.ceil((u.hackReadyAt - now) / 1000) : 0, u.wetUntil > now, !!u.hacked && now - u.hacked.t < 20_000, g.inSignal(u), g.phase(now)]);
      if (sig === this.inspSig && !force) return;
      this.inspSig = sig;
      const logsEl = $('.logs', el);
      const keepScroll = logsEl && logsEl.scrollTop + logsEl.clientHeight < logsEl.scrollHeight - 20 ? logsEl.scrollTop : -1;
      el.innerHTML = `
        <div class="insp-head"><div class="ic">${ICON[u.type]}</div><div style="flex:1;min-width:0"><div class="nm">${esc(u.name)}</div><div class="ty">${info.label} · <span class="pill ${st}">${STATUS_LABEL[st]}</span></div></div>
          <button class="icon-btn" data-act="close" title="Cerrar">${ICON.close}</button></div>
        <div class="insp-body">
          <div class="stat-grid">
            <div class="stat"><div class="k">Posición</div><div class="v">(${u.x}, ${u.y})</div></div>
            ${info.fixed ? `<div class="stat"><div class="k">Tipo</div><div class="v">edificio</div></div>` : `<div class="stat"><div class="k">Energía</div><div class="v">${u.battery.toFixed(0)} %</div><div class="bar"><i class="${batClass(u.battery)}" style="width:${u.battery.toFixed(0)}%"></i></div></div>`}
            ${third}
            <div class="stat"><div class="k">Programa</div><div class="v">${u.program ? esc(u.program.name) : '—'}</div></div>
          </div>
          ${actHtml}${hacked}${wet}${signal}${blocked}${error}${hib}
          <div class="chips">${info.cargo ? cargo : ''}<span class="chip" title="Radio del escáner">◎ radio ${info.scan}</span>${info.air ? '<span class="chip">vuela</span>' : ''}<span class="chip">${esc(info.actions.filter((x) => !['mover', 'mirar', 'esperar', 'radar', 'descargar', 'recargar', 'escanear'].includes(x)).join(' · '))}</span></div>
          <div class="btn-row"><select class="sel" id="insp-file" style="flex:1">${fileOpts}</select>
            <button class="btn go" data-act="run" style="flex:none;padding:0 14px">${ICON.play} Ejecutar</button>
            <button class="btn danger" data-act="stop" style="flex:none;padding:0 12px" ${u.program ? '' : 'disabled'}>${ICON.stop}</button></div>
          <button class="btn" data-act="code">${ICON.code} Abrir código <span class="kbd">E</span></button>
          <div class="sec-title" style="margin:4px 2px 0"><span>Log</span><span>${u.actions.toLocaleString('es-ES')} acciones · ${u.instr.toLocaleString('es-ES')} instr.</span></div>
          <div class="logs">${this.logsHtml(u.logs)}</div>
        </div>`;
      const nl = $('.logs', el);
      nl.scrollTop = keepScroll >= 0 ? keepScroll : nl.scrollHeight;
    } else if (tile) {
      const pl = g.player(this.be.me);
      const k = tile.y * g.cfg.w + tile.x;
      const known = this.be.god || !pl || pl.known[k] === 1;
      const t = g.terrain[k] as T;
      const key = TERRAIN[t].key;
      const rid = g.resAt.get(k);
      const res = rid !== undefined && (this.be.god || pl?.knownRes.has(rid)) ? g.resources.get(rid) : undefined;
      const par = known ? g.parcelAt(tile.x, tile.y) : undefined;
      const bid = g.bldAt.get(k);
      const bld = bid !== undefined && known ? g.buildings.get(bid) : undefined;
      const drop = known ? g.drops.get(k) : undefined;
      const sig = JSON.stringify([tile, known, res?.amount, par && [par.planted, Math.floor(par.mat), Math.floor(par.hum)], bld?.id, drop]);
      if (sig === this.inspSig && !force) return;
      this.inspSig = sig;
      el.innerHTML = `
        <div class="insp-head"><div class="ic">${ICON.target}</div><div style="flex:1"><div class="nm">(${tile.x}, ${tile.y})</div><div class="ty">${known ? TERRAIN_LABEL[key] : 'Sin explorar'}</div></div>
          <button class="icon-btn" data-act="close">${ICON.close}</button></div>
        <div class="insp-body">
          ${known ? `<div class="stat-grid">
            <div class="stat"><div class="k">terreno(x, y)</div><div class="v">"${key}"</div></div>
            <div class="stat"><div class="k">mover() por tierra</div><div class="v">${TERRAIN[t].move ? ((TERRAIN[t].move * g.ts) / 1000).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + ' s' : 'bloqueado'}</div></div></div>`
            : '<div class="alert amber"><div class="t">Niebla</div>Nadie de tu colonia ha visto esta casilla. Programa una unidad para explorarla.</div>'}
          ${res ? `<div class="alert amber" style="border-color:rgba(47,212,192,.35);background:rgba(47,212,192,.07)"><div class="t" style="color:var(--teal)">Recurso · ${RESOURCES[res.kind].label}</div>
            <div class="kv"><span>tipo</span><span>"${res.kind}"</span><span>cantidad</span><span>${Math.floor(res.amount)} / ${res.max}</span><span>calidad</span><span>${'★'.repeat(res.quality)}${'☆'.repeat(3 - res.quality)}</span><span>picar()</span><span>${((RESOURCES[res.kind].ms * g.ts) / 1000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} s / ud</span><span>puntos</span><span>${RESOURCES[res.kind].value} por unidad</span></div></div>` : ''}
          ${par ? `<div class="alert amber" style="border-color:rgba(143,209,79,.4);background:rgba(143,209,79,.07)"><div class="t" style="color:var(--green)">Parcela de huerto${par.owner ? ' · ' + esc(g.player(par.owner)?.p.name ?? '') : ''}</div>
            <div class="kv"><span>plantada</span><span>${par.planted ? 'True' : 'False'}</span><span>humedad</span><span>${Math.round(par.hum)} ${par.hum > 30 ? '(crece)' : '(seca: no crece)'}</span><span>madurez</span><span>${Math.floor(par.mat)} %</span><span>lista</span><span>${par.planted && par.mat >= 100 ? 'True' : 'False'}</span></div></div>` : ''}
          ${bld ? `<div class="alert amber"><div class="t">${esc(BUILDINGS[bld.kind].label)} de ${esc(g.player(bld.owner)?.p.name ?? '')}</div>${esc(BUILDINGS[bld.kind].desc)}</div>` : ''}
          ${drop && Object.values(drop).some((n) => n! > 0) ? `<div class="chips">${Object.entries(drop).filter(([, n]) => n! > 0).map(([kk, n]) => `<span class="chip">${resIcon(kk)} ${n} en el suelo</span>`).join('')}</div>` : ''}
          <div class="chips"><span class="chip">x = ${tile.x}</span><span class="chip">y = ${tile.y}</span></div>
        </div>`;
    }
  }

  logsHtml(logs: LogEntry[]): string {
    return logs.slice(-120).map((l) => `<div class="log ${l.k}"><span class="tm">${fmtHM(l.t)}</span><span class="m">${esc(l.m)}</span><span class="x">${l.n > 1 ? '×' + l.n.toLocaleString('es-ES') : ''}</span></div>`).join('');
  }

  // ───────────── objetivos ─────────────
  objectives(): Objective[] {
    const g = this.game;
    const pl = g.player(this.be.me)!;
    const libUsed = () => Object.entries(this.files()).some(([n, src]) => !(n in INV_DEFAULT) && /^def\s/m.test(src)) && this.myUnits().some((u) => u.program && /^\s*(from|import)\s+\w+/m.test(u.program.bundle.main));
    return [
      { text: 'Programa el minero: pica una veta, recoge y descarga en la base', progress: () => [Math.min(10, pl.p.totals.mined), 10] },
      { text: 'Programa el dron granjero: planta, riega y recoge una cosecha', progress: () => [Math.min(1, pl.p.totals.harvested), 1] },
      { text: 'Crea una función en tu biblioteca (nav.py) e impórtala desde un programa', progress: () => [libUsed() ? 1 : 0, 1] },
      { text: 'Construye un panel solar o una antena con el constructor', progress: () => [g.ownBuildings(this.be.me).filter((b) => b.kind === 'panel' || b.kind === 'antena').length ? 1 : 0, 1] },
      { text: 'Hackea una unidad de una colonia rival con el dron hacker', progress: () => [Math.min(1, pl.p.totals.hacks), 1] },
      { text: 'Consigue 150 puntos', progress: () => [Math.min(150, Math.floor(pl.p.totals.delivered)), 150] },
    ];
  }

  renderMatchPanel(now: number): void {
    const g = this.game;
    const el = $('#objective');
    const rows = g.rankings()[0].rows;
    const ph = g.phase(now);
    const meIdx = rows.findIndex((r) => r.id === this.be.me);
    const top = rows.slice(0, this.be.god ? 8 : 5);
    const html = `<div class="lbl">${ICON.trophy} ${ph === 'prep' ? 'Preparación: programa tus unidades' : ph === 'play' ? 'Partida en curso' : ph === 'end' ? 'Partida terminada' : 'Clasificación'}</div>
      ${meIdx >= 0 ? `<div class="txt">Tus puntos: <b style="font-size:18px">${rows[meIdx].value}</b> · puesto ${meIdx + 1} de ${rows.length}</div>` : ''}
      ${top.map((r, i) => `<div class="mini-rk ${r.id === this.be.me ? 'me' : ''}"><span>${i + 1}</span><i style="background:${r.color}"></i><span class="n">${esc(r.name)}</span><b>${r.value}</b></div>`).join('')}`;
    if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; }
  }

  renderObjective(): void {
    const obs = this.objectives();
    const i = obs.findIndex((o) => { const [a, b] = o.progress(); return a < b; });
    const el = $('#objective');
    if (i < 0) {
      el.innerHTML = `<div class="lbl">${ICON.target} Objetivos completados</div><div class="txt">Tu colonia es autosuficiente. Compite en los rankings diarios.</div>`;
      return;
    }
    const [a, b] = obs[i].progress();
    const html = `<div class="lbl">${ICON.target} Objetivo ${i + 1}/${obs.length}</div><div class="txt">${esc(obs[i].text)}</div>
      <div class="bar"><i style="width:${(a / b) * 100}%"></i></div><div class="cnt">${a} / ${b}</div>`;
    if (el.dataset.h !== html) {
      el.dataset.h = html;
      if (el.dataset.i && el.dataset.i !== String(i)) this.toast(`Objetivo completado: ${obs[i - 1]?.text ?? ''}`, 'ok');
      el.dataset.i = String(i);
      el.innerHTML = html;
    }
  }

  // ───────────── eventos → toasts ─────────────
  checkEvents(): void {
    for (const e of this.game.events) {
      if (e.t <= this.seenEvents) continue;
      if (e.owner !== this.be.me && !this.be.god) continue;
      const u = this.game.units.get(e.unit)?.u;
      if (e.kind === 'error' && u) this.toast(`${u.name}: ${e.text} en la línea ${u.error?.line ?? '?'}`, 'err', () => { this.select(u.id); this.openEditor(); this.gotoError(); });
      if (e.kind === 'build') this.toast(`Nueva unidad: ${e.text}`, 'ok');
      if (e.kind === 'done' && u) this.toast(`${u.name} terminó su programa`, 'ok');
    }
    const evs = this.game.events;
    if (evs.length) this.seenEvents = Math.max(this.seenEvents, evs[evs.length - 1].t);
    // bloqueos nuevos
    for (const u of this.myUnits()) {
      if (u.blocked && u.blocked.attempts === 5 && !(u as Unit & { _t?: boolean })._t) {
        (u as Unit & { _t?: boolean })._t = true;
        this.toast(`${u.name} está BLOQUEADO: ${u.blocked.instr}`, 'err', () => this.select(u.id));
      }
      if (!u.blocked) (u as Unit & { _t?: boolean })._t = false;
    }
  }

  toast(msg: string, kind: 'ok' | 'err' | 'warn' | 'info' = 'info', onClick?: () => void): void {
    const el = document.createElement('div');
    el.className = `toast panel ${kind}`;
    el.innerHTML = `${kind === 'err' ? ICON.warn : kind === 'ok' ? '✓' : '•'} <span>${esc(msg)}</span>`;
    if (onClick) el.onclick = () => { onClick(); el.remove(); };
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 5200);
  }

  // ───────────── editor ─────────────
  initEditor(): void {
    this.ed = new CodeEditor($('#ed-code'), {
      files: () => this.files(),
      onChange: (name, src) => {
        this.be.saveFile(this.owner(), name, src);
        this.dirty.add(name);
        this.renderTabs();
        this.updateSyntax();
      },
      onRun: () => this.runCurrent(),
      onSave: () => {
        this.be.saveFile(this.owner(), this.currentFile, this.ed.view.state.doc.toString(), true);
        this.dirty.delete(this.currentFile);
        this.be.save();
        this.renderTabs();
        this.toast(`${this.currentFile} guardado (versión ${this.be.versions(this.owner(), this.currentFile).length})`, 'ok');
      },
      runtimeError: (file) => {
        const u = this.target ? this.game.units.get(this.target)?.u : null;
        if (!u || u.status !== 'ERROR' || !u.error || !u.program) return null;
        const f = u.error.mod === '__main__' ? u.program.name + '.py' : u.error.mod + '.py';
        return f === file ? { line: u.error.line, msg: `${u.error.type}: ${u.error.msg}` } : null;
      },
    });
    const tu = this.target ? this.game.units.get(this.target)?.u : null;
    this.openFile(this.defaultFileFor(tu));
  }

  private edOwner = '';
  private seenFilesVersion = 0;

  openFile(name: string): void {
    if (this.edOwner !== this.owner()) {
      this.ed.forgetAll();
      this.edOwner = this.owner();
      this.dirty.clear();
    }
    if (!(name in this.files())) this.be.saveFile(this.owner(), name, '');
    this.currentFile = name;
    this.ed.open(name, this.files()[name]);
    this.renderTabs();
    this.updateSyntax();
  }

  renderTabs(): void {
    const order = ['minero.py', 'granjero.py', 'constructor.py', 'hacker.py', 'aspersor.py', 'base.py'];
    const rank = (f: string) => (order.includes(f) ? order.indexOf(f) : 10);
    const files = Object.keys(this.files()).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    $('#tabs').innerHTML = files.map((f) => {
      const running = this.myUnits().some((u) => u.program && u.program.name + '.py' === f);
      const lib = !running && !(f in INV_DEFAULT) && !/while\s+True/.test(this.files()[f]);
      return `<div class="tab ${f === this.currentFile ? 'on' : ''} ${lib ? 'lib' : ''}" data-f="${esc(f)}" title="${lib ? 'Módulo de biblioteca' : 'Programa'}">
        ${lib ? ICON.box : ICON.file}<span>${esc(f)}</span>${this.dirty.has(f) ? '<span class="dirty" title="Cambios sin guardar como versión"></span>' : ''}${running ? '<span class="pill RUNNING" style="padding:1px 5px">▶</span>' : ''}
        ${!(f in INV_DEFAULT) ? `<span class="x" data-del="${esc(f)}" title="Eliminar">✕</span>` : ''}</div>`;
    }).join('');
  }

  updateSyntax(): void {
    const e = checkSyntax(this.files()[this.currentFile] ?? '');
    const el = $('#ed-syntax');
    el.className = e ? 'bad' : 'ok';
    el.textContent = e ? `✖ línea ${e.line}: ${e.msg}` : '✓ sintaxis correcta';
  }

  openEditor(): void {
    this.editorOpen = true;
    document.body.classList.add('editing');
    $('#editor').classList.add('open');
    $('#inspector').classList.add('hidden');
    if (this.selected && this.be.canControl(this.selected)) this.target = this.selected;
    const u = this.target ? this.game.units.get(this.target)?.u : null;
    this.openFile(this.defaultFileFor(u));
    this.renderConsole(this.be.now(), true);
    if (u) this.focus(u.x, u.y);
    setTimeout(() => this.ed.view.focus(), 280);
  }

  closeEditor(): void {
    this.editorOpen = false;
    document.body.classList.remove('editing');
    $('#editor').classList.remove('open');
    this.renderInspector(this.be.now(), true);
  }

  private conSig = '';
  renderConsole(now: number, force = false): void {
    const u = this.target ? this.game.units.get(this.target)?.u : null;
    if (!u) return;
    const st = unitStatus(u);
    const a = u.action;
    const sig = JSON.stringify([u.id, u.logs.length, u.logs[u.logs.length - 1]?.n, st, a?.label, Math.floor(now / 500)]);
    if (sig === this.conSig && !force) return;
    this.conSig = sig;
    if (this.simResult && this.simResult.unit === u.id) {
      if (force || this.conSig !== 'sim') {
        $('#con-title').innerHTML = `Simulación · ${esc(u.name)} (sólo terreno conocido) <button class="link-btn" id="sim-x" style="margin:0 0 0 8px">cerrar</button>`;
        $('#sim-summary').innerHTML = `<div class="sim-summary">${this.simResult.text}</div>`;
        const el = $('#con-logs');
        el.innerHTML = this.logsHtml(this.simResult.logs);
        el.scrollTop = el.scrollHeight;
        $('#sim-x').onclick = () => { this.simResult = null; this.renderConsole(this.be.now(), true); };
      }
      this.conSig = 'sim';
      $('#con-st').innerHTML = `<span class="pill ${st}">${STATUS_LABEL[st]}</span> ϟ ${u.battery.toFixed(0)}%`;
      return;
    }
    $('#con-title').textContent = `Consola · ${u.name}`;
    $('#con-st').innerHTML = `<span class="pill ${st}">${STATUS_LABEL[st]}</span> ${u.program ? esc(u.program.name) + '.py' : ''} ${a && a.end > now ? '· ' + esc(a.label) : ''} · ϟ ${u.battery.toFixed(0)}% · ${cargoCount(u)}/${UNIT_TYPES[u.type].cargo}`;
    const el = $('#con-logs');
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    el.innerHTML = this.logsHtml(u.logs);
    if (atBottom || force) el.scrollTop = el.scrollHeight;
    $('#sim-summary').innerHTML = '';
  }

  runCurrent(): void {
    const id = $<HTMLSelectElement>('#ed-target').value || this.target;
    if (!id) return;
    this.target = id;
    this.runOn(id, this.currentFile);
  }

  runOn(unitId: string, file: string): void {
    const r = this.be.run(unitId, file);
    this.dirty.delete(file);
    this.renderTabs();
    const u = this.game.units.get(unitId)!.u;
    if (!r.ok) {
      this.toast(`No se puede ejecutar: ${r.error}${r.line ? ` (línea ${r.line})` : ''}`, 'err');
      if (r.line && this.editorOpen) { if (r.file && r.file !== this.currentFile) this.openFile(r.file); this.ed.goToLine(r.line); }
      return;
    }
    this.simResult = null;
    this.r.selectedUnit = this.selected;
    const now = this.be.now();
    if (this.game.phase(now) === 'prep') {
      const s = Math.ceil((this.game.playStart - now) / 1000);
      this.toast(`${u.name} tiene cargado ${file}. Se pondrá en marcha cuando termine la preparación (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`, 'info');
    } else this.toast(`${u.name} ejecuta ${file}`, 'ok');
    this.renderConsole(this.be.now(), true);
    this.ed.refreshLint();
  }

  gotoError(): void {
    const u = this.target ? this.game.units.get(this.target)?.u : null;
    if (!u?.error || !u.program) return;
    const f = u.error.mod === '__main__' ? u.program.name + '.py' : u.error.mod + '.py';
    if (f in this.files()) {
      this.openFile(f);
      setTimeout(() => this.ed.goToLine(u.error!.line), 300);
    }
  }

  /** Prueba el programa en una copia del mundo que sólo contiene lo que conoce la colonia */
  simulate(): void {
    const id = $<HTMLSelectElement>('#ed-target').value || this.target;
    if (!id) return;
    const g = this.game;
    const state = JSON.parse(JSON.stringify(g.toState()));
    const clone = Game.fromState(state);
    const pl = clone.player(clone.units.get(id)!.u.owner)!;
    const w = clone.cfg.w;
    for (let i = 0; i < clone.terrain.length; i++) if (!pl.known[i]) clone.terrain[i] = T.ROCA;
    for (const r of [...clone.resources.values()]) if (!pl.knownRes.has(r.id)) clone.removeResource(r);
    for (const rt of clone.units.values()) if (rt.u.id !== id) { rt.u.program = null; rt.vm = null; rt.u.wakeAt = null; }
    const r = clone.runProgram(id, this.currentFile, { ...this.files() });
    if (!r.ok) { this.toast(`Error: ${r.error} (línea ${r.line})`, 'err'); if (r.line) this.ed.goToLine(r.line); return; }
    const u = clone.units.get(id)!.u;
    const logs0 = u.logs.length;
    const path: [number, number][] = [[u.x, u.y]];
    const t0 = clone.time;
    const storage0 = { ...pl.p.storage };
    for (let t = t0; t <= t0 + 5 * 60_000; t += 1000) {
      clone.advanceTo(t);
      const last = path[path.length - 1];
      if (last[0] !== u.x || last[1] !== u.y) path.push([u.x, u.y]);
    }
    void w;
    const gained = RES_KINDS.map((k) => [k, pl.p.storage[k] - storage0[k]] as [ResKind, number]).filter(([, n]) => n > 0);
    const blocked = u.blocked && u.blocked.attempts >= 5;
    const summary = [
      `🧪 5 min simulados: ${path.length - 1} casillas recorridas`,
      `${u.actions} acciones`,
      gained.length ? 'entregado ' + gained.map(([k, n]) => `${n} ${k}`).join(', ') : 'nada entregado',
      u.status === 'ERROR' ? `✖ ${u.error?.type} línea ${u.error?.line}` : blocked ? `⚠ bloqueado en ${u.blocked!.instr}` : u.status === 'HIBERNATING' ? '⚠ se queda sin batería' : '✓ sin errores',
    ].join(' · ');
    const newLogs = u.logs.slice(logs0).map((l) => ({ ...l, m: '[sim] ' + l.m }));
    this.simResult = { text: esc(summary), logs: newLogs, unit: id };
    // mostrar la ruta simulada sobre el mapa (en el dron real, como ruta de depuración)
    const real = g.units.get(id)!.u;
    real.route = path.slice(1);
    this.renderConsole(this.be.now(), true);
  }

  renderManual(filter: string): void {
    const f = filter.toLowerCase();
    const cats = [...new Set(API.map((a) => a.cat))];
    $('#manual').innerHTML = `<input id="man-q" placeholder="Buscar primitiva…" value="${esc(filter)}">` + cats.map((c) => {
      const items = API.filter((a) => a.cat === c && (!f || a.name.includes(f) || a.desc.toLowerCase().includes(f)));
      if (!items.length) return '';
      return `<h4>${c}</h4>` + items.map((a) => `<div class="api-item" data-ins="${esc(a.name)}">${apiHtml(a)}</div>`).join('');
    }).join('') + `<h4>Python disponible</h4><div class="api-desc">def, return, if/elif/else, while, for, break, continue, listas, tuplas, diccionarios, sets, comprensiones, f-strings, try/except, lambda, import de tus módulos, <code>math</code>, <code>random</code>, <code>heapq</code>. Cada unidad ejecuta hasta 20 000 instrucciones entre acción y acción.</div>`;
    const q = $<HTMLInputElement>('#man-q');
    q.oninput = () => {
      const pos = q.selectionStart;
      this.renderManual(q.value);
      const q2 = $<HTMLInputElement>('#man-q');
      q2.focus();
      q2.setSelectionRange(pos, pos);
    };
  }

  // ───────────── modales ─────────────
  modal(html: string, onMount?: (root: HTMLElement, close: () => void) => void): void {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-bg"><div class="modal panel">${html}</div></div>`;
    const close = () => { root.innerHTML = ''; };
    $('.modal-bg', root).addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) close(); });
    onMount?.(root, close);
  }

  showWelcome(): void {
    this.modal(`
      <h2>Bienvenido, operador</h2>
      <p class="lead">Hace décadas la red industrial colapsó. La naturaleza ha reclamado el valle, pero bajo el musgo quedan hierro, cobre, silicio y máquinas que todavía obedecen. Tu colonia empieza hoy.</p>
      <div class="rule"><b>Tú escribes el código; las máquinas hacen el trabajo.</b><br><span style="color:var(--muted);font-size:13px">Sin teclas de movimiento: escribes Python, lo cargas en tus unidades y ellas trabajan en tiempo real, también cuando cierras el juego.</span></div>
      <div class="steps">
        <div class="step"><div class="n">1</div><div>Abre el <b>editor</b> (tecla <span class="kbd">E</span>), elige una unidad (minero, granjero, constructor o hacker), lee su programa y pulsa <b>▶ Ejecutar</b>.</div></div>
        <div class="step"><div class="n">2</div><div>Observa el log del dron. Consulta el <b>Manual</b> para ver cada primitiva, su tiempo y su coste de energía.</div></div>
        <div class="step"><div class="n">3</div><div>Tu reto: que el dron <b>explore, encuentre mineral, lo extraiga, vuelva y lo descargue… una y otra vez</b>.</div></div>
      </div>
      <label for="w-name">Nombre de tu colonia</label>
      <input type="text" id="w-name" value="${esc(this.game.player(this.be.me)!.p.name)}" maxlength="28">
      <div class="foot"><button class="btn go" id="w-go">Empezar a programar</button></div>`, (root, close) => {
      const go = () => {
        const v = $<HTMLInputElement>('#w-name', root).value.trim();
        if (v) this.game.player(this.be.me)!.p.name = v;
        this.be.save();
        close();
        this.openEditor();
      };
      $('#w-go', root).onclick = go;
      $<HTMLInputElement>('#w-name', root).onkeydown = (e) => { if (e.key === 'Enter') go(); };
    });
  }

  showReport(): void {
    const r = this.be.report!;
    const gained = RES_KINDS.filter((k) => r.storageDelta[k] > 0);
    this.modal(`
      <h2>Informe de regreso</h2>
      <p class="lead">Has estado fuera <b>${fmtDur(r.awayMs)}</b>. El valle ha seguido funcionando: ${r.events.toLocaleString('es-ES')} acciones simuladas en ${r.ms.toFixed(0)} ms.</p>
      <div class="big-delta">${gained.length ? gained.map((k) => `<div class="res">${resIcon(k)}<span class="n">+${Math.floor(r.storageDelta[k])}</span></div>`).join('') : '<span class="chip">Sin entregas en la base</span>'}
        ${r.explored ? `<span class="chip">+${r.explored} casillas exploradas</span>` : ''}</div>
      ${r.units.map((u) => {
        const st = u.error ? 'ERROR' : u.blocked ? 'BLOCKED' : u.status;
        return `<div class="report-unit"><div class="ic" style="font-size:22px;color:var(--teal)">${ICON.dron}</div><div>
          <div style="display:flex;gap:8px;align-items:center"><b class="mono">${esc(u.name)}</b><span class="pill ${st}">${STATUS_LABEL[st]}</span><span style="color:var(--muted);font-size:12px">${u.program ? esc(u.program) + '.py' : 'sin programa'} · ${u.deliveries} descargas</span></div>
          ${u.blocked ? `<div class="alert red" style="margin-top:6px"><div class="kv"><span>Última instrucción</span><span>${esc(u.blocked.instr)}</span><span>Intentos fallidos</span><span>${u.blocked.attempts.toLocaleString('es-ES')}</span><span>Tiempo perdido</span><span>${fmtDur(u.blocked.lostMs)}</span></div></div>` : ''}
          ${u.error ? `<div class="alert red" style="margin-top:6px"><b>${esc(u.error.type)}</b> en la línea ${u.error.line}: ${esc(u.error.msg)}</div>` : ''}
          ${u.lastLogs.length ? `<div class="logs">${u.lastLogs.map((l) => `<div class="log"><span class="tm">·</span><span class="m">${esc(l)}</span><span></span></div>`).join('')}</div>` : ''}
        </div></div>`;
      }).join('')}
      <div class="foot"><button class="btn" id="rp-rank">${ICON.trophy} Ver ranking</button><button class="btn go" id="rp-ok">Continuar</button></div>`, (root, close) => {
      $('#rp-ok', root).onclick = close;
      $('#rp-rank', root).onclick = () => { close(); this.showRanking(); };
    });
  }

  showRanking(): void {
    const draw = () => {
      const rks = this.game.rankings();
      const rk = rks.find((r) => r.key === this.rkTab) ?? rks[0];
      return `<h2>Ranking diario</h2><p class="lead">Varias clasificaciones para que ningún estilo domine. La general suma puestos. Se reinicia a medianoche.</p>
        <div class="rk-tabs">${rks.map((r) => `<button data-k="${r.key}" class="${r.key === rk.key ? 'on' : ''}">${esc(r.label)}</button>`).join('')}</div>
        <div class="rk-unit">${esc(rk.unit)}</div>
        ${rk.rows.length ? rk.rows.map((row, i) => `<div class="rk-row ${row.id === this.be.me ? 'me' : ''}"><span class="pos">#${i + 1}</span><span class="dot" style="background:${row.color}"></span><span>${esc(row.name)}${row.id === this.be.me ? ' <span style="color:var(--teal);font-size:12px">(tú)</span>' : ''}</span><span class="val">${row.value.toLocaleString('es-ES')}</span></div>`).join('') : '<p class="lead">Todavía no hay datos hoy para esta categoría.</p>'}
        <div class="foot"><button class="btn go" id="rk-close">Cerrar</button></div>`;
    };
    this.modal(draw(), (root, close) => {
      const bind = () => {
        $('#rk-close', root).onclick = close;
        root.querySelectorAll<HTMLButtonElement>('.rk-tabs button').forEach((b) => {
          b.onclick = () => { this.rkTab = b.dataset.k!; $('.modal', root).innerHTML = draw(); bind(); };
        });
      };
      bind();
    });
  }

  showVersions(): void {
    const vs = this.be.versions(this.owner(), this.currentFile).slice().reverse();
    this.modal(`<h2>Versiones de ${esc(this.currentFile)}</h2><p class="lead">Se guarda una versión cada vez que ejecutas o pulsas Ctrl+S.</p>
      ${vs.length ? vs.map((v, i) => `<div class="ver-item"><div><div>${new Date(v.t).toLocaleString('es-ES')}</div><pre>${esc(v.src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).slice(0, 3).join('\n'))}</pre></div><button class="btn" style="flex:none;padding:0 12px" data-v="${i}">Restaurar</button></div>`).join('') : '<p class="lead">Aún no hay versiones guardadas.</p>'}
      <div class="foot"><button class="btn go" id="v-close">Cerrar</button></div>`, (root, close) => {
      $('#v-close', root).onclick = close;
      root.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => {
        b.onclick = () => {
          const v = vs[Number(b.dataset.v)];
          this.ed.setDoc(v.src);
          this.toast('Versión restaurada (sin ejecutar)', 'ok');
          close();
        };
      });
    });
  }

  showSettings(): void {
    const pl = this.game.player(this.be.me)!;
    this.modal(`<h2>Ajustes</h2>
      <label for="s-name">Nombre de la colonia</label><input type="text" id="s-name" value="${esc(pl.p.name)}" maxlength="28">
      <div class="steps">
        <div class="step"><div class="n">⇩</div><div><b>Exportar código</b>: descarga todos tus archivos .py en un único fichero para guardarlos o compartirlos.<br><button class="btn" id="s-exp" style="margin-top:6px;padding:0 14px">Exportar biblioteca</button></div></div>
        <div class="step"><div class="n">⇧</div><div><b>Importar código</b>: añade archivos .py o una biblioteca exportada.<br><label class="btn file-btn" style="margin-top:6px;padding:0 14px">Elegir archivos<input type="file" id="s-imp" accept=".py,.json" multiple hidden></label><div class="sm" id="s-imp-n" style="margin-top:4px"></div></div></div>
        <div class="step"><div class="n">◈</div><div><b>Guía visual</b>: robots, edificios, naturaleza, ruinas, recursos y terrenos del juego.<br><button class="btn" id="s-gal" style="margin-top:6px;padding:0 14px">Abrir guía visual</button></div></div>
        <div class="step"><div class="n">↺</div><div><b>Nuevo mundo</b>: genera otro valle y empieza de cero (tu código se conserva).<br><button class="btn danger" id="s-reset" style="margin-top:6px;padding:0 14px">Crear mundo nuevo</button></div></div>
      </div>
      <p class="lead" style="font-size:12px">Demo local: el mundo se guarda en este navegador. Semilla ${this.game.cfg.seed} · ${this.game.cfg.w}×${this.game.cfg.h} casillas.</p>
      <div class="foot"><button class="btn go" id="s-ok">Guardar</button></div>`, (root, close) => {
      $('#s-ok', root).onclick = () => {
        const v = $<HTMLInputElement>('#s-name', root).value.trim();
        if (v) pl.p.name = v;
        this.be.save();
        close();
      };
      $('#s-gal', root).onclick = () => { close(); this.showGallery(); };
      $('#s-exp', root).onclick = () => {
        const blob = new Blob([JSON.stringify({ grid: 1, files: this.files() }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `grid-biblioteca-${pl.p.name.replace(/\W+/g, '_')}.json`;
        a.click();
        navigator.clipboard?.writeText(JSON.stringify({ grid: 1, files: this.files() })).then(
          () => this.toast('Biblioteca copiada al portapapeles (y descargada si el navegador lo permite)', 'ok'),
          () => undefined,
        );
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
      $<HTMLInputElement>('#s-imp', root).onchange = async (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (!files) return;
        let n = 0;
        for (const f of Array.from(files)) {
          const txt = await f.text();
          if (f.name.endsWith('.json')) {
            try {
              const data = JSON.parse(txt);
              for (const [k, v] of Object.entries(data.files ?? {})) { if (typeof v === 'string' && /^[\w-]+\.py$/.test(k)) { this.be.saveFile(this.owner(), k, v, true); n++; } }
            } catch { this.toast(`${f.name} no es una biblioteca válida`, 'err'); }
          } else if (/^[\w-]+\.py$/.test(f.name)) { this.be.saveFile(this.owner(), f.name, txt, true); n++; }
        }
        this.renderTabs();
        $('#s-imp-n', root).textContent = Array.from(files).map((f) => f.name).join(', ');
        this.toast(`${n} archivo(s) importado(s)`, 'ok');
      };
      $('#s-reset', root).onclick = () => {
        const files = { ...this.files() };
        const name = pl.p.name;
        (this.be as PracticeSession).reset(name);
        for (const [k, v] of Object.entries(files)) this.be.saveFile(this.owner(), k, v);
        location.reload();
      };
    });
  }

  ask(title: string, text: string, okLabel: string, input?: string): Promise<boolean | string> {
    return new Promise((resolve) => {
      this.modal(`<h2>${esc(title)}</h2><p class="lead">${esc(text)}</p>
        ${input !== undefined ? `<input type="text" id="ask-in" value="${esc(input)}" maxlength="30">` : ''}
        <div class="foot"><button class="btn" id="ask-no">Cancelar</button><button class="btn go" id="ask-ok">${esc(okLabel)}</button></div>`, (root, close) => {
        const inp = root.querySelector<HTMLInputElement>('#ask-in');
        const ok = () => { const v = inp ? inp.value.trim() : true; close(); resolve(v); };
        $('#ask-ok', root).onclick = ok;
        $('#ask-no', root).onclick = () => { close(); resolve(false); };
        inp?.focus();
        if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
      });
    });
  }

  showGallery(): void {
    this.modal(`<h2>Guía visual</h2><p class="lead">Futurista + postindustrial + naturaleza recuperando el mundo + esperanza. Todos los assets se pintan por código.</p>
      <canvas id="gal" style="width:100%;display:block"></canvas>
      <div class="foot"><button class="btn go" id="gal-ok">Cerrar</button></div>`, (root, close) => {
      $('.modal', root).style.width = 'min(980px, 100%)';
      const c = $<HTMLCanvasElement>('#gal', root);
      let on = true;
      const tick = (t: number) => { if (!on || !c.isConnected) return; drawGallery(c, t); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      $('#gal-ok', root).onclick = () => { on = false; close(); };
    });
  }

  newFile(): void {
    this.modal(`<h2>Nuevo archivo</h2><p class="lead">Un archivo puede ser un <b>programa</b> (lo que ejecuta una unidad) o un <b>módulo de biblioteca</b> con funciones que importas desde otros programas: <code>from nav import ir_a</code>.</p>
      <label for="nf">Nombre</label><input type="text" id="nf" placeholder="minero.py" maxlength="30">
      <div class="foot"><button class="btn" id="nf-c">Cancelar</button><button class="btn go" id="nf-ok">Crear</button></div>`, (root, close) => {
      const inp = $<HTMLInputElement>('#nf', root);
      inp.focus();
      const ok = () => {
        let n = inp.value.trim().replace(/\s+/g, '_');
        if (!n) return;
        if (!n.endsWith('.py')) n += '.py';
        if (!/^[A-Za-z_][\w]*\.py$/.test(n)) { this.toast('Usa sólo letras, números y _ (debe ser un nombre de módulo válido)', 'err'); return; }
        if (n in this.files()) { this.toast('Ya existe', 'err'); return; }
        this.be.saveFile(this.owner(), n, `# ${n}\n`);
        close();
        this.openFile(n);
      };
      $('#nf-ok', root).onclick = ok;
      $('#nf-c', root).onclick = close;
      inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') close(); };
    });
  }

  // ───────────── entrada ─────────────
  bindInput(): void {
    const canvas = this.r.canvas;
    let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, cx: this.r.cam.x, cy: this.r.cam.y, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; canvas.classList.add('dragging'); }
        this.r.cam.x = drag.cx - dx / this.r.cam.zoom;
        this.r.cam.y = drag.cy - dy / this.r.cam.zoom;
      }
      const t = this.r.screenToTile(sx, sy);
      this.r.hover = t;
      const ti = $('#tileinfo');
      const g = this.game;
      if (t.x >= 0 && t.y >= 0 && t.x < g.cfg.w && t.y < g.cfg.h && !drag?.moved) {
        const known = this.be.god || g.player(this.be.me)?.known[t.y * g.cfg.w + t.x];
        ti.style.display = 'block';
        ti.style.left = `${sx + 16}px`;
        ti.style.top = `${sy + 14}px`;
        ti.textContent = `(${t.x}, ${t.y}) ${known ? TERRAIN_LABEL[TERRAIN[g.terrain[t.y * g.cfg.w + t.x] as T].key] : '· niebla'}`;
      } else ti.style.display = 'none';
    });
    const end = (e: PointerEvent) => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      canvas.classList.remove('dragging');
      if (moved) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const u = this.r.pickUnit(sx, sy, this.be.now());
      if (u) { this.select(u.id, false); return; }
      const t = this.r.screenToTile(sx, sy);
      const g = this.game;
      if (t.x < 0 || t.y < 0 || t.x >= g.cfg.w || t.y >= g.cfg.h) return;
      this.selected = null;
      this.r.selectedUnit = null;
      this.r.selectedTile = t;
      this.renderInspector(this.be.now(), true);
      this.renderUnits(this.be.now());
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointerleave', () => { this.r.hover = null; $('#tileinfo').style.display = 'none'; });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    $('#minimap').addEventListener('pointerdown', (e) => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const [x, y] = this.mm.unmap(e.clientX - rect.left, e.clientY - rect.top);
      this.r.centerOn(x, y);
    });

    // botones
    $('#btn-code').onclick = () => (this.editorOpen ? this.closeEditor() : this.openEditor());
    $('#btn-rank').onclick = () => this.showRanking();
    $('#btn-set').onclick = () => this.showSettings();
    $('#ed-close').onclick = () => this.closeEditor();
    $('#ed-new').onclick = () => this.newFile();
    $('#ed-run').onclick = () => this.runCurrent();
    $('#ed-stop').onclick = () => { const id = $<HTMLSelectElement>('#ed-target').value; if (id) { this.be.stop(id); this.toast('Programa detenido', 'warn'); } };
    $('#ed-sim').onclick = () => this.simulate();
    $('#ed-ver').onclick = () => this.showVersions();
    $('#ed-man').onclick = () => $('#manual').classList.toggle('open');
    $<HTMLSelectElement>('#ed-target').onchange = (e) => { this.target = (e.target as HTMLSelectElement).value; this.select(this.target, true); };
    $('#z-in').onclick = () => this.zoomAt(this.r.W / 2, this.r.H / 2, 1.25);
    $('#z-out').onclick = () => this.zoomAt(this.r.W / 2, this.r.H / 2, 0.8);
    $('#c-base').onclick = () => { const b = this.viewPlayer()?.p.base; if (b) this.r.centerOn(b.x + 1, b.y + 1); };
    $('#c-grid').onclick = () => this.toggleGrid();
    $('#speed').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.be.speed = Number(b.dataset.s);
      $('#speed').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (this.be.speed > 1) this.toast(`Tiempo ×${this.be.speed} (sólo en la demo; en el juego real todo dura tiempo real)`, 'warn');
    });
    $('#tabs').addEventListener('click', (e) => {
      const del = (e.target as HTMLElement).closest('[data-del]') as HTMLElement | null;
      if (del) {
        const f = del.dataset.del!;
        this.ask(`¿Eliminar ${f}?`, 'Se conservan sus versiones por si quieres recuperarlo.', 'Eliminar').then((ok) => {
          if (!ok) return;
          this.be.deleteFile(this.owner(), f);
          this.ed.forget(f);
          if (this.currentFile === f) this.openFile(Object.keys(this.files())[0]);
          else this.renderTabs();
        });
        return;
      }
      const tab = (e.target as HTMLElement).closest('.tab') as HTMLElement | null;
      if (tab) this.openFile(tab.dataset.f!);
    });
    $('#tabs').addEventListener('dblclick', (e) => {
      const tab = (e.target as HTMLElement).closest('.tab') as HTMLElement | null;
      if (!tab || tab.dataset.f! in INV_DEFAULT) return;
      const from = tab.dataset.f!;
      this.ask('Renombrar archivo', 'Recuerda actualizar los import que lo usen.', 'Renombrar', from).then((to) => {
        if (typeof to !== 'string') return;
        const name = to.endsWith('.py') ? to : to + '.py';
        if (/^[A-Za-z_]\w*\.py$/.test(name) && !(name in this.files())) { this.be.renameFile(this.owner(), from, name); this.ed.forget(from); this.openFile(name); }
        else this.toast('Nombre no válido o ya existente', 'err');
      });
    });
    $('#ulist').addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest('.ucard') as HTMLElement | null;
      if (c) { this.select(c.dataset.u!, true); return; }
      const ph = (e.target as HTMLElement).closest('.pgroup') as HTMLElement | null;
      if (ph) {
        const us = this.game.unitsOf(ph.dataset.p!);
        if (us[0]) {
          this.select(us[0].id, true);
          if (this.editorOpen) this.openFile(this.defaultFileFor(us[0]));
        }
      }
    });
    $('#manual').addEventListener('click', (e) => {
      const it = (e.target as HTMLElement).closest('.api-item') as HTMLElement | null;
      if (!it) return;
      const name = it.dataset.ins!;
      const api = API.find((a) => a.name === name)!;
      const text = api.cat === 'Memoria' ? name : api.sig.replace(/\(.*\)/, api.sig.includes('()') ? '()' : '(');
      this.ed.view.dispatch(this.ed.view.state.replaceSelection(text));
      this.ed.view.focus();
    });
    $('#inspector').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'close') { this.selected = null; this.r.selectedUnit = null; this.r.selectedTile = null; this.renderInspector(this.be.now(), true); this.renderUnits(this.be.now()); }
      if (act === 'code') this.openEditor();
      if (act === 'goerr') { this.openEditor(); this.gotoError(); }
      if (act === 'restore' && this.selected) {
        const u = this.game.units.get(this.selected)?.u;
        const file = u?.program ? u.program.name + '.py' : null;
        const vs = file ? this.be.versions(this.owner(), file) : [];
        if (file && vs.length) {
          this.be.saveFile(this.owner(), file, vs[vs.length - 1].src);
          this.ed.forget(file);
          if (this.currentFile === file) this.ed.open(file, vs[vs.length - 1].src);
          this.toast(`${file} restaurado. Pulsa Ejecutar para volver a cargarlo.`, 'ok');
        }
      }
      if (act === 'run' && this.selected) this.runOn(this.selected, $<HTMLSelectElement>('#insp-file').value);
      if (act === 'stop' && this.selected) { this.be.stop(this.selected); this.renderInspector(this.be.now(), true); }
    });

    window.addEventListener('keydown', (e) => {
      const inEditor = (e.target as HTMLElement).closest('.cm-editor, input, textarea, select');
      if (e.key === 'Escape') {
        if ($('#modal-root').innerHTML) { $('#modal-root').innerHTML = ''; return; }
        if (this.editorOpen) { this.closeEditor(); return; }
        this.selected = null; this.r.selectedUnit = null; this.r.selectedTile = null; this.renderInspector(this.be.now(), true);
        return;
      }
      if (inEditor || $('#modal-root').innerHTML) return;
      const k = e.key.toLowerCase();
      const pan = 60 / this.r.cam.zoom;
      if (k === 'e') { e.preventDefault(); this.editorOpen ? this.closeEditor() : this.openEditor(); }
      else if (k === 'r') this.showRanking();
      else if (k === 'm') { if (!this.editorOpen) this.openEditor(); $('#manual').classList.toggle('open'); }
      else if (k === 'g') this.toggleGrid();
      else if (k === 'b') $('#c-base').click();
      else if (k === 'tab') {
        e.preventDefault();
        const us = this.myUnits();
        const i = us.findIndex((u) => u.id === this.selected);
        this.select(us[(i + 1) % us.length].id, true);
      } else if (k === ' ' && this.selected) {
        e.preventDefault();
        const u = this.game.units.get(this.selected)?.u;
        if (u) this.r.centerOn(u.x, u.y);
      } else if (k === 'arrowleft') this.r.cam.x -= pan;
      else if (k === 'arrowright') this.r.cam.x += pan;
      else if (k === 'arrowup') this.r.cam.y -= pan;
      else if (k === 'arrowdown') this.r.cam.y += pan;
      else if (k === '+' || k === '=') this.zoomAt(this.r.W / 2, this.r.H / 2, 1.2);
      else if (k === '-') this.zoomAt(this.r.W / 2, this.r.H / 2, 0.83);
    });
  }

  /** centra la cámara en una casilla teniendo en cuenta los paneles abiertos */
  focus(x: number, y: number): void {
    this.r.centerOn(x, y);
    if (this.editorOpen) {
      const w = $('#editor').getBoundingClientRect().width;
      this.r.cam.x += w / 2 / this.r.cam.zoom;
    } else if (!$('#inspector').classList.contains('hidden')) {
      this.r.cam.x += 170 / this.r.cam.zoom;
    }
  }

  toggleGrid(): void {
    this.r.showGrid = !this.r.showGrid;
    $('#c-grid').classList.toggle('on', this.r.showGrid);
  }

  zoomAt(sx: number, sy: number, f: number): void {
    const cam = this.r.cam;
    const wx = (sx - this.r.W / 2) / cam.zoom + cam.x;
    const wy = (sy - this.r.H / 2) / cam.zoom + cam.y;
    cam.zoom = Math.min(3, Math.max(0.35, cam.zoom * f));
    cam.x = wx - (sx - this.r.W / 2) / cam.zoom;
    cam.y = wy - (sy - this.r.H / 2) / cam.zoom;
  }
}

