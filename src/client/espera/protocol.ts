// Sala de espera: mensajes, plano del aula y movimiento (lógica pura, compartida por profe y alumnos).

// ───────────── plano del aula ─────────────

export const ROOM_W = 2400;
export const ROOM_H = 1400;
/** franja superior: ventanales y pantalla holográfica (no se pisa) */
export const WALL_TOP = 236;
export const WALL_SIDE = 46;
export const WALL_BOTTOM = 52;
export const RADIUS = 24;

export interface Box { x: number; y: number; w: number; h: number; kind: ObstacleKind; fly?: boolean }
export type ObstacleKind = 'desk' | 'console' | 'planter' | 'pond' | 'rack' | 'pillar' | 'spot';

function desks(): Box[] {
  const out: Box[] = [];
  const cols = [230, 470, 710, 1500, 1740, 1980];
  const rows = [500, 680, 860, 1040];
  for (const y of rows) for (const x of cols) out.push({ x, y, w: 190, h: 56, kind: 'desk' });
  return out;
}

/** obstáculos: los voladores (drones) pasan por encima de los marcados con fly */
export const OBSTACLES: Box[] = [
  ...desks().map((d) => ({ ...d, fly: true })),
  { x: 1020, y: 330, w: 360, h: 70, kind: 'console', fly: true },
  // detrás de la mesa del profe: sólo para el profe (no se dibuja)
  { x: 1020, y: WALL_TOP, w: 360, h: 330 - WALL_TOP, kind: 'spot', fly: true },
  { x: 64, y: 250, w: 120, h: 120, kind: 'planter', fly: true },
  { x: ROOM_W - 184, y: 250, w: 120, h: 120, kind: 'planter', fly: true },
  { x: 64, y: ROOM_H - 190, w: 120, h: 120, kind: 'planter', fly: true },
  { x: ROOM_W - 184, y: ROOM_H - 190, w: 120, h: 120, kind: 'planter', fly: true },
  { x: 930, y: ROOM_H - 140, w: 100, h: 80, kind: 'planter', fly: true },
  { x: 1370, y: ROOM_H - 140, w: 100, h: 80, kind: 'planter', fly: true },
  { x: 250, y: 1190, w: 380, h: 120, kind: 'pond', fly: true },
  { x: ROOM_W - 120, y: 520, w: 70, h: 120, kind: 'rack', fly: true },
  { x: ROOM_W - 120, y: 760, w: 70, h: 120, kind: 'rack', fly: true },
  { x: ROOM_W - 120, y: 1000, w: 70, h: 120, kind: 'rack', fly: true },
  { x: 940, y: 560, w: 44, h: 44, kind: 'pillar', fly: true },
  { x: 1416, y: 560, w: 44, h: 44, kind: 'pillar', fly: true },
  { x: 940, y: 1000, w: 44, h: 44, kind: 'pillar', fly: true },
  { x: 1416, y: 1000, w: 44, h: 44, kind: 'pillar', fly: true },
];

/** pista de baile holográfica (centro del aula) */
export const DANCE = { x: 1200, y: 790, r: 150 };
export const DOOR = { x: 1200, y: ROOM_H - 110 };
/** el profe, de pie tras su mesa */
export const TEACHER = { x: 1200, y: 336 };

// ───────────── avatares ─────────────

export type SpriteKind = 'android' | 'drone' | 'rc' | 'tree';
export interface Sprite { k: SpriteKind; v: number }

export const SPEED: Record<SpriteKind, number> = { android: 230, drone: 270, rc: 320, tree: 175 };
export const FLIES: Record<SpriteKind, boolean> = { android: false, drone: true, rc: false, tree: false };
export const SPRITE_LABEL: Record<SpriteKind, string> = { android: 'androide', drone: 'dron', rc: 'teledirigido', tree: 'árbol bailongo' };
export const VARIANTS = 8;

/** reparto aleatorio: el árbol bailongo es raro */
export function randomSprite(rnd: () => number = Math.random): Sprite {
  const r = rnd();
  const k: SpriteKind = r < 0.07 ? 'tree' : r < 0.42 ? 'android' : r < 0.72 ? 'drone' : 'rc';
  return { k, v: Math.floor(rnd() * VARIANTS) };
}

export interface Motion {
  x: number;
  y: number;
  /** dirección de teclado (-1..1) */
  dx: number;
  dy: number;
  /** destino por clic (si no hay teclado) */
  tx: number | null;
  ty: number | null;
}

function blocked(x: number, y: number, fly: boolean): boolean {
  const r = RADIUS;
  if (x < WALL_SIDE + r || x > ROOM_W - WALL_SIDE - r || y < WALL_TOP + r || y > ROOM_H - WALL_BOTTOM - r) return true;
  for (const o of OBSTACLES) {
    if (fly && o.kind !== 'spot') continue;
    if (x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r) return true;
  }
  return false;
}

export function clampToRoom(x: number, y: number): [number, number] {
  return [
    Math.max(WALL_SIDE + RADIUS, Math.min(ROOM_W - WALL_SIDE - RADIUS, x)),
    Math.max(WALL_TOP + RADIUS, Math.min(ROOM_H - WALL_BOTTOM - RADIUS, y)),
  ];
}

/** casilla libre más cercana (por si alguien aparece encima de una mesa) */
export function freeSpot(x: number, y: number, fly = false): [number, number] {
  [x, y] = clampToRoom(x, y);
  if (!blocked(x, y, fly)) return [x, y];
  for (let rad = 10; rad < 800; rad += 10) {
    for (let a = 0; a < 16; a++) {
      const nx = x + Math.cos((a / 16) * Math.PI * 2) * rad;
      const ny = y + Math.sin((a / 16) * Math.PI * 2) * rad;
      if (!blocked(nx, ny, fly)) return [nx, ny];
    }
  }
  return [DOOR.x, DOOR.y];
}

export function spawnPoint(rnd: () => number = Math.random, fly = false): [number, number] {
  return freeSpot(DOOR.x + (rnd() - 0.5) * 520, DOOR.y - rnd() * 140, fly);
}

/**
 * Avanza un avatar dt segundos. Desliza por los obstáculos (primero X, luego Y).
 * Devuelve true si se ha movido.
 */
export function step(m: Motion, kind: SpriteKind, dt: number): boolean {
  let vx = m.dx;
  let vy = m.dy;
  if (!vx && !vy && m.tx !== null && m.ty !== null) {
    const ex = m.tx - m.x;
    const ey = m.ty - m.y;
    const d = Math.hypot(ex, ey);
    const reach = SPEED[kind] * dt;
    if (d <= Math.max(4, reach)) {
      const fly = FLIES[kind];
      if (!blocked(m.tx, m.ty, fly)) { m.x = m.tx; m.y = m.ty; }
      m.tx = m.ty = null;
      return d > 0.5;
    }
    vx = ex / d;
    vy = ey / d;
  }
  if (!vx && !vy) return false;
  const len = Math.hypot(vx, vy);
  if (len > 1) { vx /= len; vy /= len; }
  const s = SPEED[kind] * dt;
  const fly = FLIES[kind];
  const ox = m.x;
  const oy = m.y;
  const nx = m.x + vx * s;
  if (!blocked(nx, m.y, fly)) m.x = nx;
  const ny = m.y + vy * s;
  if (!blocked(m.x, ny, fly)) m.y = ny;
  const moved = Math.abs(m.x - ox) + Math.abs(m.y - oy) > 0.01;
  // atascado yendo a un destino: se rinde
  if (!moved && m.tx !== null) { m.tx = m.ty = null; }
  return moved;
}

// ───────────── emotes ─────────────

export const EMOTES = ['👋', '😂', '👍', '❤️', '🤔', '😮', '🎉', '🔥', '💡', '😴', '🕺', '💪'] as const;
/** índice del emote de baile (hace bailar al avatar) */
export const DANCE_EMOTE = 10;
/** «farmear aura»: aura dorada estilo Dragon Ball con partículas que se concentran */
export const AURA_EMOTE = 11;
export const AURA_MS = 4800;

// ───────────── mensajes ─────────────

export interface ChatMsg { id: number; cid: string; name: string; text: string; at: number; t?: boolean }

/** [cid, nombre, sprite, variante, en línea, silenciado] */
export type Person = [string, string, SpriteKind, number, boolean, boolean];

export type WaitToHost =
  | { type: 'w-hello'; cid: string; name: string }
  | { type: 'w-move'; cid: string; x: number; y: number; dx: number; dy: number; tx: number | null; ty: number | null }
  | { type: 'w-chat'; cid: string; text: string }
  | { type: 'w-emote'; cid: string; e: number }
  | { type: 'w-hand'; cid: string; up: boolean }
  | { type: 'w-ping'; cid: string }
  | { type: 'w-bye'; cid: string };

export type WaitToStudent =
  /** posiciones (5 veces por segundo): [cid, x, y, moviéndose] · ep cambia al reiniciar la sala */
  | { type: 'w-state'; ep: number; p: [string, number, number, 0 | 1][] }
  | { type: 'w-roster'; title: string; people: Person[]; hands: string[]; mi: number; banner: ChatMsg | null; prof?: string }
  | { type: 'w-chat'; m: ChatMsg }
  | { type: 'w-del'; id: number }
  | { type: 'w-clear' }
  | { type: 'w-emote'; cid: string; e: number }
  | { type: 'w-hand'; cid: string; up: boolean; by?: 'profe' }
  | { type: 'w-init'; you: Sprite; x: number; y: number; ep: number; chat: ChatMsg[] }
  | { type: 'w-notice'; text: string }
  | { type: 'w-kick'; reason: string }
  | { type: 'w-close' };

/** intervalo mínimo entre mensajes de movimiento de cada alumno (Ably: ~50 msg/s por canal) */
export function moveInterval(students: number): number {
  return Math.round(Math.max(150, (students * 1000) / 32));
}

// ───────────── filtro de palabrotas (suave) ─────────────

const BAD = ['puta', 'puto', 'mierda', 'joder', 'gilipollas', 'cabron', 'cabrón', 'polla', 'coño', 'capullo', 'imbecil', 'imbécil', 'subnormal', 'maricon', 'maricón', 'zorra', 'follar', 'pene', 'idiota', 'fuck', 'shit', 'bitch'];
// palabras completas (para no estropear «computadora» o «disputa»), con plural opcional
const BAD_RE = new RegExp(`(?<![\\p{L}])(${BAD.join('|')})(s|es)?(?![\\p{L}])`, 'giu');

export function cleanText(s: string, filter: boolean): string {
  let t = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (filter) t = t.replace(BAD_RE, (w) => w[0] + '*'.repeat(w.length - 1));
  return t;
}
