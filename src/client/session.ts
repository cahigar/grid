// Sesiones de juego: práctica libre (local), tutorial, anfitrión (profesor) y espejo (alumno).
import { BOT_FILES, BOT_NAMES, DEFAULT_PROGRAM, STARTER_FILES } from '../sim/world/content';
import { Game, cargoCount } from '../sim/world/game';
import { RES_KINDS, type ResKind, type UnitStatus, type WorldState } from '../sim/world/types';

export interface RunResult { ok: boolean; error?: string; line?: number; file?: string; pending?: boolean }

export interface UnitReport {
  id: string;
  name: string;
  status: UnitStatus;
  blocked: { attempts: number; lostMs: number; instr: string } | null;
  error: { type: string; msg: string; line: number } | null;
  deliveries: number;
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

export type SessionKind = 'practica' | 'tutorial' | 'host' | 'alumno';

export interface Session {
  readonly kind: SessionKind;
  game: Game;
  /** id del jugador desde cuyo punto de vista se mira (en el anfitrión: 'profe') */
  me: string;
  god: boolean;
  speed: number;
  paused: boolean;
  report: ReturnReport | null;
  isNew: boolean;
  storageOk: boolean;
  now(realNow?: number): number;
  tick(realNow: number): void;
  save(): void;
  filesOf(owner: string): Record<string, string>;
  saveFile(owner: string, name: string, src: string, snapshot?: boolean): void;
  deleteFile(owner: string, name: string): void;
  renameFile(owner: string, from: string, to: string): void;
  versions(owner: string, name: string): { t: number; src: string }[];
  run(unitId: string, file: string): RunResult;
  stop(unitId: string): void;
  canControl(unitId: string): boolean;
  /** avisos de cambios externos en los archivos (hackeo, profesor) */
  filesVersion?: number;
}

/** Base con la lógica común de archivos sobre Game.players[].files */
export abstract class GameSession implements Session {
  abstract readonly kind: SessionKind;
  game!: Game;
  me = 'p1';
  god = false;
  speed = 1;
  paused = false;
  report: ReturnReport | null = null;
  isNew = false;
  storageOk = true;
  gameTime = 0;
  lastReal = performance.now();
  filesVersion = 0;

  now(realNow = performance.now()): number {
    if (this.paused) return this.gameTime;
    return this.gameTime + (realNow - this.lastReal) * this.speed;
  }

  tick(realNow: number): void {
    const dt = Math.min(5000, realNow - this.lastReal);
    this.lastReal = realNow;
    if (!this.paused) this.gameTime += dt * this.speed;
    this.game.advanceTo(this.gameTime, 20_000);
  }

  save(): void { /* por defecto no persiste */ }

  filesOf(owner: string): Record<string, string> {
    return this.game.player(owner)?.p.files ?? {};
  }

  saveFile(owner: string, name: string, src: string, snapshot = false): void {
    const p = this.game.player(owner)?.p;
    if (!p) return;
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

  deleteFile(owner: string, name: string): void {
    const p = this.game.player(owner)?.p;
    if (p) delete p.files[name];
  }

  renameFile(owner: string, from: string, to: string): void {
    const p = this.game.player(owner)?.p;
    if (!p || !(from in p.files) || to in p.files) return;
    p.files[to] = p.files[from];
    delete p.files[from];
    if (p.versions?.[from]) { p.versions[to] = p.versions[from]; delete p.versions[from]; }
  }

  versions(owner: string, name: string): { t: number; src: string }[] {
    return this.game.player(owner)?.p.versions?.[name] ?? [];
  }

  canControl(unitId: string): boolean {
    const u = this.game.units.get(unitId)?.u;
    return !!u && (this.god || u.owner === this.me);
  }

  run(unitId: string, file: string): RunResult {
    const u = this.game.units.get(unitId)?.u;
    if (!u || !this.canControl(unitId)) return { ok: false, error: 'No puedes programar esa unidad' };
    const files = this.filesOf(u.owner);
    for (const [n, s] of Object.entries(files)) this.saveFile(u.owner, n, s, n === file);
    const r = this.game.runProgram(unitId, file, { ...files });
    this.save();
    return r;
  }

  stop(unitId: string): void {
    if (!this.canControl(unitId)) return;
    this.game.stopProgram(unitId);
    this.save();
  }
}

// ─────────────────────────── práctica libre ───────────────────────────

const KEY = 'grid.practica.v2';

export class PracticeSession extends GameSession {
  readonly kind = 'practica' as const;

  constructor() {
    super();
    const saved = this.readSave();
    if (saved) {
      try {
        this.game = Game.fromState(saved.state);
        this.gameTime = saved.gameTime ?? saved.state.time;
        this.catchUp(Math.max(0, Date.now() - saved.savedReal));
      } catch (e) {
        console.error('No se pudo cargar la partida guardada', e);
        this.newWorld();
      }
    } else this.newWorld();
    this.lastReal = performance.now();
  }

  private readSave(): { savedReal: number; gameTime: number; state: WorldState } | null {
    try {
      const raw = localStorage.getItem(KEY);
      const d = raw ? JSON.parse(raw) : null;
      return d && d.state?.v === 2 ? d : null;
    } catch {
      this.storageOk = false;
      return null;
    }
  }

  newWorld(name = 'Tu colonia', seed = (Date.now() % 100000) + 7): void {
    const t = Date.now();
    this.game = Game.create({
      w: 56, h: 56, seed, tzOffsetMin: -new Date().getTimezoneOffset(), name: 'Valle de práctica', timeScale: 0.35,
      startStorage: { hierro: 6, cobre: 4, silicio: 2, chatarra: 6 },
    }, t, 4);
    this.game.addPlayer(this.me, name, false, { ...STARTER_FILES });
    for (let i = 0; i < 3; i++) {
      const id = `bot${i}`;
      this.game.addPlayer(id, BOT_NAMES[i], true, { ...BOT_FILES });
      for (const u of this.game.unitsOf(id)) {
        if (u.type === 'hacker') continue;
        this.game.runProgram(u.id, DEFAULT_PROGRAM[u.type], { ...BOT_FILES });
      }
    }
    this.gameTime = t;
    this.isNew = true;
    this.report = null;
    this.save();
  }

  catchUp(awayMs: number): void {
    const g = this.game;
    const pl = g.player(this.me)!;
    const t0 = g.time;
    const storage0 = { ...pl.p.storage };
    const explored0 = pl.p.totals.explored;
    const perf0 = performance.now();
    const n0 = g.eventsProcessed;
    this.gameTime += awayMs;
    g.advanceTo(this.gameTime);
    if (awayMs < 90_000) return;
    const units: UnitReport[] = g.unitsOf(this.me).map((u) => {
      const newLogs = u.logs.filter((l) => l.t > t0);
      return {
        id: u.id, name: u.name, status: u.status,
        blocked: u.blocked && u.blocked.attempts >= 5 ? { attempts: u.blocked.attempts, lostMs: u.blocked.lostMs, instr: u.blocked.instr } : null,
        error: u.error && u.status === 'ERROR' ? { type: u.error.type, msg: u.error.msg, line: u.error.line } : null,
        deliveries: newLogs.filter((l) => l.m.startsWith('Descargado')).reduce((a, l) => a + l.n, 0),
        program: u.program?.name ?? null,
        lastLogs: newLogs.slice(-4).map((l) => (l.n > 1 ? `${l.m} (×${l.n})` : l.m)),
      };
    });
    const storageDelta = Object.fromEntries(RES_KINDS.map((k) => [k, pl.p.storage[k] - storage0[k]])) as Record<ResKind, number>;
    this.report = { awayMs, storageDelta, explored: pl.p.totals.explored - explored0, units, events: g.eventsProcessed - n0, ms: performance.now() - perf0 };
  }

  override save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ savedReal: Date.now(), gameTime: this.gameTime, state: this.game.toState() }));
      this.storageOk = true;
    } catch {
      this.storageOk = false;
    }
  }

  reset(name: string): void {
    try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
    this.newWorld(name);
  }

  cargo(unitId: string): number {
    const u = this.game.units.get(unitId)?.u;
    return u ? cargoCount(u) : 0;
  }
}
