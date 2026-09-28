// Pantallas: inicio, cuentas, tutorial, práctica, guía, panel del profesor, sala (anfitrión y alumno).
import QRCode from 'qrcode';
import { API } from '../sim/api';
import { BOT_FILES, BOT_NAMES, DEFAULT_PROGRAM } from '../sim/world/content';
import { Game } from '../sim/world/game';
import { BUILDINGS, HACK, RESOURCES, SIGNAL, UNIT_TYPES, MOBILE_TYPES, type UnitType } from '../sim/world/types';
import { App } from './app';
import { api, type JoinInfo } from './net/api';
import { DEFAULT_SETTINGS, HostSession, MirrorSession, type LobbySettings, type RosterEntry, type ToStudent } from './net/multiplayer';
import { drawGallery } from './render/gallery';
import { Renderer } from './render/renderer';
import { PracticeSession } from './session';
import { LEVELS, codeLines } from './tutorial/levels';
import { TutorialSession } from './tutorial/session';
import { apiHtml } from './ui/editor';
import { ICON, resIcon } from './ui/icons';

export type Cleanup = () => void;

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const $ = <E extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as E;
const root = () => $('#app');

export const LOGO = `<svg class="logo" viewBox="0 0 32 32"><path d="M16 2l12 7v14l-12 7-12-7V9z" fill="none" stroke="#2fd4c0" stroke-width="2"/><path d="M16 9l6 3.5v7L16 23l-6-3.5v-7z" fill="#2fd4c0" opacity=".25"/><path d="M10 12.5L16 16l6-3.5M16 16v7" stroke="#2fd4c0" stroke-width="1.6" fill="none"/><circle cx="16" cy="16" r="2" fill="#f2a93b"/></svg>`;

function go(hash: string): void {
  location.hash = hash;
}

function toast(msg: string, kind: 'ok' | 'err' | 'warn' | 'info' = 'info'): void {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast panel ${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/** Mundo animado de fondo (colonias bot trabajando) */
function worldBackdrop(canvas: HTMLCanvasElement): Cleanup {
  const t0 = Date.now();
  const g = Game.create({ w: 44, h: 44, seed: 4242, tzOffsetMin: 0, name: 'fondo', timeScale: 0.35, startStorage: { hierro: 6, cobre: 4, silicio: 2, chatarra: 6 } }, t0, 4);
  for (let i = 0; i < 4; i++) {
    g.addPlayer(`b${i}`, BOT_NAMES[i], true, { ...BOT_FILES });
    for (const u of g.unitsOf(`b${i}`)) if (u.type !== 'hacker') g.runProgram(u.id, DEFAULT_PROGRAM[u.type], { ...BOT_FILES });
  }
  // la naturaleza entera a la vista
  const r = new Renderer(canvas, g, 'nadie');
  r.god = true;
  r.showGrid = false;
  r.resize();
  const b = g.player('b0')!.p.base;
  r.centerOn(b.x + 2, b.y + 4);
  r.cam.zoom = 1.15;
  let raf = 0;
  let last = performance.now();
  let gt = t0;
  const loop = (t: number) => {
    gt += (t - last) * 1.5;
    last = t;
    g.advanceTo(gt, 2000);
    r.cam.x += 0.06;
    r.cam.y += 0.02;
    r.draw(gt, t);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  const onR = () => r.resize();
  window.addEventListener('resize', onR);
  return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onR); };
}

function userChip(): string {
  const me = api.me;
  if (!me.role) return `<a class="tb-btn" href="#/entrar">${ICON.pin}<span class="lbl">Entrar / registrarse</span></a>`;
  return `<span class="chip">${me.role === 'teacher' ? '👩‍🏫 profesor' : '🎒 alumno'} · <b>${esc(me.name ?? '')}</b></span>
    ${me.role === 'teacher' ? `<a class="tb-btn" href="#/profe">${ICON.grid}<span class="lbl">Mis salas</span></a>` : ''}
    <button class="tb-btn" id="logout">Salir</button>`;
}

function bindLogout(el: ParentNode, after: () => void): void {
  const b = el.querySelector<HTMLButtonElement>('#logout');
  if (b) b.onclick = async () => { await api.logout(); after(); };
}

function page(inner: string, opts: { backdrop?: boolean; wide?: boolean } = {}): HTMLElement {
  root().innerHTML = `
    ${opts.backdrop ? '<canvas id="backdrop" class="backdrop"></canvas>' : ''}
    <div class="screen ${opts.backdrop ? 'over' : ''}">
      <header class="scr-top">
        <a class="brand" href="#/">${LOGO}<div><div class="title">G.R.I.D.</div><div class="colony">Gamified Robotics &amp; Instructional Development</div></div></a>
        <div class="spacer"></div>
        <div class="scr-user">${userChip()}</div>
      </header>
      <main class="scr-main ${opts.wide ? 'wide' : ''}">${inner}</main>
      <div id="toasts"></div><div id="modal-root"></div>
    </div>`;
  return root();
}

// ───────────────────────── inicio ─────────────────────────

export function mountHome(): Cleanup {
  const el = page(`
    <section class="hero">
      <h1>No controlas las máquinas.<br><span>Las programas.</span></h1>
      <p class="lead">El mundo cayó, pero estamos construyendo algo nuevo. Escribe Python, cárgalo en tus robots y compite con tu clase en partidas de 15 minutos por reconstruir el valle.</p>
    </section>
    <section class="cards">
      <div class="card panel join">
        <div class="k">Tengo un código de sala</div>
        <form id="joinf" class="row"><input id="jcode" maxlength="6" placeholder="ABC123" autocomplete="off" aria-label="Código de sala"><button class="btn go" type="submit">Entrar</button></form>
        <p class="sm">Te lo da tu profesor (o escanea su QR).</p>
      </div>
      <a class="card panel" href="#/tutorial"><div class="k">${ICON.target} Tutorial</div><h3>8 niveles para aprender</h3><p class="sm">Del primer <code>mover("E")</code> a clases y excepciones. Sin código de sala.</p></a>
      <a class="card panel" href="#/practica"><div class="k">${ICON.play} Práctica libre</div><h3>Tu colonia, a tu ritmo</h3><p class="sm">Un valle con colonias rivales que sigue funcionando cuando cierras.</p></a>
      <a class="card panel" href="#/guia"><div class="k">${ICON.book} Guía del operador</div><h3>Instrucciones completas</h3><p class="sm">Unidades, edificios, huertos, hackeo y todas las primitivas.</p></a>
      <a class="card panel prof" href="#/profe"><div class="k">👩‍🏫 Profesor</div><h3>Crear una sala</h3><p class="sm">Hasta 20 alumnos en el mismo mapa. Tú lo ves todo y puedes programar cualquier unidad.</p></a>
    </section>`, { backdrop: true });
  const stop = worldBackdrop($<HTMLCanvasElement>('#backdrop'));
  bindLogout(el, () => mountHome());
  $('#joinf', el).onsubmit = (e) => {
    e.preventDefault();
    const c = $<HTMLInputElement>('#jcode', el).value.trim().toUpperCase();
    if (c.length >= 4) go(`#/sala/${c}`);
  };
  return stop;
}

// ───────────────────────── cuentas ─────────────────────────

export function mountAuth(next: string): Cleanup {
  const el = page(`
    <section class="auth">
      <div class="panel form-card">
        <div class="tabs2"><button class="on" data-t="s">Soy alumno</button><button data-t="t">Soy profesor</button></div>
        <div id="auth-body"></div>
      </div>
      ${api.mode === 'local' ? '<p class="sm warn">Modo local: sin servidor, las cuentas se guardan sólo en este navegador.</p>' : ''}
    </section>`);
  let tab: 's' | 't' = 's';
  let reg = false;
  const draw = () => {
    const b = $('#auth-body', el);
    if (tab === 's') {
      b.innerHTML = `
        <h2>${reg ? 'Crear cuenta de alumno' : 'Entrar como alumno'}</h2>
        <p class="sm">Sin email: sólo un nombre de usuario y un PIN de 4 cifras. ¡Apúntalo!</p>
        <form id="af">
          <label for="au">Usuario</label><input id="au" autocomplete="username" maxlength="24" placeholder="p. ej. ana.g" required>
          <label for="ap">PIN (4 cifras)</label><input id="ap" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="current-password" required>
          <button class="btn go" type="submit">${reg ? 'Crear cuenta' : 'Entrar'}</button>
        </form>
        <button class="link-btn" id="sw">${reg ? 'Ya tengo cuenta' : '¿No tienes cuenta? Créala aquí'}</button>`;
    } else {
      b.innerHTML = `
        <h2>${reg ? 'Registro de profesor' : 'Entrar como profesor'}</h2>
        <form id="af">
          ${reg ? '<label for="an">Nombre</label><input id="an" maxlength="60" required>' : ''}
          <label for="ae">Email</label><input id="ae" type="email" autocomplete="email" required>
          <label for="ap">Contraseña (mín. 8)</label><input id="ap" type="password" minlength="8" autocomplete="${reg ? 'new-password' : 'current-password'}" required>
          <button class="btn go" type="submit">${reg ? 'Crear cuenta' : 'Entrar'}</button>
        </form>
        <button class="link-btn" id="sw">${reg ? 'Ya tengo cuenta' : 'Crear cuenta de profesor'}</button>`;
    }
    $('#sw', b).onclick = () => { reg = !reg; draw(); };
    $<HTMLFormElement>('#af', b).onsubmit = async (e) => {
      e.preventDefault();
      const btn = $<HTMLButtonElement>('button[type=submit]', b);
      btn.disabled = true;
      try {
        if (tab === 's') {
          const u = $<HTMLInputElement>('#au', b).value.trim();
          const p = $<HTMLInputElement>('#ap', b).value.trim();
          if (reg) await api.studentRegister(u, p); else await api.studentLogin(u, p);
        } else {
          const em = $<HTMLInputElement>('#ae', b).value.trim();
          const p = $<HTMLInputElement>('#ap', b).value;
          if (reg) await api.teacherRegister(em, p, $<HTMLInputElement>('#an', b).value.trim());
          else await api.teacherLogin(em, p);
        }
        go(next || (api.me.role === 'teacher' ? '#/profe' : '#/'));
      } catch (err) {
        toast((err as Error).message, 'err');
        btn.disabled = false;
      }
    };
  };
  el.querySelectorAll<HTMLButtonElement>('.tabs2 button').forEach((bt) => {
    bt.onclick = () => {
      tab = bt.dataset.t as 's' | 't';
      el.querySelectorAll('.tabs2 button').forEach((x) => x.classList.toggle('on', x === bt));
      draw();
    };
  });
  if (next.startsWith('#/profe')) $<HTMLButtonElement>('.tabs2 button[data-t=t]', el).click();
  else draw();
  return () => {};
}

// ───────────────────────── tutorial ─────────────────────────

export async function mountTutorialMenu(): Promise<Cleanup> {
  const prog = await api.progress();
  const done = new Set(prog.filter((p) => p.done).map((p) => p.level));
  const el = page(`
    <section class="hero small"><h1>Tutorial</h1><p class="lead">Ocho retos cortos. Cada uno presenta una idea de Python a través del juego. ${api.me.role === 'student' ? 'Tu progreso se guarda en tu cuenta.' : 'Entra con tu cuenta de alumno para guardar el progreso.'}</p></section>
    <section class="levels">
      ${LEVELS.map((l) => `<a class="panel lvl ${done.has(l.n) ? 'done' : ''}" href="#/tutorial/${l.n}">
        <div class="num">${done.has(l.n) ? '✓' : l.n}</div>
        <div><h3>${esc(l.title)}</h3><div class="concept">${esc(l.concept)}</div><p class="sm">${esc(l.goal)}</p></div>
        <div class="u">${ICON[l.unit]}</div></a>`).join('')}
    </section>`);
  bindLogout(el, () => mountTutorialMenu());
  return () => {};
}

export async function mountTutorialLevel(n: number): Promise<Cleanup> {
  const level = LEVELS.find((l) => l.n === n);
  if (!level) { go('#/tutorial'); return () => {}; }
  const prog = await api.progress();
  const saved = prog.find((p) => p.level === n)?.code ?? null;
  const sess = new TutorialSession(level, saved);
  let finished = false;
  let hintI = 0;
  let lastSig = '';
  root().innerHTML = '';
  const app = new App(sess, {
    zoom: 1.35,
    hideSettings: true,
    onReady: (a) => {
      a.r.beacons = sess.beacons;
      const u = sess.game.unitsOf('p1').find((x) => x.type === level.unit)!;
      a.select(u.id, false);
      a.target = u.id;
      a.openFile('nivel.py');
      a.modal(`<div class="k-lbl">Nivel ${level.n} · ${esc(level.concept)}</div><h2>${esc(level.title)}</h2><p class="lead">${esc(level.intro)}</p>
        <div class="rule"><b>Objetivo:</b> ${esc(level.goal)}</div>
        <div class="foot"><a class="btn" href="#/tutorial">Niveles</a><button class="btn go" id="lv-go">Al código</button></div>`, (r, close) => {
        $('#lv-go', r).onclick = () => { close(); a.openEditor(); };
      });
    },
    sidePanel: (a, el) => {
      const code = sess.lastCode || sess.filesOf('p1')['nivel.py'] || '';
      const res = level.check({ game: sess.game, code: sess.lastCode, beacons: sess.beacons, visited: sess.visited });
      const sig = JSON.stringify([res, codeLines(code)]);
      if (sig !== lastSig) {
        lastSig = sig;
        el.innerHTML = `<div class="lbl">${ICON.target} Nivel ${level.n} de ${LEVELS.length}</div>
          <div class="txt"><b>${esc(level.title)}</b><br><span class="sm">${esc(level.goal)}</span></div>
          <div class="cnt" style="text-align:left">${esc(res.progress)}</div>
          ${res.fail ? `<div class="alert amber" style="margin-top:6px">${esc(res.fail)}</div>` : ''}
          <div class="btn-row" style="margin-top:8px"><button class="btn" id="lv-hint">💡 Pista</button><button class="btn" id="lv-reset">↺ Reiniciar</button></div>
          <a class="link-btn" href="#/tutorial">← todos los niveles</a>`;
        $('#lv-hint', el).onclick = () => {
          const h = level.hints[hintI % level.hints.length];
          hintI++;
          a.modal(`<h2>Pista ${Math.min(hintI, level.hints.length)}/${level.hints.length}</h2><pre class="api-ex" style="font-size:13px">${esc(h)}</pre><div class="foot"><button class="btn go" id="hk">Entendido</button></div>`, (r, close) => { $('#hk', r).onclick = close; });
        };
        $('#lv-reset', el).onclick = () => {
          api.saveProgress(n, false, sess.filesOf('p1')['nivel.py'] ?? '');
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        };
      }
      if (res.done && !finished) {
        finished = true;
        api.saveProgress(n, true, sess.lastCode);
        const next = LEVELS.find((l) => l.n === n + 1);
        setTimeout(() => {
          a.modal(`<div class="k-lbl">¡Reto superado!</div><h2>${esc(level.title)} ✓</h2><p class="lead">Has usado: <b>${esc(level.concept)}</b>. Programa de ${codeLines(sess.lastCode)} líneas.</p>
            <div class="foot"><a class="btn" href="#/tutorial">Niveles</a>${next ? `<a class="btn go" href="#/tutorial/${next.n}">Siguiente: ${esc(next.title)}</a>` : '<a class="btn go" href="#/">¡Tutorial completado!</a>'}</div>`);
        }, 700);
      }
    },
  });
  const orig = sess.run.bind(sess);
  sess.run = (u, f) => {
    const r = orig(u, f);
    if (r.ok) api.saveProgress(n, false, sess.lastCode);
    return r;
  };
  return () => app.destroy();
}

// ───────────────────────── práctica ─────────────────────────

export function mountPractice(): Cleanup {
  root().innerHTML = '';
  const sess = new PracticeSession();
  const app = new App(sess);
  (window as unknown as { grid: unknown }).grid = { app, be: sess };
  return () => app.destroy();
}

// ───────────────────────── guía ─────────────────────────

export function mountGuide(): Cleanup {
  const unitCard = (t: UnitType) => {
    const i = UNIT_TYPES[t];
    return `<div class="panel ucard2"><div class="ic ${t}">${ICON[t]}</div><div><h3>${esc(i.label)}</h3><p>${esc(i.desc)}</p>
      <div class="chips">${i.air ? '<span class="chip">vuela</span>' : '<span class="chip">por tierra</span>'}<span class="chip">escáner radio ${i.scan}</span>${i.cargo ? `<span class="chip">carga ${i.cargo}</span>` : ''}${i.water ? `<span class="chip">agua ${i.water}</span>` : ''}</div>
      <div class="prims">${i.actions.filter((a) => !['mover', 'mirar', 'esperar', 'radar', 'descargar', 'recargar', 'escanear'].includes(a)).map((a) => `<code>${a}()</code>`).join(' ')}</div></div></div>`;
  };
  const cats = [...new Set(API.map((a) => a.cat))];
  const el = page(`
    <article class="guide">
      <h1>Guía del operador</h1>
      <p class="lead">G.R.I.D. es un juego de estrategia en el que <b>no controlas nada directamente</b>: escribes programas en Python y tus unidades los ejecutan en tiempo real sobre un mapa en cuadrícula compartido con tu clase.</p>
      <nav class="toc">${['Partida', 'Unidades', 'Huertos', 'Edificios', 'Hackeo', 'Errores', 'Primitivas', 'Python', 'Profesor', 'Arte'].map((s) => `<a href="#g-${s}" data-sec="${s}">${s}</a>`).join('')}</nav>

      <h2 id="g-Partida">1 · Cómo es una partida</h2>
      <div class="steps">
        <div class="step"><div class="n">1</div><div><b>Lobby.</b> Entras con el código de sala (o el QR) y eliges tu nombre. Esperas a que el profesor empiece.</div></div>
        <div class="step"><div class="n">2</div><div><b>Preparación (≈5 min).</b> Ves el mapa y programas. Tus unidades todavía no se mueven: aprovecha para escribir y cargar tus programas.</div></div>
        <div class="step"><div class="n">3</div><div><b>Partida (≈15 min).</b> Todo se pone en marcha. Puedes corregir y volver a ejecutar cuando quieras.</div></div>
        <div class="step"><div class="n">4</div><div><b>Final.</b> Gana quien más <b>puntos</b> haya conseguido entregando recursos en su base, almacenes o silos.</div></div>
      </div>
      <div class="pts">${Object.entries(RESOURCES).map(([k, r]) => `<span class="res">${resIcon(k)} ${esc(r.label)} <b>${r.value}</b></span>`).join('')}</div>
      <p>Cada unidad tiene <b>batería</b>: <code>recargar()</code> junto a la base o a un panel solar. Fuera del alcance de la base (radio ${SIGNAL.base}) o de una antena (radio ${SIGNAL.antena}) no hay señal y cada acción tarda el doble.</p>

      <h2 id="g-Unidades">2 · Tus unidades</h2>
      <div class="ugrid">${[...MOBILE_TYPES, 'aspersor' as UnitType].map(unitCard).join('')}</div>
      <p class="sm">Cada unidad ejecuta su propio programa. Tienes un archivo para cada una (<code>minero.py</code>, <code>granjero.py</code>…) y una biblioteca <code>nav.py</code> para tus funciones: <code>from nav import ir_a</code>. Las unidades se comunican con el diccionario <code>compartido</code>.</p>

      <h2 id="g-Huertos">3 · Huertos</h2>
      <p>Las parcelas marrones son huertos: las 6 junto a tu base son tuyas y hay huertos salvajes por el mapa (¡cualquiera puede cosechar ahí!). Un cultivo crece <b>1 % por segundo mientras su humedad sea mayor de 30</b>. La humedad baja sola (se seca en unos 90 s). <code>regar()</code> suma 45. Con madurez 100, <code>recolectar()</code> da 2 de cosecha. Si recolectas antes, salta <code>CultivoNoMaduroError</code>.</p>
      <pre class="api-ex">for p in parcelas():
    if p.propia and p.plantada and p.humedad &lt; 40:
        ir_a(p.x, p.y)
        regar()</pre>

      <h2 id="g-Edificios">4 · Edificios</h2>
      <table class="tbl"><thead><tr><th>Tipo</th><th>Coste</th><th>Para qué sirve</th></tr></thead><tbody>
      ${Object.entries(BUILDINGS).map(([k, b]) => `<tr><td><code>"${k}"</code></td><td>${Object.entries(b.cost).map(([r, n]) => `${n} ${r}`).join(' + ')}</td><td>${esc(b.desc)}</td></tr>`).join('')}
      </tbody></table>
      <p>El constructor construye en la casilla vecina: <code>construir("panel", "S")</code>. Los recursos salen del almacén de tu colonia; si faltan, salta <code>SinRecursosError</code>.</p>

      <h2 id="g-Hackeo">5 · Hackeo y defensa</h2>
      <p>El dron hacker, en una casilla vecina a una unidad rival, puede cambiar su código con <code>hackear(direccion, modo)</code>:</p>
      <ul><li><code>"invertir"</code>: cambia una dirección: "N" ↔ "S", "E" ↔ "O".</li><li><code>"numero"</code>: suma o resta 1 a un número del código.</li><li><code>"borrar"</code>: quita un carácter (puede romper el programa; el profesor decide si está permitido).</li></ul>
      <p>Reglas: ${HACK.channelMs / 1000} s junto al objetivo · ${HACK.cooldownMs / 1000} s de enfriamiento · la víctima queda protegida ${HACK.immuneMs / 1000} s · la víctima ve en su log la línea cambiada y puede restaurar la versión anterior. <b>Defensa:</b> un aspersor con <code>disparar(x, y)</code> moja a los drones enemigos (${HACK.wetMs / 1000} s sin actuar y hackeo cancelado). Con <code>integridad()</code> un programa sabe si lo han tocado.</p>

      <h2 id="g-Errores">6 · Errores del juego</h2>
      <p>Algunas primitivas lanzan excepciones. Captúralas con <code>try / except</code> para que tu programa no se pare:</p>
      <pre class="api-ex">try:
    construir("antena", "E")
except SinRecursosError as e:
    print("todavía no:", e)</pre>
      <div class="apis">${API.filter((a) => a.cat === 'Errores').map((a) => `<div class="api-item">${apiHtml(a)}</div>`).join('')}</div>

      <h2 id="g-Primitivas">7 · Todas las primitivas</h2>
      ${cats.filter((c) => c !== 'Errores').map((c) => `<h3>${esc(c)}</h3><div class="apis">${API.filter((a) => a.cat === c).map((a) => `<div class="api-item">${apiHtml(a)}${a.raises ? `<div class="api-meta"><span>⚠ ${esc(a.raises)}</span></div>` : ''}</div>`).join('')}</div>`).join('')}

      <h2 id="g-Python">8 · El Python de G.R.I.D.</h2>
      <p>Es Python de verdad (un subconjunto): <code>def</code>, <code>class</code> (con herencia y <code>__init__</code>), <code>if/elif/else</code>, <code>while</code>, <code>for</code>, listas, tuplas, diccionarios, conjuntos, comprensiones, f-strings, <code>try/except/finally</code>, <code>lambda</code>, <code>import</code> de tus archivos y los módulos <code>math</code>, <code>random</code> y <code>heapq</code>. No hay acceso a archivos, red ni <code>eval</code>. Cada unidad puede ejecutar hasta 20 000 instrucciones entre dos acciones.</p>
      <table class="tbl"><thead><tr><th>Concepto</th><th>Dónde lo necesitas</th></tr></thead><tbody>
        <tr><td>Textos</td><td>direcciones "N"/"S", mensajes, lo que cambia el hacker</td></tr>
        <tr><td>Bucles</td><td>repetir el ciclo picar → volver → descargar</td></tr>
        <tr><td>Condicionales</td><td>batería baja, parcela seca, camino bloqueado</td></tr>
        <tr><td>Funciones</td><td><code>ir_a(x, y)</code>, <code>volver_base()</code> en tu biblioteca</td></tr>
        <tr><td>Listas y diccionarios</td><td><code>escanear()</code>, <code>inventario()</code>, <code>memoria</code>, <code>compartido</code></td></tr>
        <tr><td>Excepciones</td><td>cultivo no maduro, faltan recursos, enemigo fuera de rango</td></tr>
        <tr><td>Objetos y clases</td><td>parcelas, unidades del radar, tus propias clases (planes de obra, rutas)</td></tr>
      </tbody></table>

      <h2 id="g-Profesor">9 · Para el profesor</h2>
      <ol>
        <li>Crea una cuenta de profesor y una sala. Proyecta el código y el QR.</li>
        <li>Ajusta minutos de preparación y partida, activa o no el hackeo (y el modo «borrar») y añade colonias bot si hay pocos alumnos.</li>
        <li>Pulsa <b>Empezar</b>. Tu navegador hace de servidor de la partida: no cierres la pestaña (si se cierra, la partida se detiene).</li>
        <li>En modo profesor ves todo el mapa, todas las unidades y todo el código. Selecciona cualquier unidad para leer o editar su programa y ejecutarlo: el alumno lo verá en su editor.</li>
        <li>Controles: saltar preparación, +1 minuto, pausa, terminar. Al acabar, los resultados se guardan en tu cuenta.</li>
      </ol>

      <h2 id="g-Arte">10 · Guía visual</h2>
      <canvas id="gal" style="width:100%;display:block"></canvas>
    </article>`, { wide: true });
  bindLogout(el, () => mountGuide());
  el.querySelectorAll<HTMLAnchorElement>('.toc a').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); document.getElementById(`g-${a.dataset.sec}`)?.scrollIntoView({ behavior: 'smooth' }); };
  });
  let on = true;
  const c = $<HTMLCanvasElement>('#gal', el);
  const tick = (t: number) => { if (!on) return; drawGallery(c, t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return () => { on = false; };
}

// ───────────────────────── profesor: salas ─────────────────────────

export async function mountTeacher(): Promise<Cleanup> {
  if (api.me.role !== 'teacher') { go('#/entrar?next=' + encodeURIComponent('#/profe')); return () => {}; }
  const rooms = await api.myRooms().catch(() => []);
  const el = page(`
    <section class="hero small"><h1>Tus salas</h1><p class="lead">Crea una sala para cada grupo. Los alumnos entran con el código o el QR.</p></section>
    <section class="rooms">
      <form class="panel form-card row" id="newroom"><input id="rt" maxlength="60" placeholder="Nombre de la sala (p. ej. 2º DAW · martes)" required><button class="btn go">${ICON.plus} Crear sala</button></form>
      ${rooms.length ? rooms.map((r) => `<a class="panel room" href="#/profe/${r.code}"><span class="code">${esc(r.code)}</span><span class="t">${esc(r.title)}</span><span class="sm">${r.created_at ? new Date(r.created_at).toLocaleDateString('es-ES') : ''}</span><span class="btn">Abrir</span></a>`).join('') : '<p class="sm">Aún no tienes salas.</p>'}
      ${api.mode === 'local' ? '<p class="sm warn">Modo local (sin servidor): los alumnos sólo pueden unirse desde otras pestañas de este mismo navegador. En grid.carloshidalgo.eu funcionará en red.</p>' : ''}
    </section>`);
  bindLogout(el, () => go('#/'));
  $<HTMLFormElement>('#newroom', el).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.createRoom($<HTMLInputElement>('#rt', el).value.trim());
      go(`#/profe/${r.code}`);
    } catch (err) { toast((err as Error).message, 'err'); }
  };
  return () => {};
}

// ───────────────────────── profesor: sala (anfitrión) ─────────────────────────

let activeHost: HostSession | null = null;

export async function mountHost(code: string): Promise<Cleanup> {
  if (api.me.role !== 'teacher') { go('#/entrar?next=' + encodeURIComponent(`#/profe/${code}`)); return () => {}; }
  const info = await api.roomInfo(code).catch(() => null);
  if (!info) { toast('No existe esa sala', 'err'); go('#/profe'); return () => {}; }
  // una sola sesión anfitriona por pestaña
  activeHost?.close();
  const host = new HostSession(api.transport(code, 'host', `profe${api.me.id}`), code, info.title);
  activeHost = host;
  let app: App | null = null;
  let raf = 0;
  let savedResults = false;
  let endShown = false;
  const joinUrl = `${location.origin}${location.pathname}#/sala/${code}`;
  const qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 260, color: { dark: '#0b1416', light: '#ffffff' } });

  const lobbyLoop = (t: number) => {
    host.tick(t);
    raf = requestAnimationFrame(lobbyLoop);
  };

  const showLobby = () => {
    app?.destroy();
    app = null;
    const el = page(`
      <section class="host-lobby">
        <div class="panel qr-card">
          <div class="k-lbl">Sala · ${esc(info.title)}</div>
          <div class="bigcode">${esc(code)}</div>
          <img src="${qr}" alt="Código QR para unirse a la sala" width="220" height="220">
          <div class="sm mono sel">${esc(joinUrl)}</div>
          <button class="btn" id="copy">Copiar enlace</button>
        </div>
        <div class="panel lobby-card">
          <div class="sec-title"><span>Alumnos conectados</span><span id="nroster">0</span></div>
          <div id="roster" class="roster"></div>
          <div class="sec-title" style="margin-top:14px"><span>Ajustes de la partida</span></div>
          <form id="settings" class="settings">
            <label>Preparación <input type="number" id="s-prep" min="0" max="30" step="0.5" value="${host.settings.prepMin}"> min</label>
            <label>Partida <input type="number" id="s-play" min="1" max="120" step="1" value="${host.settings.playMin}"> min</label>
            <label>Colonias bot <input type="number" id="s-bots" min="0" max="6" step="1" value="${host.settings.bots}"></label>
            <label class="ck"><input type="checkbox" id="s-hack" ${host.settings.hacking ? 'checked' : ''}> Permitir hackeo</label>
            <label class="ck"><input type="checkbox" id="s-break" ${host.settings.hackBreak ? 'checked' : ''}> Permitir el modo «borrar» (rompe código)</label>
          </form>
          <button class="btn go big" id="start">${ICON.play} Empezar partida</button>
          <p class="sm">Tu navegador hará de servidor: no cierres esta pestaña durante la partida.${api.mode === 'local' || !api.ably ? ' <b>Modo local:</b> los alumnos deben abrir la sala en otra pestaña de este navegador.' : ''}</p>
        </div>
      </section>`, { wide: true });
    bindLogout(el, () => go('#/'));
    $('#copy', el).onclick = () => { navigator.clipboard?.writeText(joinUrl).then(() => toast('Enlace copiado', 'ok'), () => toast(joinUrl)); };
    const readSettings = () => {
      const s: LobbySettings = {
        prepMin: Math.max(0, Number($<HTMLInputElement>('#s-prep', el).value) || 0),
        playMin: Math.max(1, Number($<HTMLInputElement>('#s-play', el).value) || DEFAULT_SETTINGS.playMin),
        bots: Math.max(0, Math.min(6, Number($<HTMLInputElement>('#s-bots', el).value) || 0)),
        hacking: $<HTMLInputElement>('#s-hack', el).checked,
        hackBreak: $<HTMLInputElement>('#s-break', el).checked,
      };
      host.settings = s;
      host.sendLobby(true);
    };
    $('#settings', el).addEventListener('change', readSettings);
    const drawRoster = () => {
      if (!$('#nroster', el)) return;
      const r = host.roster();
      $('#nroster', el).textContent = String(r.length);
      $('#roster', el).innerHTML = r.length ? r.map((x: RosterEntry) => `<div class="rchip ${x.online ? '' : 'off'}"><span class="dot"></span>${esc(x.name)}<button class="x" data-k="${esc(x.cid)}" title="Sacar de la sala">✕</button></div>`).join('') : '<p class="sm">Esperando alumnos… (escanean el QR o escriben el código)</p>';
      el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => { b.onclick = () => host.kick(b.dataset.k!); });
    };
    host.onRoster = drawRoster;
    drawRoster();
    const iv = window.setInterval(drawRoster, 3000);
    $('#start', el).onclick = () => {
      readSettings();
      if (!host.roster().length && !host.settings.bots) { toast('No hay alumnos conectados (o añade colonias bot)', 'warn'); return; }
      clearInterval(iv);
      host.start();
      showGame();
    };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(lobbyLoop);
    cleanupLobby = () => clearInterval(iv);
  };
  let cleanupLobby = () => {};

  const showGame = () => {
    cleanupLobby();
    host.onRoster = undefined;
    cancelAnimationFrame(raf);
    root().innerHTML = '';
    savedResults = false;
    endShown = false;
    app = new App(host, {
      zoom: 0.6,
      onReady: (a) => {
        const ctl = $('#hostctl');
        ctl.innerHTML = `<span class="chip mono" title="Código de sala">${esc(code)}</span>
          <button class="tb-btn" id="h-skip" title="Terminar la preparación ya">⏭</button>
          <button class="tb-btn" id="h-plus" title="Añadir 1 minuto">+1′</button>
          <button class="tb-btn" id="h-pause" title="Pausar / reanudar">⏸</button>
          <button class="tb-btn" id="h-end" title="Terminar la partida">■</button>
          <button class="tb-btn" id="h-proj" title="Ranking a pantalla completa">📽</button>`;
        $('#h-skip').onclick = () => host.skipPrep();
        $('#h-plus').onclick = () => { host.extend(60_000); toast('+1 minuto', 'ok'); };
        $('#h-pause').onclick = () => { host.setPaused(!host.paused); $('#h-pause').textContent = host.paused ? '▶' : '⏸'; };
        $('#h-end').onclick = () => a.ask('¿Terminar la partida ahora?', 'Se congelan todas las unidades y se muestran los resultados.', 'Terminar').then((ok) => { if (ok) host.endNow(); });
        $('#h-proj').onclick = () => showBoard(a, host.game, true);
      },
    });
    const watch = () => {
      if (!app) return;
      if (host.game.phase(host.now()) === 'end' && !endShown) {
        endShown = true;
        const rows = host.game.rankings()[0].rows;
        if (!savedResults) {
          savedResults = true;
          api.saveResults(code, { at: Date.now(), settings: host.settings, ranking: host.game.rankings() }).catch(() => {});
        }
        showBoard(app, host.game, false, () => host.backToLobby());
        void rows;
      }
      if (host.state === 'lobby') { showLobby(); return; }
      raf = requestAnimationFrame(watch);
    };
    raf = requestAnimationFrame(watch);
  };

  if (host.state === 'game') showGame(); else showLobby();
  return () => {
    cancelAnimationFrame(raf);
    cleanupLobby();
    app?.destroy();
    host.close();
    if (activeHost === host) activeHost = null;
  };
}

/** Clasificación grande (proyectable) o resultados finales */
function showBoard(a: App, g: Game, live: boolean, onNew?: () => void): void {
  const draw = () => {
    const rows = g.rankings()[0].rows;
    const podium = rows.slice(0, 3);
    return `<div class="board">
      <h2>${live ? 'Clasificación en directo' : '🏁 Resultados'}</h2>
      <div class="podium">${[1, 0, 2].map((i) => podium[i] ? `<div class="pod p${i + 1}"><div class="nm" style="color:${podium[i].color}">${esc(podium[i].name)}</div><div class="bar"><b>${podium[i].value}</b><span>${i + 1}º</span></div></div>` : '<div></div>').join('')}</div>
      <div class="rk-list">${rows.slice(3).map((r, i) => `<div class="rk-row"><span class="pos">#${i + 4}</span><span class="dot" style="background:${r.color}"></span><span>${esc(r.name)}</span><span class="val">${r.value}</span></div>`).join('')}</div>
      <div class="foot">${onNew ? '<button class="btn" id="b-new">Volver al lobby (nueva partida)</button>' : ''}<button class="btn go" id="b-close">Cerrar</button></div></div>`;
  };
  a.modal(draw(), (r, close) => {
    const m = $('.modal', r);
    m.style.width = 'min(900px, 100%)';
    const iv = live ? window.setInterval(() => { if (!r.isConnected || !m.isConnected) { clearInterval(iv); return; } m.innerHTML = draw(); bind(); }, 2000) : 0;
    const bind = () => {
      $('#b-close', r).onclick = () => { clearInterval(iv); close(); };
      const bn = r.querySelector<HTMLButtonElement>('#b-new');
      if (bn && onNew) bn.onclick = () => { clearInterval(iv); close(); onNew(); };
    };
    bind();
  });
}

// ───────────────────────── alumno: sala ─────────────────────────

export async function mountStudentRoom(code: string): Promise<Cleanup> {
  code = code.toUpperCase();
  const info = await api.roomInfo(code).catch((e: Error) => { toast(e.message, 'err'); return null; });
  if (!info) { go('#/'); return () => {}; }
  let join: JoinInfo | null = null;
  const nameKey = 'grid.name';
  let stored = '';
  try { stored = localStorage.getItem(nameKey) ?? ''; } catch { /* nada */ }
  const el = page(`
    <section class="auth">
      <div class="panel form-card">
        <div class="k-lbl">Sala ${esc(code)}</div><h2>${esc(info.title)}</h2>
        <form id="jf">
          <label for="jn">Tu nombre en la partida</label>
          <input id="jn" maxlength="20" required value="${esc(api.me.role === 'student' ? api.me.name ?? '' : stored)}">
          <button class="btn go" type="submit">Entrar a la sala</button>
        </form>
        ${api.me.role ? '' : '<p class="sm">¿Tienes cuenta? <a href="#/entrar">Entra</a> para que tu progreso quede guardado. No es obligatorio.</p>'}
      </div>
    </section>`);
  bindLogout(el, () => mountStudentRoom(code));
  let cleanup: Cleanup = () => {};
  await new Promise<void>((resolve) => {
    $<HTMLFormElement>('#jf', el).onsubmit = async (e) => {
      e.preventDefault();
      const name = $<HTMLInputElement>('#jn', el).value.trim();
      try { localStorage.setItem(nameKey, name); } catch { /* nada */ }
      try {
        join = await api.join(code, name);
        resolve();
      } catch (err) { toast((err as Error).message, 'err'); }
    };
  });
  const j = join!;
  const t = api.transport(code, 'student', j.cid, j.jt);
  let mirror: MirrorSession | null = null;
  let app: App | null = null;
  let endShown = false;
  let lastLobby: Extract<ToStudent, { type: 'lobby' }> | null = null;
  const unsub: (() => void)[] = [];

  const drawLobby = () => {
    app?.destroy();
    app = null;
    mirror = null;
    const l = lastLobby;
    page(`
      <section class="wait">
        <div class="panel form-card center">
          <div class="k-lbl">Sala ${esc(code)} · ${esc(info.title)}</div>
          <h2>Hola, ${esc(j.name)} 👋</h2>
          <p class="lead">${l ? 'Estás dentro. Esperando a que el profesor empiece la partida…' : 'Conectando con el profesor…'}</p>
          <div class="spinner"></div>
          ${l ? `<div class="roster">${l.roster.map((r) => `<div class="rchip ${r.online ? '' : 'off'} ${r.cid === j.cid ? 'me' : ''}"><span class="dot"></span>${esc(r.name)}</div>`).join('')}</div>
          <p class="sm">Partida: ${l.settings.prepMin} min de preparación + ${l.settings.playMin} min de juego · hackeo ${l.settings.hacking ? 'activado' : 'desactivado'}</p>` : ''}
          <p class="sm">Mientras esperas: <a href="#/guia" target="_blank" rel="noopener">abre la guía en otra pestaña</a>.</p>
        </div>
      </section>`);
  };
  drawLobby();

  const hello = (want?: 'init') => t.send('host', { type: 'hello', cid: j.cid, name: j.name, want });
  unsub.push(t.listen('all', (raw) => {
    const m = raw as ToStudent;
    if (m.type === 'lobby') {
      lastLobby = m;
      if (!mirror) {
        drawLobby();
        if (m.state === 'game') hello('init');
      }
    } else if (m.type === 'reset') {
      drawLobby();
    }
  }));
  unsub.push(t.listen(`c:${j.cid}`, (raw) => {
    const m = raw as ToStudent;
    if (m.type === 'init') {
      app?.destroy();
      root().innerHTML = '';
      mirror = new MirrorSession(t, j.cid, m);
      endShown = false;
      app = new App(mirror, { zoom: 1.2 });
      (window as unknown as { grid: unknown }).grid = undefined;
      mirror.onResult = (r) => {
        if (!r.ok) app?.toast(`No se puede ejecutar: ${r.error}${r.line ? ` (línea ${r.line})` : ''}`, 'err');
      };
    } else if (m.type === 'patch') {
      if (!mirror) { hello('init'); return; }
      mirror.apply(m);
      if (app && !endShown && mirror.game.phase(mirror.now()) === 'end') {
        endShown = true;
        showBoard(app, mirror.game, false);
      }
    } else if (m.type === 'kick') {
      app?.destroy();
      app = null;
      page(`<section class="wait"><div class="panel form-card center"><h2>Fuera de la sala</h2><p class="lead">${esc(m.reason)}</p><a class="btn go" href="#/">Volver al inicio</a></div></section>`);
      cleanupNet();
    }
  }));
  hello('init');
  const ping = window.setInterval(() => {
    t.send('host', { type: 'ping', cid: j.cid });
    if (mirror && performance.now() - mirror.lastPatchAt > 6000) app?.toast('Sin noticias del profesor… reconectando', 'warn');
    if (!mirror) hello('init');
  }, 4000);
  const cleanupNet = () => {
    clearInterval(ping);
    unsub.forEach((f) => f());
    t.send('host', { type: 'bye', cid: j.cid });
    t.close();
  };
  cleanup = () => { cleanupNet(); app?.destroy(); };
  return cleanup;
}
