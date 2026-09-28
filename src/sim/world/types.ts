// Tipos del mundo (todos serializables a JSON).
import type { VMState } from '../lang/serialize';

export enum T {
  HIERBA = 0,
  CARRETERA = 1,
  HORMIGON = 2,
  MALEZA = 3,
  BOSQUE = 4,
  AGUA = 5,
  RUINA = 6,
  ROCA = 7,
  CULTIVO = 8,
  PUENTE = 9,
  BASE = 10,
  ESTRUCTURA = 11,
  PUENTE_ROTO = 12,
  CAMINO = 13,
}

export interface TerrainInfo {
  key: string;
  /** tiempo base de mover() hacia esta casilla (ms); 0 = intransitable por tierra */
  move: number;
  /** transitable por unidades aéreas */
  air: boolean;
}

export const TERRAIN: Record<T, TerrainInfo> = {
  [T.HIERBA]: { key: 'hierba', move: 2000, air: true },
  [T.CARRETERA]: { key: 'carretera', move: 1200, air: true },
  [T.HORMIGON]: { key: 'hormigon', move: 1500, air: true },
  [T.MALEZA]: { key: 'maleza', move: 3500, air: true },
  [T.BOSQUE]: { key: 'bosque', move: 0, air: true },
  [T.AGUA]: { key: 'agua', move: 0, air: true },
  [T.RUINA]: { key: 'ruina', move: 0, air: false },
  [T.ROCA]: { key: 'roca', move: 0, air: false },
  [T.CULTIVO]: { key: 'huerto', move: 2500, air: true },
  [T.PUENTE]: { key: 'puente', move: 1200, air: true },
  [T.BASE]: { key: 'base', move: 0, air: false },
  [T.ESTRUCTURA]: { key: 'edificio', move: 0, air: false },
  [T.PUENTE_ROTO]: { key: 'puente_roto', move: 0, air: true },
  [T.CAMINO]: { key: 'camino', move: 1000, air: true },
};

/** Minerales (vetas del mapa) y cosecha (huertos) */
export type ResKind = 'hierro' | 'cobre' | 'silicio' | 'chatarra' | 'cosecha';
export type MineralKind = Exclude<ResKind, 'cosecha'>;

export const RESOURCES: Record<ResKind, { ms: number; value: number; label: string }> = {
  hierro: { ms: 3000, value: 1, label: 'Hierro' },
  cobre: { ms: 4000, value: 2, label: 'Cobre' },
  silicio: { ms: 6000, value: 4, label: 'Silicio' },
  chatarra: { ms: 2500, value: 1, label: 'Chatarra' },
  cosecha: { ms: 3000, value: 3, label: 'Cosecha' },
};
export const RES_KINDS = Object.keys(RESOURCES) as ResKind[];
export const MINERALS: MineralKind[] = ['hierro', 'cobre', 'silicio', 'chatarra'];

export interface ResourceNode {
  id: number;
  x: number;
  y: number;
  kind: MineralKind;
  amount: number;
  max: number;
  quality: 1 | 2 | 3;
}

export type PropKind =
  | 'arbol' | 'arbol_grande' | 'pino' | 'arbusto' | 'flores' | 'torre_ruina' | 'bloque_ruina' | 'muro_ruina'
  | 'coche' | 'farola' | 'panel_solar' | 'almacen' | 'antena' | 'silo' | 'roca' | 'cristales' | 'tuberia'
  | 'cascada' | 'turbina' | 'invernadero' | 'poste' | 'aspersor'
  | 'casa' | 'taller' | 'aerogenerador' | 'laboratorio' | 'torre_verde';

export interface Prop {
  x: number;
  y: number;
  kind: PropKind;
  v: number; // variante
  owner?: string;
}

// ───── edificios que levanta el constructor ─────
export type BuildKind = 'camino' | 'almacen' | 'silo' | 'panel' | 'antena' | 'aspersor'
  | 'casa' | 'taller' | 'aerogenerador' | 'laboratorio' | 'torre_verde';

export const BUILDINGS: Record<BuildKind, { label: string; cost: Partial<Record<ResKind, number>>; ms: number; desc: string; points?: number }> = {
  camino: { label: 'Camino', cost: { chatarra: 1 }, ms: 2000, desc: 'Moverse por él cuesta 1 s (por tierra y en vuelo). Sobre agua construye un puente (3 chatarra + 1 hierro).' },
  almacen: { label: 'Almacén', cost: { hierro: 5, chatarra: 3 }, ms: 8000, desc: 'Punto de descarga para cualquier recurso.' },
  silo: { label: 'Silo', cost: { hierro: 3 }, ms: 6000, desc: 'Punto de descarga sólo para cosecha.' },
  panel: { label: 'Panel solar', cost: { silicio: 2, cobre: 2 }, ms: 6000, desc: 'Las unidades junto a él pueden recargar().' },
  antena: { label: 'Antena', cost: { cobre: 3, hierro: 2 }, ms: 8000, desc: 'Amplía el rango de señal (radio 11). Fuera de señal las acciones tardan el doble.' },
  aspersor: { label: 'Aspersor', cost: { cobre: 2, hierro: 2 }, ms: 6000, desc: 'Unidad fija programable: disparar(x, y) riega huertos y moja drones enemigos (radio 3).' },
  // edificios de la nueva colonia: cuestan más, pero dan muchos puntos al terminarlos
  casa: { label: 'Vivienda modular', cost: { hierro: 4, chatarra: 4 }, ms: 12000, points: 12, desc: 'Módulos habitables con jardín en la azotea.' },
  taller: { label: 'Taller', cost: { hierro: 6, cobre: 3 }, ms: 14000, points: 18, desc: 'Nave de reparaciones con tejado de dientes de sierra.' },
  aerogenerador: { label: 'Aerogenerador', cost: { hierro: 5, cobre: 3, silicio: 1 }, ms: 14000, points: 24, desc: 'Turbina de viento que alimenta la colonia.' },
  laboratorio: { label: 'Laboratorio', cost: { hierro: 4, cobre: 4, silicio: 3 }, ms: 18000, points: 36, desc: 'Cúpula de cristal para investigar la tecnología antigua.' },
  torre_verde: { label: 'Torre verde', cost: { hierro: 8, chatarra: 6, cosecha: 4 }, ms: 20000, points: 45, desc: 'Torre de terrazas con cultivos: el símbolo de la nueva colonia.' },
};
/** edificios que dan puntos al terminarse */
export const SCORE_BUILDINGS = (Object.keys(BUILDINGS) as BuildKind[]).filter((k) => BUILDINGS[k].points);
export const BRIDGE_COST: Partial<Record<ResKind, number>> = { chatarra: 3, hierro: 1 };

export interface Building {
  id: number;
  owner: string;
  kind: Exclude<BuildKind, 'camino'>;
  x: number;
  y: number;
}

/** Parcela de huerto (casilla CULTIVO). Estado evaluado de forma perezosa en `t`. */
export interface Parcel {
  planted: boolean;
  hum: number; // 0-100
  mat: number; // 0-100
  t: number;
  owner: string | null; // quien la plantó
}

export const CROP = {
  /** pérdida de humedad por segundo real */
  humDecay: 100 / 90,
  /** madurez por segundo con humedad > 30 */
  grow: 1,
  water: 45,
  yield: 2,
};

// ───── unidades ─────
export type UnitType = 'granjero' | 'minero' | 'constructor' | 'hacker' | 'aspersor' | 'base';

export interface UnitTypeInfo {
  label: string;
  prefix: string;
  air: boolean;
  fixed: boolean;
  /** ms por casilla en vuelo; en tierra se usa el terreno × moveMul */
  airMove: number;
  moveMul: number;
  scan: number;
  cargo: number;
  water: number;
  actions: string[];
  color: string;
  desc: string;
}

const COMMON = ['mover', 'mirar', 'escanear', 'radar', 'descargar', 'recargar', 'esperar'];

export const UNIT_TYPES: Record<UnitType, UnitTypeInfo> = {
  granjero: {
    label: 'Dron granjero', prefix: 'GRJ', air: true, fixed: false, airMove: 900, moveMul: 1, scan: 4, cargo: 6, water: 6,
    actions: [...COMMON, 'plantar', 'regar', 'recolectar', 'cargar_agua'], color: '#8fd14f',
    desc: 'Vuela. Planta, riega y recolecta en los huertos.',
  },
  minero: {
    label: 'Minero', prefix: 'MIN', air: false, fixed: false, airMove: 0, moveMul: 1, scan: 3, cargo: 12, water: 0,
    actions: [...COMMON, 'picar', 'recoger'], color: '#f2a93b',
    desc: 'Vehículo de tierra. Pica vetas y recoge lo que queda en el suelo.',
  },
  constructor: {
    label: 'Constructor', prefix: 'CON', air: false, fixed: false, airMove: 0, moveMul: 1.1, scan: 2, cargo: 0, water: 0,
    actions: [...COMMON, 'construir'], color: '#ef7d2d',
    desc: 'Vehículo de tierra con brazo. Construye caminos, almacenes, paneles, antenas y aspersores.',
  },
  hacker: {
    label: 'Dron hacker', prefix: 'HCK', air: true, fixed: false, airMove: 800, moveMul: 1, scan: 5, cargo: 0, water: 0,
    actions: [...COMMON, 'hackear'], color: '#ff5d73',
    desc: 'Vuela. Junto a una unidad enemiga puede modificar su código.',
  },
  aspersor: {
    label: 'Aspersor', prefix: 'ASP', air: false, fixed: true, airMove: 0, moveMul: 1, scan: 3, cargo: 0, water: 10,
    actions: ['disparar', 'radar', 'esperar', 'mirar'], color: '#5fb8ff',
    desc: 'Edificio programable. Dispara agua: riega huertos y deja fuera de juego a drones enemigos unos segundos.',
  },
  base: {
    label: 'Centro operativo', prefix: 'CEN', air: false, fixed: true, airMove: 0, moveMul: 1, scan: 5, cargo: 0, water: 0,
    actions: ['fabricar', 'radar', 'escanear', 'esperar'], color: '#2fd4c0',
    desc: 'Tu base también se programa: con fabricar(tipo) crea granjeros, mineros y constructores nuevos usando recursos del almacén.',
  },
};
/** unidades que puede fabricar la base */
export const FACTORY_TYPES: UnitType[] = ['granjero', 'minero', 'constructor'];
export const UNIT_COST: Partial<Record<UnitType, Partial<Record<ResKind, number>>>> = {
  granjero: { hierro: 4, cobre: 3, silicio: 1 },
  minero: { hierro: 6, chatarra: 4 },
  constructor: { hierro: 5, chatarra: 5, cobre: 2 },
};
export const FACTORY = { ms: 10000, maxPerType: 4 };
export const MOBILE_TYPES: UnitType[] = ['granjero', 'minero', 'constructor', 'hacker'];

export type UnitStatus = 'IDLE' | 'RUNNING' | 'DONE' | 'ERROR' | 'HIBERNATING';

export interface LogEntry {
  t: number;
  m: string;
  k: 'info' | 'warn' | 'error' | 'print' | 'ok';
  n: number;
}

export interface UnitAction {
  name: string;
  label: string;
  start: number;
  end: number;
  from: [number, number];
  to: [number, number];
  ok: boolean;
  data?: unknown;
}

export interface Program {
  name: string;
  bundle: { main: string; modules: Record<string, string> };
  /** código tal como lo cargó su dueño (para integridad()) */
  original: string;
  startedAt: number;
  vm: VMState | null;
  /** petición de acción pendiente (hibernación o mojado) */
  pending: { action: string; args: unknown; kw: unknown } | null;
}

export interface Unit {
  id: string;
  owner: string;
  name: string;
  type: UnitType;
  x: number;
  y: number;
  battery: number;
  batteryAt: number;
  water: number;
  waterAt: number;
  cargo: Partial<Record<ResKind, number>>;
  status: UnitStatus;
  action: UnitAction | null;
  program: Program | null;
  wakeAt: number | null;
  logs: LogEntry[];
  trail: [number, number][];
  route: [number, number][] | null;
  blocked: { attempts: number; lostMs: number; since: number; instr: string } | null;
  error: { type: string; msg: string; line: number; mod: string } | null;
  memoria: unknown; // valor serializado
  lastLine: number;
  cpuWarned: boolean;
  instr: number;
  actions: number;
  wetUntil: number;
  immuneUntil: number;
  hackReadyAt: number;
  hacked: { by: string; t: number; line: number; before: string; after: string } | null;
}

export interface DayStats {
  day: number;
  mined: number;
  delivered: number;
  explored: number;
  energy: number;
  instr: number;
  actions: number;
  activeMs: number;
  errors: number;
  harvested: number;
  built: number;
  hacks: number;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  bot: boolean;
  base: { x: number; y: number };
  dock: { x: number; y: number };
  storage: Record<ResKind, number>;
  known: string; // niebla serializada
  knownRes: number[];
  stats: DayStats;
  totals: { mined: number; delivered: number; explored: number; built: number; units: number; harvested: number; hacks: number; buildScore?: number };
  compartido: unknown;
  unitCounter: Record<UnitType, number>;
  files: Record<string, string>;
  versions?: Record<string, { t: number; src: string }[]>;
  lastSeen: number;
}

export interface MatchConfig {
  /** instante de inicio de la preparación */
  start: number;
  prepMs: number;
  playMs: number;
  hacking: boolean;
  hackBreak: boolean; // permitir el modo "borrar"
}

export interface WorldConfig {
  w: number;
  h: number;
  seed: number;
  tzOffsetMin: number;
  name: string;
  /** multiplicador de duración de acciones (0.35 en partida) */
  timeScale?: number;
  match?: MatchConfig | null;
  startStorage?: Partial<Record<ResKind, number>>;
  /** unidades con las que empieza cada jugador */
  startUnits?: UnitType[];
  /** crear la unidad programable del centro operativo (por defecto sí) */
  baseUnit?: boolean;
  /** sin generación procedural: la crea el nivel del tutorial */
  level?: string;
}

export interface WorldState {
  v: 2;
  cfg: WorldConfig;
  time: number;
  terrain: string; // base64
  props: Prop[];
  resources: ResourceNode[];
  nextResId: number;
  players: Player[];
  units: Unit[];
  seq: number;
  slots: { x: number; y: number }[];
  buildings: Building[];
  parcels: [number, Parcel][];
  drops: [number, Partial<Record<ResKind, number>>][];
  nextBuildId: number;
  terrainVersion: number;
}

export type Dir = 'N' | 'S' | 'E' | 'O';
export const DIRS: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], O: [-1, 0] };

export const SIGNAL = { base: 9, antena: 11 };
export const HACK = { channelMs: 4000, cooldownMs: 45_000, immuneMs: 40_000, wetMs: 8000, radarRange: 5 };
