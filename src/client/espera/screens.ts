// Sala de espera — pantallas del profesor (proyector) y del alumno.
import QRCode from 'qrcode';
import { sound, soundButton } from '../audio';
import { api, type JoinInfo, type RoomInfo } from '../net/api';
import { backgroundTicker } from '../net/transport';
import { WaitClient } from './client';
import { WaitHost } from './host';
import { AURA_EMOTE, DANCE_EMOTE, EMOTES, SPRITE_LABEL, type ChatMsg, type SpriteKind } from './protocol';
import { draw, fitView, followView, newFx, toWorld, type AvatarView, type Fx, type ScreenInfo, type View } from './render';

type Cleanup = () => void;

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const $ = <E extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as E;
const SPRITE_ICON: Record<SpriteKind, string> = { android: '🤖', drone: '🛸', rc: '🏎️', tree: '🌳' };
const EMOTE_NAMES = ['saludo', 'risa', 'bien', 'corazón', 'pensando', 'sorpresa', 'fiesta', 'fuego', 'idea', 'sueño', 'baile', 'farmear aura'];

const LOGO = `<svg class="logo" viewBox="0 0 32 32"><path d="M16 2l12 7v14l-12 7-12-7V9z" fill="none" stroke="#2fd4c0" stroke-width="2"/><path d="M16 9l6 3.5v7L16 23l-6-3.5v-7z" fill="#2fd4c0" opacity=".25"/><circle cx="16" cy="16" r="2" fill="#f2a93b"/></svg>`;

function hhmm(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function chatLine(m: ChatMsg, del: boolean): string {
  return `<div class="wr-msg ${m.t ? 'prof' : ''}" data-id="${m.id}">
    <span class="tm">${hhmm(m.at)}</span><b>${esc(m.name)}</b><span class="tx">${esc(m.text)}</span>
    ${del ? `<button class="x" data-del="${m.id}" title="Borrar este mensaje">✕</button>` : ''}</div>`;
}

function toast(msg: string, kind: 'ok' | 'err' | 'warn' | 'info' = 'info'): void {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast panel ${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function sizeCanvas(cv: HTMLCanvasElement): { w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  return { w, h };
}

function loadImg(src: string): HTMLImageElement {
  const i = new Image();
  i.src = src;
  return i;
}

// ═════════════════════════ PROFESOR (proyector) ═════════════════════════

export async function mountWaitHost(code: string, info: RoomInfo): Promise<Cleanup> {
  const root = $('#app');
  const joinUrl = `${location.origin}${location.pathname}#/sala/${code}`;
  const qrSrc = await QRCode.toDataURL(joinUrl, { margin: 1, width: 320, color: { dark: '#0b1416', light: '#ffffff' } });
  const qr = loadImg(qrSrc);
  const host = new WaitHost(api.transport(code, 'host', `profe${api.me.id}`), code, info.title);
  host.profName = `Profe ${(api.me.name ?? '').trim().split(/\s+/)[0] ?? ''}`.trim().slice(0, 22);
  const saveKey = `grid.espera.${code}`;
  const prof = { talkAt: -1e9, waveAt: -1e9 };
  try { host.restore(sessionStorage.getItem(saveKey)); } catch { /* nada */ }
  const fx: Fx = newFx();
  let tab: 'cola' | 'chat' | 'alumnos' = 'cola';
  let sideOpen = true;
  let lastPop = 0;

  root.innerHTML = `
    <div class="wr host">
      <div class="wr-stage"><canvas id="wr-cv" class="wr-cv"></canvas>
        <div class="wr-queue big" id="wr-q"></div>
        <button class="tb-btn wr-open" id="wr-open" title="Mostrar el panel">☰ Panel</button>
      </div>
      <aside class="wr-side panel" id="wr-side">
        <div class="wr-head">
          <a class="brand" href="#/profe">${LOGO}<div><div class="title">SALA DE ESPERA</div><div class="colony">${esc(info.title)}</div></div></a>
          <div class="spacer"></div>
          <span id="wr-snd"></span>
          <button class="tb-btn" id="wr-fs" title="Pantalla completa">⛶</button>
          <button class="tb-btn" id="wr-hide" title="Ocultar el panel (para proyectar)">⇥</button>
        </div>
        <div class="wr-code"><span class="mono">${esc(code)}</span><button class="link-btn" id="wr-copy">copiar enlace</button></div>
        <div class="wr-timer" id="wr-timer"></div>
        <div class="wr-tabs">
          <button data-tab="cola">✋ Cola <span id="n-cola" class="n"></span></button>
          <button data-tab="chat">💬 Chat <span id="n-chat" class="n"></span></button>
          <button data-tab="alumnos">👥 Alumnos <span id="n-al" class="n"></span></button>
        </div>
        <div class="wr-body" id="wr-body"></div>
        <div class="wr-foot" id="wr-foot"></div>
      </aside>
    </div>
    <div id="toasts"></div><div id="modal-root"></div>`;
  $('#wr-snd').replaceWith(soundButton());
  const cv = $<HTMLCanvasElement>('#wr-cv');
  const side = $('#wr-side');
  sound.setTrack('calm');
  sound.setMusicAllowed(true);

  const setSide = (open: boolean) => {
    sideOpen = open;
    root.querySelector('.wr')!.classList.toggle('noside', !open);
  };
  $('#wr-hide').onclick = () => setSide(false);
  $('#wr-open').onclick = () => setSide(true);
  $('#wr-fs').onclick = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };
  $('#wr-copy').onclick = () => { navigator.clipboard?.writeText(joinUrl).then(() => toast('Enlace copiado', 'ok'), () => toast(joinUrl)); };
  side.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
    b.onclick = () => { tab = b.dataset.tab as typeof tab; renderSide(true); };
  });

  // ── panel lateral ──
  let lastSideSig = '';
  const renderSide = (force = false) => {
    const people = host.people();
    const sig = JSON.stringify([tab, people, host.hands, host.chat.length, host.chat.at(-1)?.id, host.filter, force ? Math.random() : 0]);
    $('#n-cola').textContent = host.hands.length ? String(host.hands.length) : '';
    $('#n-chat').textContent = host.chat.length ? String(host.chat.length) : '';
    $('#n-al').textContent = String(host.onlineCount());
    side.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'cola') updateAgo();
    if (sig === lastSideSig) return;
    lastSideSig = sig;
    const body = $('#wr-body');
    const foot = $('#wr-foot');
    if (tab === 'cola') {
      body.innerHTML = host.hands.length
        ? `<ol class="wr-hands">${host.hands.map((cid, i) => {
          const a = host.avatars.get(cid);
          return `<li><span class="pos">${i + 1}</span><span class="ic">${a ? SPRITE_ICON[a.sprite.k] : '✋'}</span><b>${esc(a?.name ?? '¿?')}</b>
            <span class="ago" data-ago="${cid}"></span><button class="btn go sm" data-att="${esc(cid)}">✓ Atendido</button></li>`;
        }).join('')}</ol>`
        : '<p class="sm empty">Nadie tiene la mano levantada. Cuando alguien la levante sonará un aviso y aparecerá aquí y en la pantalla.</p>';
      foot.innerHTML = `<button class="btn go" id="h-next" ${host.hands.length ? '' : 'disabled'}>✓ Atender al siguiente</button>
        <button class="btn" id="h-all" ${host.hands.length ? '' : 'disabled'}>Bajar todas</button>`;
      $('#h-next', foot).onclick = () => { if (host.attendNext()) sound.attend(); };
      $('#h-all', foot).onclick = () => host.clearHands();
      body.querySelectorAll<HTMLButtonElement>('[data-att]').forEach((b) => { b.onclick = () => { host.setHand(b.dataset.att!, false, true); sound.attend(); }; });
      updateAgo();
    } else if (tab === 'chat') {
      const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
      body.innerHTML = host.chat.length
        ? `<div class="wr-log">${host.chat.map((m) => chatLine(m, true)).join('')}</div>`
        : '<p class="sm empty">El chat está vacío.</p>';
      if (atBottom || force) body.scrollTop = body.scrollHeight;
      body.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => { b.onclick = () => host.deleteMsg(Number(b.dataset.del)); });
      foot.innerHTML = `<form id="h-say" class="wr-say"><input id="h-txt" maxlength="160" placeholder="Escribe como profe (sale en la pantalla grande)" autocomplete="off"><button class="btn go">Enviar</button></form>
        <div class="row2"><button class="btn danger" id="h-clear" ${host.chat.length ? '' : 'disabled'}>🗑 Vaciar chat</button>
        <label class="ck sm"><input type="checkbox" id="h-filter" ${host.filter ? 'checked' : ''}> Filtro de palabrotas</label></div>`;
      $<HTMLFormElement>('#h-say', foot).onsubmit = (e) => {
        e.preventDefault();
        const i = $<HTMLInputElement>('#h-txt', foot);
        host.teacherSay(i.value);
        i.value = '';
      };
      $('#h-clear', foot).onclick = () => { if (confirmBox('¿Vaciar el chat?', 'Se borran todos los mensajes para todos.')) host.clearChat(); };
      $<HTMLInputElement>('#h-filter', foot).onchange = (e) => { host.filter = (e.target as HTMLInputElement).checked; };
    } else {
      const list = [...host.avatars.values()].sort((a, b) => Number(host.online(b)) - Number(host.online(a)) || a.name.localeCompare(b.name));
      body.innerHTML = list.length
        ? `<div class="wr-people">${list.map((a) => `<div class="wr-person ${host.online(a) ? '' : 'off'}">
            <span class="ic" title="${SPRITE_LABEL[a.sprite.k]}">${SPRITE_ICON[a.sprite.k]}</span><span class="dot"></span><b>${esc(a.name)}</b>
            <span class="acts">
              <button class="x" data-reroll="${esc(a.cid)}" title="Cambiar su aspecto">🎲</button>
              <button class="x ${a.muted ? 'on' : ''}" data-mute="${esc(a.cid)}" title="${a.muted ? 'Quitar silencio' : 'Silenciar su chat'}">${a.muted ? '🔇' : '💬'}</button>
              <button class="x" data-kick="${esc(a.cid)}" title="Sacar de la sala">✕</button>
            </span></div>`).join('')}</div>`
        : '<p class="sm empty">Aún no ha entrado nadie. Los alumnos escanean el QR de la pantalla o escriben el código en la portada.</p>';
      body.querySelectorAll<HTMLButtonElement>('[data-reroll]').forEach((b) => { b.onclick = () => host.reroll(b.dataset.reroll!); });
      body.querySelectorAll<HTMLButtonElement>('[data-mute]').forEach((b) => {
        b.onclick = () => { const a = host.avatars.get(b.dataset.mute!); if (a) host.setMuted(a.cid, !a.muted); };
      });
      body.querySelectorAll<HTMLButtonElement>('[data-kick]').forEach((b) => {
        b.onclick = () => { const a = host.avatars.get(b.dataset.kick!); if (a && confirmBox(`¿Sacar a ${a.name}?`, 'No podrá volver a entrar en esta sala de espera.')) host.kick(a.cid); };
      });
      foot.innerHTML = `<button class="btn" id="h-reset">↺ Reiniciar sala</button><button class="btn danger" id="h-close">Cerrar sala</button>`;
      $('#h-reset', foot).onclick = () => { if (confirmBox('¿Reiniciar la sala?', 'Se vacía el chat, se bajan las manos y todos vuelven a la puerta.')) host.reset(); };
      $('#h-close', foot).onclick = async () => {
        if (!confirmBox('¿Cerrar la sala de espera?', 'Los alumnos saldrán y el código dejará de funcionar.')) return;
        host.closeRoom();
        await api.closeRoom(code).catch(() => {});
        try { sessionStorage.removeItem(saveKey); } catch { /* nada */ }
        location.hash = '#/profe';
      };
    }
  };
  const updateAgo = () => {
    const now = Date.now();
    side.querySelectorAll<HTMLElement>('[data-ago]').forEach((e) => { e.textContent = ago(now - (host.handAt.get(e.dataset.ago!) ?? now)); });
  };

  // ── temporizador ──
  const tbox = $('#wr-timer');
  let timerSig = '';
  const fmt = (ms: number) => {
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const renderTimer = () => {
    const tm = host.timer;
    const sig = tm ? `on${tm.pausedLeft !== null}${tm.label}` : 'off';
    if (sig !== timerSig) {
      timerSig = sig;
      if (!tm) {
        tbox.innerHTML = `<div class="hd">⏱ Temporizador</div>
          <div class="presets">${[1, 3, 5, 10, 15, 20].map((m) => `<button class="btn sm" data-min="${m}">${m}′</button>`).join('')}</div>
          <form id="t-form" class="t-form"><input id="t-min" type="number" min="0.25" max="180" step="0.25" placeholder="min" aria-label="Minutos"><input id="t-lbl" maxlength="40" placeholder="Para qué (p. ej. Ejercicio 3)" aria-label="Etiqueta"><button class="btn go sm">▶</button></form>`;
        const start = (min: number) => { if (min > 0) { host.setTimer(min * 60_000, $<HTMLInputElement>('#t-lbl', tbox).value); sound.blip(880); } };
        tbox.querySelectorAll<HTMLButtonElement>('[data-min]').forEach((b) => { b.onclick = () => start(Number(b.dataset.min)); });
        $<HTMLFormElement>('#t-form', tbox).onsubmit = (e) => { e.preventDefault(); start(Number($<HTMLInputElement>('#t-min', tbox).value)); };
      } else {
        tbox.innerHTML = `<div class="hd">⏱ ${esc(tm.label || 'Temporizador')}</div>
          <div class="run"><span class="big mono" id="t-left"></span>
          <button class="btn sm" id="t-pause" title="${tm.pausedLeft !== null ? 'Reanudar' : 'Pausar'}">${tm.pausedLeft !== null ? '▶' : '❚❚'}</button>
          <button class="btn sm" id="t-minus" title="Quitar 1 minuto">−1′</button>
          <button class="btn sm" id="t-plus" title="Añadir 1 minuto">+1′</button>
          <button class="btn sm danger" id="t-stop" title="Quitar el temporizador">✕</button></div>`;
        $('#t-pause', tbox).onclick = () => host.pauseTimer();
        $('#t-plus', tbox).onclick = () => host.addTime(60_000);
        $('#t-minus', tbox).onclick = () => host.addTime(-60_000);
        $('#t-stop', tbox).onclick = () => host.clearTimer();
      }
    }
    const l = $('#t-left', tbox);
    if (l && tm) { const left = host.timerLeft(); l.textContent = left > 0 ? fmt(left) : '¡Tiempo!'; l.classList.toggle('urgent', left <= 60_000); l.classList.toggle('done', left <= 0); }
  };
  let lastSec = -1;
  const timerSounds = () => {
    const tm = host.timer;
    if (!tm || tm.pausedLeft !== null) { lastSec = -1; return; }
    const sec = Math.ceil(host.timerLeft() / 1000);
    if (sec !== lastSec) {
      if (lastSec > 0 && sec === 0) sound.timeUp();
      else if (lastSec > 0 && sec > 0 && sec <= 10) sound.tick(sec <= 3);
      lastSec = sec;
    }
  };

  // ── cola en grande sobre el aula ──
  const renderQueue = () => {
    const q = $('#wr-q');
    q.classList.toggle('show', host.hands.length > 0);
    q.innerHTML = host.hands.length
      ? `<div class="hd">✋ Manos levantadas</div><ol>${host.hands.slice(0, 8).map((cid) => `<li>${esc(host.avatars.get(cid)?.name ?? '¿?')}</li>`).join('')}</ol>${host.hands.length > 8 ? `<div class="more">y ${host.hands.length - 8} más…</div>` : ''}`
      : '';
  };

  host.onChange = () => { renderSide(); renderQueue(); renderTimer(); };
  const origSetHand = host.setHand.bind(host);
  host.setHand = (cid, up, byTeacher = false) => { if (byTeacher && !up && host.hands.includes(cid)) prof.waveAt = performance.now(); origSetHand(cid, up, byTeacher); };
  host.onEvent = (e) => {
    const now = performance.now();
    if (e.kind === 'hand') { sound.hand(); }
    else if (e.kind === 'join') { fx.joins.set(e.cid, now); sound.join(); }
    else if (e.kind === 'chat' && e.m) {
      if (e.m.t) prof.talkAt = now;
      else { fx.bubbles.set(e.cid, { text: e.m.text, at: now }); sound.chat(); }
    }
    else if (e.kind === 'emote' && e.e !== undefined) {
      fx.emotes.set(e.cid, { e: e.e, at: now });
      if (e.e === DANCE_EMOTE) fx.dance.set(e.cid, now + 3600);
      if (e.e === AURA_EMOTE) { fx.aura.set(e.cid, now); sound.aura(); }
      else if (now - lastPop > 250) { lastPop = now; sound.pop(); }
    }
  };

  // clic en un avatar con la mano levantada = atendido
  let view: View = { scale: 1, ox: 0, oy: 0 };
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect();
    const [wx, wy] = toWorld(view, e.clientX - r.left, e.clientY - r.top);
    let best: string | null = null;
    let bd = 60;
    for (const a of host.avatars.values()) {
      if (!host.online(a)) continue;
      const d = Math.hypot(a.x - wx, a.y - 36 - wy);
      if (d < bd) { bd = d; best = a.cid; }
    }
    if (best && host.hands.includes(best)) { host.setHand(best, false, true); sound.attend(); }
    else if (best) { tab = 'alumnos'; setSide(true); renderSide(true); }
  });

  const screen = (): ScreenInfo => ({
    code, title: info.title, url: location.host, qr,
    banner: host.banner ? { name: host.banner.name, text: host.banner.text } : null, online: host.onlineCount(), timer: host.timerMsg(),
  });

  let raf = 0;
  let lastSave = 0;
  const loop = (t: number) => {
    host.tick();
    timerSounds();
    if (host.timer) renderTimer();
    const { w, h } = sizeCanvas(cv);
    view = fitView(w, h, 8);
    const avatars: AvatarView[] = [];
    for (const a of host.avatars.values()) {
      if (!host.online(a)) continue;
      avatars.push({ cid: a.cid, name: a.name, k: a.sprite.k, v: a.sprite.v, x: a.x, y: a.y, moving: a.moving, hand: host.hands.indexOf(a.cid) + 1, muted: a.muted });
    }
    const first = host.hands.length ? host.avatars.get(host.hands[0]) : undefined;
    const teacher = { name: host.profName, talkAt: prof.talkAt, waveAt: prof.waveAt, look: first ? { x: first.x, y: first.y } : null };
    draw(cv, view, t, { teacher, avatars, fx, screen: screen(), labelScale: Math.max(1, Math.min(1.7, w / 1250)) });
    if (Date.now() - lastSave > 2000) {
      lastSave = Date.now();
      try { sessionStorage.setItem(saveKey, host.snapshot()); } catch { /* nada */ }
      if (tab === 'cola') updateAgo();
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  // si el proyector cambia de pestaña la sala sigue respondiendo
  const stopTicker = backgroundTicker(() => { if (document.hidden) host.tick(); }, 200);
  const roster = window.setInterval(() => renderSide(), 3000);
  renderSide();
  renderQueue();
  renderTimer();
  void sideOpen;

  return () => {
    cancelAnimationFrame(raf);
    stopTicker();
    clearInterval(roster);
    try { sessionStorage.setItem(saveKey, host.snapshot()); } catch { /* nada */ }
    host.close();
    host.transport.close();
    sound.setTrack('main');
  };
}

function confirmBox(title: string, text: string): boolean {
  return window.confirm(`${title}\n\n${text}`);
}

// ═════════════════════════ ALUMNO ═════════════════════════

export function mountWaitStudent(code: string, info: RoomInfo, j: JoinInfo): Cleanup {
  const root = $('#app');
  const t = api.transport(code, 'student', j.cid, j.jt);
  const client = new WaitClient(t, j.cid, j.name);
  const prof = { talkAt: -1e9, waveAt: -1e9 };
  let studentSec = -1;
  const fx: Fx = newFx();
  // en ordenador se ve el aula entera, como en el proyector (pizarra siempre visible); en móvil la cámara sigue al avatar
  let fitAll = window.innerWidth > 760;
  let chatOpen = window.innerWidth > 760;
  let unread = 0;
  let ended = false;
  sound.setTrack('calm');
  let musicOn = false;
  try { musicOn = localStorage.getItem('grid.espera.musica') === '1'; } catch { /* nada */ }
  sound.setMusicAllowed(musicOn);

  root.innerHTML = `
    <div class="wr student ${chatOpen ? '' : 'nochat'}">
      <div class="wr-stage"><canvas id="wr-cv" class="wr-cv" tabindex="0" aria-label="Aula: muévete con WASD o las flechas, o toca el suelo"></canvas>
        <div class="wr-queue" id="wr-q"></div>
        <div class="wr-hint" id="wr-hint">Muévete con <b>WASD</b> / <b>flechas</b> o toca el suelo · <b>Intro</b> para escribir · <b>H</b> mano · <b>F</b> farmear aura</div>
      </div>
      <header class="wr-top panel">
        <span class="brand">${LOGO}<span class="ttl"><b>${esc(info.title)}</b><span class="sm mono">${esc(code)}</span></span></span>
        <div class="spacer"></div>
        <span id="wr-snd"></span>
        <button class="tb-btn" id="wr-music" title="Música en este dispositivo">🎵</button>
        <button class="tb-btn" id="wr-map" title="Ver el aula entera">🗺</button>
        <button class="tb-btn" id="wr-chatbtn" title="Chat">💬<span class="badge" id="wr-unread"></span></button>
        <a class="tb-btn" href="#/" id="wr-exit">Salir</a>
      </header>
      <aside class="wr-chat panel" id="wr-chat">
        <div class="sec-title"><span>Chat de la clase</span><span id="wr-me" class="sm"></span></div>
        <div class="wr-log" id="wr-log"></div>
      </aside>
      <div class="wr-dock panel">
        <div class="wr-emotes">${EMOTES.map((e, i) => `<button class="em${i === AURA_EMOTE ? ' aura' : ''}" data-e="${i}" title="${EMOTE_NAMES[i]} (${i === DANCE_EMOTE ? 'B' : i === AURA_EMOTE ? 'F' : (i + 1) % 10})">${e}</button>`).join('')}</div>
        <div class="wr-row">
          <button class="btn hand" id="wr-hand">✋ Levantar la mano</button>
          <form id="wr-say" class="wr-say"><input id="wr-txt" maxlength="160" placeholder="Escribe al chat…" autocomplete="off" enterkeyhint="send"><button class="btn go" aria-label="Enviar">➤</button></form>
        </div>
      </div>
    </div>
    <div id="toasts"></div>`;
  $('#wr-snd').replaceWith(soundButton());
  const cv = $<HTMLCanvasElement>('#wr-cv');
  const txt = $<HTMLInputElement>('#wr-txt');
  const wr = $('.wr');

  const music = $<HTMLButtonElement>('#wr-music');
  const drawMusic = () => { music.classList.toggle('on', musicOn); music.style.opacity = musicOn ? '1' : '0.5'; };
  drawMusic();
  music.onclick = () => {
    musicOn = !musicOn;
    try { localStorage.setItem('grid.espera.musica', musicOn ? '1' : '0'); } catch { /* nada */ }
    sound.setMusicAllowed(musicOn);
    drawMusic();
  };
  $('#wr-map').classList.toggle('on', fitAll);
  $('#wr-map').title = 'Ver el aula entera / seguir a mi personaje';
  $('#wr-map').onclick = () => { fitAll = !fitAll; $('#wr-map').classList.toggle('on', fitAll); };
  $('#wr-chatbtn').onclick = () => {
    chatOpen = !chatOpen;
    wr.classList.toggle('nochat', !chatOpen);
    if (chatOpen) { unread = 0; drawUnread(); scrollLog(); }
  };
  const drawUnread = () => { $('#wr-unread').textContent = unread ? String(Math.min(99, unread)) : ''; };

  // ── chat ──
  const log = $('#wr-log');
  const scrollLog = () => { log.scrollTop = log.scrollHeight; };
  const renderChat = () => {
    log.innerHTML = client.chat.length ? client.chat.map((m) => chatLine(m, false)).join('') : '<p class="sm empty">Aún no hay mensajes. ¡Saluda!</p>';
    scrollLog();
  };
  client.onChatReset = renderChat;
  client.onChat = (m) => {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.querySelector('.empty')?.remove();
    log.insertAdjacentHTML('beforeend', chatLine(m, false));
    if (atBottom || m.cid === j.cid) scrollLog();
    if (m.t) prof.talkAt = performance.now();
    else fx.bubbles.set(m.cid, { text: m.text, at: performance.now() });
    if (!chatOpen) { unread++; drawUnread(); }
    if (m.t) sound.chat();
  };
  $<HTMLFormElement>('#wr-say').onsubmit = (e) => {
    e.preventDefault();
    const v = txt.value.trim();
    if (!v) return;
    client.chatSend(v);
    txt.value = '';
    txt.blur();
    cv.focus();
  };

  // ── mano ──
  const handBtn = $<HTMLButtonElement>('#wr-hand');
  const drawHand = () => {
    const i = client.hands.indexOf(j.cid);
    handBtn.classList.toggle('up', i >= 0);
    handBtn.innerHTML = i >= 0 ? `✋ Bajar la mano <span class="pos">${i === 0 ? '¡eres el siguiente!' : `nº ${i + 1} en la cola`}</span>` : '✋ Levantar la mano';
    const q = $('#wr-q');
    q.classList.toggle('show', client.hands.length > 0);
    const names = new Map(client.people.map((p) => [p[0], p[1]]));
    q.innerHTML = client.hands.length
      ? `<div class="hd">✋ Cola</div><ol>${client.hands.slice(0, 6).map((cid) => `<li class="${cid === j.cid ? 'me' : ''}">${esc(names.get(cid) ?? '…')}</li>`).join('')}</ol>${client.hands.length > 6 ? `<div class="more">y ${client.hands.length - 6} más</div>` : ''}`
      : '';
  };
  const toggleHand = () => {
    const up = !client.handUp();
    client.hand(up);
    if (up) sound.hand(); else sound.blip(440);
  };
  handBtn.onclick = toggleHand;
  client.onHand = (cid, up, by) => {
    if (!up && by === 'profe') prof.waveAt = performance.now();
    if (cid === j.cid && !up && by === 'profe') { toast('El profe viene a verte 👋', 'ok'); sound.attend(); }
  };

  // ── emotes ──
  const doEmote = (i: number) => { client.emote(i); if (i !== AURA_EMOTE) sound.pop(); };
  wr.querySelectorAll<HTMLButtonElement>('.em').forEach((b) => { b.onclick = () => { doEmote(Number(b.dataset.e)); cv.focus(); }; });
  client.onEmote = (cid, e) => {
    const now = performance.now();
    fx.emotes.set(cid, { e, at: now });
    if (e === DANCE_EMOTE) fx.dance.set(cid, now + 3600);
    if (e === AURA_EMOTE) { fx.aura.set(cid, now); if (cid === j.cid) sound.aura(); }
  };

  client.onRoster = () => {
    drawHand();
    const me = client.people.find((p) => p[0] === j.cid);
    $('#wr-me').textContent = me ? `eres un ${SPRITE_LABEL[me[2]]} ${SPRITE_ICON[me[2]]}` : '';
  };
  client.onInit = () => { client.fixSpot(); client.onRoster?.(); };
  client.onNotice = (m) => toast(m, 'warn');
  const finish = (title: string, text: string) => {
    if (ended) return;
    ended = true;
    stop();
    root.innerHTML = `<div class="screen"><main class="scr-main"><section class="wait"><div class="panel form-card center"><h2>${esc(title)}</h2><p class="lead">${esc(text)}</p><a class="btn go" href="#/">Volver al inicio</a></div></section></main></div>`;
  };
  client.onKick = (r) => finish('Fuera de la sala', r);
  client.onClose = () => finish('La sala de espera se ha cerrado', 'El profesor ha cerrado la sala. ¡Hasta la próxima!');

  // ── teclado ──
  const keys = new Set<string>();
  const typing = () => document.activeElement === txt;
  const applyKeys = () => {
    const dx = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    const dy = (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0);
    client.setDir(dx, dy);
  };
  const KEYMAP: Record<string, string> = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };
  const onDown = (e: KeyboardEvent) => {
    if (typing()) {
      if (e.key === 'Escape') { txt.blur(); cv.focus(); }
      return;
    }
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = KEYMAP[e.key];
    if (k) { e.preventDefault(); keys.add(k); applyKeys(); $('#wr-hint').classList.add('gone'); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (!chatOpen && window.innerWidth <= 760) $('#wr-chatbtn').click(); txt.focus(); return; }
    if (e.repeat) return;
    if (e.key === 'h' || e.key === 'H') { toggleHand(); return; }
    if (e.key === 'b' || e.key === 'B') { doEmote(DANCE_EMOTE); return; }
    if (e.key === 'f' || e.key === 'F') { doEmote(AURA_EMOTE); return; }
    if (/^[0-9]$/.test(e.key)) { const i = (Number(e.key) + 9) % 10; if (i < DANCE_EMOTE) doEmote(i); }
  };
  const onUp = (e: KeyboardEvent) => {
    const k = KEYMAP[e.key];
    if (k && keys.delete(k)) applyKeys();
  };
  const onBlur = () => { keys.clear(); applyKeys(); };
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);
  txt.addEventListener('focus', () => { keys.clear(); applyKeys(); });

  // ── tocar el suelo ──
  let view: View = { scale: 1, ox: 0, oy: 0 };
  cv.addEventListener('pointerdown', (e) => {
    cv.focus();
    const r = cv.getBoundingClientRect();
    const [wx, wy] = toWorld(view, e.clientX - r.left, e.clientY - r.top);
    client.goTo(wx, wy);
    $('#wr-hint').classList.add('gone');
  });

  // ── red ──
  client.hello();
  const ping = window.setInterval(() => {
    client.ping();
    if (Date.now() - client.lastMsgAt > 6000) client.hello();
  }, 4000);
  let warned = false;
  const watchdog = window.setInterval(() => {
    const quiet = Date.now() - client.lastMsgAt > 9000;
    if (quiet && !warned) { warned = true; toast('Sin noticias del profesor… reintentando', 'warn'); }
    if (!quiet) warned = false;
  }, 3000);

  // ── dibujo ──
  let raf = 0;
  let last = performance.now();
  const screen = (): ScreenInfo => ({
    code, title: client.title || info.title, url: location.host, qr: null,
    banner: client.banner ? { name: client.banner.name, text: client.banner.text } : null,
    online: client.people.filter((p) => p[4]).length,
    timer: client.timer ? { left: client.timerLeft(), total: client.timer.total, label: client.timer.label, paused: client.timer.pausedLeft !== null } : null,
  });
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    client.update(dt, now);
    if (client.timer && client.timer.pausedLeft === null) {
      const sec = Math.ceil(client.timerLeft() / 1000);
      if (studentSec > 0 && sec === 0) sound.timeUp();
      studentSec = sec;
    } else studentSec = -1;
    const { w, h } = sizeCanvas(cv);
    const me = client.me;
    view = fitAll || !me ? fitView(w, h, 4) : followView(w, h, me.x, me.y - 60, Math.max(0.42, Math.min(1.1, w / 1300)));
    const byCid = new Map(client.people.map((p) => [p[0], p]));
    const avatars: AvatarView[] = [];
    for (const r of client.remotes.values()) {
      const p = byCid.get(r.cid);
      if (!p) continue;
      avatars.push({ cid: r.cid, name: p[1], k: p[2], v: p[3], x: r.x, y: r.y, moving: r.moving, hand: client.hands.indexOf(r.cid) + 1, muted: p[5] });
    }
    if (me) {
      const moving = !!(me.dx || me.dy || me.tx !== null);
      avatars.push({ cid: j.cid, name: j.name, k: me.sprite.k, v: me.sprite.v, x: me.x, y: me.y, moving, me: true, hand: client.hands.indexOf(j.cid) + 1 });
    }
    const firstCid = client.hands[0];
    const fp = firstCid === j.cid ? me : firstCid ? client.remotes.get(firstCid) : undefined;
    const teacher = { name: client.prof, talkAt: prof.talkAt, waveAt: prof.waveAt, look: fp ? { x: fp.x, y: fp.y } : null };
    draw(cv, view, now, { teacher, avatars, fx, screen: screen(), target: me && me.tx !== null && me.ty !== null ? { x: me.tx, y: me.ty } : null, labelScale: w < 600 ? 0.9 : 1 });
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  renderChat();
  drawHand();
  cv.focus();

  const stop = () => {
    cancelAnimationFrame(raf);
    clearInterval(ping);
    clearInterval(watchdog);
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('blur', onBlur);
    client.close();
    t.close();
    sound.setTrack('main');
    sound.setMusicAllowed(true);
  };
  return () => { if (!ended) stop(); };
}
