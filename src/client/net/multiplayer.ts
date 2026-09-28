// Partida en red: el navegador del profesor es el anfitrión (simula), los alumnos reciben un espejo filtrado por su niebla.
import { checkSyntax } from '../../sim/lang/compiler';
import { PyDict } from '../../sim/lang/values';
import { BOT_FILES, BOT_NAMES, DEFAULT_PROGRAM, STARTER_FILES } from '../../sim/world/content';
import { Game, fromB64, toB64, type GameEvent } from '../../sim/world/game';
import {
  type Building, type DayStats, type LogEntry, type MatchConfig, type Parcel, type Player, type Prop, type ResKind,
  type ResourceNode, type Unit, type WorldConfig,
} from '../../sim/world/types';
import { GameSession, type RunResult } from '../session';
import type { Channel, Transport } from './transport';

// ───────────── mensajes ─────────────

export interface RosterEntry { cid: string; name: string; online: boolean }

export interface LobbySettings {
  prepMin: number;
  playMin: number;
  hacking: boolean;
  hackBreak: boolean;
  bots: number;
}

export type ToStudent =
  | { type: 'lobby'; roster: RosterEntry[]; state: 'lobby' | 'game'; settings: LobbySettings; title: string }
  | { type: 'init'; cfg: WorldConfig; time: number; slots: number; players: { id: string; name: string; bot: boolean }[]; you: string; paused: boolean }
  | PatchMsg
  | { type: 'kick'; reason: string }
  | { type: 'reset' };

export interface UnitView {
  u: Partial<Unit> & { id: string };
}

export interface PatchMsg {
  type: 'patch';
  t: number;
  paused: boolean;
  full?: boolean;
  knownAll?: string;
  k?: number[];
  kr?: number[];
  terr?: [number, number][];
  blds?: Building[];
  res?: [number, ResourceNode | null][];
  par?: [number, Parcel][];
  drops?: [number, Partial<Record<ResKind, number>> | null][];
  units?: [string, Partial<Unit> | null][];
  logs?: [string, LogEntry[]][];
  me?: { storage: Player['storage']; totals: Player['totals']; stats: DayStats };
  files?: Record<string, string>;
  versions?: Player['versions'];
  scores?: [string, string, string, number][];
  ev?: GameEvent[];
  match?: MatchConfig | null;
  acks?: { id: number; r: RunResult }[];
  players?: { id: string; name: string; bot: boolean }[];
}

export type ToHost =
  | { type: 'hello'; cid: string; name: string; want?: 'init' }
  | { type: 'ping'; cid: string }
  | { type: 'files'; cid: string; files: Record<string, string> }
  | { type: 'run'; cid: string; unit: string; file: string; files: Record<string, string>; id: number }
  | { type: 'stop'; cid: string; unit: string }
  | { type: 'bye'; cid: string };

// ───────────── anfitrión (profesor) ─────────────

interface ClientState {
  cid: string;
  name: string;
  lastSeen: number;
  known: Uint8Array | null;
  knownRes: Set<number>;
  terrCursor: number;
  sent: Map<string, string>;
  unitsSent: Set<string>;
  evCursor: number;
  acks: { id: number; r: RunResult }[];
  needInit: boolean;
}

export const DEFAULT_SETTINGS: LobbySettings = { prepMin: 5, playMin: 15, hacking: true, hackBreak: false, bots: 0 };

export function mapSizeFor(slots: number): number {
  return Math.round(26 + 14 * Math.sqrt(Math.max(4, slots)));
}

export class HostSession extends GameSession {
  readonly kind = 'host' as const;
  clients = new Map<string, ClientState>();
  state: 'lobby' | 'game' = 'lobby';
  settings: LobbySettings = { ...DEFAULT_SETTINGS };
  private unsub: (() => void)[] = [];
  private lastPatch = 0;
  private lastLobby = 0;
  onRoster?: () => void;

  constructor(public transport: Transport, public code: string, public title: string) {
    super();
    this.me = 'profe';
    this.god = true;
    this.unsub.push(transport.listen('host', (m) => this.onMessage(m as ToHost)));
    // mundo provisional para el lobby (no se usa hasta empezar)
    this.game = Game.create({ w: 32, h: 32, seed: 1, tzOffsetMin: 0, name: 'lobby' }, Date.now(), 1);
  }

  roster(): RosterEntry[] {
    const now = Date.now();
    return [...this.clients.values()].map((c) => ({ cid: c.cid, name: c.name, online: now - c.lastSeen < 8000 }));
  }

  private onMessage(m: ToHost): void {
    if (!m || typeof m !== 'object' || !('cid' in m)) return;
    const name = 'name' in m ? String(m.name).slice(0, 24).trim() || 'Alumno' : '';
    let c = this.clients.get(m.cid);
    if (m.type === 'hello') {
      if (!c) {
        c = { cid: m.cid, name, lastSeen: Date.now(), known: null, knownRes: new Set(), terrCursor: 0, sent: new Map(), unitsSent: new Set(), evCursor: 0, acks: [], needInit: true };
        this.clients.set(m.cid, c);
        if (this.state === 'game') this.addLatePlayer(c);
      }
      c.lastSeen = Date.now();
      c.name = name;
      if (this.state === 'game' && m.want === 'init') c.needInit = true;
      this.onRoster?.();
      this.sendLobby(true);
      return;
    }
    if (!c) return;
    c.lastSeen = Date.now();
    if (m.type === 'bye') { c.lastSeen = 0; this.onRoster?.(); return; }
    if (m.type === 'ping') return;
    if (this.state !== 'game') return;
    const pl = this.game.player(c.cid);
    if (!pl) return;
    if (m.type === 'files' || m.type === 'run') {
      const files: Record<string, string> = {};
      for (const [k, v] of Object.entries(m.files ?? {}).slice(0, 30)) {
        if (/^[A-Za-z_]\w*\.py$/.test(k) && typeof v === 'string' && v.length < 60_000) files[k] = v;
      }
      pl.p.files = files;
      c.sent.set('files', JSON.stringify(files));
    }
    if (m.type === 'run') {
      const u = this.game.units.get(m.unit)?.u;
      let r: RunResult;
      if (!u || u.owner !== c.cid) r = { ok: false, error: 'Esa unidad no es tuya' };
      else {
        const files = pl.p.files;
        for (const [n, src] of Object.entries(files)) this.saveFile(c.cid, n, src, n === m.file);
        r = this.game.runProgram(m.unit, m.file, { ...files });
      }
      c.acks.push({ id: m.id, r });
    }
    if (m.type === 'stop') {
      const u = this.game.units.get(m.unit)?.u;
      if (u && u.owner === c.cid) this.game.stopProgram(m.unit);
    }
  }

  sendLobby(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastLobby < 2000) return;
    this.lastLobby = now;
    this.transport.send('all', { type: 'lobby', roster: this.roster(), state: this.state, settings: this.settings, title: this.title } satisfies ToStudent);
  }

  kick(cid: string): void {
    this.transport.send(`c:${cid}`, { type: 'kick', reason: 'El profesor te ha sacado de la sala' } satisfies ToStudent);
    this.clients.delete(cid);
    this.onRoster?.();
    this.sendLobby(true);
  }

  /** Empieza la partida con los alumnos conectados */
  start(): void {
    const students = [...this.clients.values()];
    const slots = Math.max(8, Math.min(24, students.length + this.settings.bots + 2));
    const size = mapSizeFor(slots);
    const t = Date.now();
    const match: MatchConfig = {
      start: t, prepMs: Math.round(this.settings.prepMin * 60_000), playMs: Math.round(this.settings.playMin * 60_000),
      hacking: this.settings.hacking, hackBreak: this.settings.hackBreak,
    };
    const cfg: WorldConfig = {
      w: size, h: size, seed: (t % 1_000_000) + 11, tzOffsetMin: 0, name: this.title, timeScale: 0.35, match,
      startStorage: { hierro: 6, cobre: 4, silicio: 2, chatarra: 6 },
    };
    this.game = Game.create(cfg, t, slots);
    for (const c of students) this.game.addPlayer(c.cid, c.name, false, { ...STARTER_FILES });
    for (let i = 0; i < this.settings.bots; i++) {
      const id = `bot${i}`;
      this.game.addPlayer(id, `🤖 ${BOT_NAMES[i % BOT_NAMES.length]}`, true, { ...BOT_FILES });
      for (const u of this.game.unitsOf(id)) if (u.type !== 'hacker' || this.settings.hacking) this.game.runProgram(u.id, DEFAULT_PROGRAM[u.type], { ...BOT_FILES });
    }
    this.gameTime = t;
    this.lastReal = performance.now();
    this.paused = false;
    this.state = 'game';
    for (const c of students) this.resetClient(c);
    this.sendLobby(true);
  }

  private addLatePlayer(c: ClientState): void {
    try {
      this.game.addPlayer(c.cid, c.name, false, { ...STARTER_FILES });
    } catch {
      this.transport.send(`c:${c.cid}`, { type: 'kick', reason: 'La sala está llena' } satisfies ToStudent);
    }
  }

  private resetClient(c: ClientState): void {
    c.known = null;
    c.knownRes = new Set();
    c.terrCursor = 0;
    c.sent.clear();
    c.unitsSent.clear();
    c.evCursor = this.game.events.length ? this.game.events[this.game.events.length - 1].t : 0;
    c.needInit = true;
  }

  backToLobby(): void {
    this.state = 'lobby';
    this.transport.send('all', { type: 'reset' } satisfies ToStudent);
    this.sendLobby(true);
  }

  setPaused(p: boolean): void {
    if (p === this.paused) return;
    this.gameTime = this.now();
    this.lastReal = performance.now();
    this.paused = p;
  }

  extend(ms: number): void {
    const m = this.game.cfg.match;
    if (!m) return;
    if (this.game.phase(this.gameTime) === 'prep') m.prepMs = Math.max(0, m.prepMs + ms);
    else m.playMs = Math.max(0, m.playMs + ms);
    if (ms < 0 && this.game.phase(this.gameTime) === 'prep') m.prepMs = Math.max(0, this.gameTime - m.start);
  }

  /** salta directamente al inicio del juego (termina la preparación) */
  skipPrep(): void {
    const m = this.game.cfg.match;
    if (m && this.game.phase(this.gameTime) === 'prep') m.prepMs = Math.max(0, this.gameTime - m.start + 500);
  }

  endNow(): void {
    const m = this.game.cfg.match;
    if (m) m.playMs = Math.max(0, this.gameTime - m.start - m.prepMs);
  }

  override tick(realNow: number): void {
    super.tick(realNow);
    this.sendLobby();
    if (this.state !== 'game') return;
    // Ably admite ~50 mensajes/s por conexión: con muchos alumnos, parches algo menos frecuentes
    const every = Math.max(330, Math.ceil((this.clients.size * 1000) / 35));
    if (realNow - this.lastPatch < every) return;
    this.lastPatch = realNow;
    for (const c of this.clients.values()) {
      if (!this.game.player(c.cid)) continue;
      if (c.needInit) this.sendInit(c);
      const p = this.buildPatch(c);
      if (p) this.transport.send(`c:${c.cid}` as Channel, p);
    }
  }

  private sendInit(c: ClientState): void {
    this.resetClient(c);
    c.needInit = false;
    const players = [...this.game.players.values()].map((p) => ({ id: p.p.id, name: p.p.name, bot: p.p.bot }));
    this.transport.send(`c:${c.cid}`, {
      type: 'init', cfg: this.game.cfg, time: this.game.time, slots: this.game.slots.length, players, you: c.cid, paused: this.paused,
    } satisfies ToStudent);
  }

  private buildPatch(c: ClientState): PatchMsg | null {
    const g = this.game;
    const pl = g.player(c.cid)!;
    const w = g.cfg.w;
    const n = w * g.cfg.h;
    const out: PatchMsg = { type: 'patch', t: this.now(), paused: this.paused };
    let changed = false;
    const put = (key: string, val: unknown): boolean => {
      const s = JSON.stringify(val);
      if (c.sent.get(key) === s) return false;
      c.sent.set(key, s);
      return true;
    };
    // niebla
    if (!c.known) {
      c.known = new Uint8Array(pl.known);
      out.knownAll = toB64(pl.known);
      out.full = true;
      changed = true;
    } else {
      const k: number[] = [];
      for (let i = 0; i < n; i++) if (pl.known[i] && !c.known[i]) { c.known[i] = 1; k.push(i); }
      if (k.length) { out.k = k; changed = true; }
    }
    const known = c.known;
    // vetas conocidas
    const kr: number[] = [];
    for (const id of pl.knownRes) if (!c.knownRes.has(id)) { c.knownRes.add(id); kr.push(id); }
    if (kr.length) { out.kr = kr; changed = true; }
    const res: [number, ResourceNode | null][] = [];
    for (const id of c.knownRes) {
      const r = g.resources.get(id);
      if (put(`r${id}`, r ? r.amount : null)) res.push([id, r ?? null]);
    }
    if (res.length) { out.res = res; changed = true; }
    // terreno y edificios (públicos)
    if (c.terrCursor < g.terrainLog.length) {
      out.terr = g.terrainLog.slice(c.terrCursor);
      c.terrCursor = g.terrainLog.length;
      changed = true;
    }
    const blds = [...g.buildings.values()];
    if (put('blds', blds.length)) { out.blds = blds; changed = true; }
    // huertos y montones en casillas conocidas
    const par: [number, Parcel][] = [];
    for (const [k, p] of g.parcels) {
      if (!known[k]) continue;
      if (put(`p${k}`, [p.planted, p.hum, p.mat, p.t, p.owner])) par.push([k, p]);
    }
    if (par.length) { out.par = par; changed = true; }
    const drops: [number, Partial<Record<ResKind, number>> | null][] = [];
    for (const [k, d] of g.drops) {
      if (!known[k]) continue;
      if (put(`d${k}`, d)) drops.push([k, d]);
    }
    for (const key of [...c.sent.keys()]) {
      if (key[0] === 'd' && key !== 'blds') {
        const k = Number(key.slice(1));
        if (!Number.isNaN(k) && !g.drops.has(k)) { c.sent.delete(key); drops.push([k, null]); }
      }
    }
    if (drops.length) { out.drops = drops; changed = true; }
    // unidades
    const units: [string, Partial<Unit> | null][] = [];
    const logs: [string, LogEntry[]][] = [];
    const seen = new Set<string>();
    for (const rt of g.units.values()) {
      const u = rt.u;
      const mine = u.owner === c.cid;
      if (!mine && !known[u.y * w + u.x]) continue;
      seen.add(u.id);
      const view: Partial<Unit> = mine
        ? { ...u, program: u.program ? { ...u.program, vm: null, bundle: { main: '', modules: {} }, original: u.program.bundle.main === u.program.original ? '' : '*' } : null, logs: [], memoria: null, trail: u.trail.slice(-20) }
        : { id: u.id, owner: u.owner, name: u.name, type: u.type, x: u.x, y: u.y, status: u.status, action: u.action, wetUntil: u.wetUntil, hacked: u.hacked, battery: 100, water: 0, cargo: {}, logs: [], trail: [] };
      if (put(`u${u.id}`, view)) units.push([u.id, view]);
      if (mine) {
        const last = u.logs[u.logs.length - 1];
        if (put(`l${u.id}`, [u.logs.length, last?.t, last?.n])) logs.push([u.id, u.logs.slice(-60)]);
      }
    }
    for (const id of c.unitsSent) if (!seen.has(id)) { units.push([id, null]); c.sent.delete(`u${id}`); }
    c.unitsSent = seen;
    if (units.length) { out.units = units; changed = true; }
    if (logs.length) { out.logs = logs; changed = true; }
    // lo mío
    const me = { storage: pl.p.storage, totals: pl.p.totals, stats: pl.p.stats };
    if (put('me', me)) { out.me = me; changed = true; }
    if (put('files', pl.p.files)) { out.files = pl.p.files; changed = true; }
    if (put('versions', pl.p.versions ?? {})) { out.versions = pl.p.versions; changed = true; }
    const plist = [...g.players.values()].map((p) => ({ id: p.p.id, name: p.p.name, bot: p.p.bot }));
    if (put('players', plist.length)) { out.players = plist; changed = true; }
    const scores = [...g.players.values()].map((p) => [p.p.id, p.p.name, p.p.color, g.score(p)] as [string, string, string, number]);
    if (put('scores', scores)) { out.scores = scores; changed = true; }
    if (put('match', g.cfg.match)) { out.match = g.cfg.match; changed = true; }
    // eventos
    const ev = g.events.filter((e) => e.t > c.evCursor && (e.owner === c.cid || known[e.y * w + e.x]));
    if (g.events.length) c.evCursor = Math.max(c.evCursor, g.events[g.events.length - 1].t);
    if (ev.length) { out.ev = ev; changed = true; }
    if (c.acks.length) { out.acks = c.acks; c.acks = []; changed = true; }
    if (put('paused', this.paused)) changed = true;
    // latido: cada ~2 s aunque no cambie nada, para sincronizar el reloj
    if (!changed && Math.floor(this.lastPatch / 2000) === Math.floor((this.lastPatch - 330) / 2000)) return null;
    return out;
  }

  close(): void {
    this.unsub.forEach((f) => f());
    this.transport.close();
  }
}

// ───────────── espejo (alumno) ─────────────

export class MirrorSession extends GameSession {
  readonly kind = 'alumno' as const;
  private reqId = 1;
  private pendingRuns = new Map<number, (r: RunResult) => void>();
  onResult?: (r: RunResult) => void;
  private filesTimer: ReturnType<typeof setTimeout> | undefined;
  lastPatchAt = performance.now();

  constructor(public transport: Transport, public cid: string, init: Extract<ToStudent, { type: 'init' }>) {
    super();
    this.me = cid;
    const cfg = init.cfg;
    // las mismas altas en el mismo orden → mismo terreno y colores que el anfitrión
    const g2 = Game.create(cfg, init.time, init.slots);
    for (const p of init.players) g2.addPlayer(p.id, p.name, p.bot, {});
    g2.mirror = true;
    // nada de lo generado localmente es fiable: vetas, unidades y niebla llegan del anfitrión
    for (const r of [...g2.resources.values()]) g2.removeResource(r);
    g2.units.clear();
    for (const p of g2.players.values()) { p.known.fill(0); p.knownRes.clear(); }
    g2.events = [];
    this.game = g2;
    this.gameTime = init.time;
    this.paused = init.paused;
  }

  apply(m: PatchMsg): void {
    const g = this.game;
    const pl = g.player(this.me);
    if (!pl) return;
    const now = performance.now();
    // reloj: se sincroniza con el anfitrión
    this.gameTime = m.t;
    this.lastReal = now;
    this.lastPatchAt = now;
    this.paused = m.paused;
    g.time = Math.max(g.time, m.t);
    if (m.knownAll) pl.known.set(fromB64(m.knownAll, pl.known.length));
    if (m.k) { for (const i of m.k) pl.known[i] = 1; }
    if (m.knownAll || m.k) g.version++;
    if (m.terr) {
      for (const [k, t] of m.terr) {
        g.terrain[k] = t;
        const x = k % g.cfg.w;
        const y = Math.floor(k / g.cfg.w);
        g.props = g.props.filter((p) => !(p.x === x && p.y === y) || p.owner);
      }
      g.terrainVersion++;
    }
    if (m.blds) {
      for (const b of m.blds) {
        if (g.buildings.has(b.id)) continue;
        g.addBuilding(b);
        const kind = (b.kind === 'panel' ? 'panel_solar' : b.kind) as Prop['kind'];
        g.props = g.props.filter((p) => !(p.x === b.x && p.y === b.y));
        g.props.push({ x: b.x, y: b.y, kind, v: 0, owner: b.owner });
      }
      g.terrainVersion++;
    }
    if (m.kr) for (const id of m.kr) pl.knownRes.add(id);
    if (m.res) {
      for (const [id, r] of m.res) {
        const cur = g.resources.get(id);
        if (!r) { if (cur) g.removeResource(cur); continue; }
        if (cur) Object.assign(cur, r);
        else g.addResource({ ...r });
      }
      g.version++;
    }
    if (m.par) for (const [k, p] of m.par) g.parcels.set(k, { ...p });
    if (m.drops) for (const [k, d] of m.drops) { if (d) g.drops.set(k, d); else g.drops.delete(k); }
    if (m.units) {
      for (const [id, v] of m.units) {
        if (!v) { g.units.delete(id); continue; }
        const rt = g.units.get(id);
        if (rt) Object.assign(rt.u, v, { logs: rt.u.logs });
        else g.units.set(id, { u: { logs: [], trail: [], cargo: {}, ...v } as Unit, vm: null, memoria: new PyDict() });
      }
    }
    if (m.logs) for (const [id, l] of m.logs) { const rt = g.units.get(id); if (rt) rt.u.logs = l; }
    if (m.me) { pl.p.storage = m.me.storage; pl.p.totals = m.me.totals; pl.p.stats = m.me.stats; }
    if (m.files) {
      const localChanged = JSON.stringify(m.files) !== JSON.stringify(pl.p.files);
      pl.p.files = { ...m.files };
      if (localChanged) this.filesVersion++;
    }
    if (m.versions) pl.p.versions = m.versions;
    if (m.scores) {
      for (const [id, name, color, score] of m.scores) {
        const p = g.player(id);
        if (p) { p.p.name = name; p.p.color = color; if (id !== this.me) p.p.totals = { ...p.p.totals, delivered: score, buildScore: 0 }; }
      }
    }
    if (m.match !== undefined) g.cfg.match = m.match;
    if (m.players) {
      for (const p of m.players) {
        if (g.player(p.id)) continue;
        try {
          g.addPlayer(p.id, p.name, p.bot, {});
          for (const u of g.unitsOf(p.id)) g.units.delete(u.id);
          g.player(p.id)!.known.fill(0);
          g.terrainVersion++;
        } catch { /* sala llena */ }
      }
    }
    if (m.ev) { g.events.push(...m.ev); if (g.events.length > 400) g.events.splice(0, g.events.length - 400); }
    if (m.acks) for (const a of m.acks) { this.pendingRuns.get(a.id)?.(a.r); this.pendingRuns.delete(a.id); this.onResult?.(a.r); }
  }

  override tick(realNow: number): void {
    const dt = Math.min(1500, realNow - this.lastReal);
    if (!this.paused && realNow - this.lastPatchAt < 5000) {
      this.gameTime += dt;
      this.lastReal = realNow;
    } else this.lastReal = realNow;
    this.game.time = Math.max(this.game.time, this.gameTime);
  }

  override now(realNow = performance.now()): number {
    if (this.paused) return this.gameTime;
    return this.gameTime + Math.min(1500, realNow - this.lastReal);
  }

  override saveFile(owner: string, name: string, src: string, snapshot = false): void {
    super.saveFile(owner, name, src, snapshot);
    clearTimeout(this.filesTimer);
    this.filesTimer = globalThis.setTimeout(() => this.transport.send('host', { type: 'files', cid: this.cid, files: this.filesOf(this.me) } satisfies ToHost), 800);
  }

  override deleteFile(owner: string, name: string): void {
    super.deleteFile(owner, name);
    this.transport.send('host', { type: 'files', cid: this.cid, files: this.filesOf(this.me) } satisfies ToHost);
  }

  override run(unitId: string, file: string): RunResult {
    const src = this.filesOf(this.me)[file];
    if (src === undefined) return { ok: false, error: `No existe ${file}` };
    const syn = checkSyntax(src);
    if (syn) return { ok: false, error: syn.msg, line: syn.line, file };
    if (this.game.phase(this.now()) === 'end') return { ok: false, error: 'La partida ha terminado' };
    const id = this.reqId++;
    this.transport.send('host', { type: 'run', cid: this.cid, unit: unitId, file, files: this.filesOf(this.me), id } satisfies ToHost);
    return { ok: true, pending: true };
  }

  override stop(unitId: string): void {
    this.transport.send('host', { type: 'stop', cid: this.cid, unit: unitId } satisfies ToHost);
  }

  override canControl(unitId: string): boolean {
    return this.game.units.get(unitId)?.u.owner === this.me;
  }
}
