// Mundo persistente simulado por eventos con marcas de tiempo.
import { checkSyntax } from '../lang/compiler';
import { deserializeValue, deserializeVM, serializeValue, serializeVM, type ValueState } from '../lang/serialize';
import { PyDict, PyError, PyRecord, Tuple, err, pyRepr, seqItems, toInt, toNum, type Value } from '../lang/values';
import { VM, type ActionReq, type Host } from '../lang/vm';
import { buildBase, generate } from './mapgen';
import {
  DIRS, RES_KINDS, RESOURCES, T, TERRAIN, UNIT_TYPES, type DayStats, type Dir, type LogEntry, type Player, type Prop,
  type ResKind, type ResourceNode, type Unit, type UnitType, type WorldConfig, type WorldState,
} from './types';

export const VM_BUDGET = 20_000;
const SOLAR_MS_PER_PCT = 30_000;
const MAX_LOGS = 160;
const PLAYER_COLORS = ['#2fd4c0', '#f2a93b', '#8fd14f', '#5aa9f0', '#f07a8c', '#c9a0ff', '#f5e050', '#6ee7b7'];

export interface GameEvent {
  t: number;
  kind: 'extract' | 'deliver' | 'scan' | 'bump' | 'error' | 'build' | 'deplete' | 'done';
  unit: string;
  owner: string;
  x: number;
  y: number;
  text?: string;
}

interface PlayerRt {
  p: Player;
  known: Uint8Array;
  knownRes: Set<number>;
  compartido: PyDict;
}

interface UnitRt {
  u: Unit;
  vm: VM | null;
  memoria: PyDict;
}

// ───── utilidades base64 portables ─────
function toB64(a: Uint8Array): string {
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string, n: number): Uint8Array {
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

export class Game {
  cfg: WorldConfig;
  time: number;
  terrain: Uint8Array;
  props: Prop[];
  resources = new Map<number, ResourceNode>();
  resAt = new Map<number, number>();
  nextResId = 1;
  players = new Map<string, PlayerRt>();
  units = new Map<string, UnitRt>();
  seq = 0;
  queue = new MinHeap();
  events: GameEvent[] = [];
  /** contador que cambia cuando cambia algo visible del terreno/niebla */
  version = 0;
  slots: { x: number; y: number }[] = [];
  eventsProcessed = 0;

  private constructor(cfg: WorldConfig, time: number, terrain: Uint8Array, props: Prop[]) {
    this.cfg = cfg;
    this.time = time;
    this.terrain = terrain;
    this.props = props;
  }

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
      v: 1, cfg: this.cfg, time: this.time, terrain: toB64(this.terrain), props: this.props,
      resources: [...this.resources.values()], nextResId: this.nextResId, players, units, seq: this.seq,
      slots: this.slots,
    };
  }

  static fromState(s: WorldState): Game {
    const g = new Game(s.cfg, s.time, fromB64(s.terrain, s.cfg.w * s.cfg.h), s.props);
    for (const r of s.resources) g.addResource(r);
    g.nextResId = s.nextResId;
    g.seq = s.seq;
    g.slots = s.slots ?? [];
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

  // ───────────── jugadores ─────────────

  addPlayer(id: string, name: string, bot = false, files?: Record<string, string>): Player {
    if (this.players.has(id)) return this.players.get(id)!.p;
    const used = new Set([...this.players.values()].map((p) => `${p.p.base.x},${p.p.base.y}`));
    const slot = this.slots.find((s) => !used.has(`${s.x},${s.y}`));
    if (!slot) throw new Error('El mundo está lleno');
    const { base, dock } = buildBase(this.terrain, this.cfg.w, this.props, slot, id);
    for (const [k, r] of [...this.resAt]) {
      const x = k % this.cfg.w;
      const y = Math.floor(k / this.cfg.w);
      const t = this.terrain[k];
      if (TERRAIN[t as T].move === 0 || (Math.abs(x - base.x) <= 3 && Math.abs(y - base.y) <= 3)) this.removeResource(this.resources.get(r)!);
    }
    const p: Player = {
      id, name, bot, color: PLAYER_COLORS[this.players.size % PLAYER_COLORS.length], base, dock,
      storage: Object.fromEntries(RES_KINDS.map((k) => [k, 0])) as Record<ResKind, number>,
      known: '', knownRes: [], stats: this.emptyStats(), totals: { mined: 0, delivered: 0, explored: 0, built: 0, units: 0 },
      compartido: null, unitCounter: { dron: 0, explorador: 0, minero: 0 }, files: files ?? {}, lastSeen: this.time,
    };
    const rt: PlayerRt = { p, known: new Uint8Array(this.cfg.w * this.cfg.h), knownRes: new Set(), compartido: new PyDict() };
    this.players.set(id, rt);
    this.reveal(rt, base.x, base.y, 5, true);
    this.reveal(rt, base.x + 1, base.y + 1, 5, true);
    this.spawnUnit(rt, 'dron');
    this.version++;
    return p;
  }

  emptyStats(): DayStats {
    return { day: this.dayOf(this.time), mined: 0, delivered: 0, explored: 0, energy: 0, instr: 0, actions: 0, activeMs: 0, errors: 0 };
  }

  dayOf(t: number): number {
    return Math.floor((t + this.cfg.tzOffsetMin * 60_000) / 86_400_000);
  }

  stats(pl: PlayerRt): DayStats {
    if (pl.p.stats.day !== this.dayOf(this.time)) pl.p.stats = this.emptyStats();
    return pl.p.stats;
  }

  spawnUnit(pl: PlayerRt, type: UnitType): Unit {
    const info = UNIT_TYPES[type];
    const n = ++pl.p.unitCounter[type];
    const id = `${pl.p.id}:${info.prefix}${n}`;
    const u: Unit = {
      id, owner: pl.p.id, name: `${info.prefix}-${String(n).padStart(2, '0')}`, type,
      x: pl.p.dock.x, y: pl.p.dock.y, battery: 100, batteryAt: this.time, cargo: {},
      status: 'IDLE', action: null, program: null, wakeAt: null, logs: [], trail: [], route: null,
      blocked: null, error: null, memoria: null, lastLine: 0, cpuWarned: false, instr: 0, actions: 0,
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
    return UNIT_TYPES[u.type].air ? TERRAIN[t].air : TERRAIN[t].move > 0;
  }

  moveMs(u: Unit, x: number, y: number): number {
    const t = this.terrainAt(x, y);
    if (t === -1) return 0;
    if (UNIT_TYPES[u.type].air) return TERRAIN[t].air ? 900 : 0;
    return Math.round(TERRAIN[t].move * UNIT_TYPES[u.type].moveMul);
  }

  nearBase(u: Unit): boolean {
    const b = this.players.get(u.owner)!.p.base;
    const dx = Math.max(b.x - u.x, 0, u.x - (b.x + 1));
    const dy = Math.max(b.y - u.y, 0, u.y - (b.y + 1));
    return Math.max(dx, dy) <= 2;
  }

  // ───────────── logs ─────────────

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

  emit(u: Unit, kind: GameEvent['kind'], text?: string): void {
    this.events.push({ t: this.time, kind, unit: u.id, owner: u.owner, x: u.x, y: u.y, text });
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  }

  // ───────────── batería ─────────────

  settleBattery(u: Unit): void {
    const dt = this.time - u.batteryAt;
    if (dt > 0) {
      u.battery = Math.min(100, u.battery + dt / SOLAR_MS_PER_PCT);
      u.batteryAt = this.time;
    }
  }

  // ───────────── programas ─────────────

  runProgram(unitId: string, fileName: string, files: Record<string, string>): { ok: boolean; error?: string; line?: number; file?: string } {
    const rt = this.units.get(unitId);
    if (!rt) return { ok: false, error: 'Unidad desconocida' };
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
    u.program = { name: fileName.replace(/\.py$/, ''), bundle: { main, modules }, startedAt: this.time, vm: null, pending: null };
    const pl = this.players.get(u.owner)!;
    rt.vm = new VM(u.program.bundle, this.hostFor(rt), hashSeed(u.id + this.time));
    void pl;
    rt.vm.start();
    u.status = 'RUNNING';
    u.error = null;
    u.blocked = null;
    u.cpuWarned = false;
    u.route = null;
    this.log(u, `▶ iniciado programa ${u.program.name}`, 'ok');
    if (!u.action) this.schedule(u, this.time);
    return { ok: true };
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
    u.wakeAt = t;
    this.queue.push([t, this.seq++, u.id]);
  }

  // ───────────── avance del tiempo ─────────────

  advanceTo(t: number, maxEvents = Infinity): number {
    let n = 0;
    const startT = this.time;
    while (this.queue.size && this.queue.peek()![0] <= t && n < maxEvents) {
      const [et, , id] = this.queue.pop()!;
      const rt = this.units.get(id);
      if (!rt || rt.u.wakeAt !== et) continue;
      this.time = Math.max(this.time, et);
      this.process(rt);
      n++;
    }
    if (n < maxEvents) this.time = Math.max(this.time, t);
    this.regen(this.time - startT);
    this.eventsProcessed += n;
    return n;
  }

  regen(dt: number): void {
    if (dt <= 0) return;
    for (const r of this.resources.values()) {
      const reg = RESOURCES[r.kind].regen;
      if (reg > 0 && r.amount < r.max) r.amount = Math.min(r.max, r.amount + dt * reg);
    }
  }

  process(rt: UnitRt): void {
    const u = rt.u;
    u.wakeAt = null;
    this.settleBattery(u);
    const pl = this.players.get(u.owner)!;
    let result: Value = null;
    let hadAction = false;
    if (u.action && u.action.end <= this.time) {
      const a = u.action;
      if (u.program) this.stats(pl).activeMs += a.end - a.start;
      result = this.finishAction(rt, a);
      u.action = null;
      hadAction = true;
    }
    if (!u.program || !rt.vm) {
      if (u.status === 'RUNNING' || u.status === 'HIBERNATING') u.status = 'IDLE';
      return;
    }
    const vm = rt.vm;
    // reintento tras hibernación
    if (u.program.pending) {
      const req = u.program.pending as ActionReq;
      u.program.pending = null;
      u.status = 'RUNNING';
      this.startAction(rt, req);
      return;
    }
    if (hadAction && vm.waiting) vm.resume(result);
    if (vm.waiting) {
      // la acción terminó sin programa esperando (programa nuevo): arrancar
      vm.resume(null);
    }
    this.runVM(rt);
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
      case 'error': {
        u.status = 'ERROR';
        u.error = { type: r.type, msg: r.msg, line: r.line, mod: r.mod };
        const where = r.mod === '__main__' ? `línea ${r.line}` : `${r.mod}.py línea ${r.line}`;
        this.log(u, `✖ ${r.type} (${where}): ${r.msg}`, 'error');
        this.stats(pl).errors++;
        this.emit(u, 'error', r.type);
        rt.vm = null;
        break;
      }
    }
  }

  // ───────────── acciones ─────────────

  hostFor(rt: UnitRt): Host {
    const g = this;
    const u = () => rt.u;
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
    const dirArg = (args: Value[], name: string): Dir => {
      if (args.length !== 1) err('TypeError', `${name}() necesita una dirección: "N", "S", "E" u "O"`);
      const d = typeof args[0] === 'string' ? args[0].toUpperCase().trim() : args[0];
      if (d === 'W') err('ValueError', 'en G.R.I.D. el oeste es "O"');
      if (typeof d !== 'string' || !(d in DIRS)) err('ValueError', `dirección inválida ${pyRepr(args[0])}: usa "N", "S", "E" u "O"`);
      return d as Dir;
    };
    const known = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= g.cfg.w || y >= g.cfg.h) return false;
      return pl().known[y * g.cfg.w + x] === 1;
    };
    const resRecord = (r: ResourceNode) =>
      new PyRecord('Recurso', { tipo: r.kind, x: r.x, y: r.y, cantidad: Math.floor(r.amount), calidad: r.quality });
    return {
      print: (text) => g.log(u(), text, 'print'),
      functions: {
        mover: (args, kw) => { dirArg(args, 'mover'); return act('mover')(args, kw); },
        mirar: (args, kw) => { dirArg(args, 'mirar'); return act('mirar')(args, kw); },
        escanear: act('escanear'),
        extraer: act('extraer'),
        descargar: act('descargar'),
        recargar: act('recargar'),
        esperar: (args, kw) => {
          if (args.length !== 1) err('TypeError', 'esperar(segundos) necesita un número');
          toNum(args[0]);
          return act('esperar')(args, kw);
        },
        fabricar: (args, kw) => {
          const tipo = args[0];
          if (typeof tipo !== 'string' || !(tipo in UNIT_TYPES)) err('ValueError', 'fabricar(tipo): usa "dron", "explorador" o "minero"');
          return act('fabricar')(args, kw);
        },
        posicion: () => new Tuple([u().x, u().y]),
        bateria: () => { g.settleBattery(u()); return Math.floor(u().battery * 10) / 10; },
        carga: () => cargoCount(u()),
        carga_max: () => UNIT_TYPES[u().type].cargo,
        inventario: () => PyDict.from(Object.entries(u().cargo).filter(([, n]) => n! > 0).map(([k, n]) => [k, n!])),
        base: () => new Tuple([pl().p.dock.x, pl().p.dock.y]),
        almacen: () => PyDict.from(Object.entries(pl().p.storage).map(([k, n]) => [k, n])),
        tiempo: () => Math.floor((g.time - (u().program?.startedAt ?? g.time)) / 1000),
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
          return g.moveMs(u(), x, y) / 1000;
        },
        recurso_aqui: () => {
          const id = g.resAt.get(u().y * g.cfg.w + u().x);
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
      },
      globals: { memoria: rt.memoria, compartido: this.players.get(rt.u.owner)?.compartido ?? new PyDict() },
    };
  }

  startAction(rt: UnitRt, req: ActionReq): void {
    const u = rt.u;
    const pl = this.players.get(u.owner)!;
    const info = UNIT_TYPES[u.type];
    const t = this.time;
    let dur = 500;
    let energy = 0;
    let to: [number, number] = [u.x, u.y];
    let ok = true;
    let label: string = req.action;
    let data: unknown;
    const a = req.args;
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
      case 'mirar': {
        const d = String(a[0]).toUpperCase() as Dir;
        label = `mirar("${d}")`;
        data = d;
        break;
      }
      case 'escanear':
        dur = 3000;
        energy = 2;
        label = 'escanear()';
        break;
      case 'extraer': {
        label = 'extraer()';
        const id = this.resAt.get(u.y * this.cfg.w + u.x);
        const node = id !== undefined ? this.resources.get(id) : undefined;
        if (info.mineMul === 0) {
          ok = false;
          data = 'sin_taladro';
          dur = 500;
        } else if (!node || node.amount < 1) {
          ok = false;
          data = 'vacio';
          dur = 1000;
        } else if (cargoCount(u) >= info.cargo) {
          ok = false;
          data = 'lleno';
          dur = 500;
        } else {
          dur = Math.round(RESOURCES[node.kind].ms * info.mineMul);
          energy = 1;
          data = node.id;
        }
        break;
      }
      case 'descargar':
        label = 'descargar()';
        if (this.nearBase(u)) dur = cargoCount(u) ? 2000 : 500;
        else { ok = false; dur = 500; }
        break;
      case 'recargar':
        label = 'recargar()';
        if (this.nearBase(u)) dur = Math.max(500, Math.round((100 - u.battery) * 400));
        else { ok = false; dur = 500; }
        break;
      case 'esperar': {
        const s = Math.min(3600, Math.max(1, toNum(a[0])));
        dur = Math.round(s * 1000);
        label = `esperar(${s})`;
        break;
      }
      case 'fabricar': {
        const tipo = String(a[0]) as UnitType;
        label = `fabricar("${tipo}")`;
        const cost = UNIT_TYPES[tipo].cost;
        const afford = Object.entries(cost).every(([k, n]) => pl.p.storage[k as ResKind] >= n!);
        if (!this.nearBase(u)) { ok = false; dur = 500; data = 'lejos'; }
        else if (!afford) { ok = false; dur = 500; data = 'recursos'; }
        else {
          for (const [k, n] of Object.entries(cost)) pl.p.storage[k as ResKind] -= n!;
          dur = UNIT_TYPES[tipo].buildMs;
          energy = 5;
          data = tipo;
        }
        break;
      }
      default:
        this.log(u, `acción desconocida ${req.action}`, 'error');
    }

    // energía insuficiente → hibernación (nunca muere)
    this.settleBattery(u);
    if (energy > u.battery) {
      u.program!.pending = { action: req.action, args: req.args, kw: req.kw };
      if (req.action === 'fabricar' && ok) {
        for (const [k, n] of Object.entries(UNIT_TYPES[String(a[0]) as UnitType].cost)) pl.p.storage[k as ResKind] += n!;
      }
      u.status = 'HIBERNATING';
      this.log(u, `Batería agotada (${u.battery.toFixed(0)} %): hibernando hasta recargar con el sol`, 'warn');
      this.schedule(u, t + Math.ceil((energy - u.battery + 0.5) * SOLAR_MS_PER_PCT));
      return;
    }
    u.battery -= energy;
    this.stats(pl).energy += energy;
    this.stats(pl).actions++;
    u.actions++;
    u.status = 'RUNNING';
    u.action = { name: req.action, label, start: t, end: t + dur, from: [u.x, u.y], to, ok, data };
    this.schedule(u, t + dur);
  }

  finishAction(rt: UnitRt, a: NonNullable<Unit['action']>): Value {
    const u = rt.u;
    const pl = this.players.get(u.owner)!;
    const info = UNIT_TYPES[u.type];
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
          // conocer el obstáculo
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
            const id = this.resAt.get(y * this.cfg.w + x);
            if (id === undefined) continue;
            const node = this.resources.get(id)!;
            if (node.amount < 1) continue;
            found.push(node);
            if (!pl.knownRes.has(id)) { pl.knownRes.add(id); this.version++; }
          }
        }
        found.sort((p, q) => Math.abs(p.x - u.x) + Math.abs(p.y - u.y) - (Math.abs(q.x - u.x) + Math.abs(q.y - u.y)));
        const summary = countBy(found.map((f) => f.kind));
        this.log(u, found.length ? `Escaneo: ${found.length} recurso(s) — ${summary}` : 'Escaneo: nada en el radio', found.length ? 'ok' : 'info');
        this.emit(u, 'scan', String(found.length));
        return found.map((n) => new PyRecord('Recurso', { tipo: n.kind, x: n.x, y: n.y, cantidad: Math.floor(n.amount), calidad: n.quality }));
      }
      case 'extraer': {
        if (!a.ok) {
          const msg = a.data === 'lleno' ? `Carga llena (${cargoCount(u)}/${info.cargo})` : a.data === 'sin_taladro' ? 'Esta unidad no tiene herramienta de extracción' : `No hay recurso en (${u.x}, ${u.y})`;
          this.log(u, msg, 'warn');
          return 0;
        }
        const node = this.resources.get(a.data as number);
        if (!node || node.amount < 1) {
          this.log(u, `El recurso de (${u.x}, ${u.y}) se agotó`, 'warn');
          return 0;
        }
        node.amount -= 1;
        u.cargo[node.kind] = (u.cargo[node.kind] ?? 0) + 1;
        const s = this.stats(pl);
        s.mined += 1;
        pl.p.totals.mined += 1;
        if (!pl.knownRes.has(node.id)) { pl.knownRes.add(node.id); this.version++; }
        this.emit(u, 'extract', node.kind);
        if (cargoCount(u) >= info.cargo) this.log(u, `Carga completa: ${cargoSummary(u)}`, 'ok');
        if (node.amount < 1 && RESOURCES[node.kind].regen === 0) {
          this.log(u, `Veta de ${node.kind} agotada en (${node.x}, ${node.y})`, 'info');
          this.emit(u, 'deplete', node.kind);
          this.removeResource(node);
          this.version++;
        }
        return 1;
      }
      case 'descargar': {
        if (!a.ok) {
          this.log(u, 'Demasiado lejos de la base para descargar (usa base())', 'warn');
          return 0;
        }
        const n = cargoCount(u);
        if (!n) return 0;
        let value = 0;
        for (const [k, c] of Object.entries(u.cargo)) {
          pl.p.storage[k as ResKind] += c!;
          value += c! * RESOURCES[k as ResKind].value;
        }
        this.log(u, `Descargado en base: ${cargoSummary(u)}`, 'ok');
        this.emit(u, 'deliver', cargoSummary(u));
        u.cargo = {};
        this.stats(pl).delivered += value;
        pl.p.totals.delivered += value;
        pl.p.totals.units = (pl.p.totals.units ?? 0) + n;
        return n;
      }
      case 'recargar':
        if (!a.ok) {
          this.log(u, 'Demasiado lejos de la base para recargar', 'warn');
          return u.battery;
        }
        u.battery = 100;
        u.batteryAt = this.time;
        return 100;
      case 'esperar':
        return null;
      case 'fabricar': {
        if (!a.ok) {
          this.log(u, a.data === 'lejos' ? 'Hay que estar junto a la base para fabricar' : 'Recursos insuficientes para fabricar', 'warn');
          return null;
        }
        const nu = this.spawnUnit(pl, a.data as UnitType);
        pl.p.totals.built++;
        this.log(u, `Fabricado ${nu.name}`, 'ok');
        this.emit(u, 'build', nu.name);
        this.version++;
        return nu.name;
      }
    }
    return null;
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

  rankings(): Ranking[] {
    const pls = [...this.players.values()];
    const cats: { key: string; label: string; unit: string; lower?: boolean; val: (p: PlayerRt) => number | null }[] = [
      { key: 'mineria', label: 'Minería', unit: 'valor entregado', val: (p) => this.stats(p).delivered },
      { key: 'exploracion', label: 'Exploración', unit: 'casillas', val: (p) => this.stats(p).explored },
      { key: 'eficiencia', label: 'Eficiencia energética', unit: 'valor / 100 energía', val: (p) => { const s = this.stats(p); return s.energy >= 20 ? Math.round((s.delivered / s.energy) * 1000) / 10 : null; } },
      { key: 'codigo', label: 'Código eficiente', unit: 'instr. por acción', lower: true, val: (p) => { const s = this.stats(p); return s.actions >= 30 ? Math.round(s.instr / s.actions) : null; } },
      { key: 'automatizacion', label: 'Automatización', unit: 'min de programa activo', val: (p) => Math.round(this.stats(p).activeMs / 60000) },
      { key: 'riqueza', label: 'Riqueza', unit: 'valor almacenado', val: (p) => Math.round(RES_KINDS.reduce((s, k) => s + p.p.storage[k] * RESOURCES[k].value, 0)) },
    ];
    const out: Ranking[] = cats.map((c) => {
      const rows = pls
        .map((p) => ({ id: p.p.id, name: p.p.name, color: p.p.color, value: c.val(p) }))
        .filter((r) => r.value !== null && (c.lower || (r.value as number) > 0)) as RankRow[];
      rows.sort((a, b) => (c.lower ? a.value - b.value : b.value - a.value));
      return { key: c.key, label: c.label, unit: c.unit, rows };
    });
    // clasificación general (Borda)
    const pts = new Map<string, number>();
    for (const r of out) r.rows.forEach((row, i) => pts.set(row.id, (pts.get(row.id) ?? 0) + (pls.length - i)));
    const general = pls
      .map((p) => ({ id: p.p.id, name: p.p.name, color: p.p.color, value: pts.get(p.p.id) ?? 0 }))
      .sort((a, b) => b.value - a.value);
    out.unshift({ key: 'general', label: 'General', unit: 'puntos', rows: general });
    return out;
  }
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

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export { PyError };
