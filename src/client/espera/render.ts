// Sala de espera — dibujo del aula futurista (Canvas 2D, todo procedural) y de los avatares.
import {
  AURA_MS, DANCE, DOOR, OBSTACLES, TEACHER, ROOM_H, ROOM_W, WALL_BOTTOM, WALL_SIDE, WALL_TOP, EMOTES, type Box, type SpriteKind,
} from './protocol';

export interface View { scale: number; ox: number; oy: number }

/** tamaño de los avatares respecto al aula */
const SPR = 1.55;

export interface AvatarView {
  cid: string;
  name: string;
  k: SpriteKind;
  v: number;
  x: number;
  y: number;
  moving: boolean;
  me?: boolean;
  /** posición en la cola de manos (1 = siguiente) o 0 */
  hand: number;
  muted?: boolean;
}

export interface Fx {
  bubbles: Map<string, { text: string; at: number; t?: boolean }>;
  emotes: Map<string, { e: number; at: number }>;
  /** hasta cuándo baila cada avatar (ms) */
  dance: Map<string, number>;
  /** dirección mirando (−1 izquierda, 1 derecha) y ángulo para teledirigidos */
  face: Map<string, { dir: number; ang: number; lx: number; ly: number }>;
  joins: Map<string, number>;
  /** inicio del aura («farmear aura») de cada avatar (ms) */
  aura: Map<string, number>;
}

export function newFx(): Fx {
  return { bubbles: new Map(), emotes: new Map(), dance: new Map(), face: new Map(), joins: new Map(), aura: new Map() };
}

export interface ScreenInfo {
  code: string;
  title: string;
  url: string;
  qr: HTMLImageElement | null;
  banner: { name: string; text: string } | null;
  online: number;
  timer?: { left: number; total: number; label: string; paused: boolean } | null;
}

// ───────────── paletas ─────────────

const PAL: [string, string, string][] = [
  // carcasa, acento, brillo
  ['#e9f1f2', '#2fd4c0', '#5fe8ff'],
  ['#f2a93b', '#3b4a52', '#5fe8ff'],
  ['#8fd14f', '#2b4a3a', '#ffe066'],
  ['#ff7a66', '#3b4a52', '#5fe8ff'],
  ['#7aa7ff', '#203048', '#f2a93b'],
  ['#c7b3ff', '#33305a', '#2fd4c0'],
  ['#4a5a62', '#ff6bd6', '#ff6bd6'],
  ['#ffd34d', '#4a3a1a', '#2fd4c0'],
];

const TREE_PAL: [string, string][] = [
  ['#5fbf4a', '#3d8f34'], ['#8fd14f', '#4f9a2e'], ['#3fbf8f', '#258a66'], ['#e07ab8', '#b04f8c'],
  ['#f2a93b', '#c67a1e'], ['#7ad16b', '#3f8f3a'], ['#b9e05a', '#7aa62e'], ['#4fd4a8', '#2a9a7a'],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

// ───────────── fondo estático (se pinta una vez) ─────────────

let bgCache: { canvas: HTMLCanvasElement; scale: number } | null = null;

export function background(scale: number): HTMLCanvasElement {
  if (bgCache && bgCache.scale === scale) return bgCache.canvas;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(ROOM_W * scale);
  cv.height = Math.ceil(ROOM_H * scale);
  const c = cv.getContext('2d')!;
  c.scale(scale, scale);
  paintStatic(c);
  bgCache = { canvas: cv, scale };
  return cv;
}

function paintStatic(c: CanvasRenderingContext2D): void {
  // muro exterior
  c.fillStyle = '#0a1517';
  c.fillRect(0, 0, ROOM_W, ROOM_H);

  // ── ventanales con el valle (naturaleza recuperando el mundo) ──
  const wy = 18;
  const wh = WALL_TOP - 52;
  const sky = c.createLinearGradient(0, wy, 0, wy + wh);
  sky.addColorStop(0, '#5fb8c9');
  sky.addColorStop(0.55, '#a7dccb');
  sky.addColorStop(1, '#f3d9a0');
  c.fillStyle = sky;
  c.fillRect(WALL_SIDE, wy, ROOM_W - WALL_SIDE * 2, wh);
  // sol
  const sun = c.createRadialGradient(1880, wy + 60, 4, 1880, wy + 60, 220);
  sun.addColorStop(0, 'rgba(255,244,200,0.95)');
  sun.addColorStop(0.15, 'rgba(255,230,160,0.6)');
  sun.addColorStop(1, 'rgba(255,230,160,0)');
  c.fillStyle = sun;
  c.fillRect(WALL_SIDE, wy, ROOM_W - WALL_SIDE * 2, wh);
  // colinas lejanas
  const hills = (base: number, amp: number, col: string, f: number, ph: number) => {
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(WALL_SIDE, wy + wh);
    for (let x = WALL_SIDE; x <= ROOM_W - WALL_SIDE; x += 20) {
      c.lineTo(x, wy + base - Math.sin(x * f + ph) * amp - Math.sin(x * f * 2.7 + ph * 2) * amp * 0.35);
    }
    c.lineTo(ROOM_W - WALL_SIDE, wy + wh);
    c.fill();
  };
  hills(wh * 0.62, 26, '#7fbfa6', 0.004, 1);
  // ruinas de torres con musgo
  for (let i = 0; i < 14; i++) {
    const x = 120 + i * 165 + Math.sin(i * 7.3) * 40;
    const h = 40 + ((i * 37) % 60);
    const w = 22 + ((i * 13) % 18);
    c.fillStyle = '#6f9a93';
    c.fillRect(x, wy + wh * 0.6 - h, w, h + 30);
    c.fillStyle = 'rgba(70,140,90,0.8)';
    c.fillRect(x, wy + wh * 0.6 - h, w, 7);
    c.fillStyle = 'rgba(255,255,255,0.25)';
    for (let k = 0; k < h / 12; k++) c.fillRect(x + 5, wy + wh * 0.6 - h + 12 + k * 12, w - 10, 3);
  }
  hills(wh * 0.8, 18, '#4f9a6e', 0.006, 3);
  hills(wh * 0.95, 12, '#3a7d55', 0.011, 5);
  // árboles cercanos
  for (let x = WALL_SIDE + 10; x < ROOM_W - WALL_SIDE; x += 34) {
    const h = 14 + hash(String(x)) * 22;
    c.fillStyle = hash('t' + x) > 0.5 ? '#2f6e45' : '#3b8150';
    c.beginPath();
    c.arc(x, wy + wh - h * 0.4, h * 0.6, 0, Math.PI * 2);
    c.fill();
  }
  // marcos de los ventanales
  c.fillStyle = '#16282b';
  for (let x = WALL_SIDE; x <= ROOM_W - WALL_SIDE; x += 230) c.fillRect(x - 6, wy, 12, wh);
  c.fillRect(WALL_SIDE, wy - 6, ROOM_W - WALL_SIDE * 2, 10);
  c.fillRect(WALL_SIDE, wy + wh * 0.42, ROOM_W - WALL_SIDE * 2, 5);
  // reflejo del cristal
  c.fillStyle = 'rgba(255,255,255,0.08)';
  for (let x = WALL_SIDE + 30; x < ROOM_W - WALL_SIDE; x += 230) {
    c.beginPath();
    c.moveTo(x, wy + wh); c.lineTo(x + 40, wy); c.lineTo(x + 70, wy); c.lineTo(x + 30, wy + wh);
    c.fill();
  }
  // zócalo del muro
  const sill = c.createLinearGradient(0, wy + wh, 0, WALL_TOP);
  sill.addColorStop(0, '#22383b');
  sill.addColorStop(1, '#152629');
  c.fillStyle = sill;
  c.fillRect(0, wy + wh, ROOM_W, WALL_TOP - wy - wh);
  c.fillStyle = '#2fd4c0';
  c.globalAlpha = 0.55;
  c.fillRect(WALL_SIDE, WALL_TOP - 6, ROOM_W - WALL_SIDE * 2, 2);
  c.globalAlpha = 1;

  // ── suelo ──
  const fx0 = WALL_SIDE, fy0 = WALL_TOP, fw = ROOM_W - WALL_SIDE * 2, fh = ROOM_H - WALL_TOP - WALL_BOTTOM;
  c.fillStyle = '#132629';
  c.fillRect(fx0, fy0, fw, fh);
  const T = 80;
  for (let y = fy0; y < fy0 + fh; y += T) {
    for (let x = fx0; x < fx0 + fw; x += T) {
      const n = hash(`${x},${y}`);
      c.fillStyle = n < 0.33 ? '#152a2e' : n < 0.66 ? '#14282b' : '#122427';
      c.fillRect(x + 1, y + 1, T - 2, T - 2);
      if (n > 0.93) { c.fillStyle = 'rgba(47,212,192,0.05)'; c.fillRect(x + 8, y + 8, T - 16, T - 16); }
    }
  }
  c.strokeStyle = 'rgba(120,220,205,0.06)';
  c.lineWidth = 1;
  for (let x = fx0; x <= fx0 + fw; x += T) { c.beginPath(); c.moveTo(x, fy0); c.lineTo(x, fy0 + fh); c.stroke(); }
  for (let y = fy0; y <= fy0 + fh; y += T) { c.beginPath(); c.moveTo(fx0, y); c.lineTo(fx0 + fw, y); c.stroke(); }
  // luz cálida de los ventanales sobre el suelo
  for (let x = WALL_SIDE + 40; x < ROOM_W - WALL_SIDE; x += 230) {
    const g = c.createLinearGradient(0, fy0, 0, fy0 + 520);
    g.addColorStop(0, 'rgba(255,220,150,0.10)');
    g.addColorStop(1, 'rgba(255,220,150,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x, fy0); c.lineTo(x + 170, fy0); c.lineTo(x + 290, fy0 + 520); c.lineTo(x + 120, fy0 + 520);
    c.fill();
  }
  // pasillos con guías luminosas
  c.strokeStyle = 'rgba(47,212,192,0.22)';
  c.setLineDash([18, 14]);
  c.lineWidth = 3;
  for (const x of [1000, 1400]) { c.beginPath(); c.moveTo(x, 430); c.lineTo(x, ROOM_H - 160); c.stroke(); }
  c.beginPath(); c.moveTo(200, 455); c.lineTo(2200, 455); c.stroke();
  c.setLineDash([]);
  // flecha de entrada
  c.fillStyle = 'rgba(242,169,59,0.25)';
  for (let i = 0; i < 3; i++) {
    const y = ROOM_H - 170 - i * 40;
    c.beginPath(); c.moveTo(DOOR.x - 24, y + 14); c.lineTo(DOOR.x, y); c.lineTo(DOOR.x + 24, y + 14); c.lineTo(DOOR.x + 24, y + 22); c.lineTo(DOOR.x, y + 8); c.lineTo(DOOR.x - 24, y + 22); c.fill();
  }

  // ── pista holográfica (base) ──
  const pad = c.createRadialGradient(DANCE.x, DANCE.y, 10, DANCE.x, DANCE.y, DANCE.r + 20);
  pad.addColorStop(0, '#1d3d40');
  pad.addColorStop(1, '#122427');
  c.fillStyle = pad;
  c.beginPath(); c.arc(DANCE.x, DANCE.y, DANCE.r + 14, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(47,212,192,0.5)';
  c.lineWidth = 3;
  c.beginPath(); c.arc(DANCE.x, DANCE.y, DANCE.r + 14, 0, Math.PI * 2); c.stroke();
  // hexágonos
  c.strokeStyle = 'rgba(47,212,192,0.14)';
  c.lineWidth = 1.5;
  for (let q = -4; q <= 4; q++) for (let r = -4; r <= 4; r++) {
    const hx = DANCE.x + (q + r / 2) * 40;
    const hy = DANCE.y + r * 35;
    if (Math.hypot(hx - DANCE.x, hy - DANCE.y) > DANCE.r - 10) continue;
    c.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; c.lineTo(hx + Math.cos(a) * 21, hy + Math.sin(a) * 21); }
    c.closePath(); c.stroke();
  }

  // ── muros laterales e inferior ──
  const side = (x: number) => {
    c.fillStyle = '#0f1e21';
    c.fillRect(x, WALL_TOP - 6, WALL_SIDE, ROOM_H - WALL_TOP + 6);
    c.fillStyle = 'rgba(47,212,192,0.5)';
    c.fillRect(x === 0 ? WALL_SIDE - 4 : x + 2, WALL_TOP, 2, ROOM_H - WALL_TOP - WALL_BOTTOM);
    c.fillStyle = '#18302f';
    for (let y = WALL_TOP + 40; y < ROOM_H - 80; y += 120) c.fillRect(x + 10, y, WALL_SIDE - 20, 70);
  };
  side(0);
  side(ROOM_W - WALL_SIDE);
  c.fillStyle = '#0f1e21';
  c.fillRect(0, ROOM_H - WALL_BOTTOM, ROOM_W, WALL_BOTTOM);
  c.fillStyle = 'rgba(47,212,192,0.45)';
  c.fillRect(WALL_SIDE, ROOM_H - WALL_BOTTOM + 2, ROOM_W - WALL_SIDE * 2, 2);
  // puerta
  c.fillStyle = '#1d3336';
  c.fillRect(DOOR.x - 110, ROOM_H - WALL_BOTTOM - 4, 220, WALL_BOTTOM + 4);
  c.fillStyle = '#f2a93b';
  c.fillRect(DOOR.x - 110, ROOM_H - WALL_BOTTOM - 4, 220, 4);
  c.fillStyle = 'rgba(242,169,59,0.8)';
  c.font = '600 20px "JetBrains Mono", monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('ENTRADA', DOOR.x, ROOM_H - WALL_BOTTOM / 2);

  // ── sillas y mesas ──
  for (const o of OBSTACLES) if (o.kind === 'desk') chairs(c, o);
  for (const o of OBSTACLES) {
    if (o.kind === 'desk') desk(c, o);
    else if (o.kind === 'console') consoleDesk(c, o);
    else if (o.kind === 'planter') planter(c, o);
    else if (o.kind === 'pond') pond(c, o);
    else if (o.kind === 'rack') rack(c, o);
    else if (o.kind === 'pillar') pillar(c, o);
  }
  // enredaderas colgando del muro superior
  for (let x = WALL_SIDE + 20; x < ROOM_W - WALL_SIDE; x += 70 + hash('v' + x) * 90) {
    const len = 20 + hash('l' + x) * 70;
    c.strokeStyle = '#2f6e45';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(x, WALL_TOP - 8);
    c.quadraticCurveTo(x + 10, WALL_TOP + len / 2, x - 4, WALL_TOP + len); c.stroke();
    for (let k = 0; k < len; k += 9) {
      c.fillStyle = k % 18 ? '#4f9a5a' : '#6fbf6a';
      c.beginPath(); c.ellipse(x + Math.sin(k) * 6, WALL_TOP + k, 6, 3.5, k, 0, Math.PI * 2); c.fill();
    }
  }
}

function chairs(c: CanvasRenderingContext2D, o: Box): void {
  for (let i = 0; i < 2; i++) {
    const cx = o.x + o.w * (0.28 + i * 0.44);
    const cy = o.y + o.h + 26;
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.beginPath(); c.ellipse(cx, cy + 6, 18, 9, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#24393c';
    rr(c, cx - 16, cy - 14, 32, 26, 9); c.fill();
    c.fillStyle = '#2fd4c0';
    c.globalAlpha = 0.5;
    rr(c, cx - 12, cy + 6, 24, 4, 2); c.fill();
    c.globalAlpha = 1;
  }
}

function desk(c: CanvasRenderingContext2D, o: Box): void {
  c.fillStyle = 'rgba(0,0,0,0.35)';
  rr(c, o.x + 6, o.y + 14, o.w, o.h, 14); c.fill();
  // patas/estructura
  c.fillStyle = '#2a4245';
  rr(c, o.x, o.y + 8, o.w, o.h, 14); c.fill();
  // tablero
  const g = c.createLinearGradient(0, o.y, 0, o.y + o.h);
  g.addColorStop(0, '#e4eef0');
  g.addColorStop(1, '#bfd0d3');
  c.fillStyle = g;
  rr(c, o.x, o.y, o.w, o.h - 6, 14); c.fill();
  c.strokeStyle = 'rgba(47,212,192,0.9)';
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(o.x + 12, o.y + o.h - 6); c.lineTo(o.x + o.w - 12, o.y + o.h - 6); c.stroke();
  // pantallas holográficas
  for (let i = 0; i < 2; i++) {
    const mx = o.x + o.w * (0.28 + i * 0.44) - 26;
    c.fillStyle = 'rgba(47,212,192,0.28)';
    rr(c, mx, o.y - 14, 52, 26, 4); c.fill();
    c.strokeStyle = 'rgba(95,232,255,0.8)';
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = 'rgba(200,255,250,0.7)';
    for (let l = 0; l < 3; l++) c.fillRect(mx + 7, o.y - 8 + l * 6, 14 + ((l * 13 + i * 7 + o.x) % 24), 2);
    c.fillStyle = '#9fb2b5';
    rr(c, mx + 8, o.y + 18, 36, 10, 3); c.fill();
  }
}

function consoleDesk(c: CanvasRenderingContext2D, o: Box): void {
  c.fillStyle = 'rgba(0,0,0,0.35)';
  rr(c, o.x + 8, o.y + 16, o.w, o.h, 30); c.fill();
  c.fillStyle = '#2a4245';
  rr(c, o.x, o.y + 10, o.w, o.h, 30); c.fill();
  const g = c.createLinearGradient(0, o.y, 0, o.y + o.h);
  g.addColorStop(0, '#f4f7f7');
  g.addColorStop(1, '#c9d6d8');
  c.fillStyle = g;
  rr(c, o.x, o.y, o.w, o.h - 6, 30); c.fill();
  c.strokeStyle = '#f2a93b';
  c.lineWidth = 3;
  c.beginPath(); c.moveTo(o.x + 30, o.y + o.h - 6); c.lineTo(o.x + o.w - 30, o.y + o.h - 6); c.stroke();
  c.fillStyle = '#5b6f72';
  c.font = '600 14px "JetBrains Mono", monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('PROFE', o.x + o.w / 2, o.y + o.h / 2 - 2);
}

function planter(c: CanvasRenderingContext2D, o: Box): void {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const r = Math.min(o.w, o.h) / 2;
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath(); c.ellipse(cx + 8, cy + 12, r, r * 0.9, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#d5e0e1';
  rr(c, o.x + 6, o.y + 6, o.w - 12, o.h - 12, 18); c.fill();
  c.fillStyle = '#4a3a2a';
  rr(c, o.x + 14, o.y + 14, o.w - 28, o.h - 28, 12); c.fill();
  const seed = hash(`${o.x},${o.y}`);
  const blobs = 9;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + seed * 6;
    const d = r * 0.45 * (0.6 + hash(i + 'p' + o.x) * 0.5);
    c.fillStyle = ['#2f7a45', '#3f9a55', '#5fbf5a', '#2a6a40'][i % 4];
    c.beginPath(); c.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d - 6, r * 0.42, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = '#7fd36a';
  c.beginPath(); c.arc(cx - 4, cy - 12, r * 0.32, 0, Math.PI * 2); c.fill();
  // flores
  for (let i = 0; i < 5; i++) {
    c.fillStyle = ['#ffd34d', '#ff8fb0', '#ffffff', '#f2a93b', '#c7b3ff'][(i + Math.floor(seed * 5)) % 5];
    c.beginPath(); c.arc(cx + Math.cos(i * 2.4 + seed) * r * 0.5, cy + Math.sin(i * 2.4 + seed) * r * 0.5 - 6, 4, 0, Math.PI * 2); c.fill();
  }
}

function pond(c: CanvasRenderingContext2D, o: Box): void {
  c.fillStyle = '#7d8f8c';
  rr(c, o.x - 8, o.y - 8, o.w + 16, o.h + 16, 50); c.fill();
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    c.fillStyle = i % 2 ? '#93a5a1' : '#6c7f7b';
    c.beginPath(); c.ellipse(o.x + o.w / 2 + Math.cos(a) * (o.w / 2 + 2), o.y + o.h / 2 + Math.sin(a) * (o.h / 2 + 2), 14, 10, a, 0, Math.PI * 2); c.fill();
  }
  const g = c.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
  g.addColorStop(0, '#1f7f8a');
  g.addColorStop(1, '#14545f');
  c.fillStyle = g;
  rr(c, o.x, o.y, o.w, o.h, 44); c.fill();
  // nenúfares
  for (let i = 0; i < 6; i++) {
    const lx = o.x + 50 + hash('n' + i) * (o.w - 100);
    const ly = o.y + 26 + hash('m' + i) * (o.h - 52);
    c.fillStyle = '#3f9a55';
    c.beginPath(); c.arc(lx, ly, 13, 0.3, Math.PI * 2 - 0.1); c.lineTo(lx, ly); c.fill();
    if (i % 2 === 0) { c.fillStyle = '#ffb3d0'; c.beginPath(); c.arc(lx + 3, ly - 2, 4.5, 0, Math.PI * 2); c.fill(); }
  }
  // juncos
  for (let i = 0; i < 9; i++) {
    const bx = o.x + o.w - 30 + (i % 3) * 8;
    c.strokeStyle = '#4f8a3a';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(bx, o.y + o.h - 6); c.lineTo(bx - 6 + i, o.y + o.h - 46 - (i % 3) * 8); c.stroke();
  }
}

function rack(c: CanvasRenderingContext2D, o: Box): void {
  c.fillStyle = 'rgba(0,0,0,0.35)';
  rr(c, o.x - 8, o.y + 8, o.w, o.h, 8); c.fill();
  c.fillStyle = '#1f3134';
  rr(c, o.x, o.y, o.w, o.h, 8); c.fill();
  c.strokeStyle = 'rgba(47,212,192,0.6)';
  c.lineWidth = 2;
  c.stroke();
  c.fillStyle = '#16262a';
  for (let i = 0; i < 6; i++) rr(c, o.x + 8, o.y + 8 + i * 18, o.w - 16, 12, 3), c.fill();
  // musgo encima
  c.fillStyle = '#3f8a4f';
  c.beginPath(); c.ellipse(o.x + 18, o.y + 6, 20, 9, 0, 0, Math.PI * 2); c.fill();
}

function pillar(c: CanvasRenderingContext2D, o: Box): void {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath(); c.arc(cx + 6, cy + 8, o.w / 2 + 2, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#c9d6d8';
  c.beginPath(); c.arc(cx, cy, o.w / 2, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#2fd4c0';
  c.lineWidth = 3;
  c.beginPath(); c.arc(cx, cy, o.w / 2 - 6, 0, Math.PI * 2); c.stroke();
  // hiedra
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9;
    c.fillStyle = i % 2 ? '#3f9a55' : '#5fbf5a';
    c.beginPath(); c.ellipse(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18, 8, 5, a, 0, Math.PI * 2); c.fill();
  }
}

// ───────────── partes animadas del aula ─────────────

function wrapLines(c: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (c.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else cur = t;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && c.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

function holoScreen(c: CanvasRenderingContext2D, t: number, s: ScreenInfo): void {
  const x = 700, y = 26, w = 1000, h = 168;
  // marco
  c.fillStyle = '#0c1a1d';
  rr(c, x - 10, y - 8, w + 20, h + 16, 18); c.fill();
  c.strokeStyle = '#2fd4c0';
  c.lineWidth = 3;
  c.stroke();
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(16,58,60,0.97)');
  g.addColorStop(1, 'rgba(8,30,34,0.97)');
  c.fillStyle = g;
  rr(c, x, y, w, h, 12); c.fill();
  // líneas de barrido
  c.fillStyle = 'rgba(95,232,255,0.05)';
  for (let ly = y + ((t * 30) % 6); ly < y + h; ly += 6) c.fillRect(x, ly, w, 1.5);
  const sweep = y + ((t * 60) % (h + 60)) - 30;
  const sg = c.createLinearGradient(0, sweep - 30, 0, sweep + 30);
  sg.addColorStop(0, 'rgba(95,232,255,0)');
  sg.addColorStop(0.5, 'rgba(95,232,255,0.08)');
  sg.addColorStop(1, 'rgba(95,232,255,0)');
  c.fillStyle = sg;
  c.fillRect(x, Math.max(y, sweep - 30), w, 60);

  // QR para entrar
  let left = x + 24;
  if (s.qr && s.qr.complete && s.qr.naturalWidth) {
    c.fillStyle = '#fff';
    rr(c, left - 4, y + 12, h - 16, h - 16, 8); c.fill();
    c.drawImage(s.qr, left, y + 16, h - 24, h - 24);
    left += h + 4;
  }
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  if (s.banner) {
    c.fillStyle = '#f2a93b';
    c.font = '700 22px "Space Grotesk", sans-serif';
    c.fillText(`📢 ${s.banner.name.toUpperCase()}`, left, y + 40);
    c.fillStyle = '#fff4dd';
    c.font = '600 30px "Space Grotesk", sans-serif';
    wrapLines(c, s.banner.text, x + w - left - 30, 3).forEach((l, i) => c.fillText(l, left, y + 80 + i * 34));
    return;
  }
  c.fillStyle = '#5fe8ff';
  c.font = '600 20px "JetBrains Mono", monospace';
  c.fillText('SALA DE ESPERA', left, y + 40);
  c.fillStyle = '#e3efec';
  c.font = '700 36px "Space Grotesk", sans-serif';
  c.fillText(wrapLines(c, s.title, 400, 1)[0] ?? '', left, y + 84);
  c.fillStyle = '#8aa6a1';
  c.font = '500 20px "JetBrains Mono", monospace';
  c.fillText(s.url, left, y + 118);
  c.fillText(`${s.online} conectado${s.online === 1 ? '' : 's'}`, left, y + 148);
  // código grande
  c.textAlign = 'right';
  c.fillStyle = '#8aa6a1';
  c.font = '600 16px "JetBrains Mono", monospace';
  c.fillText('CÓDIGO', x + w - 30, y + 46);
  c.fillStyle = '#2fd4c0';
  c.shadowColor = 'rgba(47,212,192,0.8)';
  c.shadowBlur = 18;
  c.font = '700 84px "JetBrains Mono", monospace';
  c.fillText(s.code, x + w - 26, y + 118);
  c.shadowBlur = 0;
  const d = new Date();
  c.fillStyle = '#f2a93b';
  c.font = '600 22px "JetBrains Mono", monospace';
  c.fillText(`${String(d.getHours()).padStart(2, '0')}${d.getSeconds() % 2 ? ':' : ' '}${String(d.getMinutes()).padStart(2, '0')}`, x + w - 30, y + 148);
}

/** pantalla del temporizador, a la derecha de la pizarra (aparece al ponerlo) */
let timerShownAt = -1;
function timerScreen(c: CanvasRenderingContext2D, t: number, nowMs: number, tm: ScreenInfo['timer']): void {
  if (!tm) { timerShownAt = -1; return; }
  if (timerShownAt < 0) timerShownAt = nowMs;
  const on = Math.min(1, (nowMs - timerShownAt) / 450);
  const x = 1740, y = 26, w = 420, h = 168;
  const left = tm.left;
  const frac = tm.total > 0 ? Math.max(0, Math.min(1, left / tm.total)) : 0;
  const done = left <= 0;
  const urgent = !done && left <= 60_000;
  const col = done ? '#ff6b5a' : urgent ? '#ff8a5a' : frac < 0.25 ? '#f2a93b' : '#2fd4c0';
  const flash = done ? (Math.floor(t * 3) % 2 === 0 ? 1 : 0.35) : urgent ? 0.6 + 0.4 * Math.abs(Math.sin(t * 4)) : 1;
  c.save();
  // encendido: se despliega en vertical
  c.translate(x + w / 2, y + h / 2);
  c.scale(1, 0.05 + 0.95 * on);
  c.translate(-(x + w / 2), -(y + h / 2));
  c.fillStyle = '#0c1a1d';
  rr(c, x - 10, y - 8, w + 20, h + 16, 18); c.fill();
  c.strokeStyle = col;
  c.lineWidth = 3;
  c.stroke();
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(16,40,44,0.97)');
  g.addColorStop(1, 'rgba(8,24,28,0.97)');
  c.fillStyle = g;
  rr(c, x, y, w, h, 12); c.fill();
  c.fillStyle = 'rgba(95,232,255,0.05)';
  for (let ly = y + ((t * 30) % 6); ly < y + h; ly += 6) c.fillRect(x, ly, w, 1.5);
  // anillo de progreso
  const cx = x + 84, cy = y + h / 2, r = 58;
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(255,255,255,0.08)';
  c.lineWidth = 12;
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = col;
  c.shadowColor = col;
  c.shadowBlur = 14;
  c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); c.stroke();
  c.shadowBlur = 0;
  c.lineCap = 'butt';
  // reloj de arena / icono
  c.fillStyle = col;
  c.font = '34px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(done ? '⏰' : tm.paused ? '❚❚' : '⏳', cx, cy + 2);
  // texto
  const tx = x + 170;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#8aa6a1';
  c.font = '600 18px "JetBrains Mono", monospace';
  c.fillText((tm.label || 'TEMPORIZADOR').toUpperCase().slice(0, 22), tx, y + 40);
  const secs = Math.ceil(left / 1000);
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  const txt = done ? '¡TIEMPO!' : mm >= 60 ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  c.globalAlpha = done || urgent ? flash : 1;
  c.fillStyle = col;
  c.shadowColor = col;
  c.shadowBlur = 20;
  c.font = `700 ${done ? 46 : mm >= 60 ? 58 : 82}px "JetBrains Mono", monospace`;
  c.fillText(txt, tx - 4, y + 118);
  c.shadowBlur = 0;
  c.globalAlpha = 1;
  if (tm.paused && !done) {
    c.fillStyle = '#f2a93b';
    c.font = '600 17px "JetBrains Mono", monospace';
    c.fillText('EN PAUSA', tx, y + 150);
  }
  c.restore();
}

function danceFloor(c: CanvasRenderingContext2D, t: number, dancers: number): void {
  const k = 0.35 + Math.min(1, dancers / 3) * 0.65;
  for (let i = 0; i < 3; i++) {
    const r = ((t * 70 + i * 50) % 150) + 4;
    c.strokeStyle = `rgba(47,212,192,${(0.35 * (1 - r / 154) * k).toFixed(3)})`;
    c.lineWidth = 3;
    c.beginPath(); c.arc(DANCE.x, DANCE.y, r, 0, Math.PI * 2); c.stroke();
  }
  if (dancers > 0) {
    const cols = ['255,107,214', '95,232,255', '242,169,59', '143,209,79'];
    for (let i = 0; i < 4; i++) {
      const a = t * 1.3 + (i * Math.PI) / 2;
      const lx = DANCE.x + Math.cos(a) * 80;
      const ly = DANCE.y + Math.sin(a) * 60;
      const g = c.createRadialGradient(lx, ly, 2, lx, ly, 90);
      g.addColorStop(0, `rgba(${cols[i]},0.32)`);
      g.addColorStop(1, `rgba(${cols[i]},0)`);
      c.fillStyle = g;
      c.beginPath(); c.arc(lx, ly, 90, 0, Math.PI * 2); c.fill();
    }
  }
}

function ambient(c: CanvasRenderingContext2D, t: number): void {
  // brillo del agua
  const p = OBSTACLES.find((o) => o.kind === 'pond')!;
  c.strokeStyle = 'rgba(200,255,250,0.25)';
  c.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const ph = (t * 0.6 + i * 0.25) % 1;
    const cx = p.x + 80 + i * 70;
    const cy = p.y + 40 + (i % 2) * 40;
    c.globalAlpha = 1 - ph;
    c.beginPath(); c.ellipse(cx, cy, 6 + ph * 26, 3 + ph * 12, 0, 0, Math.PI * 2); c.stroke();
  }
  c.globalAlpha = 1;
  // pez naranja
  const fx = p.x + p.w / 2 + Math.cos(t * 0.7) * 120;
  const fy = p.y + p.h / 2 + Math.sin(t * 1.4) * 22;
  const fa = Math.atan2(Math.cos(t * 1.4) * 1.4 * 22, -Math.sin(t * 0.7) * 0.7 * 120);
  c.save(); c.translate(fx, fy); c.rotate(fa);
  c.fillStyle = '#f2a93b';
  c.beginPath(); c.ellipse(0, 0, 10, 5, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.moveTo(-8, 0); c.lineTo(-16, -6); c.lineTo(-16, 6); c.fill();
  c.restore();
  // leds de los racks
  for (const o of OBSTACLES) {
    if (o.kind !== 'rack') continue;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
      const on = Math.sin(t * (2 + j) + i * 1.7 + o.y) > 0.2;
      c.fillStyle = on ? (j === 2 ? '#f2a93b' : '#2fd4c0') : '#163034';
      c.fillRect(o.x + 14 + j * 9, o.y + 12 + i * 18, 5, 4);
    }
  }
  // motas de polvo en la luz
  for (let i = 0; i < 46; i++) {
    const sx = (hash('d' + i) * ROOM_W + t * (6 + (i % 5) * 3)) % ROOM_W;
    const sy = WALL_TOP + ((hash('e' + i) * (ROOM_H - WALL_TOP) + Math.sin(t * 0.5 + i) * 20) % (ROOM_H - WALL_TOP - 60));
    c.fillStyle = `rgba(255,240,200,${(0.15 + 0.15 * Math.sin(t + i)).toFixed(3)})`;
    c.beginPath(); c.arc(sx, sy, 1.6 + (i % 3) * 0.6, 0, Math.PI * 2); c.fill();
  }
}

// ───────────── avatares ─────────────

function shadow(c: CanvasRenderingContext2D, x: number, y: number, rx: number, alpha = 0.35): void {
  c.fillStyle = `rgba(0,0,0,${alpha})`;
  c.beginPath(); c.ellipse(x, y, rx, rx * 0.42, 0, 0, Math.PI * 2); c.fill();
}

function android(c: CanvasRenderingContext2D, a: AvatarView, t: number, dir: number, dance: boolean): void {
  const [shell, accent, glow] = PAL[a.v % PAL.length];
  const ph = hash(a.cid) * 10;
  const walk = a.moving ? t * 12 + ph : 0;
  const bob = a.moving ? Math.abs(Math.sin(walk)) * 3 : Math.sin(t * 2 + ph) * 1.2;
  const jump = dance ? Math.abs(Math.sin(t * 7)) * 16 : 0;
  shadow(c, a.x, a.y + 2, 18 - jump * 0.3);
  c.save();
  c.translate(a.x, a.y - jump);
  if (dance) c.rotate(Math.sin(t * 7) * 0.25);
  c.scale(dir, 1);
  // piernas
  const l1 = Math.sin(walk) * 5;
  c.fillStyle = accent;
  rr(c, -10, -16 + Math.max(0, l1) * 0.3, 7, 16, 3); c.fill();
  rr(c, 3, -16 + Math.max(0, -l1) * 0.3, 7, 16, 3); c.fill();
  // cuerpo
  c.translate(0, -bob);
  c.fillStyle = shell;
  rr(c, -15, -40, 30, 26, 9); c.fill();
  c.fillStyle = 'rgba(0,0,0,0.15)';
  rr(c, -15, -22, 30, 8, 5); c.fill();
  c.fillStyle = glow;
  c.beginPath(); c.arc(0, -29, 4 + Math.sin(t * 3 + ph) * 1, 0, Math.PI * 2); c.fill();
  // brazos
  const arm = dance ? Math.sin(t * 14) * 1.2 - 1.6 : a.moving ? Math.sin(walk) * 0.6 : Math.sin(t * 1.5 + ph) * 0.08;
  for (const s of [-1, 1]) {
    c.save();
    c.translate(s * 16, -36);
    c.rotate(s * (dance ? arm : arm * s));
    c.fillStyle = shell;
    rr(c, -3.5, 0, 7, 17, 3.5); c.fill();
    c.fillStyle = accent;
    c.beginPath(); c.arc(0, 18, 4, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  // cabeza (tres modelos según la variante)
  const model = a.v % 3;
  c.fillStyle = shell;
  if (model === 0) { rr(c, -17, -66, 34, 26, 11); c.fill(); }
  else if (model === 1) { c.beginPath(); c.arc(0, -54, 16, 0, Math.PI * 2); c.fill(); }
  else { rr(c, -19, -64, 38, 24, 5); c.fill(); c.fillStyle = accent; c.fillRect(-21, -58, 4, 10); c.fillRect(17, -58, 4, 10); }
  // visor
  c.fillStyle = '#0d1a1d';
  rr(c, -12, -60, 26, 12, 6); c.fill();
  const blink = (t + ph) % 4 < 0.12;
  c.fillStyle = glow;
  c.shadowColor = glow;
  c.shadowBlur = 8;
  if (blink) c.fillRect(-6, -54, 16, 2);
  else if (a.v % 2) { c.beginPath(); c.arc(-1, -54, 3, 0, Math.PI * 2); c.arc(8, -54, 3, 0, Math.PI * 2); c.fill(); }
  else { rr(c, -6, -56, 16, 5, 2.5); c.fill(); }
  c.shadowBlur = 0;
  // antena
  c.strokeStyle = accent;
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(4, -66); c.lineTo(8, -78); c.stroke();
  c.fillStyle = Math.sin(t * 4 + ph) > 0 ? glow : accent;
  c.beginPath(); c.arc(8, -79, 3.5, 0, Math.PI * 2); c.fill();
  c.restore();
}

function drone(c: CanvasRenderingContext2D, a: AvatarView, t: number, dir: number, dance: boolean): void {
  const [shell, accent, glow] = PAL[a.v % PAL.length];
  const ph = hash(a.cid) * 10;
  const hgt = 34 + Math.sin(t * 2.6 + ph) * 5 + (dance ? Math.abs(Math.sin(t * 6)) * 18 : 0);
  shadow(c, a.x, a.y + 2, 20 - hgt * 0.15, 0.25);
  c.save();
  c.translate(a.x, a.y - hgt);
  const tilt = a.moving ? 0.18 * dir : 0;
  c.rotate(tilt + (dance ? t * 8 : 0));
  const quad = a.v % 2 === 0;
  const arms: [number, number][] = quad ? [[-22, -12], [22, -12], [-22, 12], [22, 12]] : [[-26, 0], [26, 0]];
  c.strokeStyle = accent;
  c.lineWidth = 4;
  for (const [ax, ay] of arms) { c.beginPath(); c.moveTo(0, 0); c.lineTo(ax, ay); c.stroke(); }
  for (const [ax, ay] of arms) {
    c.fillStyle = 'rgba(200,240,240,0.18)';
    c.beginPath(); c.ellipse(ax, ay, 13, 6, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(230,255,255,0.7)';
    c.lineWidth = 1.5;
    const sp = t * 40 + ax;
    c.beginPath(); c.moveTo(ax - Math.cos(sp) * 12, ay - Math.sin(sp) * 5); c.lineTo(ax + Math.cos(sp) * 12, ay + Math.sin(sp) * 5); c.stroke();
    c.fillStyle = accent;
    c.beginPath(); c.arc(ax, ay, 3, 0, Math.PI * 2); c.fill();
  }
  // cuerpo
  c.fillStyle = shell;
  c.beginPath(); c.ellipse(0, 0, 17, 12, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.beginPath(); c.ellipse(0, 4, 15, 7, 0, 0, Math.PI); c.fill();
  // ojo/cámara
  c.fillStyle = '#0d1a1d';
  c.beginPath(); c.arc(6 * dir, 1, 6.5, 0, Math.PI * 2); c.fill();
  c.fillStyle = glow;
  c.shadowColor = glow;
  c.shadowBlur = 10;
  c.beginPath(); c.arc(7 * dir, 1, 3, 0, Math.PI * 2); c.fill();
  c.shadowBlur = 0;
  // luz de navegación
  c.fillStyle = Math.sin(t * 5 + ph) > 0.6 ? '#ff6b5a' : 'rgba(255,107,90,0.3)';
  c.beginPath(); c.arc(-10 * dir, -6, 2.5, 0, Math.PI * 2); c.fill();
  c.restore();
  // haz de escáner bajo el dron
  c.fillStyle = `rgba(95,232,255,${(0.06 + 0.04 * Math.sin(t * 3 + ph)).toFixed(3)})`;
  c.beginPath(); c.moveTo(a.x - 6, a.y - hgt + 10); c.lineTo(a.x + 6, a.y - hgt + 10); c.lineTo(a.x + 16, a.y); c.lineTo(a.x - 16, a.y); c.fill();
}

function rc(c: CanvasRenderingContext2D, a: AvatarView, t: number, ang: number, dance: boolean): void {
  const [shell, accent, glow] = PAL[a.v % PAL.length];
  const ph = hash(a.cid) * 10;
  shadow(c, a.x, a.y + 4, 26);
  c.save();
  c.translate(a.x, a.y - 8 - (dance ? Math.abs(Math.sin(t * 8)) * 10 : 0));
  c.rotate(ang + (dance ? Math.sin(t * 8) * 0.6 : 0));
  // ruedas
  c.fillStyle = '#121c1e';
  const wob = a.moving ? Math.sin(t * 30) * 0.8 : 0;
  for (const [wx, wy] of [[-14, -16], [14, -16], [-14, 16], [14, 16]] as const) { rr(c, wx - 7, wy - 5 + wob, 14, 10, 3); c.fill(); }
  // chasis
  c.fillStyle = shell;
  rr(c, -22, -13, 44, 26, 9); c.fill();
  c.fillStyle = accent;
  rr(c, -20, -4, 40, 8, 3); c.fill();
  // cabina
  c.fillStyle = 'rgba(15,30,34,0.85)';
  rr(c, -4, -9, 16, 18, 5); c.fill();
  c.fillStyle = 'rgba(95,232,255,0.5)';
  rr(c, 2, -7, 7, 14, 3); c.fill();
  // faros
  c.fillStyle = glow;
  c.shadowColor = glow;
  c.shadowBlur = 8;
  c.beginPath(); c.arc(21, -8, 3, 0, Math.PI * 2); c.arc(21, 8, 3, 0, Math.PI * 2); c.fill();
  c.shadowBlur = 0;
  // antena con banderín
  c.strokeStyle = '#d0dcdd';
  c.lineWidth = 1.5;
  const sway = Math.sin(t * 6 + ph) * 4 - (a.moving ? 6 : 0);
  c.beginPath(); c.moveTo(-16, -8); c.lineTo(-24 + sway, -30); c.stroke();
  c.fillStyle = '#ff6b5a';
  c.beginPath(); c.moveTo(-24 + sway, -30); c.lineTo(-36 + sway * 1.3, -27); c.lineTo(-24 + sway, -23); c.fill();
  c.restore();
  // humo al moverse
  if (a.moving) {
    for (let i = 0; i < 3; i++) {
      const k = (t * 3 + i / 3) % 1;
      c.fillStyle = `rgba(200,210,210,${(0.25 * (1 - k)).toFixed(3)})`;
      c.beginPath(); c.arc(a.x - Math.cos(ang) * (26 + k * 22), a.y - Math.sin(ang) * (26 + k * 22) - 4, 4 + k * 6, 0, Math.PI * 2); c.fill();
    }
  }
}

function tree(c: CanvasRenderingContext2D, a: AvatarView, t: number, dir: number): void {
  const [leaf, dark] = TREE_PAL[a.v % TREE_PAL.length];
  const ph = hash(a.cid) * 10;
  const beat = t * 4.4 + ph;
  const sway = Math.sin(beat) * 0.22;
  const squash = 1 + Math.sin(beat * 2) * 0.06;
  const hop = Math.abs(Math.sin(beat)) * (a.moving ? 6 : 3);
  shadow(c, a.x, a.y + 2, 22);
  c.save();
  c.translate(a.x, a.y - hop);
  c.rotate(sway);
  c.scale(dir / squash, squash);
  // raíces-pies
  c.fillStyle = '#6b4a2e';
  const step = Math.sin(beat) * 5;
  rr(c, -12 + step, -6, 10, 7, 3); c.fill();
  rr(c, 2 - step, -6, 10, 7, 3); c.fill();
  // tronco
  c.fillStyle = '#8a5f3a';
  rr(c, -7, -38, 14, 36, 5); c.fill();
  c.fillStyle = '#6b4a2e';
  c.fillRect(-3, -30, 2, 18);
  // brazos-rama
  for (const s of [-1, 1]) {
    c.save();
    c.translate(s * 6, -28);
    c.rotate(s * (0.6 + Math.sin(beat * 2 + s) * 0.5) - Math.PI / 2 * s);
    c.strokeStyle = '#8a5f3a';
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 0); c.lineTo(s * 16, 0); c.stroke();
    c.fillStyle = leaf;
    c.beginPath(); c.arc(s * 19, 0, 5, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  // copa
  const blobs: [number, number, number][] = [[0, -62, 22], [-17, -50, 15], [17, -50, 15], [-10, -74, 13], [11, -74, 13]];
  c.fillStyle = dark;
  for (const [bx, by, r] of blobs) { c.beginPath(); c.arc(bx, by + 3, r, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = leaf;
  for (const [bx, by, r] of blobs) { c.beginPath(); c.arc(bx, by, r, 0, Math.PI * 2); c.fill(); }
  // flor
  c.fillStyle = '#ffd34d';
  c.beginPath(); c.arc(12, -76, 4, 0, Math.PI * 2); c.fill();
  // cara
  c.fillStyle = '#1a2a1a';
  c.beginPath(); c.arc(-5, -58, 2.6, 0, Math.PI * 2); c.arc(6, -58, 2.6, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#1a2a1a';
  c.lineWidth = 2;
  c.beginPath(); c.arc(0.5, -53, 5, 0.2, Math.PI - 0.2); c.stroke();
  c.fillStyle = 'rgba(255,140,160,0.6)';
  c.beginPath(); c.arc(-10, -53, 3, 0, Math.PI * 2); c.arc(11, -53, 3, 0, Math.PI * 2); c.fill();
  c.restore();
  // notas musicales
  const k = (t * 0.7 + ph) % 1;
  c.fillStyle = `rgba(242,169,59,${(1 - k).toFixed(3)})`;
  c.font = '18px sans-serif';
  c.textAlign = 'center';
  c.fillText(k < 0.5 ? '♪' : '♫', a.x + 24 + Math.sin(k * 6) * 6, a.y - 70 - k * 40);
}

// ───────────── el profe ─────────────

function professor(c: CanvasRenderingContext2D, T: TeacherView, t: number, nowMs: number): void {
  const talk = nowMs - T.talkAt;
  const wave = nowMs - T.waveAt;
  const talking = talk >= 0 && talk < 3500;
  const waving = wave >= 0 && wave < 2200;
  const lookDir = T.look ? Math.max(-1, Math.min(1, (T.look.x - TEACHER.x) / 500)) : Math.sin(t * 0.35) * 0.6;
  const S = SPR * 1.18;
  c.save();
  c.translate(TEACHER.x, TEACHER.y);
  c.scale(S, S);
  const bob = Math.sin(t * 1.8) * 1.2;
  // sombra y halo de «profe»
  const halo = c.createRadialGradient(0, -40, 4, 0, -40, 70);
  halo.addColorStop(0, 'rgba(242,169,59,0.22)');
  halo.addColorStop(1, 'rgba(242,169,59,0)');
  c.fillStyle = halo;
  c.beginPath(); c.arc(0, -40, 70, 0, Math.PI * 2); c.fill();
  c.translate(0, -bob);
  // bata blanca
  c.fillStyle = '#f3f7f7';
  c.beginPath();
  c.moveTo(-20, -52); c.lineTo(20, -52); c.lineTo(26, 0); c.lineTo(-26, 0); c.closePath(); c.fill();
  c.fillStyle = '#2a4a4e';
  c.beginPath(); c.moveTo(-6, -52); c.lineTo(6, -52); c.lineTo(4, 0); c.lineTo(-4, 0); c.closePath(); c.fill();
  // corbata ámbar
  c.fillStyle = '#f2a93b';
  c.beginPath(); c.moveTo(-3, -50); c.lineTo(3, -50); c.lineTo(4, -30); c.lineTo(0, -25); c.lineTo(-4, -30); c.closePath(); c.fill();
  // solapas y bolsillo con boli
  c.strokeStyle = '#c9d6d8';
  c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(-6, -52); c.lineTo(-12, -36); c.moveTo(6, -52); c.lineTo(12, -36); c.stroke();
  c.fillStyle = '#d7e2e3'; c.fillRect(10, -34, 8, 6);
  c.fillStyle = '#2fd4c0'; c.fillRect(12, -39, 2, 7);
  // brazo izquierdo con la tableta holográfica
  c.fillStyle = '#f3f7f7';
  rr(c, -27, -50, 8, 24, 4); c.fill();
  const tabY = -30 + Math.sin(t * 2.2) * 1.5;
  c.fillStyle = 'rgba(47,212,192,0.3)';
  rr(c, -46, tabY - 14, 26, 18, 3); c.fill();
  c.strokeStyle = 'rgba(95,232,255,0.9)';
  c.lineWidth = 1.2;
  c.stroke();
  c.fillStyle = 'rgba(210,255,250,0.85)';
  const wl = ((t * 0.5) % 1) * 16;
  c.fillRect(-42, tabY - 10, 14, 1.6);
  c.fillRect(-42, tabY - 6, 10, 1.6);
  c.fillRect(-42, tabY - 2, wl, 1.6);
  // brazo derecho: señala la pizarra al hablar, saluda al atender
  c.save();
  c.translate(22, -48);
  let ang = 0.15 + Math.sin(t * 1.3) * 0.05;
  if (talking) ang = -2.5 + Math.sin(talk / 140) * 0.12;
  if (waving) ang = -2.7 + Math.sin(wave / 90) * 0.45;
  c.rotate(ang);
  c.fillStyle = '#f3f7f7';
  rr(c, -4, 0, 8, 24, 4); c.fill();
  c.fillStyle = '#c9d6d8';
  c.beginPath(); c.arc(0, 26, 4.5, 0, Math.PI * 2); c.fill();
  if (talking) { c.strokeStyle = '#f2a93b'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 28); c.lineTo(0, 42); c.stroke(); c.fillStyle = '#ffd34d'; c.beginPath(); c.arc(0, 43, 2.5, 0, Math.PI * 2); c.fill(); }
  c.restore();
  // cabeza
  c.save();
  c.translate(0, -66);
  c.rotate(lookDir * 0.12);
  c.fillStyle = '#d5e0e1';
  rr(c, -18, -16, 36, 30, 12); c.fill();
  c.fillStyle = '#b8c7c9';
  rr(c, -18, 6, 36, 8, 5); c.fill();
  // pantalla-cara
  c.fillStyle = '#0d1a1d';
  rr(c, -14, -11, 28, 18, 7); c.fill();
  const ex = lookDir * 3;
  const blink = (t % 5) < 0.12;
  c.fillStyle = '#ffd34d';
  c.shadowColor = '#ffd34d';
  c.shadowBlur = 8;
  if (blink) { c.fillRect(-9 + ex, -3, 7, 1.6); c.fillRect(3 + ex, -3, 7, 1.6); }
  else { c.beginPath(); c.arc(-5 + ex, -2, 2.6, 0, Math.PI * 2); c.arc(6 + ex, -2, 2.6, 0, Math.PI * 2); c.fill(); }
  c.shadowBlur = 0;
  // gafas
  c.strokeStyle = '#f2a93b';
  c.lineWidth = 1.6;
  c.beginPath(); c.arc(-5 + ex, -2, 5.5, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(6 + ex, -2, 5.5, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(0.5 + ex - 0.1, -3); c.lineTo(0.6 + ex, -3); c.stroke();
  // boca: habla
  c.fillStyle = '#ffd34d';
  const mouth = talking ? 1.5 + Math.abs(Math.sin(talk / 70)) * 3 : 1.2;
  rr(c, -4 + ex, 3, 8, mouth, 1); c.fill();
  // auriculares con micro
  c.fillStyle = '#2a4245';
  rr(c, -21, -8, 5, 12, 2); c.fill();
  rr(c, 16, -8, 5, 12, 2); c.fill();
  c.strokeStyle = '#2a4245';
  c.lineWidth = 2;
  c.beginPath(); c.arc(0, -10, 19, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
  c.beginPath(); c.moveTo(-19, 2); c.quadraticCurveTo(-16, 12, -6, 10); c.stroke();
  c.fillStyle = talking ? '#ff6b5a' : '#5b6f72';
  c.beginPath(); c.arc(-6, 10, 2.2, 0, Math.PI * 2); c.fill();
  // antena con estrella
  c.strokeStyle = '#c9d6d8';
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, -16); c.lineTo(0, -26); c.stroke();
  c.fillStyle = '#ffd34d';
  c.save();
  c.translate(0, -29);
  c.rotate(t * 1.5);
  c.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 2.4 : 5.5; const a = (i / 10) * Math.PI * 2; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  c.closePath(); c.fill();
  c.restore();
  c.restore();
  c.restore();
}

/** taza de café humeante y teclado sobre la mesa del profe */
function deskProps(c: CanvasRenderingContext2D, o: Box, t: number): void {
  const mx = o.x + o.w - 70;
  const my = o.y + 22;
  c.fillStyle = '#f2a93b';
  rr(c, mx - 9, my - 10, 18, 18, 4); c.fill();
  c.strokeStyle = '#f2a93b';
  c.lineWidth = 3;
  c.beginPath(); c.arc(mx + 11, my - 1, 5, -Math.PI / 2, Math.PI / 2); c.stroke();
  c.fillStyle = '#4a2a14';
  c.beginPath(); c.ellipse(mx, my - 9, 7, 3, 0, 0, Math.PI * 2); c.fill();
  for (let i = 0; i < 3; i++) {
    const k = (t * 0.6 + i / 3) % 1;
    c.strokeStyle = `rgba(255,255,255,${(0.35 * (1 - k)).toFixed(3)})`;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(mx - 3 + i * 3, my - 12 - k * 4);
    c.quadraticCurveTo(mx + 4 + i * 3 + Math.sin(t * 3 + i) * 4, my - 20 - k * 14, mx - 2 + i * 3, my - 26 - k * 20);
    c.stroke();
  }
  // teclado holográfico
  c.fillStyle = 'rgba(47,212,192,0.25)';
  rr(c, o.x + 60, o.y + 14, 80, 22, 4); c.fill();
  c.fillStyle = 'rgba(95,232,255,0.7)';
  for (let i = 0; i < 3; i++) for (let j = 0; j < 8; j++) if (Math.sin(t * 6 + i * 3 + j) > 0.85) c.fillRect(o.x + 64 + j * 9.5, o.y + 17 + i * 6.5, 7, 4);
}

// ───────────── aura («farmear aura») ─────────────

/** intensidad 0..1: entra rápido, se mantiene y se apaga */
function auraK(e: number): number {
  if (e < 0) return 0;
  if (e < 350) return e / 350;
  if (e > AURA_MS - 600) return Math.max(0, (AURA_MS - e) / 600);
  return 1;
}

function flame(c: CanvasRenderingContext2D, t: number, ph: number, rx: number, ry: number, col: string, alpha: number): void {
  const N = 40;
  c.beginPath();
  for (let i = 0; i <= N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const up = Math.max(0, -Math.sin(ang));
    const lick = (Math.sin(ang * 7 + t * 23 + ph) + Math.sin(ang * 11 - t * 31 + ph * 2)) * 0.5;
    const r = 1 + lick * 0.12 + up * up * (0.55 + lick * 0.45);
    const x = Math.cos(ang) * rx * (1 - up * 0.35);
    const y = Math.sin(ang) * ry * r;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.closePath();
  const g = c.createRadialGradient(0, ry * 0.2, 4, 0, -ry * 0.3, ry * 1.5);
  g.addColorStop(0, `rgba(255,255,235,${alpha})`);
  g.addColorStop(0.35, `rgba(${col},${alpha * 0.8})`);
  g.addColorStop(1, `rgba(${col},0)`);
  c.fillStyle = g;
  c.fill();
}

/** detrás del avatar: llamarada dorada, onda de choque y polvo */
function auraBack(c: CanvasRenderingContext2D, a: AvatarView, t: number, e: number): void {
  const k = auraK(e);
  if (k <= 0) return;
  const ph = hash(a.cid) * 10;
  const cy = a.y - 34 * SPR;
  c.save();
  // onda de choque en el suelo al empezar
  if (e < 700) {
    const q = e / 700;
    c.strokeStyle = `rgba(255,230,140,${(0.8 * (1 - q)).toFixed(3)})`;
    c.lineWidth = 6 * (1 - q) + 1;
    c.beginPath(); c.ellipse(a.x, a.y + 2, 30 + q * 160, (30 + q * 160) * 0.4, 0, 0, Math.PI * 2); c.stroke();
  }
  // resplandor en el suelo
  const fl = c.createRadialGradient(a.x, a.y, 4, a.x, a.y, 110);
  fl.addColorStop(0, `rgba(255,214,90,${(0.45 * k).toFixed(3)})`);
  fl.addColorStop(1, 'rgba(255,214,90,0)');
  c.fillStyle = fl;
  c.beginPath(); c.ellipse(a.x, a.y, 110, 46, 0, 0, Math.PI * 2); c.fill();
  c.globalCompositeOperation = 'lighter';
  c.translate(a.x, cy);
  const pulse = 1 + Math.sin(t * 18 + ph) * 0.05;
  flame(c, t, ph, 58 * SPR * k * pulse, 62 * SPR * k * pulse, '255,170,30', 0.55 * k);
  flame(c, t * 1.3, ph + 2, 44 * SPR * k, 50 * SPR * k, '255,215,70', 0.6 * k);
  flame(c, t * 1.7, ph + 4, 30 * SPR * k, 36 * SPR * k, '255,250,190', 0.5 * k);
  c.restore();
}

/** delante del avatar: partículas que se concentran en el centro y rayos */
function auraFront(c: CanvasRenderingContext2D, a: AvatarView, t: number, e: number): void {
  const k = auraK(e);
  if (k <= 0) return;
  const ph = hash(a.cid) * 10;
  const cx = a.x;
  const cy = a.y - 34 * SPR;
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 44; i++) {
    const h1 = hash(a.cid + 'p' + i);
    const h2 = hash(a.cid + 'q' + i);
    const per = 0.45 + h1 * 0.55;
    const q = ((t + h2 * per) / per) % 1;
    const R = (110 + h1 * 90) * SPR * 0.8;
    const ang = h2 * Math.PI * 2 + q * 0.6;
    const r = R * (1 - q) * (1 - q * 0.15);
    const px = cx + Math.cos(ang) * r;
    const py = cy + Math.sin(ang) * r * 0.75;
    const tail = 14 * (1 - q) + 3;
    const alpha = Math.min(1, q * 2.2) * k;
    c.strokeStyle = i % 5 === 0 ? `rgba(255,255,255,${alpha.toFixed(3)})` : `rgba(255,${200 + (i % 3) * 20},80,${alpha.toFixed(3)})`;
    c.lineWidth = 2 + (i % 3);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px + Math.cos(ang) * tail, py + Math.sin(ang) * tail * 0.75);
    c.stroke();
  }
  // núcleo brillante
  const core = c.createRadialGradient(cx, cy, 0, cx, cy, 34 * SPR);
  core.addColorStop(0, `rgba(255,255,230,${(0.35 * k * (0.8 + 0.2 * Math.sin(t * 25))).toFixed(3)})`);
  core.addColorStop(1, 'rgba(255,230,120,0)');
  c.fillStyle = core;
  c.beginPath(); c.arc(cx, cy, 34 * SPR, 0, Math.PI * 2); c.fill();
  // rayos azulados que chisporrotean
  for (let j = 0; j < 2; j++) {
    const z = Math.sin(t * 9 + ph * 3 + j * 2.1);
    if (z < 0.55) continue;
    const seed = Math.floor(t * 12) + j * 7;
    let lx = cx + (hash(a.cid + seed) - 0.5) * 70 * SPR;
    let ly = cy - 40 * SPR + hash(a.cid + 'y' + seed) * 30;
    c.strokeStyle = `rgba(170,230,255,${(0.9 * k).toFixed(3)})`;
    c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(lx, ly);
    for (let s = 0; s < 5; s++) {
      lx += (hash(a.cid + seed + 's' + s) - 0.5) * 30;
      ly += 14 + hash(a.cid + seed + 't' + s) * 10;
      c.lineTo(lx, ly);
    }
    c.stroke();
  }
  c.restore();
}

// ───────────── dibujo completo ─────────────

/** el profe: avatar único y fijo tras su mesa */
export interface TeacherView {
  name: string;
  /** cuándo habló por última vez (ms, reloj de performance) → señala la pizarra */
  talkAt: number;
  /** cuándo atendió a alguien → saluda */
  waveAt: number;
  /** hacia dónde mira (el primero de la cola) */
  look: { x: number; y: number } | null;
}

export interface DrawOpts {
  teacher?: TeacherView;
  avatars: AvatarView[];
  fx: Fx;
  screen: ScreenInfo;
  /** destino del clic propio (marca en el suelo) */
  target?: { x: number; y: number } | null;
  labelScale?: number;
}

export function updateFacing(fx: Fx, a: AvatarView): { dir: number; ang: number } {
  let f = fx.face.get(a.cid);
  if (!f) { f = { dir: hash(a.cid) > 0.5 ? 1 : -1, ang: hash(a.cid + 'a') * Math.PI * 2, lx: a.x, ly: a.y }; fx.face.set(a.cid, f); }
  const ddx = a.x - f.lx;
  const ddy = a.y - f.ly;
  if (Math.abs(ddx) > 0.4) f.dir = ddx > 0 ? 1 : -1;
  if (Math.hypot(ddx, ddy) > 0.8) {
    const target = Math.atan2(ddy, ddx);
    let d = target - f.ang;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    f.ang += d * 0.35;
  }
  f.lx = a.x;
  f.ly = a.y;
  return f;
}

export function draw(cv: HTMLCanvasElement, view: View, nowMs: number, o: DrawOpts): void {
  const c = cv.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const t = nowMs / 1000;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#071012';
  c.fillRect(0, 0, cv.width, cv.height);
  c.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.ox * dpr, view.oy * dpr);
  const bgScale = Math.min(1.6, Math.max(0.6, view.scale * dpr));
  const bg = background(Math.round(bgScale * 4) / 4);
  c.imageSmoothingEnabled = true;
  c.drawImage(bg, 0, 0, ROOM_W, ROOM_H);
  holoScreen(c, t, o.screen);
  timerScreen(c, t, nowMs, o.screen.timer ?? null);
  const dancers = o.avatars.filter((a) => Math.hypot(a.x - DANCE.x, a.y - DANCE.y) < DANCE.r).length;
  danceFloor(c, t, dancers);
  ambient(c, t);

  // marca de destino
  if (o.target) {
    const k = (t * 2) % 1;
    c.strokeStyle = `rgba(242,169,59,${(0.9 - k * 0.7).toFixed(3)})`;
    c.lineWidth = 3;
    c.beginPath(); c.ellipse(o.target.x, o.target.y, 10 + k * 14, (10 + k * 14) * 0.45, 0, 0, Math.PI * 2); c.stroke();
  }

  // anillos bajo quien levanta la mano y bajo uno mismo
  for (const a of o.avatars) {
    if (a.hand) {
      const k = (t * 1.6) % 1;
      c.strokeStyle = `rgba(242,169,59,${(1 - k).toFixed(3)})`;
      c.lineWidth = 4;
      c.beginPath(); c.ellipse(a.x, a.y + 2, 34 + k * 44, (34 + k * 44) * 0.45, 0, 0, Math.PI * 2); c.stroke();
    }
    if (a.me) {
      c.strokeStyle = 'rgba(47,212,192,0.85)';
      c.lineWidth = 3;
      c.beginPath(); c.ellipse(a.x, a.y + 2, 36, 15, 0, 0, Math.PI * 2); c.stroke();
    }
    const jt = o.fx.joins.get(a.cid);
    if (jt && nowMs - jt < 1400) {
      const k = (nowMs - jt) / 1400;
      c.fillStyle = `rgba(95,232,255,${(0.5 * (1 - k)).toFixed(3)})`;
      c.fillRect(a.x - 34, a.y - 180 * (1 - k * 0.3), 68, 180 * (1 - k * 0.3));
    }
  }

  // el profe, tras su mesa (la mesa se vuelve a pintar delante para taparle las piernas)
  if (o.teacher) {
    professor(c, o.teacher, t, nowMs);
    const desk = OBSTACLES.find((b) => b.kind === 'console')!;
    consoleDesk(c, desk);
    deskProps(c, desk, t);
  }

  // avatares, de atrás hacia delante
  const sorted = [...o.avatars].sort((p, q) => p.y - q.y);
  for (const a of sorted) {
    const f = updateFacing(o.fx, a);
    const dance = (o.fx.dance.get(a.cid) ?? 0) > nowMs;
    const ae = nowMs - (o.fx.aura.get(a.cid) ?? -1e12);
    const aura = ae < AURA_MS;
    if (aura) auraBack(c, a, t, ae);
    // los sprites se dibujan en un sistema local con los pies en (0,0) y se agrandan
    c.save();
    c.translate(a.x, a.y);
    if (aura) {
      // tiembla y se eleva un poco mientras concentra el poder
      const k = auraK(ae);
      c.translate(Math.sin(t * 97) * 2.2 * k, Math.cos(t * 83) * 1.5 * k - 10 * k);
      c.scale(1 + 0.06 * k, 1 + 0.06 * k);
    }
    c.scale(SPR, SPR);
    const la = { ...a, x: 0, y: 0 };
    if (a.k === 'android') android(c, la, t, f.dir, dance);
    else if (a.k === 'drone') drone(c, la, t, f.dir, dance);
    else if (a.k === 'rc') rc(c, la, t, f.ang, dance);
    else tree(c, la, t, f.dir);
    c.restore();
    if (aura) auraFront(c, a, t, ae);
  }

  // ── capa de etiquetas en píxeles de pantalla (legibles en el proyector) ──
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ls = o.labelScale ?? 1;
  if (o.teacher) {
    const T = o.teacher;
    const sx = TEACHER.x * view.scale + view.ox;
    // placa con el nombre delante de la mesa (arriba taparía la pizarra)
    const sy = (TEACHER.y + 84) * view.scale + view.oy;
    c.font = `700 ${Math.round(14 * ls)}px "Space Grotesk", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const label = `★ ${T.name}`;
    const tw = c.measureText(label).width + 18 * ls;
    const g = c.createLinearGradient(sx - tw / 2, 0, sx + tw / 2, 0);
    g.addColorStop(0, '#f2a93b');
    g.addColorStop(1, '#ffd34d');
    c.fillStyle = g;
    c.shadowColor = 'rgba(242,169,59,0.7)';
    c.shadowBlur = 12;
    rr(c, sx - tw / 2, sy - 12 * ls, tw, 24 * ls, 12 * ls); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = '#1d1204';
    c.fillText(label, sx, sy + 0.5);
    const since = nowMs - T.talkAt;
    if (since >= 0 && since < 4000) {
      const k = since / 4000;
      c.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
      c.font = `${Math.round(28 * ls)}px sans-serif`;
      c.fillText('📢', sx + tw / 2 + 18 * ls, sy - 6 * ls - Math.sin(since / 120) * 3 * ls);
      c.globalAlpha = 1;
    }
  }
  const head = (a: AvatarView) => SPR * (a.k === 'drone' ? 64 : a.k === 'rc' ? 40 : a.k === 'tree' ? 92 : 84);
  for (const a of sorted) {
    const sx = a.x * view.scale + view.ox;
    const sy = (a.y - head(a)) * view.scale + view.oy;
    // nick
    c.font = `600 ${Math.round(13 * ls)}px "Space Grotesk", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const label = a.name + (a.muted ? ' 🔇' : '');
    const tw = c.measureText(label).width + 14 * ls;
    const ny = sy - 10 * ls;
    c.fillStyle = a.me ? 'rgba(242,169,59,0.92)' : 'rgba(8,20,22,0.78)';
    rr(c, sx - tw / 2, ny - 10 * ls, tw, 20 * ls, 10 * ls); c.fill();
    c.fillStyle = a.me ? '#1d1204' : '#e3efec';
    c.fillText(label, sx, ny + 0.5);
    let top = ny - 12 * ls;
    // mano levantada
    if (a.hand) {
      const bounce = Math.abs(Math.sin(t * 5 + hash(a.cid) * 6)) * 6 * ls;
      const hy = top - 22 * ls - bounce;
      c.fillStyle = '#f2a93b';
      c.shadowColor = 'rgba(242,169,59,0.9)';
      c.shadowBlur = 14;
      c.beginPath(); c.arc(sx, hy, 18 * ls, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
      c.font = `${Math.round(20 * ls)}px sans-serif`;
      c.fillText('✋', sx, hy + 1);
      c.fillStyle = '#0b1416';
      c.beginPath(); c.arc(sx + 15 * ls, hy - 13 * ls, 9 * ls, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff';
      c.font = `700 ${Math.round(11 * ls)}px "JetBrains Mono", monospace`;
      c.fillText(String(a.hand), sx + 15 * ls, hy - 12.5 * ls);
      top = hy - 22 * ls;
    }
    // emote
    const em = o.fx.emotes.get(a.cid);
    if (em && nowMs - em.at < 2600) {
      const k = (nowMs - em.at) / 2600;
      const pop = k < 0.12 ? k / 0.12 : 1;
      c.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
      c.font = `${Math.round(34 * ls * (0.6 + pop * 0.5))}px sans-serif`;
      c.fillText(EMOTES[em.e] ?? '', sx + 30 * ls, top - 4 * ls - k * 26 * ls);
      c.globalAlpha = 1;
    }
    // rótulo del aura
    const as = o.fx.aura.get(a.cid);
    if (as !== undefined && nowMs - as < 2200) {
      const k = (nowMs - as) / 2200;
      const pop = Math.min(1, k / 0.1);
      c.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
      c.font = `900 ${Math.round(22 * ls * (0.7 + pop * 0.4))}px "Space Grotesk", sans-serif`;
      c.lineWidth = 4 * ls;
      c.strokeStyle = '#5a2a00';
      const txt = '+9000 AURA';
      const yy = top - 14 * ls - k * 30 * ls;
      c.strokeText(txt, sx, yy);
      c.fillStyle = '#ffd34d';
      c.fillText(txt, sx, yy);
      c.globalAlpha = 1;
      top = yy - 14 * ls;
    }
    // bocadillo de chat
    const b = o.fx.bubbles.get(a.cid);
    if (b && nowMs - b.at < 7000) {
      const k = (nowMs - b.at) / 7000;
      c.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
      c.font = `500 ${Math.round(14 * ls)}px "Space Grotesk", sans-serif`;
      const lines = wrapLines(c, b.text, 230 * ls, 3);
      const lh = 18 * ls;
      const bw = Math.max(...lines.map((l) => c.measureText(l).width)) + 20 * ls;
      const bh = lines.length * lh + 12 * ls;
      const by = top - 8 * ls - bh;
      c.fillStyle = 'rgba(240,250,248,0.96)';
      rr(c, sx - bw / 2, by, bw, bh, 10 * ls); c.fill();
      c.beginPath(); c.moveTo(sx - 7 * ls, by + bh); c.lineTo(sx, by + bh + 8 * ls); c.lineTo(sx + 7 * ls, by + bh); c.fill();
      c.fillStyle = '#10201f';
      lines.forEach((l, i) => c.fillText(l, sx, by + 6 * ls + lh / 2 + i * lh));
      c.globalAlpha = 1;
    }
  }
}

/** encaja el aula entera en el lienzo */
export function fitView(w: number, h: number, pad = 0): View {
  const scale = Math.min((w - pad * 2) / ROOM_W, (h - pad * 2) / ROOM_H);
  return { scale, ox: (w - ROOM_W * scale) / 2, oy: (h - ROOM_H * scale) / 2 };
}

/** cámara que sigue a un punto con zoom, sin salirse del aula */
export function followView(w: number, h: number, x: number, y: number, scale: number): View {
  const vw = w / scale;
  const vh = h / scale;
  let cx = vw >= ROOM_W ? ROOM_W / 2 : Math.max(vw / 2, Math.min(ROOM_W - vw / 2, x));
  let cy = vh >= ROOM_H ? ROOM_H / 2 : Math.max(vh / 2, Math.min(ROOM_H - vh / 2, y));
  if (!Number.isFinite(cx)) cx = ROOM_W / 2;
  if (!Number.isFinite(cy)) cy = ROOM_H / 2;
  return { scale, ox: w / 2 - cx * scale, oy: h / 2 - cy * scale };
}

export function toWorld(v: View, sx: number, sy: number): [number, number] {
  return [(sx - v.ox) / v.scale, (sy - v.oy) / v.scale];
}

export { WALL_TOP };
