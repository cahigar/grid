import { toPy, type J } from '../lang/interop';
// Mundo simulado por eventos con marcas de tiempo (partidas de aula y práctica libre).
import { checkSyntax } from '../lang/compiler';
import { deserializeValue, deserializeVM, serializeValue, serializeVM, type ValueState } from '../lang/serialize';
import { PyDict, PyError, PyRecord, Tuple, err, pyRepr, seqItems, toInt, toNum, type Value } from '../lang/values';
import { VM, type ActionReq, type Host } from '../lang/vm';
import { HACK_MODES, mutate, type HackMode } from './hack';
import { buildBase, generate } from './mapgen';
import {
  BRIDGE_COST, BUILDINGS, CROP, DIRS, FACTORY, FACTORY_TYPES, HACK, MOBILE_TYPES, UNIT_COST, RES_KINDS, RESOURCES, SIGNAL, T, TERRAIN, UNIT_TYPES,
  type BuildKind, type Building, type DayStats, type Dir, type LogEntry, type Parcel, type Player, type Prop,
  type ResKind, type ResourceNode, type Unit, type UnitType, type WorldConfig, type WorldState,
} from './types';

export const VM_BUDGET = 20_000;
const SOLAR_MS_PER_PCT = 30_000;
const ASPERSOR_WATER_MS = 3000;
const MAX_LOGS = 160;
export const PLAYER_COLORS = [
  '#2fd4c0', '#f2a93b', '#8fd14f', '#5aa9f0', '#f07a8c', '#e6c84a', '#6ee7b7', '#ff8a5b', '#7fb3ff', '#d4e157',
  '#4dd0e1', '#ffb74d', '#aed581', '#90caf9', '#f48fb1', '#ffd54f', '#80cbc4', '#ffab91', '#b0bec5', '#c5e1a5',
];

export interface GameEvent {
  t: number;
  kind: 'extract' | 'deliver' | 'scan' | 'bump' | 'error' | 'build' | 'deplete' | 'done' | 'plant' | 'harvest'
    | 'water' | 'splash' | 'hack' | 'hacked' | 'wet' | 'pickup' | 'spawn';
  unit: string;
  owner: string;
  x: number;
  y: number;
  text?: string;
}

export interface PlayerRt {
  p: Player;
  known: Uint8Array;
  knownRes: Set<number>;
  compartido: PyDict;
}

export interface UnitRt {
  u: Unit;
  vm: VM | null;
  memoria: PyDict;
}

export type Phase = 'free' | 'prep' | 'play' | 'end';

// ───── utilidades base64 portables ─────
export function toB64(a: Uint8Array): string {
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(s: string, n: number): Uint8Array {
  const bin = atob(s);
  const a = new Uint8Array(n);
  for (let i = 0; i < bin.length && i < n; i++) a[i] = bin.charCodeAt(i);
  return a;
}

class MinHeap {
  a: [number, number, string][] = [];
  push(e: [number, number, string]): void {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.lt(a[p], a[i])) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  lt(x: [number, number, string], y: [number, number, string]): boolean {
    return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  }
  peek(): [number, number, string] | undefined { return this.a[0]; }
  pop(): [number, number, string] | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.lt(a[l], a[m])) m = l;
        if (r < a.length && this.lt(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  get size(): number { return this.a.length; }
}

const ALL_ACTIONS = new Set(Object.values(UNIT_TYPES).flatMap((t) => t.actions));

export class Game {
  cfg: WorldConfig;
  /** variables precargadas en todos los programas (retos de la Academia) */
  preset: Record<string, J> | null = null;
  time: number;
  terrain: Uint8Array;
  props: Prop[];
  resources = new Map<number, ResourceNode>();
  resAt = new Map<number, number>();
  nextResId = 1;
  players = new Map<string, PlayerRt>();
  units = new Map<string, UnitRt>();
  buildings = new Map<number, Building>();
  bldAt = new Map<number, number>();
  nextBuildId = 1;
  parcels = new Map<number, Parcel>();
  drops = new Map<number, Partial<Record<ResKind, number>>>();
  seq = 0;
  queue = new MinHeap();
  events: GameEvent[] = [];
  /** cambia cuando cambia algo visible (niebla, recursos) */
  version = 0;
  /** cambia cuando cambia el terreno (caminos, edificios) */
  terrainVersion = 0;
  /** cambios de terreno en orden (para sincronizar a los alumnos) */
  terrainLog: [number, number][] = [];
  slots: { x: number; y: number }[] = [];
  eventsProcessed = 0;
  /** desactiva la ejecución (espejo del alumno) */
  mirror = false;

  constructor(cfg: WorldConfig, time: number, terrain: Uint8Array, props: Prop[]) {
    this.cfg = cfg;
    this.time = time;
    this.terrain = terrain;
    this.props = props;
    for (let i = 0; i < terrain.length; i++) if (terrain[i] === T.CULTIVO) this.parcels.set(i, emptyParcel(time));
  }

  get ts(): number { return this.cfg.timeScale ?? 1; }

  // ───────────── creación / persistencia ─────────────

  static create(cfg: WorldConfig, time: number, maxPlayers = 4): Game {
    const gen = generate(cfg, maxPlayers);
    const g = new Game(cfg, time, gen.terrain, gen.props);
    for (const r of gen.resources) g.addResource(r);
    g.nextResId = Math.max(0, ...gen.resources.map((r) => r.id)) + 1;
    g.slots = gen.slots;
    return g;
  }

  toState(): WorldState {
    const units = [...this.units.values()].map(({ u, vm, memoria }) => {
      const ext = new Map<object, string>([[memoria, 'memoria'], [this.players.get(u.owner)!.compartido, 'compartido']]);
      const copy: Unit = { ...u, memoria: serializeValue(memoria) };
      if (u.program) copy.program = { ...u.program, vm: vm ? serializeVM(vm, ext) : null };
      return copy;
    });
    const players = [...this.players.values()].map(({ p, known, knownRes, compartido }) => ({
      ...p, known: toB64(known), knownRes: [...knownRes], compartido: serializeValue(compartido),
    }));
    return {
      v: 2, cfg: this.cfg, time: this.time, terrain: toB64(this.terrain), props: this.props,
      resources: [...this.resources.values()], nextResId: this.nextResId, players, units, seq: this.seq,
      slots: this.slots, buildings: [...this.buildings.values()], parcels: [...this.parcels],
      drops: [...this.drops], nextBuildId: this.nextBuildId, terrainVersion: this.terrainVersion,
    };
  }

  static fromState(s: WorldState): Game {
    const g = new Game(s.cfg, s.time, fromB64(s.terrain, s.cfg.w * s.cfg.h), s.props);
    for (const r of s.resources) g.addResource(r);
    g.nextResId = s.nextResId;
    g.seq = s.seq;
    g.slots = s.slots ?? [];
    for (const b of s.buildings ?? []) g.addBuilding(b);
    g.nextBuildId = s.nextBuildId ?? 1;
    if (s.parcels) g.parcels = new Map(s.parcels);
    if (s.drops) g.drops = new Map(s.drops);
    g.terrainVersion = s.terrainVersion ?? 0;
    for (const p of s.players) {
      const compartido = (p.compartido ? deserializeValue(p.compartido as ValueState) : new PyDict()) as PyDict;
      g.players.set(p.id, {
        p: { ...p, known: '', knownRes: [], compartido: null },
        known: fromB64(p.known, s.cfg.w * s.cfg.h),
        knownRes: new Set(p.knownRes),
        compartido,
      });
    }
    for (const u of s.units) {
      const memoria = (u.memoria ? deserializeValue(u.memoria as ValueState) : new PyDict()) as PyDict;
      const rt: UnitRt = { u: { ...u, memoria: null }, vm: null, memoria };
      g.units.set(u.id, rt);
      if (u.program?.vm) {
        rt.vm = deserializeVM(u.program.vm, g.hostFor(rt), { memoria, compartido: g.players.get(u.owner)!.compartido });
      }
      if (rt.u.program) rt.u.program = { ...rt.u.program, vm: null };
      if (u.wakeAt !== null) g.queue.push([u.wakeAt, g.seq++, u.id]);
    }
    // migraciones de partidas guardadas antiguas
    for (const pl of g.players.values()) {
      for (const r of g.resources.values()) if (pl.known[r.y * g.cfg.w + r.x]) pl.knownRes.add(r.id);
      if (!s.cfg.level && g.cfg.baseUnit !== false && !g.unitsOf(pl.p.id).some((u) => u.type === 'base')) {
        g.spawnUnit(pl, 'base', [pl.p.base.x, pl.p.base.y]);
      }
      pl.p.dock = g.parkingSpot(pl.p.base, pl.p.dock);
    }
    return g;
  }

  addResource(r: ResourceNode): void {
    this.resources.set(r.id, r);
    this.resAt.set(r.y * this.cfg.w + r.x, r.id);
  }
  removeResource(r: ResourceNode): void {
    this.resources.delete(r.id);
    this.resAt.delete(r.y * this.cfg.w + r.x);
  }
  addBuilding(b: Building): void {
    this.buildings.set(b.id, b);
    this.bldAt.set(b.y * this.cfg.w + b.x, b.id);
  }

  // ───────────── fases de la partida ─────────────

  get playStart(): number {
    const m = this.cfg.match;
    return m ? m.start + m.prepMs : -Infinity;
  }
  get playEnd(): number {
    const m = this.cfg.match;
    return m ? m.start + m.prepMs + m.playMs : Infinity;
  }
  phase(t = this.time): Phase {
    const m = this.cfg.match;
    if (!m) return 'free';
    if (t < this.playStart) return 'prep';
    if (t < this.playEnd) return 'play';
    return 'end';
  }

  // ───────────── jugadores ─────────────

  addPlayer(id: string, name: string, bot = false, files?: Record<string, string>): Player {
    if (this.players.has(id)) return this.players.get(id)!.p;
    const used = new Set([...this.players.values()].map((p) => `${p.p.base.x},${p.p.base.y}`));
    const slot = this.slots.find((s) => !used.has(`${s.x},${s.y}`));
    if (!slot) throw new Error('El mundo está lleno');
    const { base, dock } = buildBase(this.terrain, this.cfg.w, this.props, slot, id);
    for (let y = base.y; y <= base.y + 2; y++) for (let x = base.x + 3; x <= base.x + 4; x++) this.parcels.set(y * this.cfg.w + x, emptyParcel(this.time));
    for (const [k, r] of [...this.resAt]) {
      const x = k % this.cfg.w;
      const y = Math.floor(k / this.cfg.w);
      const t = this.terrain[k];
      if (TERRAIN[t as T].move === 0 || t === T.CULTIVO || (Math.abs(x - base.x) <= 3 && Math.abs(y - base.y) <= 3)) this.removeResource(this.resources.get(r)!);
    }
    return this.registerPlayer(id, name, bot, files ?? {}, base, dock);
  }

  /** alta de jugador con base ya colocada (también la usan los niveles del tutorial) */
  registerPlayer(id: string, name: string, bot: boolean, files: Record<string, string>, base: { x: number; y: number }, dock: { x: number; y: number }): Player {
    dock = this.parkingSpot(base, dock);
    const storage = Object.fromEntries(RES_KINDS.map((k) => [k, this.cfg.startStorage?.[k] ?? 0])) as Record<ResKind, number>;
    const p: Player = {
      id, name, bot, color: PLAYER_COLORS[this.players.size % PLAYER_COLORS.length], base, dock, storage,
      known: '', knownRes: [], stats: this.emptyStats(),
      totals: { mined: 0, delivered: 0, explored: 0, built: 0, units: 0, harvested: 0, hacks: 0 },
      compartido: null, unitCounter: { granjero: 0, minero: 0, constructor: 0, hacker: 0, aspersor: 0, base: 0 }, files, lastSeen: this.time,
    };
    const rt: PlayerRt = { p, known: new Uint8Array(this.cfg.w * this.cfg.h), knownRes: new Set(), compartido: new PyDict() };
    this.players.set(id, rt);
    this.reveal(rt, base.x, base.y, 7, true);
    this.reveal(rt, base.x + 1, base.y + 1, 7, true);
    if (this.cfg.baseUnit !== false) this.spawnUnit(rt, 'base', [base.x, base.y]);
    const types = this.cfg.startUnits ?? MOBILE_TYPES;
    const spots = this.spawnSpots(dock, types.length);
    types.forEach((t, i) => this.spawnUnit(rt, t, spots[i]));
    this.version++;
    return p;
  }

  /** casilla libre junto a la base 2×2 donde aparcar (transitable por tierra y aire) */
  parkingSpot(base: { x: number; y: number }, pref?: { x: number; y: number }): { x: number; y: number } {
    const ok = (x: number, y: number, strict: boolean) => {
      const t = this.terrainAt(x, y);
      if (t === -1 || TERRAIN[t].move <= 0 || !TERRAIN[t].air) return false;
      if (this.distRect(x, y, base.x, base.y, 2, 2) !== 1) return false;
      return !strict || (t !== T.CULTIVO && !this.resAt.has(y * this.cfg.w + x));
    };
    const ring: [number, number][] = [];
    for (const dx of [0, 1]) ring.push([base.x + dx, base.y + 2]); // sur
    for (const dy of [0, 1]) ring.push([base.x + 2, base.y + dy], [base.x - 1, base.y + dy]); // este, oeste
    for (const dx of [0, 1]) ring.push([base.x + dx, base.y - 1]); // norte
    ring.push([base.x - 1, base.y + 2], [base.x + 2, base.y + 2], [base.x - 1, base.y - 1], [base.x + 2, base.y - 1]);
    if (pref && ok(pref.x, pref.y, true)) return pref;
    for (const strict of [true, false]) for (const [x, y] of ring) if (ok(x, y, strict)) return { x, y };
    return pref ?? { x: base.x, y: base.y + 2 };
  }

  /** casilla libre (sin unidades) junto a la base para una unidad nueva */
  freeSpotNearBase(pl: PlayerRt): [number, number] | null {
    const b = pl.p.base;
    const busy = new Set([...this.units.values()].map((o) => o.u.y * this.cfg.w + o.u.x));
    for (let r = 1; r <= 3; r++) {
      for (let y = b.y - r; y <= b.y + 1 + r; y++) {
        for (let x = b.x - r; x <= b.x + 1 + r; x++) {
          if (this.distRect(x, y, b.x, b.y, 2, 2) !== r) continue;
          const t = this.terrainAt(x, y);
          if (t === -1 || TERRAIN[t].move <= 0 || busy.has(y * this.cfg.w + x)) continue;
          if (x === pl.p.dock.x && y === pl.p.dock.y) continue;
          return [x, y];
        }
      }
    }
    return null;
  }

  spawnSpots(dock: { x: number; y: number }, n: number): [number, number][] {
    const out: [number, number][] = [];
    const seen = new Set<string>();
    const q: [number, number][] = [[dock.x, dock.y]];
    while (q.length && out.length < n) {
      const [x, y] = q.shift()!;
      const k = `${x},${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const t = this.terrainAt(x, y);
      if (t === -1) continue;
      if (TERRAIN[t].move > 0 && t !== T.CULTIVO) out.push([x, y]);
      if (TERRAIN[t].move > 0 || (x === dock.x && y === dock.y)) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) q.push([x + dx, y + dy]);
    }
    while (out.length < n) out.push([dock.x, dock.y]);
    return out;
  }

  emptyStats(): DayStats {
    return { day: this.dayOf(this.time), mined: 0, delivered: 0, explored: 0, energy: 0, instr: 0, actions: 0, activeMs: 0, errors: 0, harvested: 0, built: 0, hacks: 0 };
  }

  dayOf(t: number): number {
    return Math.floor((t + this.cfg.tzOffsetMin * 60_000) / 86_400_000);
  }

  stats(pl: PlayerRt): DayStats {
    if (!this.cfg.match && pl.p.stats.day !== this.dayOf(this.time)) pl.p.stats = this.emptyStats();
    return pl.p.stats;
  }

  spawnUnit(pl: PlayerRt, type: UnitType, at?: [number, number]): Unit {
    const info = UNIT_TYPES[type];
    const n = (pl.p.unitCounter[type] = (pl.p.unitCounter[type] ?? 0) + 1);
    const id = `${pl.p.id}:${info.prefix}${n}`;
    const [x, y] = at ?? [pl.p.dock.x, pl.p.dock.y];
    const u: Unit = {
      id, owner: pl.p.id, name: `${info.prefix}-${String(n).padStart(2, '0')}`, type,
      x, y, battery: 100, batteryAt: this.time, water: info.water, waterAt: this.time, cargo: {},
      status: 'IDLE', action: null, program: null, wakeAt: null, logs: [], trail: [], route: null,
      blocked: null, error: null, memoria: null, lastLine: 0, cpuWarned: false, instr: 0, actions: 0,
      wetUntil: 0, immuneUntil: 0, hackReadyAt: 0, hacked: null,
    };
    this.units.set(id, { u, vm: null, memoria: new PyDict() });
    this.log(u, `${info.label} ${u.name} operativo en (${u.x}, ${u.y})`, 'ok');
    return u;
  }

  // ───────────── conocimiento / niebla ─────────────

  reveal(pl: PlayerRt, cx: number, cy: number, r: number, silent = false): number {
    let n = 0;
    const { w, h } = this.cfg;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r + r) continue;
        const k = y * w + x;
        if (!pl.known[k]) {
          pl.known[k] = 1;
          n++;
          const rid = this.resAt.get(k);
          if (rid !== undefined) pl.knownRes.add(rid);
        }
      }
    }
    if (n) {
      this.version++;
      if (!silent) {
        this.stats(pl).explored += n;
        pl.p.totals.explored += n;
      }
    }
    return n;
  }

  terrainAt(x: number, y: number): T | -1 {
    if (x < 0 || y < 0 || x >= this.cfg.w || y >= this.cfg.h) return -1;
    return this.terrain[y * this.cfg.w + x] as T;
  }

  canEnter(u: Unit, x: number, y: number): boolean {
    const t = this.terrainAt(x, y);
    if (t === -1) return false;
    const info = UNIT_TYPES[u.type];
    if (info.fixed) return false;
    return info.air ? TERRAIN[t].air : TERRAIN[t].move > 0;
  }

  /** ms (sin escalar) para entrar en la casilla */
  moveMs(u: Unit, x: number, y: number): number {
    const t = this.terrainAt(x, y);
    if (t === -1) return 0;
    const info = UNIT_TYPES[u.type];
    if (info.air) {
      if (!TERRAIN[t].air) return 0;
      return t === T.CAMINO || t === T.CARRETERA || t === T.PUENTE ? Math.round(info.airMove * 0.7) : info.airMove;
    }
    return Math.round(TERRAIN[t].move * info.moveMul);
  }

  /** distancia de Chebyshev de la unidad a un rectángulo */
  distRect(x: number, y: number, rx: number, ry: number, rw = 1, rh = 1): number {
    const dx = Math.max(rx - x, 0, x - (rx + rw - 1));
    const dy = Math.max(ry - y, 0, y - (ry + rh - 1));
    return Math.max(dx, dy);
  }

  nearBase(u: Unit, d = 2): boolean {
    const b = this.players.get(u.owner)!.p.base;
    return this.distRect(u.x, u.y, b.x, b.y, 2, 2) <= d;
  }

  ownBuildings(owner: string, kind?: Building['kind']): Building[] {
    return [...this.buildings.values()].filter((b) => b.owner === owner && (!kind || b.kind === kind));
  }

  nearOwn(u: Unit, kind: Building['kind'], d = 1): boolean {
    return this.ownBuildings(u.owner, kind).some((b) => this.distRect(u.x, u.y, b.x, b.y) <= d);
  }

  inSignal(u: Unit): boolean {
    if (UNIT_TYPES[u.type].fixed || (this.cfg.level && !this.cfg.match)) return true;
    const b = this.players.get(u.owner)!.p.base;
    if (Math.hypot(u.x - b.x - 0.5, u.y - b.y - 0.5) <= SIGNAL.base) return true;
    return this.ownBuildings(u.owner, 'antena').some((a) => Math.hypot(u.x - a.x, u.y - a.y) <= SIGNAL.antena);
  }

  // ───────────── huertos ─────────────

  settleParcel(p: Parcel, t = this.time): Parcel {
    const dt = (t - p.t) / 1000;
    if (dt <= 0) return p;
    if (p.planted) {
      // tiempo con humedad > 30 durante dt
      const wet = Math.max(0, Math.min(dt, (p.hum - 30) / CROP.humDecay));
      p.mat = Math.min(100, p.mat + wet * CROP.grow);
    }
    p.hum = Math.max(0, p.hum - dt * CROP.humDecay);
    p.t = t;
    return p;
  }

  parcelAt(x: number, y: number): Parcel | undefined {
    if (x < 0 || y < 0 || x >= this.cfg.w || y >= this.cfg.h) return undefined;
    const p = this.parcels.get(y * this.cfg.w + x);
    return p ? this.settleParcel(p) : undefined;
  }

  // ───────────── logs y eventos ─────────────

  log(u: Unit, m: string, k: LogEntry['k'] = 'info'): void {
    const last = u.logs[u.logs.length - 1];
    if (last && last.m === m && last.k === k) {
      last.n++;
      last.t = this.time;
      return;
    }
    u.logs.push({ t: this.time, m, k, n: 1 });
    if (u.logs.length > MAX_LOGS) u.logs.splice(0, u.logs.length - MAX_LOGS);
  }

  emit(u: Unit, kind: GameEvent['kind'], text?: string, x = u.x, y = u.y): void {
    this.events.push({ t: this.time, kind, unit: u.id, owner: u.owner, x, y, text });
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  // ───────────── batería y agua ─────────────

  settleBattery(u: Unit): void {
    const dt = this.time - u.batteryAt;
    if (dt > 0) {
      u.battery = Math.min(100, u.battery + dt / SOLAR_MS_PER_PCT);
      u.batteryAt = this.time;
    }
    if (u.type === 'aspersor') {
      const max = UNIT_TYPES.aspersor.water;
      const dw = (this.time - u.waterAt) / ASPERSOR_WATER_MS;
      if (dw > 0) {
        u.water = Math.min(max, u.water + dw);
        u.waterAt = this.time;
      }
    }
  }

  // ───────────── programas ─────────────

  runProgram(unitId: string, fileName: string, files: Record<string, string>): { ok: boolean; error?: string; line?: number; file?: string } {
    const rt = this.units.get(unitId);
    if (!rt) return { ok: false, error: 'Unidad desconocida' };
    if (this.phase() === 'end') return { ok: false, error: 'La partida ha terminado' };
    const main = files[fileName];
    if (main === undefined) return { ok: false, error: `No existe ${fileName}` };
    const syn = checkSyntax(main);
    if (syn) return { ok: false, error: syn.msg, line: syn.line, file: fileName };
    const modules: Record<string, string> = {};
    for (const [name, src] of Object.entries(files)) {
      if (name === fileName) continue;
      modules[name.replace(/\.py$/, '')] = src;
    }
    const u = rt.u;
    this.settleBattery(u);
    u.program = { name: fileName.replace(/\.py$/, ''), bundle: { main, modules }, original: main, startedAt: this.time, vm: null, pending: null };
    this.startVM(rt);
    u.error = null;
    u.blocked = null;
    u.cpuWarned = false;
    u.route = null;
    this.log(u, `▶ iniciado programa ${u.program.name}`, 'ok');
    return { ok: true };
  }

  private startVM(rt: UnitRt): void {
    const u = rt.u;
    rt.vm = new VM(u.program!.bundle, this.hostFor(rt), hashSeed(u.id + this.time));
    try {
      rt.vm.start();
    } catch (e) {
      const r = rt.vm.fatal(e);
      if (r.s === 'error') this.failUnit(rt, r.type, r.msg, r.line, r.mod);
      return;
    }
    u.status = 'RUNNING';
    if (!u.action) this.schedule(u, this.time);
  }

  stopProgram(unitId: string): void {
    const rt = this.units.get(unitId);
    if (!rt || !rt.u.program) return;
    const u = rt.u;
    this.log(u, `■ programa ${u.program!.name} detenido`, 'warn');
    u.program = null;
    rt.vm = null;
    u.status = 'IDLE';
    u.blocked = null;
    if (!u.action) u.wakeAt = null;
  }

  schedule(u: Unit, t: number): void {
    if (this.cfg.match) t = Math.max(t, this.playStart);
    u.wakeAt = t;
    this.queue.push([t, this.seq++, u.id]);
  }

  // ───────────── avance del tiempo ─────────────

  advanceTo(t: number, maxEvents = Infinity): number {
    if (this.mirror) { this.time = Math.max(this.time, t); return 0; }
    let n = 0;
    const limit = Math.min(t, this.playEnd - 1);
    while (this.queue.size && this.queue.peek()![0] <= limit && n < maxEvents) {
      const [et, , id] = this.queue.pop()!;
      const rt = this.units.get(id);
      if (!rt || rt.u.wakeAt !== et) continue;
      this.time = Math.max(this.time, et);
      this.process(rt);
      n++;
    }
    if (n < maxEvents) this.time = Math.max(this.time, t);
    this.eventsProcessed += n;
    return n;
  }

  process(rt: UnitRt): void {
    const u = rt.u;
    u.wakeAt = null;
    this.settleBattery(u);
    const pl = this.players.get(u.owner)!;
    let result: Value = null;
    let hadAction = false;
    let thrown: PyError | null = null;
    if (u.action && u.action.end <= this.time) {
      const a = u.action;
      if (u.program) this.stats(pl).activeMs += a.end - a.start;
      try {
        result = this.finishAction(rt, a);
      } catch (e) {
        if (e instanceof PyError) thrown = e;
        else throw e;
      }
      u.action = null;
      hadAction = true;
    }
    if (!u.program || !rt.vm) {
      if (u.status === 'RUNNING' || u.status === 'HIBERNATING') u.status = 'IDLE';
      return;
    }
    const vm = rt.vm;
    if (u.program.pending) {
      const req = u.program.pending as ActionReq;
      u.program.pending = null;
      u.status = 'RUNNING';
      this.startAction(rt, req);
      return;
    }
    if (hadAction && vm.waiting) {
      if (thrown) vm.resumeThrow(thrown);
      else vm.resume(result);
    }
    if (vm.waiting) vm.resume(null);
    this.runVM(rt);
  }

  failUnit(rt: UnitRt, type: string, msg: string, line: number, mod: string): void {
    const u = rt.u;
    u.status = 'ERROR';
    u.error = { type, msg, line, mod };
    const where = mod === '__main__' ? `línea ${line}` : `${mod}.py línea ${line}`;
    this.log(u, `✖ ${type} (${where}): ${msg}`, 'error');
    this.stats(this.players.get(u.owner)!).errors++;
    this.emit(u, 'error', type);
    rt.vm = null;
  }

  runVM(rt: UnitRt): void {
    const u = rt.u;
    const vm = rt.vm!;
    const pl = this.players.get(u.owner)!;
    const before = vm.instrTotal;
    const r = vm.run(VM_BUDGET);
    const used = vm.instrTotal - before;
    u.instr += used;
    this.stats(pl).instr += used;
    switch (r.s) {
      case 'action':
        u.lastLine = r.line;
        this.startAction(rt, r.req);
        break;
      case 'budget':
        if (!u.cpuWarned) {
          this.log(u, `CPU saturada en la línea ${vm.lastLine}: el programa calcula mucho sin actuar (pausa de 1 s)`, 'warn');
          u.cpuWarned = true;
        }
        this.schedule(u, this.time + 1000);
        break;
      case 'done':
        u.status = 'DONE';
        this.log(u, `✔ programa ${u.program!.name} terminado`, 'ok');
        this.emit(u, 'done');
        rt.vm = null;
        break;
      case 'error':
        this.failUnit(rt, r.type, r.msg, r.line, r.mod);
        break;
    }
  }

  // ───────────── primitivas ─────────────

  hostFor(rt: UnitRt): Host {
    const g = this;
    const u = () => rt.u;
    const info = () => UNIT_TYPES[rt.u.type];
    const pl = () => g.players.get(rt.u.owner)!;
    const act = (action: string) => (args: Value[], kw: Record<string, Value>): ActionReq => ({ action, args, kw });
    const xy = (args: Value[], name: string): [number, number] => {
      if (args.length === 1) {
        const it = seqItems(args[0]);
        if (it && it.length === 2) return [toInt(it[0]), toInt(it[1])];
      }
      if (args.length !== 2) err('TypeError', `${name}(x, y) necesita dos coordenadas`);
      return [toInt(args[0], 'entero (x)'), toInt(args[1], 'entero (y)')];
    };
    const dirOf = (v: Value, name: string): Dir => {
      const d = typeof v === 'string' ? v.toUpperCase().trim() : v;
      if (d === 'W') err('ValueError', 'en G.R.I.D. el oeste es "O"');
      if (typeof d !== 'string' || !(d in DIRS)) err('ValueError', `${name}(): dirección inválida ${pyRepr(v)}: usa "N", "S", "E" u "O"`);
      return d as Dir;
    };
    const dirArg = (args: Value[], name: string): Dir => {
      if (args.length !== 1) err('TypeError', `${name}() necesita una dirección: "N", "S", "E" u "O"`);
      return dirOf(args[0], name);
    };
    const known = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= g.cfg.w || y >= g.cfg.h) return false;
      return pl().known[y * g.cfg.w + x] === 1;
    };
    const resRecord = (r: ResourceNode) =>
      new PyRecord('Recurso', { tipo: r.kind, x: r.x, y: r.y, cantidad: Math.floor(r.amount), calidad: r.quality });
    const parcelRecord = (x: number, y: number, p: Parcel) =>
      new PyRecord('Parcela', {
        x, y, plantada: p.planted, humedad: Math.round(p.hum), madurez: Math.floor(p.mat), lista: p.planted && p.mat >= 100,
        propia: p.owner === rt.u.owner || isOwnPlot(g, rt.u.owner, x, y),
      });
    const can = (name: string) => {
      if (!info().actions.includes(name)) err('AccionInvalidaError', `${info().label} no puede usar ${name}()`);
    };
    const wrap = (name: string, fn: (args: Value[], kw: Record<string, Value>) => Value | ActionReq) =>
      (args: Value[], kw: Record<string, Value>) => { if (ALL_ACTIONS.has(name)) can(name); return fn(args, kw); };
    const here = () => u().y * g.cfg.w + u().x;
    const fns: Record<string, (args: Value[], kw: Record<string, Value>) => Value | ActionReq> = {
      mover: (args, kw) => { dirArg(args, 'mover'); return act('mover')(args, kw); },
      mirar: (args, kw) => { dirArg(args, 'mirar'); return act('mirar')(args, kw); },
      escanear: act('escanear'),
      descargar: act('descargar'),
      recargar: act('recargar'),
      esperar: (args, kw) => {
        if (args.length !== 1) err('TypeError', 'esperar(segundos) necesita un número');
        toNum(args[0]);
        return act('esperar')(args, kw);
      },
      // granjero
      plantar: (args, kw) => {
        const p = g.parcelAt(u().x, u().y);
        if (!p) err('AccionInvalidaError', `no hay huerto en (${u().x}, ${u().y})`);
        if (p!.planted) err('AccionInvalidaError', 'esta parcela ya está plantada');
        return act('plantar')(args, kw);
      },
      regar: (args, kw) => {
        if (!g.parcelAt(u().x, u().y)) err('AccionInvalidaError', `no hay huerto en (${u().x}, ${u().y})`);
        if (u().water < 1) err('SinRecursosError', 'el depósito de agua está vacío: usa cargar_agua() junto al agua o la base');
        return act('regar')(args, kw);
      },
      recolectar: (args, kw) => {
        const p = g.parcelAt(u().x, u().y);
        if (!p || !p.planted) err('AccionInvalidaError', 'aquí no hay nada plantado');
        if (p!.mat < 100) err('CultivoNoMaduroError', `el cultivo está al ${Math.floor(p!.mat)} % de madurez`);
        if (cargoCount(u()) >= info().cargo) err('AccionInvalidaError', `carga llena (${cargoCount(u())}/${info().cargo}): descarga primero`);
        return act('recolectar')(args, kw);
      },
      cargar_agua: (args, kw) => {
        const nearWater = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.terrainAt(u().x + dx, u().y + dy) === T.AGUA);
        if (!nearWater && !g.nearBase(u())) err('FueraDeRangoError', 'hay que estar junto al agua o a la base para cargar agua');
        return act('cargar_agua')(args, kw);
      },
      agua: () => Math.floor(u().water),
      parcela_aqui: () => {
        const p = g.parcelAt(u().x, u().y);
        return p ? parcelRecord(u().x, u().y, p) : null;
      },
      parcelas: () => {
        const out: Value[] = [];
        for (const [k, p] of g.parcels) {
          if (!pl().known[k]) continue;
          const x = k % g.cfg.w;
          const y = Math.floor(k / g.cfg.w);
          out.push(parcelRecord(x, y, g.settleParcel(p)));
        }
        return out;
      },
      // minero
      picar: act('picar'),
      recoger: act('recoger'),
      suelo: () => {
        const d = g.drops.get(here());
        return PyDict.from(Object.entries(d ?? {}).filter(([, n]) => n! > 0).map(([k, n]) => [k, n!]));
      },
      // constructor
      construir: (args, kw) => {
        if (args.length !== 2) err('TypeError', 'construir(tipo, direccion) — p. ej. construir("camino", "E")');
        const tipo = args[0];
        if (typeof tipo !== 'string' || !(tipo in BUILDINGS)) err('ValueError', `tipo de edificio desconocido ${pyRepr(tipo)}: usa ${Object.keys(BUILDINGS).map((k) => `"${k}"`).join(', ')}`);
        const d = dirOf(args[1], 'construir');
        const [dx, dy] = DIRS[d];
        const tx = u().x + dx;
        const ty = u().y + dy;
        const cost = g.buildCost(tipo as BuildKind, tx, ty);
        const reason = g.buildBlocked(tipo as BuildKind, tx, ty);
        if (reason) err('AccionInvalidaError', reason);
        const missing = Object.entries(cost).filter(([k, n]) => pl().p.storage[k as ResKind] < n!).map(([k, n]) => `${n} ${k}`);
        if (missing.length) err('SinRecursosError', `faltan recursos en el almacén para ${tipo}: necesitas ${Object.entries(cost).map(([k, n]) => `${n} ${k}`).join(' + ')}`);
        return act('construir')(args, kw);
      },
      coste_edificio: (args) => {
        const tipo = String(args[0]);
        if (!(tipo in BUILDINGS)) err('ValueError', `tipo desconocido ${pyRepr(args[0])}`);
        return PyDict.from(Object.entries(BUILDINGS[tipo as BuildKind].cost).map(([k, n]) => [k, n!]));
      },
      edificios: () => g.ownBuildings(u().owner).map((b) => new PyRecord('Edificio', { tipo: b.kind, x: b.x, y: b.y })),
      // hacker
      hackear: (args, kw) => {
        if (args.length < 1) err('TypeError', 'hackear(direccion, modo="invertir")');
        const d = dirOf(args[0], 'hackear');
        const modo = String(args[1] ?? kw.modo ?? 'invertir');
        if (!HACK_MODES.includes(modo as HackMode)) err('ValueError', `modo de hackeo desconocido "${modo}": usa "invertir", "numero" o "borrar"`);
        const m = g.cfg.match;
        if (m && !m.hacking) err('AccionInvalidaError', 'el profesor ha desactivado el hackeo en esta partida');
        if (m && modo === 'borrar' && !m.hackBreak) err('AccionInvalidaError', 'el modo "borrar" está desactivado en esta partida');
        if (g.time < u().hackReadyAt) err('AccionInvalidaError', `el módulo de hackeo se está enfriando: faltan ${Math.ceil((u().hackReadyAt - g.time) / 1000)} s`);
        const target = g.enemyAt(u(), d);
        if (!target) err('FueraDeRangoError', `no hay ninguna unidad enemiga al ${d}`);
        if (target!.immuneUntil > g.time) err('AccionInvalidaError', `${target!.name} está protegida ${Math.ceil((target!.immuneUntil - g.time) / 1000)} s más`);
        return act('hackear')([d, modo], {});
      },
      // centro operativo
      fabricar: (args, kw) => {
        if (args.length < 1) err('TypeError', 'fabricar(tipo, programa=None)');
        const tipo = String(args[0]) as UnitType;
        if (!FACTORY_TYPES.includes(tipo)) err('ValueError', `la base sólo fabrica ${FACTORY_TYPES.map((t) => `"${t}"`).join(', ')}`);
        const prog = args[1] ?? kw.programa ?? null;
        if (prog !== null) {
          const f = String(prog).endsWith('.py') ? String(prog) : `${String(prog)}.py`;
          if (!(f in pl().p.files)) err('ValueError', `no tienes ningún archivo "${f}"`);
        }
        const n = g.unitsOf(u().owner).filter((x) => x.type === tipo).length;
        if (n >= FACTORY.maxPerType) err('AccionInvalidaError', `ya tienes ${n} unidades de tipo ${tipo} (máximo ${FACTORY.maxPerType})`);
        const cost = UNIT_COST[tipo]!;
        const falta = Object.entries(cost).filter(([k, c]) => pl().p.storage[k as ResKind] < c!).map(([k, c]) => `${c! - pl().p.storage[k as ResKind]} ${k}`);
        if (falta.length) err('SinRecursosError', `faltan ${falta.join(', ')} para fabricar un ${tipo}`);
        if (!g.freeSpotNearBase(pl())) err('AccionInvalidaError', 'no hay sitio libre junto a la base');
        return act('fabricar')([tipo, prog], kw);
      },
      coste_unidad: (args) => {
        const tipo = String(args[0]) as UnitType;
        if (!FACTORY_TYPES.includes(tipo)) err('ValueError', `tipo desconocido ${pyRepr(args[0] ?? null)}`);
        return PyDict.from(Object.entries(UNIT_COST[tipo]!).map(([k, n]) => [k, n!]));
      },
      unidades: () => g.unitsOf(u().owner).map((x) => new PyRecord('Unidad', { nombre: x.name, tipo: x.type, x: x.x, y: x.y, dueño: pl().p.name, enemiga: false })),
      // aspersor
      disparar: (args, kw) => {
        const [x, y] = xy(args, 'disparar');
        if (Math.max(Math.abs(x - u().x), Math.abs(y - u().y)) > 3) err('FueraDeRangoError', `(${x}, ${y}) está fuera del alcance del aspersor (radio 3)`);
        g.settleBattery(u());
        if (u().water < 1) err('SinRecursosError', 'el aspersor no tiene agua: se recarga sola poco a poco (usa esperar)');
        return act('disparar')([x, y], kw);
      },
      radar: () => {
        const r = info().fixed ? HACK.radarRange : Math.max(info().scan, 3);
        const out: Value[] = [];
        for (const o of g.units.values()) {
          const v = o.u;
          if (v.id === u().id) continue;
          if (Math.max(Math.abs(v.x - u().x), Math.abs(v.y - u().y)) > r) continue;
          out.push(new PyRecord('Unidad', {
            nombre: v.name, tipo: v.type, x: v.x, y: v.y, dueño: g.players.get(v.owner)?.p.name ?? '?',
            enemiga: v.owner !== u().owner,
          }));
        }
        return out;
      },
      // sensores comunes
      posicion: () => new Tuple([u().x, u().y]),
      bateria: () => { g.settleBattery(u()); return Math.floor(u().battery * 10) / 10; },
      carga: () => cargoCount(u()),
      carga_max: () => info().cargo,
      inventario: () => PyDict.from(Object.entries(u().cargo).filter(([, n]) => n! > 0).map(([k, n]) => [k, n!])),
      base: () => new Tuple([pl().p.dock.x, pl().p.dock.y]),
      almacen: () => PyDict.from(Object.entries(pl().p.storage).map(([k, n]) => [k, n])),
      tiempo: () => Math.floor((g.time - (u().program?.startedAt ?? g.time)) / 1000),
      tiempo_restante: () => (g.cfg.match ? Math.max(0, Math.floor((g.playEnd - Math.max(g.time, g.playStart)) / 1000)) : null),
      senal: () => g.inSignal(u()),
      integridad: () => !u().program || u().program!.bundle.main === u().program!.original,
      tipo: () => u().type,
      terreno: (args) => {
        const [x, y] = xy(args, 'terreno');
        if (!known(x, y)) return null;
        return TERRAIN[g.terrainAt(x, y) as T].key;
      },
      transitable: (args) => {
        const [x, y] = xy(args, 'transitable');
        if (x < 0 || y < 0 || x >= g.cfg.w || y >= g.cfg.h) return false;
        if (!known(x, y)) return null;
        return g.canEnter(u(), x, y);
      },
      coste: (args) => {
        const [x, y] = xy(args, 'coste');
        if (!known(x, y) || !g.canEnter(u(), x, y)) return null;
        return Math.round((g.moveMs(u(), x, y) * g.ts) / 100) / 10;
      },
      recurso_aqui: () => {
        const id = g.resAt.get(here());
        if (id === undefined || !pl().knownRes.has(id)) return null;
        return resRecord(g.resources.get(id)!);
      },
      dibujar_ruta: (args) => {
        const pts = seqItems(args[0] ?? null);
        if (!pts) err('TypeError', 'dibujar_ruta necesita una lista de coordenadas [(x, y), …]');
        u().route = pts!.slice(0, 2000).map((p) => {
          const it = seqItems(p);
          if (!it || it.length !== 2) err('TypeError', 'cada punto debe ser una tupla (x, y)');
          return [toNum(it![0]), toNum(it![1])] as [number, number];
        });
        return null;
      },
      nombre: () => u().name,
    };
    const functions: Record<string, (args: Value[], kw: Record<string, Value>) => Value | ActionReq> = {};
    for (const [k, f] of Object.entries(fns)) functions[k] = wrap(k, f);
    return {
      print: (text) => g.log(u(), text, 'print'),
      functions,
      globals: {
        memoria: rt.memoria, compartido: this.players.get(rt.u.owner)?.compartido ?? new PyDict(),
        ...(this.preset ? Object.fromEntries(Object.entries(this.preset).map(([k, v]) => [k, toPy(v)])) : {}),
      },
    };
  }

  enemyAt(u: Unit, d: Dir): Unit | null {
    const [dx, dy] = DIRS[d];
    for (const o of this.units.values()) {
      if (o.u.owner !== u.owner && o.u.x === u.x + dx && o.u.y === u.y + dy) return o.u;
    }
    return null;
  }

  buildCost(tipo: BuildKind, x: number, y: number): Partial<Record<ResKind, number>> {
    if (tipo === 'camino' && this.terrainAt(x, y) === T.AGUA) return BRIDGE_COST;
    return BUILDINGS[tipo].cost;
  }

  /** motivo por el que no se puede construir, o null */
  buildBlocked(tipo: BuildKind, x: number, y: number): string | null {
    const t = this.terrainAt(x, y);
    if (t === -1) return 'no se puede construir fuera del mapa';
    const k = y * this.cfg.w + x;
    for (const o of this.units.values()) if (o.u.x === x && o.u.y === y && tipo !== 'camino') return 'hay una unidad en esa casilla';
    if (tipo === 'camino') {
      if (t === T.CAMINO || t === T.CARRETERA || t === T.PUENTE) return 'ya hay camino en esa casilla';
      if (t === T.AGUA || t === T.PUENTE_ROTO) return null;
      if (t === T.HIERBA || t === T.MALEZA || t === T.HORMIGON) return this.resAt.has(k) ? 'hay una veta en esa casilla' : null;
      return `no se puede hacer camino sobre ${TERRAIN[t].key}`;
    }
    if (!(t === T.HIERBA || t === T.MALEZA || t === T.HORMIGON || t === T.CAMINO)) return `no se puede construir sobre ${TERRAIN[t].key}`;
    if (this.resAt.has(k)) return 'hay una veta en esa casilla';
    for (const p of this.players.values()) if (p.p.dock.x === x && p.p.dock.y === y) return 'no se puede construir en un muelle';
    return null;
  }

  startAction(rt: UnitRt, req: ActionReq): void {
    const u = rt.u;
    const pl = this.players.get(u.owner)!;
    const info = UNIT_TYPES[u.type];
    const t = this.time;
    let dur = 500;
    let scaled = true;
    let energy = 0;
    let to: [number, number] = [u.x, u.y];
    let ok = true;
    let label: string = req.action;
    let data: unknown;
    const a = req.args;
    // mojado: espera a secarse
    if (u.wetUntil > t) {
      u.program!.pending = { action: req.action, args: req.args, kw: req.kw };
      this.log(u, `Mojado por un aspersor: inactivo ${Math.ceil((u.wetUntil - t) / 1000)} s`, 'warn');
      this.schedule(u, u.wetUntil);
      return;
    }
    switch (req.action) {
      case 'mover': {
        const d = String(a[0]).toUpperCase() as Dir;
        const [dx, dy] = DIRS[d];
        const nx = u.x + dx;
        const ny = u.y + dy;
        label = `mover("${d}")`;
        if (this.canEnter(u, nx, ny)) {
          dur = this.moveMs(u, nx, ny);
          energy = 1;
          to = [nx, ny];
        } else {
          ok = false;
          dur = 1000;
          const tt = this.terrainAt(nx, ny);
          data = tt === -1 ? 'borde' : TERRAIN[tt].key;
        }
        break;
      }
      case 'mirar':
        label = `mirar("${String(a[0]).toUpperCase()}")`;
        data = String(a[0]).toUpperCase();
        break;
      case 'escanear':
        dur = 3000; energy = 2; label = 'escanear()';
        break;
      case 'plantar': dur = 2000; energy = 1; label = 'plantar()'; break;
      case 'regar': dur = 1500; energy = 1; label = 'regar()'; u.water -= 1; break;
      case 'recolectar': dur = 3000; energy = 1; label = 'recolectar()'; break;
      case 'cargar_agua': dur = 2000; label = 'cargar_agua()'; break;
      case 'picar': {
        label = 'picar()';
        const id = this.resAt.get(u.y * this.cfg.w + u.x);
        const node = id !== undefined ? this.resources.get(id) : undefined;
        if (!node || node.amount < 1) { ok = false; data = 'vacio'; dur = 1000; }
        else { dur = RESOURCES[node.kind].ms; energy = 1; data = node.id; }
        break;
      }
      case 'recoger': dur = 1000; label = 'recoger()'; break;
      case 'construir': {
        const tipo = String(a[0]) as BuildKind;
        const d = String(a[1]).toUpperCase() as Dir;
        const [dx, dy] = DIRS[d];
        const tx = u.x + dx;
        const ty = u.y + dy;
        label = `construir("${tipo}", "${d}")`;
        const cost = this.buildCost(tipo, tx, ty);
        for (const [k, n] of Object.entries(cost)) pl.p.storage[k as ResKind] -= n!;
        dur = tipo === 'camino' && this.terrainAt(tx, ty) === T.AGUA ? 4000 : BUILDINGS[tipo].ms;
        energy = 2;
        data = { tipo, x: tx, y: ty, cost };
        break;
      }
      case 'fabricar': {
        const tipo = String(a[0]) as UnitType;
        const cost = UNIT_COST[tipo]!;
        for (const [k, n] of Object.entries(cost)) pl.p.storage[k as ResKind] -= n!;
        label = `fabricar("${tipo}")`;
        dur = FACTORY.ms;
        const spot = this.freeSpotNearBase(pl) ?? [pl.p.dock.x, pl.p.dock.y];
        data = { tipo, prog: a[1] ?? null, x: spot[0], y: spot[1], cost };
        this.log(u, `Fabricando ${UNIT_TYPES[tipo].label.toLowerCase()} en (${spot[0]}, ${spot[1]})…`, 'info');
        break;
      }
      case 'hackear': {
        const d = String(a[0]) as Dir;
        label = `hackear("${d}", "${a[1]}")`;
        dur = HACK.channelMs;
        scaled = false;
        energy = 3;
        const target = this.enemyAt(u, d);
        data = { target: target?.id ?? null, mode: a[1] };
        break;
      }
      case 'disparar': {
        const x = toInt(a[0]);
        const y = toInt(a[1]);
        label = `disparar(${x}, ${y})`;
        dur = 800;
        u.water -= 1;
        data = [x, y];
        break;
      }
      case 'descargar':
        label = 'descargar()';
        dur = cargoCount(u) ? 2000 : 500;
        break;
      case 'recargar':
        label = 'recargar()';
        dur = this.canRecharge(u) ? Math.max(500, Math.round((100 - u.battery) * 400)) : 500;
        break;
      case 'esperar': {
        const s = Math.min(3600, Math.max(0.2, toNum(a[0])));
        dur = Math.round(s * 1000);
        scaled = false;
        label = `esperar(${s})`;
        break;
      }
      default:
        this.log(u, `acción desconocida ${req.action}`, 'error');
    }

    // energía insuficiente → hibernación (nunca muere)
    this.settleBattery(u);
    if (energy > u.battery) {
      if (req.action === 'construir') for (const [k, n] of Object.entries((data as { cost: Record<string, number> }).cost)) pl.p.storage[k as ResKind] += n;
      if (req.action === 'regar') u.water += 1;
      u.program!.pending = { action: req.action, args: req.args, kw: req.kw };
      u.status = 'HIBERNATING';
      this.log(u, `Batería agotada (${u.battery.toFixed(0)} %): hibernando hasta recargar con el sol`, 'warn');
      this.schedule(u, t + Math.ceil((energy - u.battery + 0.5) * SOLAR_MS_PER_PCT));
      return;
    }
    if (scaled) dur = Math.max(100, Math.round(dur * this.ts));
    if (!this.inSignal(u)) {
      dur *= 2;
      if (!u.blocked || u.blocked.attempts < 5) {
        const last = u.logs[u.logs.length - 1];
        if (!last || !last.m.startsWith('Sin señal')) this.log(u, 'Sin señal de la base: acciones al doble de tiempo (construye una antena)', 'warn');
      }
    }
    u.battery -= energy;
    this.stats(pl).energy += energy;
    this.stats(pl).actions++;
    u.actions++;
    u.status = 'RUNNING';
    u.action = { name: req.action, label, start: t, end: t + dur, from: [u.x, u.y], to, ok, data };
    this.schedule(u, t + dur);
  }

  canRecharge(u: Unit): boolean {
    return this.nearBase(u) || this.nearOwn(u, 'panel');
  }

  finishAction(rt: UnitRt, a: NonNullable<Unit['action']>): Value {
    const u = rt.u;
    const pl = this.players.get(u.owner)!;
    const info = UNIT_TYPES[u.type];
    const w = this.cfg.w;
    switch (a.name) {
      case 'mover': {
        if (!a.ok) {
          const b = u.blocked ?? { attempts: 0, lostMs: 0, since: a.start, instr: a.label };
          b.attempts++;
          b.lostMs += a.end - a.start;
          b.instr = a.label;
          u.blocked = b;
          if (b.attempts === 1) this.log(u, `Choque: ${a.label} bloqueado por ${a.data}`, 'warn');
          if (b.attempts === 5) this.log(u, `BLOQUEADO: ${b.attempts} intentos fallidos de ${a.label}`, 'error');
          this.emit(u, 'bump');
          const [dx, dy] = DIRS[a.label.charAt(7) as Dir] ?? [0, 0];
          const nx = u.x + dx;
          const ny = u.y + dy;
          if (nx >= 0 && ny >= 0 && nx < this.cfg.w && ny < this.cfg.h) this.reveal(pl, nx, ny, 0);
          return false;
        }
        if (u.blocked && u.blocked.attempts >= 5) {
          this.log(u, `Desbloqueado tras ${u.blocked.attempts} intentos (${fmtDur(u.blocked.lostMs)} perdidos)`, 'ok');
        }
        u.blocked = null;
        u.x = a.to[0];
        u.y = a.to[1];
        u.trail.push([u.x, u.y]);
        if (u.trail.length > 40) u.trail.shift();
        this.reveal(pl, u.x, u.y, info.air ? 2 : 1);
        return true;
      }
      case 'mirar': {
        const [dx, dy] = DIRS[a.data as Dir];
        const t = this.terrainAt(u.x + dx, u.y + dy);
        if (t === -1) return 'borde';
        this.reveal(pl, u.x + dx, u.y + dy, 0);
        return TERRAIN[t].key;
      }
      case 'escanear': {
        this.reveal(pl, u.x, u.y, info.scan);
        const found: ResourceNode[] = [];
        const r = info.scan;
        for (let y = u.y - r; y <= u.y + r; y++) {
          for (let x = u.x - r; x <= u.x + r; x++) {
            if ((x - u.x) ** 2 + (y - u.y) ** 2 > r * r + r) continue;
            const id = this.resAt.get(y * w + x);
            if (id === undefined) continue;
            const node = this.resources.get(id)!;
            if (node.amount < 1) continue;
            found.push(node);
            if (!pl.knownRes.has(id)) { pl.knownRes.add(id); this.version++; }
          }
        }
        found.sort((p, q) => Math.abs(p.x - u.x) + Math.abs(p.y - u.y) - (Math.abs(q.x - u.x) + Math.abs(q.y - u.y)));
        const summary = countBy(found.map((f) => f.kind));
        this.log(u, found.length ? `Escaneo: ${found.length} veta(s) — ${summary}` : 'Escaneo: ninguna veta en el radio', found.length ? 'ok' : 'info');
        this.emit(u, 'scan', String(found.length));
        return found.map((n) => new PyRecord('Recurso', { tipo: n.kind, x: n.x, y: n.y, cantidad: Math.floor(n.amount), calidad: n.quality }));
      }
      case 'plantar': {
        const p = this.parcelAt(u.x, u.y);
        if (!p || p.planted) { this.log(u, 'Alguien plantó aquí antes', 'warn'); return false; }
        p.planted = true;
        p.mat = 0;
        p.owner = u.owner;
        this.emit(u, 'plant');
        this.version++;
        return true;
      }
      case 'regar': {
        const p = this.parcelAt(u.x, u.y);
        if (!p) return false;
        p.hum = Math.min(100, p.hum + CROP.water);
        this.emit(u, 'water');
        this.version++;
        return true;
      }
      case 'recolectar': {
        const p = this.parcelAt(u.x, u.y);
        if (!p || !p.planted || p.mat < 100) {
          this.log(u, 'La cosecha ya no está (¿otro dron llegó antes?)', 'warn');
          return 0;
        }
        const n = Math.min(CROP.yield, info.cargo - cargoCount(u));
        u.cargo.cosecha = (u.cargo.cosecha ?? 0) + n;
        p.planted = false;
        p.mat = 0;
        p.owner = null;
        this.stats(pl).harvested += n;
        pl.p.totals.harvested += n;
        this.log(u, `Cosecha recogida: +${n} (${cargoCount(u)}/${info.cargo})`, 'ok');
        this.emit(u, 'harvest', String(n));
        this.version++;
        return n;
      }
      case 'cargar_agua':
        u.water = info.water;
        return u.water;
      case 'picar': {
        if (!a.ok) {
          this.log(u, `No hay veta en (${u.x}, ${u.y})`, 'warn');
          return 0;
        }
        const node = this.resources.get(a.data as number);
        if (!node || node.amount < 1) {
          this.log(u, `La veta de (${u.x}, ${u.y}) se agotó`, 'warn');
          return 0;
        }
        node.amount -= 1;
        const k = node.y * w + node.x;
        const d = this.drops.get(k) ?? {};
        d[node.kind] = (d[node.kind] ?? 0) + 1;
        this.drops.set(k, d);
        this.stats(pl).mined += 1;
        pl.p.totals.mined += 1;
        if (!pl.knownRes.has(node.id)) { pl.knownRes.add(node.id); }
        this.emit(u, 'extract', node.kind);
        if (node.amount < 1) {
          this.log(u, `Veta de ${node.kind} agotada en (${node.x}, ${node.y})`, 'info');
          this.emit(u, 'deplete', node.kind);
          this.removeResource(node);
        }
        this.version++;
        return 1;
      }
      case 'recoger': {
        const k = u.y * w + u.x;
        const d = this.drops.get(k);
        let n = 0;
        if (d) {
          for (const kind of Object.keys(d) as ResKind[]) {
            while ((d[kind] ?? 0) > 0 && cargoCount(u) < info.cargo) {
              d[kind]! -= 1;
              u.cargo[kind] = (u.cargo[kind] ?? 0) + 1;
              n++;
            }
            if (!d[kind]) delete d[kind];
          }
          if (!Object.keys(d).length) this.drops.delete(k);
        }
        if (n) { this.emit(u, 'pickup', String(n)); this.version++; }
        if (cargoCount(u) >= info.cargo) this.log(u, `Carga completa: ${cargoSummary(u)}`, 'ok');
        return n;
      }
      case 'construir': {
        const { tipo, x, y, cost } = a.data as { tipo: BuildKind; x: number; y: number; cost: Record<string, number> };
        const reason = this.buildBlocked(tipo, x, y);
        if (reason) {
          for (const [k, n] of Object.entries(cost)) pl.p.storage[k as ResKind] += n;
          this.log(u, `No se pudo construir ${tipo}: ${reason}`, 'warn');
          return false;
        }
        const k = y * w + x;
        if (tipo === 'camino') {
          this.terrain[k] = this.terrain[k] === T.AGUA || this.terrain[k] === T.PUENTE_ROTO ? T.PUENTE : T.CAMINO;
          this.props = this.props.filter((p) => !(p.x === x && p.y === y));
        } else {
          this.terrain[k] = T.ESTRUCTURA;
          this.props = this.props.filter((p) => !(p.x === x && p.y === y));
          const b: Building = { id: this.nextBuildId++, owner: u.owner, kind: tipo, x, y };
          this.addBuilding(b);
          const propKind = tipo === 'panel' ? 'panel_solar' : tipo;
          this.props.push({ x, y, kind: propKind, v: 0, owner: u.owner });
          if (tipo === 'aspersor') this.spawnUnit(pl, 'aspersor', [x, y]);
        }
        this.terrainLog.push([k, this.terrain[k]]);
        this.terrainVersion++;
        this.version++;
        this.stats(pl).built++;
        pl.p.totals.built++;
        const pts = BUILDINGS[tipo].points ?? 0;
        if (pts) {
          pl.p.totals.buildScore = (pl.p.totals.buildScore ?? 0) + pts;
          this.stats(pl).delivered += pts;
          this.log(u, `Construido: ${BUILDINGS[tipo].label} en (${x}, ${y}) (+${pts} puntos)`, 'ok');
        } else this.log(u, `Construido: ${BUILDINGS[tipo].label} en (${x}, ${y})`, 'ok');
        this.emit(u, 'build', BUILDINGS[tipo].label, x, y);
        return true;
      }
      case 'hackear':
        return this.applyHack(rt, a);
      case 'fabricar': {
        const d = a.data as { tipo: UnitType; prog: string | null; x: number; y: number };
        const busy = [...this.units.values()].some((o) => o.u.x === d.x && o.u.y === d.y);
        const spot = busy ? this.freeSpotNearBase(pl) ?? [d.x, d.y] : [d.x, d.y];
        const nu = this.spawnUnit(pl, d.tipo, spot as [number, number]);
        this.log(u, `✔ ${nu.name} fabricado en (${nu.x}, ${nu.y})`, 'ok');
        this.emit(nu, 'spawn');
        if (d.prog) {
          const f = d.prog.endsWith('.py') ? d.prog : `${d.prog}.py`;
          const r = this.runProgram(nu.id, f, pl.p.files);
          if (!r.ok) this.log(nu, `No se pudo cargar ${f}: ${r.error}`, 'error');
        }
        return nu.name;
      }
      case 'disparar': {
        const [x, y] = a.data as [number, number];
        let wet = 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const p = this.parcelAt(x + dx, y + dy);
          if (p) p.hum = Math.min(100, p.hum + CROP.water);
          for (const o of this.units.values()) {
            const v = o.u;
            if (v.owner === u.owner || !UNIT_TYPES[v.type].air) continue;
            if (v.x === x + dx && v.y === y + dy) {
              v.wetUntil = this.time + HACK.wetMs;
              wet++;
              this.log(v, `¡Mojado por el aspersor ${u.name} de ${pl.p.name}! ${HACK.wetMs / 1000} s fuera de juego`, 'warn');
              this.emit(v, 'wet');
            }
          }
        }
        this.emit(u, 'splash', String(wet), x, y);
        this.version++;
        return wet;
      }
      case 'descargar': {
        const atBase = this.nearBase(u);
        const atStore = this.nearOwn(u, 'almacen');
        const atSilo = this.nearOwn(u, 'silo');
        if (!atBase && !atStore && !atSilo) {
          this.log(u, 'Demasiado lejos de un punto de descarga (base, almacén o silo)', 'warn');
          return 0;
        }
        let n = 0;
        let value = 0;
        const moved: string[] = [];
        for (const [k, c] of Object.entries(u.cargo) as [ResKind, number][]) {
          if (!c) continue;
          if (!atBase && !atStore && k !== 'cosecha') continue;
          pl.p.storage[k] += c;
          value += c * RESOURCES[k].value;
          n += c;
          moved.push(`${c} ${k}`);
          delete u.cargo[k];
        }
        if (!n) return 0;
        this.log(u, `Descargado: ${moved.join(', ')} (+${value} puntos)`, 'ok');
        this.emit(u, 'deliver', moved.join(', '));
        this.stats(pl).delivered += value;
        pl.p.totals.delivered += value;
        pl.p.totals.units = (pl.p.totals.units ?? 0) + n;
        return n;
      }
      case 'recargar':
        if (!this.canRecharge(u)) {
          this.log(u, 'Para recargar hay que estar junto a la base o a un panel solar propio', 'warn');
          return Math.floor(u.battery);
        }
        u.battery = 100;
        u.batteryAt = this.time;
        return 100;
      case 'esperar':
        return null;
    }
    return null;
  }

  private applyHack(rt: UnitRt, a: NonNullable<Unit['action']>): Value {
    const u = rt.u;
    const pl = this.players.get(u.owner)!;
    const { target, mode } = a.data as { target: string | null; mode: HackMode };
    const trt = target ? this.units.get(target) : undefined;
    if (u.wetUntil > a.start) { this.log(u, 'Hackeo interrumpido: ¡te han mojado!', 'warn'); return false; }
    if (!trt) return false;
    const v = trt.u;
    // una vez enganchado, el hackeo se completa aunque el objetivo se aleje
    if (v.immuneUntil > this.time) { this.log(u, `${v.name} está protegida`, 'warn'); return false; }
    if (!v.program) { this.log(u, `${v.name} no está ejecutando ningún programa`, 'warn'); return false; }
    let seed = hashSeed(u.id + v.id + this.time);
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const mut = mutate(v.program.bundle.main, mode, rnd);
    u.hackReadyAt = this.time + HACK.cooldownMs;
    if (!mut) { this.log(u, `El código de ${v.name} no tiene nada que ${mode === 'invertir' ? 'invertir' : 'cambiar'}`, 'warn'); return false; }
    const victim = this.players.get(v.owner)!;
    const file = v.program.name + '.py';
    // guarda el original en las versiones de la víctima y le cambia el archivo
    victim.p.versions ??= {};
    const list = (victim.p.versions[file] ??= []);
    if (!list.length || list[list.length - 1].src !== v.program.bundle.main) list.push({ t: this.time, src: v.program.bundle.main });
    victim.p.files[file] = mut.src;
    v.program.bundle = { ...v.program.bundle, main: mut.src };
    v.immuneUntil = this.time + HACK.immuneMs;
    v.hacked = { by: pl.p.name, t: this.time, line: mut.line, before: mut.before, after: mut.after };
    this.log(v, `⚠ HACKEADO por ${pl.p.name} (${u.name}) en la línea ${mut.line}: «${mut.before}» → «${mut.after}»`, 'error');
    this.emit(v, 'hacked', pl.p.name);
    this.emit(u, 'hack', v.name);
    this.stats(pl).hacks++;
    pl.p.totals.hacks++;
    this.log(u, `Hackeo con éxito a ${v.name} (${victim.p.name}): línea ${mut.line}`, 'ok');
    const syn = checkSyntax(mut.src);
    if (syn) {
      v.program.startedAt = this.time;
      this.failUnit(trt, 'SyntaxError', syn.msg.replace(/^\w+Error: /, ''), syn.line, '__main__');
    } else {
      v.program.startedAt = this.time;
      this.startVM(trt);
    }
    return `línea ${mut.line}: ${mut.after}`;
  }

  // ───────────── consultas ─────────────

  unitsOf(playerId: string): Unit[] {
    return [...this.units.values()].filter((r) => r.u.owner === playerId).map((r) => r.u);
  }

  player(id: string): PlayerRt | undefined {
    return this.players.get(id);
  }

  /** Posición interpolada (para render) */
  static lerpPos(u: Unit, t: number): [number, number] {
    const a = u.action;
    if (!a || a.name !== 'mover' || !a.ok) return [u.x, u.y];
    const k = Math.min(1, Math.max(0, (t - a.start) / (a.end - a.start)));
    return [a.from[0] + (a.to[0] - a.from[0]) * k, a.from[1] + (a.to[1] - a.from[1]) * k];
  }

  score(p: PlayerRt): number {
    return Math.round(p.p.totals.delivered + (p.p.totals.buildScore ?? 0));
  }

  rankings(): Ranking[] {
    const pls = [...this.players.values()].filter((p) => !p.p.bot || !this.cfg.match || true);
    const match = !!this.cfg.match;
    const cats: { key: string; label: string; unit: string; lower?: boolean; val: (p: PlayerRt) => number | null }[] = [
      { key: 'mineria', label: 'Minería', unit: 'unidades picadas', val: (p) => this.stats(p).mined },
      { key: 'cosecha', label: 'Cosecha', unit: 'cosechas recogidas', val: (p) => this.stats(p).harvested },
      { key: 'exploracion', label: 'Exploración', unit: 'casillas', val: (p) => this.stats(p).explored },
      { key: 'construccion', label: 'Construcción', unit: 'edificios y caminos', val: (p) => this.stats(p).built },
      { key: 'hackeo', label: 'Hackeo', unit: 'hackeos con éxito', val: (p) => this.stats(p).hacks },
      { key: 'eficiencia', label: 'Eficiencia energética', unit: 'puntos / 100 energía', val: (p) => { const s = this.stats(p); return s.energy >= 20 ? Math.round((s.delivered / s.energy) * 1000) / 10 : null; } },
      { key: 'codigo', label: 'Código eficiente', unit: 'instr. por acción', lower: true, val: (p) => { const s = this.stats(p); return s.actions >= 30 ? Math.round(s.instr / s.actions) : null; } },
    ];
    const out: Ranking[] = cats.map((c) => {
      const rows = pls
        .map((p) => ({ id: p.p.id, name: p.p.name, color: p.p.color, value: c.val(p) }))
        .filter((r) => r.value !== null && (c.lower || (r.value as number) > 0)) as RankRow[];
      rows.sort((a, b) => (c.lower ? a.value - b.value : b.value - a.value));
      return { key: c.key, label: c.label, unit: c.unit, rows };
    });
    const general = pls
      .map((p) => ({ id: p.p.id, name: p.p.name, color: p.p.color, value: match ? this.score(p) : Math.round(this.stats(p).delivered) }))
      .sort((a, b) => b.value - a.value);
    out.unshift({ key: 'general', label: 'Puntos', unit: 'recursos entregados + edificios', rows: general });
    return out;
  }
}

function emptyParcel(t: number): Parcel {
  return { planted: false, hum: 0, mat: 0, t, owner: null };
}

function isOwnPlot(g: Game, owner: string, x: number, y: number): boolean {
  const b = g.players.get(owner)?.p.base;
  return !!b && x >= b.x + 3 && x <= b.x + 4 && y >= b.y && y <= b.y + 2;
}

export interface RankRow { id: string; name: string; color: string; value: number }
export interface Ranking { key: string; label: string; unit: string; rows: RankRow[] }

export function cargoCount(u: Unit): number {
  let n = 0;
  for (const k in u.cargo) n += u.cargo[k as ResKind] ?? 0;
  return n;
}

export function cargoSummary(u: Unit): string {
  return Object.entries(u.cargo).filter(([, n]) => n! > 0).map(([k, n]) => `${n} ${k}`).join(', ') || 'vacío';
}

function countBy(xs: string[]): string {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].map(([k, n]) => `${k}×${n}`).join(', ');
}

export function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export { PyError };
