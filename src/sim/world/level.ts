// Mapas dibujados a mano (tutorial y tests) a partir de texto.
import { Game } from './game';
import { T, type MineralKind, type Prop, type UnitType, type WorldConfig } from './types';

/**
 * Leyenda:
 *  .  hierba      ,  maleza     =  camino      c  hormigón    ~  agua       T  bosque
 *  #  roca        R  ruina      h  huerto      B  base (esquina superior izquierda del bloque 2×2; el muelle queda debajo)
 *  i  veta de hierro   u  cobre   s  silicio   x  chatarra   (sobre hierba)
 *  *  baliza (objetivo)
 *  M G C H  unidades propias (minero, granjero, constructor, hacker)
 *  E  base enemiga    m g k  unidades enemigas (minero, granjero, hacker)
 */
export interface LevelSpec {
  map: string[];
  seed?: number;
  known?: 'all' | 'base';
  storage?: WorldConfig['startStorage'];
  amount?: number;
  timeScale?: number;
}

export interface BuiltLevel {
  game: Game;
  beacons: [number, number][];
}

const TILE: Record<string, T> = {
  '.': T.HIERBA, ',': T.MALEZA, '=': T.CAMINO, c: T.HORMIGON, '~': T.AGUA, T: T.BOSQUE, '#': T.ROCA, R: T.RUINA, h: T.CULTIVO,
};
const RES: Record<string, MineralKind> = { i: 'hierro', u: 'cobre', s: 'silicio', x: 'chatarra' };
const OWN: Record<string, UnitType> = { M: 'minero', G: 'granjero', C: 'constructor', H: 'hacker' };
const ENEMY: Record<string, UnitType> = { m: 'minero', g: 'granjero', k: 'hacker' };

export function buildLevel(spec: LevelSpec, time = Date.now()): BuiltLevel {
  const rows = spec.map.map((r) => r.replace(/\s+$/, ''));
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const terrain = new Uint8Array(w * h).fill(T.HIERBA);
  const props: Prop[] = [];
  const cfg: WorldConfig = {
    w, h, seed: spec.seed ?? 7, tzOffsetMin: 0, name: 'nivel', timeScale: spec.timeScale ?? 0.5,
    startUnits: [], startStorage: spec.storage ?? {}, level: 'custom',
  };
  let base: [number, number] | null = null;
  let enemyBase: [number, number] | null = null;
  const beacons: [number, number][] = [];
  const own: [UnitType, number, number][] = [];
  const enemy: [UnitType, number, number][] = [];
  const res: [MineralKind, number, number][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x] ?? '.';
      const k = y * w + x;
      if (ch in TILE) terrain[k] = TILE[ch];
      else if (ch in RES) res.push([RES[ch], x, y]);
      else if (ch === '*') beacons.push([x, y]);
      else if (ch in OWN) own.push([OWN[ch], x, y]);
      else if (ch in ENEMY) enemy.push([ENEMY[ch], x, y]);
      else if (ch === 'B') base = [x, y];
      else if (ch === 'E') enemyBase = [x, y];
      if (ch === 'T') props.push({ x, y, kind: (x * 7 + y) % 3 === 0 ? 'pino' : 'arbol', v: (x + y) % 6 });
      if (ch === '#') props.push({ x, y, kind: 'roca', v: (x + y) % 4 });
      if (ch === 'R') props.push({ x, y, kind: 'bloque_ruina', v: (x * 3 + y) % 5 });
    }
  }
  const placeBase = (b: [number, number]) => {
    for (let y = b[1]; y <= b[1] + 1; y++) for (let x = b[0]; x <= b[0] + 1; x++) terrain[y * w + x] = T.BASE;
    if (b[1] + 2 < h) terrain[(b[1] + 2) * w + b[0]] = T.HORMIGON;
  };
  if (base) placeBase(base);
  if (enemyBase) placeBase(enemyBase);
  const g = new Game(cfg, time, terrain, props);
  let rid = 1;
  for (const [kind, x, y] of res) g.addResource({ id: rid++, x, y, kind, amount: spec.amount ?? 20, max: spec.amount ?? 20, quality: 1 });
  g.nextResId = rid;
  const b = base ?? [0, 0];
  g.registerPlayer('p1', 'Tú', false, {}, { x: b[0], y: b[1] }, { x: b[0], y: Math.min(h - 1, b[1] + 2) });
  const pl = g.player('p1')!;
  for (const [t, x, y] of own) g.spawnUnit(pl, t, [x, y]);
  if (enemyBase || enemy.length) {
    const eb = enemyBase ?? [w - 2, 0];
    g.registerPlayer('p2', 'Colonia rival', true, {}, { x: eb[0], y: eb[1] }, { x: eb[0], y: Math.min(h - 1, eb[1] + 2) });
    const ep = g.player('p2')!;
    for (const [t, x, y] of enemy) g.spawnUnit(ep, t, [x, y]);
  }
  if (spec.known === 'all') {
    pl.known.fill(1);
    for (const r of g.resources.values()) pl.knownRes.add(r.id);
  }
  return { game: g, beacons };
}
