// Sala de espera — anfitrión: el navegador del profesor (normalmente en el proyector) lleva el estado y lo reparte.
import type { Transport } from '../net/transport';
import {
  DANCE_EMOTE, EMOTES, FLIES, clampToRoom, cleanText, freeSpot, moveInterval, randomSprite, spawnPoint, step,
  type ChatMsg, type Motion, type TimerMsg, type Person, type Sprite, type WaitToHost, type WaitToStudent,
} from './protocol';

export interface Avatar extends Motion {
  cid: string;
  name: string;
  sprite: Sprite;
  lastSeen: number;
  muted: boolean;
  moving: boolean;
  lastChat: number;
  lastEmote: number;
}

export interface WaitEvent { kind: 'join' | 'hand' | 'chat' | 'emote' | 'leave'; cid: string; e?: number; m?: ChatMsg }

const CHAT_KEEP = 120;
const ONLINE_MS = 12_000;

export class WaitHost {
  avatars = new Map<string, Avatar>();
  chat: ChatMsg[] = [];
  hands: string[] = [];
  /** cuándo levantó la mano cada uno (para el panel del profe) */
  handAt = new Map<string, number>();
  banned = new Set<string>();
  filter = true;
  ep = 1;
  banner: ChatMsg | null = null;
  private seq = 1;
  private unsub: () => void;
  private lastTick = 0;
  private lastState = 0;
  private lastRoster = 0;
  private stateDirty = true;
  private rosterDirty = true;
  /** avisos para la pantalla del profesor (sonidos, burbujas) */
  onEvent?: (e: WaitEvent) => void;
  onChange?: () => void;

  /** temporizador: fin (reloj de este navegador) o, si está en pausa, lo que queda */
  timer: { end: number; total: number; label: string; pausedLeft: number | null } | null = null;
  /** nombre que aparece sobre el avatar del profe y en sus mensajes */
  profName = 'Profe';

  constructor(public transport: Transport, public code: string, public title: string, private now: () => number = () => Date.now()) {
    this.unsub = transport.listen('host', (m) => this.onMessage(m as WaitToHost));
  }

  // ───── persistencia (si el profesor recarga la pestaña no se pierde la sala) ─────

  snapshot(): string {
    return JSON.stringify({
      ep: this.ep, seq: this.seq, chat: this.chat, hands: this.hands, filter: this.filter, banned: [...this.banned], timer: this.timer,
      av: [...this.avatars.values()].map((a) => [a.cid, a.name, a.sprite, Math.round(a.x), Math.round(a.y), a.muted]),
    });
  }

  restore(raw: string | null): void {
    if (!raw) return;
    try {
      const s = JSON.parse(raw);
      this.ep = (s.ep ?? 1) + 1;
      this.seq = s.seq ?? 1;
      this.chat = s.chat ?? [];
      this.hands = s.hands ?? [];
      this.filter = s.filter ?? true;
      this.timer = s.timer ?? null;
      this.banned = new Set(s.banned ?? []);
      for (const [cid, name, sprite, x, y, muted] of s.av ?? []) {
        this.avatars.set(cid, this.newAvatar(cid, name, sprite, x, y, 0, muted));
      }
    } catch { /* estado corrupto: sala nueva */ }
  }

  private newAvatar(cid: string, name: string, sprite: Sprite, x: number, y: number, lastSeen: number, muted = false): Avatar {
    return { cid, name, sprite, x, y, dx: 0, dy: 0, tx: null, ty: null, lastSeen, muted, moving: false, lastChat: 0, lastEmote: 0 };
  }

  // ───── consultas ─────

  online(a: Avatar): boolean {
    return this.now() - a.lastSeen < ONLINE_MS;
  }

  people(): Person[] {
    return [...this.avatars.values()].map((a) => [a.cid, a.name, a.sprite.k, a.sprite.v, this.online(a), a.muted]);
  }

  onlineCount(): number {
    let n = 0;
    for (const a of this.avatars.values()) if (this.online(a)) n++;
    return n;
  }

  // ───── red ─────

  private toAll(m: WaitToStudent): void { this.transport.send('all', m); }
  private toOne(cid: string, m: WaitToStudent): void { this.transport.send(`c:${cid}`, m); }

  private onMessage(m: WaitToHost): void {
    if (!m || typeof m !== 'object' || typeof (m as { cid?: unknown }).cid !== 'string') return;
    const cid = m.cid.slice(0, 40);
    if (this.banned.has(cid)) {
      if (m.type === 'w-hello') this.toOne(cid, { type: 'w-kick', reason: 'El profesor te ha sacado de la sala de espera.' });
      return;
    }
    let a = this.avatars.get(cid);
    const t = this.now();
    if (m.type === 'w-hello') {
      const name = cleanText(String(m.name ?? ''), this.filter).slice(0, 20) || 'Alumno';
      const fresh = !a;
      if (!a) {
        const sprite = randomSprite();
        const [x, y] = spawnPoint(Math.random, FLIES[sprite.k]);
        a = this.newAvatar(cid, name, sprite, x, y, t);
        this.avatars.set(cid, a);
      }
      const wasOnline = this.online(a);
      a.name = name;
      a.lastSeen = t;
      this.toOne(cid, { type: 'w-init', you: a.sprite, x: Math.round(a.x), y: Math.round(a.y), ep: this.ep, chat: this.chat.slice(-60) });
      this.rosterDirty = true;
      this.stateDirty = true;
      if (fresh || !wasOnline) this.onEvent?.({ kind: 'join', cid });
      this.onChange?.();
      return;
    }
    if (!a) return;
    a.lastSeen = t;
    switch (m.type) {
      case 'w-ping': return;
      case 'w-bye': {
        a.lastSeen = 0;
        a.dx = a.dy = 0;
        a.tx = a.ty = null;
        this.rosterDirty = true;
        this.onEvent?.({ kind: 'leave', cid });
        this.onChange?.();
        return;
      }
      case 'w-move': {
        const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
        // confiamos en la posición del alumno (es una sala para charlar), pero dentro del aula y sin teletransportes largos
        const [x, y] = clampToRoom(num(m.x, a.x), num(m.y, a.y));
        if (Math.hypot(x - a.x, y - a.y) < 600) { [a.x, a.y] = freeSpot(x, y, FLIES[a.sprite.k]); }
        a.dx = Math.max(-1, Math.min(1, num(m.dx, 0)));
        a.dy = Math.max(-1, Math.min(1, num(m.dy, 0)));
        const tx = m.tx === null ? null : num(m.tx, NaN);
        const ty = m.ty === null ? null : num(m.ty, NaN);
        if (tx !== null && ty !== null && Number.isFinite(tx) && Number.isFinite(ty)) [a.tx, a.ty] = clampToRoom(tx, ty);
        else a.tx = a.ty = null;
        this.stateDirty = true;
        return;
      }
      case 'w-chat': {
        if (a.muted) { this.toOne(cid, { type: 'w-notice', text: 'El profesor te ha silenciado el chat.' }); return; }
        if (t - a.lastChat < 1500) { this.toOne(cid, { type: 'w-notice', text: 'Más despacio: espera un momento antes de volver a escribir.' }); return; }
        const text = cleanText(String(m.text ?? ''), this.filter);
        if (!text) return;
        a.lastChat = t;
        this.postChat({ id: this.seq++, cid, name: a.name, text, at: t });
        return;
      }
      case 'w-emote': {
        const e = Math.floor(Number(m.e));
        if (!(e >= 0 && e < EMOTES.length) || a.muted || t - a.lastEmote < 700) return;
        a.lastEmote = t;
        this.toAll({ type: 'w-emote', cid, e });
        this.onEvent?.({ kind: 'emote', cid, e });
        return;
      }
      case 'w-hand': {
        this.setHand(cid, !!m.up);
        return;
      }
    }
  }

  private postChat(msg: ChatMsg): void {
    this.chat.push(msg);
    if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
    this.toAll({ type: 'w-chat', m: msg });
    this.onEvent?.({ kind: 'chat', cid: msg.cid, m: msg });
    this.onChange?.();
  }

  // ───── acciones del profesor ─────

  // ───── temporizador ─────

  timerLeft(): number {
    const tm = this.timer;
    if (!tm) return 0;
    return Math.max(0, tm.pausedLeft ?? tm.end - this.now());
  }

  timerMsg(): TimerMsg | null {
    const tm = this.timer;
    return tm ? { left: this.timerLeft(), total: tm.total, label: tm.label, paused: tm.pausedLeft !== null } : null;
  }

  setTimer(ms: number, label = ''): void {
    ms = Math.max(1000, Math.min(3 * 3600_000, Math.round(ms)));
    this.timer = { end: this.now() + ms, total: ms, label: cleanText(label, false).slice(0, 40), pausedLeft: null };
    this.timerChanged();
  }

  pauseTimer(): void {
    const tm = this.timer;
    if (!tm) return;
    if (tm.pausedLeft === null) tm.pausedLeft = this.timerLeft();
    else { tm.end = this.now() + tm.pausedLeft; tm.pausedLeft = null; }
    this.timerChanged();
  }

  addTime(ms: number): void {
    const tm = this.timer;
    if (!tm) return;
    if (tm.pausedLeft !== null) tm.pausedLeft = Math.max(0, tm.pausedLeft + ms);
    else tm.end = Math.max(this.now(), tm.end) + ms;
    tm.total = Math.max(tm.total, this.timerLeft());
    this.timerChanged();
  }

  clearTimer(): void {
    this.timer = null;
    this.timerChanged();
  }

  private timerChanged(): void {
    this.rosterDirty = true;
    this.lastRoster = 0;
    this.onChange?.();
  }

  teacherSay(text: string, name = this.profName): void {
    const t = cleanText(text, false);
    if (!t) return;
    const msg: ChatMsg = { id: this.seq++, cid: 'profe', name, text: t, at: this.now(), t: true };
    this.banner = msg;
    this.rosterDirty = true;
    this.postChat(msg);
  }

  setHand(cid: string, up: boolean, byTeacher = false): void {
    const i = this.hands.indexOf(cid);
    if (up && i < 0 && this.avatars.has(cid)) { this.hands.push(cid); this.handAt.set(cid, this.now()); }
    else if (!up && i >= 0) { this.hands.splice(i, 1); this.handAt.delete(cid); }
    else return;
    this.toAll({ type: 'w-hand', cid, up, by: byTeacher ? 'profe' : undefined });
    if (up) this.onEvent?.({ kind: 'hand', cid });
    this.rosterDirty = true;
    this.onChange?.();
  }

  /** atiende al primero de la cola */
  attendNext(): string | null {
    const c = this.hands[0];
    if (c) this.setHand(c, false, true);
    return c ?? null;
  }

  clearHands(): void {
    for (const c of [...this.hands]) this.setHand(c, false, true);
  }

  deleteMsg(id: number): void {
    const i = this.chat.findIndex((m) => m.id === id);
    if (i < 0) return;
    this.chat.splice(i, 1);
    if (this.banner?.id === id) { this.banner = null; this.rosterDirty = true; }
    this.toAll({ type: 'w-del', id });
    this.onChange?.();
  }

  clearChat(): void {
    this.chat = [];
    this.banner = null;
    this.rosterDirty = true;
    this.toAll({ type: 'w-clear' });
    this.onChange?.();
  }

  /** reinicia la sala: chat vacío, manos bajadas y todos de vuelta a la puerta */
  reset(): void {
    this.clearChat();
    this.clearHands();
    this.ep++;
    for (const a of this.avatars.values()) {
      [a.x, a.y] = spawnPoint(Math.random, FLIES[a.sprite.k]);
      a.dx = a.dy = 0;
      a.tx = a.ty = null;
    }
    // quien no esté conectado desaparece
    for (const [cid, a] of this.avatars) if (!this.online(a)) this.avatars.delete(cid);
    this.stateDirty = true;
    this.rosterDirty = true;
    this.onChange?.();
  }

  setMuted(cid: string, muted: boolean): void {
    const a = this.avatars.get(cid);
    if (!a) return;
    a.muted = muted;
    this.toOne(cid, { type: 'w-notice', text: muted ? 'El profesor te ha silenciado el chat.' : 'Ya puedes volver a escribir en el chat.' });
    this.rosterDirty = true;
    this.onChange?.();
  }

  /** cambia el aspecto de un alumno (otro sprite al azar) */
  reroll(cid: string): void {
    const a = this.avatars.get(cid);
    if (!a) return;
    let s = randomSprite();
    for (let i = 0; i < 6 && s.k === a.sprite.k; i++) s = randomSprite();
    a.sprite = s;
    [a.x, a.y] = freeSpot(a.x, a.y, FLIES[s.k]);
    this.toOne(cid, { type: 'w-init', you: a.sprite, x: Math.round(a.x), y: Math.round(a.y), ep: this.ep, chat: this.chat.slice(-60) });
    this.rosterDirty = true;
    this.onChange?.();
  }

  kick(cid: string): void {
    this.banned.add(cid);
    this.toOne(cid, { type: 'w-kick', reason: 'El profesor te ha sacado de la sala de espera.' });
    this.avatars.delete(cid);
    const i = this.hands.indexOf(cid);
    if (i >= 0) this.hands.splice(i, 1);
    this.rosterDirty = true;
    this.stateDirty = true;
    this.onChange?.();
  }

  closeRoom(): void {
    this.toAll({ type: 'w-close' });
  }

  // ───── bucle ─────

  tick(nowMs: number = this.now()): void {
    const dt = this.lastTick ? Math.min(0.25, (nowMs - this.lastTick) / 1000) : 0;
    this.lastTick = nowMs;
    for (const a of this.avatars.values()) {
      if (!this.online(a)) { a.moving = false; continue; }
      const moved = dt > 0 && step(a, a.sprite.k, dt);
      if (moved !== a.moving) this.stateDirty = true;
      a.moving = moved;
      if (moved) this.stateDirty = true;
    }
    // banner del profe en la pantalla grande: 20 s
    if (this.banner && this.now() - this.banner.at > 20_000) { this.banner = null; this.rosterDirty = true; }
    if ((this.stateDirty && nowMs - this.lastState >= 200) || nowMs - this.lastState > 2500) {
      this.lastState = nowMs;
      this.stateDirty = false;
      this.toAll({
        type: 'w-state', ep: this.ep,
        p: [...this.avatars.values()].filter((a) => this.online(a)).map((a) => [a.cid, Math.round(a.x), Math.round(a.y), a.moving ? 1 : 0]),
      });
    }
    if ((this.rosterDirty && nowMs - this.lastRoster >= 250) || nowMs - this.lastRoster > 4000) {
      const before = this.lastRoster;
      this.lastRoster = nowMs;
      this.rosterDirty = false;
      this.toAll({
        type: 'w-roster', title: this.title, people: this.people(), hands: this.hands,
        mi: moveInterval(this.onlineCount()), banner: this.banner, prof: this.profName, timer: this.timerMsg(),
      });
      // la lista de conectados cambia sola con el tiempo (desconexiones): refresca el panel cada tanto
      if (nowMs - before > 3000) this.onChange?.();
    }
  }

  close(): void {
    this.unsub();
  }

  isDancing(e: number): boolean { return e === DANCE_EMOTE; }
}
