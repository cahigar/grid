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
  [T.CULTIVO]: { key: 'cultivo', move: 2500, air: true },
  [T.PUENTE]: { key: 'puente', move: 1200, air: true },
  [T.BASE]: { key: 'base', move: 0, air: false },
  [T.ESTRUCTURA]: { key: 'estructura', move: 0, air: false },
  [T.PUENTE_ROTO]: { key: 'puente_roto', move: 0, air: true },
};

export type ResKind = 'hierro' | 'cobre' | 'silicio' | 'chatarra' | 'biomasa';

export const RESOURCES: Record<ResKind, { ms: number; value: number; regen: number; label: string }> = {
  hierro: { ms: 3000, value: 1, regen: 0, label: 'Hierro' },
  cobre: { ms: 4000, value: 2, regen: 0, label: 'Cobre' },
  silicio: { ms: 6000, value: 4, regen: 0, label: 'Silicio' },
  chatarra: { ms: 2500, value: 1, regen: 0, label: 'Chatarra' },
  biomasa: { ms: 2000, value: 0.5, regen: 1 / 120_000, label: 'Biomasa' },
};
export const RES_KINDS = Object.keys(RESOURCES) as ResKind[];

export interface ResourceNode {
  id: number;
  x: number;
  y: number;
  kind: ResKind;
  amount: number;
  max: number;
  quality: 1 | 2 | 3;
}

export type PropKind =
  | 'arbol' | 'arbol_grande' | 'pino' | 'arbusto' | 'flores' | 'torre_ruina' | 'bloque_ruina' | 'muro_ruina'
  | 'coche' | 'farola' | 'panel_solar' | 'almacen' | 'antena' | 'silo' | 'roca' | 'cristales' | 'tuberia'
  | 'cascada' | 'turbina' | 'invernadero' | 'poste';

export interface Prop {
  x: number;
  y: number;
  kind: PropKind;
  v: number; // variante
  owner?: string;
}

export type UnitType = 'dron' | 'explorador' | 'minero';

export const UNIT_TYPES: Record<UnitType, {
  label: string; prefix: string; moveMul: number; scan: number; cargo: number; mineMul: number; air: boolean;
  cost: Partial<Record<ResKind, number>>; buildMs: number;
}> = {
  dron: { label: 'Dron', prefix: 'DRN', moveMul: 1, scan: 3, cargo: 8, mineMul: 1, air: false, cost: { hierro: 10, cobre: 4 }, buildMs: 60_000 },
  explorador: { label: 'Explorador', prefix: 'EXP', moveMul: 0.5, scan: 5, cargo: 0, mineMul: 0, air: true, cost: { hierro: 12, cobre: 6 }, buildMs: 90_000 },
  minero: { label: 'Minero', prefix: 'MIN', moveMul: 1.25, scan: 2, cargo: 20, mineMul: 0.67, air: false, cost: { hierro: 20, chatarra: 8 }, buildMs: 120_000 },
};

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
  startedAt: number;
  vm: VMState | null;
  /** petición de acción pendiente de energía (hibernación) */
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
}

export interface Player {
  id: string;
  name: string;
  color: string;
  bot: boolean;
  base: { x: number; y: number };
  dock: { x: number; y: number };
  storage: Record<ResKind, number>;
  known: string; // niebla serializada (base64 de bits)
  knownRes: number[];
  stats: DayStats;
  totals: { mined: number; delivered: number; explored: number; built: number; units: number };
  compartido: unknown;
  unitCounter: Record<UnitType, number>;
  files: Record<string, string>;
  versions?: Record<string, { t: number; src: string }[]>;
  lastSeen: number;
}

export interface WorldConfig {
  w: number;
  h: number;
  seed: number;
  tzOffsetMin: number;
  name: string;
}

export interface WorldState {
  v: 1;
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
}

export type Dir = 'N' | 'S' | 'E' | 'O';
export const DIRS: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], O: [-1, 0] };
