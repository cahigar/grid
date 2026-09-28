// Backend local de la demo: el mundo vive en el navegador y se guarda en localStorage.
// La interfaz está pensada para poder sustituirse por un backend remoto (servidor/Vercel).
import { STARTER_FILES, BOTS } from '../sim/world/content';
import { Game, cargoCount } from '../sim/world/game';
import { RES_KINDS, type ResKind, type UnitStatus, type WorldState } from '../sim/world/types';

const KEY = 'grid.world.v1';
const ME = 'p1';

export interface UnitReport {
  id: string;
  name: string;
  status: UnitStatus;
  blocked: { attempts: number; lostMs: number; instr: string } | null;
  error: { type: string; msg: string; line: number } | null;
  deliveries: number;
  mined: number;
  program: string | null;
  lastLogs: string[];
}

export interface ReturnReport {
  awayMs: number;
  storageDelta: Record<ResKind, number>;
  explored: number;
  units: UnitReport[];
  events: number;
  ms: number;
}

export class LocalBackend {
  game!: Game;
  me = ME;
  speed = 1;
  gameTime = 0;
  lastReal = 0;
  report: ReturnReport | null = null;
  isNew = false;
  storageOk = true;

  constructor() {
    const saved = this.readSave();
    if (saved) {
      try {
        this.game = Game.fromState(saved.state);
        this.gameTime = saved.gameTime ?? saved.state.time;
        this.speed = 1;
        const away = Math.max(0, Date.now() - saved.savedReal);
        this.catchUp(away);
      } catch (e) {
        console.error('No se pudo cargar la partida guardada', e);
        this.newWorld();
      }
    } else {
      this.newWorld();
    }
    this.lastReal = performance.now();
  }

  private readSave(): { savedReal: number; gameTime: number; state: WorldState } | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      this.storageOk = false;
      return null;
    }
  }

  newWorld(name = 'Tu colonia', seed = (Date.now() % 100000) + 7): void {
    const t = Date.now();
    this.game = Game.create({ w: 64, h: 64, seed, tzOffsetMin: -new Date().getTimezoneOffset(), name: 'Valle de Ataúlfo' }, t, 4);
    this.game.addPlayer(ME, name, false, { ...STARTER_FILES });
    for (const b of BOTS) {
      this.game.addPlayer(b.id, b.name, true, b.files);
      const u = this.game.unitsOf(b.id)[0];
      this.game.runProgram(u.id, b.main, b.files);
    }
    // los rivales llevan un rato funcionando
    this.game.advanceTo(t + 1);
    this.gameTime = t;
    this.isNew = true;
    this.report = null;
    this.save();
  }

  catchUp(awayMs: number): void {
    const g = this.game;
    const pl = g.player(ME)!;
    const before = new Map(g.unitsOf(ME).map((u) => [u.id, { logs: u.logs.length ? u.logs[u.logs.length - 1].t : 0 }]));
    const storage0 = { ...pl.p.storage };
    const explored0 = pl.p.totals.explored;
    const t0 = g.time;
    const perf0 = performance.now();
    const n0 = g.eventsProcessed;
    this.gameTime += awayMs;
    g.advanceTo(this.gameTime);
    if (awayMs < 90_000) return;
    const units: UnitReport[] = g.unitsOf(ME).map((u) => {
      const since = before.get(u.id)?.logs ?? t0;
      const newLogs = u.logs.filter((l) => l.t > since || (l.t > t0));
      return {
        id: u.id, name: u.name, status: u.status,
        blocked: u.blocked && u.blocked.attempts >= 5 ? { attempts: u.blocked.attempts, lostMs: u.blocked.lostMs, instr: u.blocked.instr } : null,
        error: u.error && u.status === 'ERROR' ? { type: u.error.type, msg: u.error.msg, line: u.error.line } : null,
        deliveries: newLogs.filter((l) => l.m.startsWith('Descargado')).reduce((a, l) => a + l.n, 0),
        mined: 0,
        program: u.program?.name ?? null,
        lastLogs: newLogs.slice(-4).map((l) => (l.n > 1 ? `${l.m} (×${l.n})` : l.m)),
      };
    });
    const storageDelta = Object.fromEntries(RES_KINDS.map((k) => [k, pl.p.storage[k] - storage0[k]])) as Record<ResKind, number>;
    this.report = {
      awayMs, storageDelta, explored: pl.p.totals.explored - explored0, units,
      events: g.eventsProcessed - n0, ms: performance.now() - perf0,
    };
  }

  /** instante de juego actual (interpolado) */
  now(realNow = performance.now()): number {
    return this.gameTime + (realNow - this.lastReal) * this.speed;
  }

  tick(realNow: number): void {
    const dt = Math.min(5000, realNow - this.lastReal);
    this.lastReal = realNow;
    this.gameTime += dt * this.speed;
    this.game.advanceTo(this.gameTime, 20_000);
  }

  save(): void {
    try {
      const data = JSON.stringify({ savedReal: Date.now(), gameTime: this.gameTime, state: this.game.toState() });
      localStorage.setItem(KEY, data);
      this.storageOk = true;
    } catch (e) {
      this.storageOk = false;
      console.warn('No se pudo guardar', e);
    }
  }

  reset(name: string): void {
    try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
    this.newWorld(name);
  }

  // ───── comandos del jugador ─────
  get files(): Record<string, string> {
    return this.game.player(ME)!.p.files;
  }

  saveFile(name: string, src: string, snapshot = false): void {
    const p = this.game.player(ME)!.p;
    p.files[name] = src;
    if (snapshot) {
      p.versions ??= {};
      const list = (p.versions[name] ??= []);
      if (!list.length || list[list.length - 1].src !== src) {
        list.push({ t: this.game.time, src });
        if (list.length > 25) list.shift();
      }
    }
  }

  deleteFile(name: string): void {
    const p = this.game.player(ME)!.p;
    delete p.files[name];
  }

  renameFile(from: string, to: string): void {
    const p = this.game.player(ME)!.p;
    if (!(from in p.files) || to in p.files) return;
    p.files[to] = p.files[from];
    delete p.files[from];
    if (p.versions?.[from]) { p.versions[to] = p.versions[from]; delete p.versions[from]; }
  }

  versions(name: string): { t: number; src: string }[] {
    return this.game.player(ME)!.p.versions?.[name] ?? [];
  }

  run(unitId: string, file: string) {
    for (const [n, s] of Object.entries(this.files)) this.saveFile(n, s, n === file);
    const r = this.game.runProgram(unitId, file, { ...this.files });
    this.save();
    return r;
  }

  stop(unitId: string): void {
    this.game.stopProgram(unitId);
    this.save();
  }

  cargo(unitId: string): number {
    const u = this.game.units.get(unitId)?.u;
    return u ? cargoCount(u) : 0;
  }
}
