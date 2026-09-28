// Academia: modelo de retos, evaluación de las 3 variantes y estrellas.
import { pyEquals, toPy, type J } from '../lang/interop';
import { pyRepr } from '../lang/values';
import { Game } from '../world/game';
import { buildLevel } from '../world/level';
import type { UnitType } from '../world/types';
import { runConsole, type ConsoleRun } from './runner';

export interface Learn { text: string; code?: string }

export interface Variant {
  preset?: Record<string, J>;
  inputs?: string[];
  /** valor que hay que enviar() (consola) */
  expect?: J;
  /** mapa (retos de mapa) */
  map?: string[];
}

export interface Requirement { test: (code: string) => boolean; msg: string }

interface LevelBase {
  id: string;
  title: string;
  concept: string;
  story: string;
  goal: string;
  learn: Learn[];
  starter: string;
  hints: string[];
  /** líneas máximas para la 3ª estrella */
  par: number;
  requires?: Requirement[];
  variants: Variant[];
  boss?: boolean;
}
export interface ConsoleLevel extends LevelBase { kind: 'consola'; check?: (run: ConsoleRun, v: Variant) => string | null }
export interface MapLevel extends LevelBase { kind: 'mapa'; unit: UnitType; mode: 'meta' | 'todas' }
export type Level = ConsoleLevel | MapLevel;

export interface Section {
  id: string;
  n: number;
  title: string;
  subtitle: string;
  icon: string;
  levels: Level[];
  soon?: boolean;
}

export interface VariantResult {
  ok: boolean;
  msg: string;
  prints: string[];
  error: { type: string; msg: string; line: number } | null;
}

export interface Evaluation {
  results: VariantResult[];
  reqFail: string | null;
  lines: number;
  stars: number;
}

/** líneas de código reales (sin vacías ni comentarios) */
export function codeLines(src: string): number {
  return src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;
}

const cleanPrints = (r: ConsoleRun) => r.prints;

function checkConsole(level: ConsoleLevel, v: Variant, code: string): VariantResult {
  const r = runConsole(code, v.preset ?? {}, v.inputs ?? []);
  const base = { prints: cleanPrints(r), error: r.error };
  if (r.error) return { ok: false, msg: `${r.error.type}: ${r.error.msg} (línea ${r.error.line})`, ...base };
  if (level.check) {
    const m = level.check(r, v);
    return { ok: !m, msg: m ?? '¡Correcto!', ...base };
  }
  if (v.expect !== undefined) {
    if (!r.sent.length) return { ok: false, msg: 'No has enviado nada a la base: usa enviar(valor)', ...base };
    const got = r.sent[r.sent.length - 1];
    const exp = toPy(v.expect);
    if (!pyEquals(got, exp)) return { ok: false, msg: `La base esperaba ${pyRepr(exp)} y recibió ${pyRepr(got)}`, ...base };
  }
  return { ok: true, msg: '¡Correcto!', ...base };
}

/** Construye el mundo de una variante de un reto de mapa */
export function buildMapVariant(level: MapLevel, v: Variant, time = Date.UTC(2026, 0, 1)) {
  const built = buildLevel({ map: v.map!, known: 'all', timeScale: 0.3 }, time);
  built.game.preset = v.preset ?? null;
  built.game.player('p1')!.p.name = 'Tú';
  return built;
}

export function mapGoal(level: MapLevel, game: Game, beacons: [number, number][], visited: Set<string>): { done: boolean; progress: string } {
  const u = game.unitsOf('p1').find((x) => x.type === level.unit);
  if (!u) return { done: false, progress: '' };
  for (const b of beacons) if (u.x === b[0] && u.y === b[1]) visited.add(b.join(','));
  if (level.mode === 'todas') return { done: visited.size === beacons.length, progress: `Balizas: ${visited.size}/${beacons.length}` };
  const b = beacons[beacons.length - 1];
  return { done: u.x === b[0] && u.y === b[1], progress: `Robot en (${u.x}, ${u.y}) · meta ★ en (${b[0]}, ${b[1]})` };
}

function checkMap(level: MapLevel, v: Variant, code: string): VariantResult {
  const t0 = Date.UTC(2026, 0, 1);
  const { game, beacons } = buildMapVariant(level, v, t0);
  const u = game.unitsOf('p1').find((x) => x.type === level.unit)!;
  const r = game.runProgram(u.id, 'reto.py', { 'reto.py': code });
  if (!r.ok) return { ok: false, msg: r.error ?? 'error', prints: [], error: { type: 'SyntaxError', msg: r.error ?? '', line: r.line ?? 0 } };
  const visited = new Set<string>();
  let goal = mapGoal(level, game, beacons, visited);
  for (let t = t0; t < t0 + 20 * 60_000; t += 60) {
    game.advanceTo(t);
    goal = mapGoal(level, game, beacons, visited);
    if (u.status !== 'RUNNING') break;
  }
  const prints = u.logs.filter((l) => l.k === 'print').map((l) => l.m);
  if (u.status === 'ERROR' && u.error) {
    return { ok: false, msg: `${u.error.type}: ${u.error.msg} (línea ${u.error.line})`, prints, error: { type: u.error.type, msg: u.error.msg, line: u.error.line } };
  }
  if (u.status === 'RUNNING') return { ok: false, msg: 'El robot no termina nunca: ¿hay un bucle infinito?', prints, error: null };
  if (!goal.done) {
    const b = u.blocked && u.blocked.attempts ? ` (chocó ${u.blocked.attempts} vez/veces)` : '';
    return { ok: false, msg: `${level.mode === 'todas' ? goal.progress : `El robot acabó en (${u.x}, ${u.y}) y no en la ★`}${b}`, prints, error: null };
  }
  return { ok: true, msg: '¡Correcto!', prints, error: null };
}

export function evaluate(level: Level, code: string): Evaluation {
  const lines = codeLines(code);
  const reqFail = (level.requires ?? []).find((q) => !q.test(code))?.msg ?? null;
  const results = level.variants.map((v) => (level.kind === 'consola' ? checkConsole(level, v, code) : checkMap(level, v, code)));
  let stars = 0;
  if (!reqFail && results[0]?.ok) {
    stars = 1;
    if (results.every((r) => r.ok)) stars = lines <= level.par ? 3 : 2;
  }
  return { results, reqFail, lines, stars };
}

// ───── requisitos habituales ─────
const stripComments = (c: string) => c.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
export const uses = (re: RegExp, msg: string): Requirement => ({ test: (c) => re.test(stripComments(c)), msg });
export const avoids = (re: RegExp, msg: string): Requirement => ({ test: (c) => !re.test(stripComments(c)), msg });
