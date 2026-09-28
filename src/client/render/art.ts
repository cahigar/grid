// Arte procedural: todo se pinta por código (suelo, naturaleza, ruinas, edificios, robots).
// Convención: (0,0) = centro de la casilla en el suelo, unidades en píxeles a zoom 1.
import { hash2 } from '../../sim/world/rng';
import { T, type PropKind, type ResKind, type UnitType } from '../../sim/world/types';

export const TW = 64;
export const TH = 32;
export const HW = TW / 2;
export const HH = TH / 2;

type C = CanvasRenderingContext2D;

// ───────── paleta ─────────
export const PAL = {
  grass: ['#6fa64b', '#73a94e', '#6ca449', '#77ac50'],
  grassDark: '#4f8a3a',
  grassLight: '#9cc85e',
  moss: ['#62923f', '#669541', '#5e8e3c'],
  forest: '#3d6f33',
  road: '#5d6468',
  roadDark: '#454b4f',
  roadLine: '#d9c37e',
  concrete: ['#b3ada0', '#aaa497', '#bab4a7'],
  concreteDark: '#8e897d',
  water: '#2f8fa6',
  waterShallow: '#4bb8c2',
  waterDeep: '#1f6f8a',
  foam: '#dff6f1',
  rock: ['#8e877b', '#a29b8f', '#6f695f'],
  soil: '#7b5b3b',
  soilDark: '#63482f',
  sprout: '#8fd14f',
  tech: '#eef2ef',
  techShade: '#c9d1ce',
  techDark: '#8e9a9c',
  teal: '#2fd4c0',
  tealDark: '#1a8f86',
  amber: '#f2a93b',
  amberDark: '#c77e1c',
  steel: '#7d8a92',
  glass: '#7fd8e0',
  fog: '#0d181b',
};

// ───────── utilidades ─────────
export function diamond(ctx: C, cx = 0, cy = 0, hw = HW, hh = HH): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
}

/** proyección de un desplazamiento en casillas (dx, dy) a pantalla */
export function iso(dx: number, dy: number): [number, number] {
  return [(dx - dy) * HW, (dx + dy) * HH];
}

function parseColor(c: string): [number, number, number] {
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/[\d.]+/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [128, 128, 128];
}

export function shade(hex: string, k: number): string {
  let [r, g, b] = parseColor(hex);
  if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = parseColor(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function jitter(hex: string, x: number, y: number, seed: number, amt = 0.06): string {
  return shade(hex, (hash2(x, y, seed) - 0.5) * 2 * amt);
}

/**
 * Caja isométrica. Base centrada en (cx, cy) del suelo, huella a×b casillas, altura h.
 * Devuelve los vértices superiores para decorar.
 */
export function isoBox(ctx: C, cx: number, cy: number, a: number, b: number, h: number, top: string, left: string, right: string, stroke?: string) {
  const [nx, ny] = iso(-a / 2, -b / 2);
  const [ex, ey] = iso(a / 2, -b / 2);
  const [sx, sy] = iso(a / 2, b / 2);
  const [wx, wy] = iso(-a / 2, b / 2);
  const P = (x: number, y: number, up = 0) => [cx + x, cy + y - up] as const;
  // cara izquierda (W-S)
  ctx.fillStyle = left;
  ctx.beginPath();
  ctx.moveTo(...P(wx, wy));
  ctx.lineTo(...P(sx, sy));
  ctx.lineTo(...P(sx, sy, h));
  ctx.lineTo(...P(wx, wy, h));
  ctx.closePath();
  ctx.fill();
  // cara derecha (S-E)
  ctx.fillStyle = right;
  ctx.beginPath();
  ctx.moveTo(...P(sx, sy));
  ctx.lineTo(...P(ex, ey));
  ctx.lineTo(...P(ex, ey, h));
  ctx.lineTo(...P(sx, sy, h));
  ctx.closePath();
  ctx.fill();
  // techo
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(...P(nx, ny, h));
  ctx.lineTo(...P(ex, ey, h));
  ctx.lineTo(...P(sx, sy, h));
  ctx.lineTo(...P(wx, wy, h));
  ctx.closePath();
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  return {
    n: P(nx, ny, h), e: P(ex, ey, h), s: P(sx, sy, h), w: P(wx, wy, h),
    sb: P(sx, sy), wb: P(wx, wy), eb: P(ex, ey),
  };
}

export function shadowEllipse(ctx: C, cx: number, cy: number, rx: number, ry: number, a = 0.28): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
  g.addColorStop(0, `rgba(20,35,25,${a})`);
  g.addColorStop(1, 'rgba(20,35,25,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ───────── suelo ─────────
export type Neighbor = (dx: number, dy: number) => T | -1;

const isWaterish = (t: T | -1) => t === T.AGUA || t === T.PUENTE_ROTO;
const isGreen = (t: T | -1) => t === T.HIERBA || t === T.MALEZA || t === T.BOSQUE || t === T.CULTIVO;

export function paintGround(ctx: C, t: T, x: number, y: number, nb: Neighbor, seed: number): void {
  const r = (k: number) => hash2(x * 7 + k, y * 13 - k, seed + k);
  ctx.save();
  diamond(ctx, 0, 0, HW + 0.6, HH + 0.3);
  ctx.clip();
  switch (t) {
    case T.HIERBA:
    case T.BOSQUE:
    case T.MALEZA:
    case T.CULTIVO:
    case T.BASE:
    case T.ESTRUCTURA: {
      const base = t === T.BOSQUE ? PAL.forest : t === T.MALEZA ? PAL.moss[Math.floor(r(1) * 3)] : PAL.grass[Math.floor(r(1) * 4)];
      ctx.fillStyle = jitter(base, x, y, seed, 0.025);
      ctx.fillRect(-HW - 2, -HH - 2, TW + 4, TH + 4);
      // manchas pictóricas
      for (let i = 0; i < 7; i++) {
        const px = (r(10 + i) - 0.5) * TW;
        const py = (r(20 + i) - 0.5) * TH;
        const rad = 5 + r(30 + i) * 10;
        ctx.fillStyle = rgba(r(40 + i) > 0.5 ? PAL.grassLight : PAL.grassDark, t === T.BOSQUE ? 0.18 : 0.13);
        ctx.beginPath();
        ctx.ellipse(px, py, rad, rad * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // briznas
      const blades = t === T.MALEZA ? 26 : 12;
      ctx.lineWidth = 1;
      for (let i = 0; i < blades; i++) {
        const px = (r(50 + i) - 0.5) * TW * 0.9;
        const py = (r(80 + i) - 0.5) * TH * 0.9;
        const hgt = t === T.MALEZA ? 3 + r(110 + i) * 5 : 2 + r(110 + i) * 3;
        ctx.strokeStyle = rgba(r(140 + i) > 0.35 ? '#a8d266' : '#3f7431', 0.55);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + (r(170 + i) - 0.5) * 3, py - hgt);
        ctx.stroke();
      }
      if (t === T.MALEZA) {
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = rgba(r(200 + i) > 0.5 ? '#c8d96a' : '#e8d58a', 0.7);
          ctx.fillRect((r(210 + i) - 0.5) * TW * 0.7, (r(220 + i) - 0.5) * TH * 0.7, 1.5, 1.5);
        }
      }
      if (t === T.CULTIVO) {
        ctx.fillStyle = PAL.soil;
        ctx.fillRect(-HW, -HH, TW, TH);
        for (let k = -3; k <= 3; k++) {
          const [ax, ay] = iso(-0.5, k / 7);
          const [bx, by] = iso(0.5, k / 7);
          ctx.strokeStyle = PAL.soilDark;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(ax, ay + 1);
          ctx.lineTo(bx, by + 1);
          ctx.stroke();
          ctx.strokeStyle = rgba('#9a7650', 0.6);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(ax, ay - 1);
          ctx.lineTo(bx, by - 1);
          ctx.stroke();
        }
        // borde de madera del bancal
        ctx.strokeStyle = rgba('#8a6440', 0.9);
        ctx.lineWidth = 2;
        diamond(ctx, 0, 0, HW - 1, HH - 0.5);
        ctx.stroke();
      }
      break;
    }
    case T.CARRETERA:
    case T.PUENTE: {
      ctx.fillStyle = jitter(PAL.road, x, y, seed, 0.05);
      ctx.fillRect(-HW - 2, -HH - 2, TW + 4, TH + 4);
      // grava y parches
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = rgba(r(300 + i) > 0.5 ? '#72797d' : '#4d5357', 0.6);
        ctx.fillRect((r(310 + i) - 0.5) * TW, (r(320 + i) - 0.5) * TH, 2, 1);
      }
      // línea central (según orientación de la carretera)
      const ew = nb(1, 0) === T.CARRETERA || nb(-1, 0) === T.CARRETERA || nb(1, 0) === T.PUENTE || nb(-1, 0) === T.PUENTE;
      const ns = nb(0, 1) === T.CARRETERA || nb(0, -1) === T.CARRETERA || nb(0, 1) === T.PUENTE || nb(0, -1) === T.PUENTE;
      ctx.strokeStyle = rgba(PAL.roadLine, 0.55);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      if (ew && !ns) { const [a1, b1] = iso(-0.5, 0); const [a2, b2] = iso(0.5, 0); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke(); }
      if (ns && !ew) { const [a1, b1] = iso(0, -0.5); const [a2, b2] = iso(0, 0.5); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke(); }
      ctx.setLineDash([]);
      // grietas con hierba
      if (r(400) > 0.35) {
        ctx.strokeStyle = '#33383b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        let px = (r(401) - 0.5) * TW * 0.8;
        let py = (r(402) - 0.5) * TH * 0.8;
        ctx.moveTo(px, py);
        for (let i = 0; i < 4; i++) {
          px += (r(403 + i) - 0.5) * 14;
          py += (r(410 + i) - 0.5) * 7;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
        for (let i = 0; i < 5; i++) {
          ctx.strokeStyle = rgba('#8cc152', 0.8);
          const gx = px + (r(420 + i) - 0.5) * 8;
          const gy = py + (r(430 + i) - 0.5) * 4;
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.lineTo(gx + (r(440 + i) - 0.5) * 3, gy - 3 - r(450 + i) * 3);
          ctx.stroke();
        }
      }
      if (t === T.PUENTE) {
        ctx.strokeStyle = rgba('#c9c3b5', 0.9);
        ctx.lineWidth = 2;
        const ewb = nb(1, 0) !== T.AGUA || nb(-1, 0) !== T.AGUA;
        if (ewb) { const [a1, b1] = iso(-0.5, -0.45); const [a2, b2] = iso(0.5, -0.45); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke(); }
        else { const [a1, b1] = iso(-0.45, -0.5); const [a2, b2] = iso(-0.45, 0.5); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke(); }
      }
      break;
    }
    case T.CAMINO: {
      // adoquines modulares puestos por los colonos, con guías luminosas
      ctx.fillStyle = '#c9c3b2';
      ctx.fillRect(-HW - 2, -HH - 2, TW + 4, TH + 4);
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          const [cx2, cy2] = iso(-0.33 + a * 0.33, -0.33 + b * 0.33);
          ctx.fillStyle = (a + b + x + y) % 2 ? '#d6d0bf' : '#bfb9a8';
          diamond(ctx, cx2, cy2, HW / 3 - 1.2, HH / 3 - 0.6);
          ctx.fill();
        }
      }
      ctx.strokeStyle = rgba(PAL.teal, 0.55);
      ctx.lineWidth = 1;
      diamond(ctx, 0, 0, HW - 2, HH - 1);
      ctx.stroke();
      break;
    }
    case T.HORMIGON: {
      ctx.fillStyle = jitter(PAL.concrete[Math.floor(r(1) * 3)], x, y, seed, 0.04);
      ctx.fillRect(-HW - 2, -HH - 2, TW + 4, TH + 4);
      // losas
      ctx.strokeStyle = rgba('#7d786d', 0.45);
      ctx.lineWidth = 1;
      const [a1, b1] = iso(0, -0.5); const [a2, b2] = iso(0, 0.5);
      const [c1, d1] = iso(-0.5, 0); const [c2, d2] = iso(0.5, 0);
      ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.moveTo(c1, d1); ctx.lineTo(c2, d2); ctx.stroke();
      // manchas de musgo y humedad
      for (let i = 0; i < 4; i++) {
        if (r(500 + i) < 0.45) continue;
        ctx.fillStyle = rgba(r(510 + i) > 0.5 ? '#6f9a45' : '#7c7a6a', 0.3);
        ctx.beginPath();
        ctx.ellipse((r(520 + i) - 0.5) * TW * 0.7, (r(530 + i) - 0.5) * TH * 0.7, 4 + r(540 + i) * 7, 2 + r(550 + i) * 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // hierba en las juntas
      for (let i = 0; i < 6; i++) {
        ctx.strokeStyle = rgba('#8cc152', 0.7);
        const f = r(560 + i) - 0.5;
        const [gx, gy] = r(570 + i) > 0.5 ? iso(0, f) : iso(f, 0);
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + 1, gy - 3);
        ctx.stroke();
      }
      break;
    }
    case T.AGUA:
    case T.PUENTE_ROTO: {
      const shoreN = [nb(0, -1), nb(-1, 0), nb(1, 0), nb(0, 1)].filter((n) => n !== -1 && !isWaterish(n) && n !== T.PUENTE).length;
      const g = ctx.createLinearGradient(-HW, -HH, HW, HH);
      g.addColorStop(0, shoreN ? PAL.waterShallow : PAL.water);
      g.addColorStop(1, shoreN > 1 ? PAL.water : PAL.waterDeep);
      ctx.fillStyle = g;
      ctx.fillRect(-HW - 2, -HH - 2, TW + 4, TH + 4);
      // reflejos del cielo
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = rgba('#bfeff0', 0.18);
        ctx.lineWidth = 1;
        const px = (r(600 + i) - 0.5) * TW * 0.7;
        const py = (r(610 + i) - 0.5) * TH * 0.7;
        ctx.beginPath();
        ctx.moveTo(px - 5, py);
        ctx.quadraticCurveTo(px, py - 1.5, px + 5, py);
        ctx.stroke();
      }
      // orillas: talud de tierra y espuma
      const edges: [number, number, [number, number], [number, number]][] = [
        [0, -1, iso(-0.5, -0.5), iso(0.5, -0.5)],
        [-1, 0, iso(-0.5, -0.5), iso(-0.5, 0.5)],
        [1, 0, iso(0.5, -0.5), iso(0.5, 0.5)],
        [0, 1, iso(-0.5, 0.5), iso(0.5, 0.5)],
      ];
      for (const [dx, dy, a, b] of edges) {
        const n = nb(dx, dy);
        if (n === -1 || isWaterish(n) || n === T.PUENTE) continue;
        const far = dy < 0 || dx < 0; // orillas del fondo: se ve el talud
        if (far) {
          ctx.strokeStyle = rgba('#6a5a3e', 0.85);
          ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(a[0], a[1] + 1); ctx.lineTo(b[0], b[1] + 1); ctx.stroke();
          ctx.strokeStyle = rgba(isGreen(n) ? '#4f8a3a' : '#8e897d', 0.9);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(a[0], a[1] - 1); ctx.lineTo(b[0], b[1] - 1); ctx.stroke();
        }
        ctx.strokeStyle = rgba(PAL.foam, 0.55);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        const ox = far ? 0 : 0;
        const oy = far ? 4 : -1.5;
        ctx.beginPath(); ctx.moveTo(a[0] + ox, a[1] + oy); ctx.lineTo(b[0] + ox, b[1] + oy); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (t === T.PUENTE_ROTO) {
        // restos de un puente: vigas rotas
        ctx.fillStyle = '#8e897d';
        ctx.fillRect(-10, -6, 7, 3);
        ctx.fillRect(4, 2, 9, 3);
        ctx.strokeStyle = '#a0522d';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-3, -5); ctx.lineTo(1, -9); ctx.moveTo(13, 3); ctx.lineTo(16, -1); ctx.stroke();
      }
      break;
    }
    case T.RUINA:
    case T.ROCA: {
      ctx.fillStyle = t === T.RUINA ? jitter(PAL.concreteDark, x, y, seed) : jitter('#76705f', x, y, seed);
      ctx.fillRect(-HW - 2, -HH - 2, TW + 4, TH + 4);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = rgba(r(700 + i) > 0.5 ? '#9a9486' : '#5e8a3e', 0.35);
        ctx.fillRect((r(710 + i) - 0.5) * TW, (r(720 + i) - 0.5) * TH, 3, 2);
      }
      break;
    }
  }
  // transición: hierba que invade bordes de hormigón/carretera
  if (t === T.HORMIGON || t === T.CARRETERA) {
    const sides: [number, number, number, number][] = [[0, -1, 0, -0.5], [-1, 0, -0.5, 0], [1, 0, 0.5, 0], [0, 1, 0, 0.5]];
    for (const [dx, dy, fx, fy] of sides) {
      if (!isGreen(nb(dx, dy))) continue;
      for (let i = 0; i < 7; i++) {
        const f = r(800 + i + dx * 3 + dy * 5) - 0.5;
        const [px, py] = iso(fx + (dy !== 0 ? f : 0) - dx * 0.06 * r(820 + i) * 0, fy + (dx !== 0 ? f : 0));
        ctx.fillStyle = rgba(PAL.grass[i % 4], 0.8);
        ctx.beginPath();
        ctx.ellipse(px - dx * 2, py - dy * 1, 3 + r(830 + i) * 3, 1.5 + r(840 + i) * 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

export function paintFog(ctx: C, x: number, y: number, seed: number, edge: boolean): void {
  ctx.save();
  diamond(ctx, 0, 0, HW + 0.6, HH + 0.3);
  ctx.clip();
  const v = hash2(x, y, seed + 999);
  ctx.fillStyle = edge ? '#132428' : shade('#0e1a1d', (v - 0.5) * 0.12);
  ctx.fillRect(-HW - 2, -HH - 2, TW + 4, TH + 4);
  ctx.restore();
  // retícula holográfica tenue
  ctx.strokeStyle = rgba(PAL.teal, edge ? 0.12 : 0.05);
  ctx.lineWidth = 1;
  diamond(ctx, 0, 0, HW - 1, HH - 0.5);
  ctx.stroke();
  if (v > 0.93) {
    ctx.fillStyle = rgba(PAL.teal, 0.25);
    ctx.fillRect(-1, -1, 2, 2);
  }
}

export function paintGridLine(ctx: C, alpha: number): void {
  ctx.strokeStyle = `rgba(255,255,240,${alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -HH);
  ctx.lineTo(HW, 0);
  ctx.moveTo(0, -HH);
  ctx.lineTo(-HW, 0);
  ctx.stroke();
}

// ───────── vegetación ─────────
function canopy(ctx: C, cx: number, cy: number, rad: number, base: string, seed: number): void {
  // sombra interna y volumen con luz cálida desde el noroeste
  const blobs = 5;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + hash2(i, 1, seed) * 0.6;
    const d = rad * 0.45;
    const bx = cx + Math.cos(a) * d;
    const by = cy + Math.sin(a) * d * 0.7;
    const br = rad * (0.55 + hash2(i, 2, seed) * 0.25);
    ctx.fillStyle = shade(base, -0.25);
    ctx.beginPath(); ctx.arc(bx + 1.5, by + 2, br, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + hash2(i, 1, seed) * 0.6;
    const d = rad * 0.45;
    const bx = cx + Math.cos(a) * d;
    const by = cy + Math.sin(a) * d * 0.7;
    const br = rad * (0.55 + hash2(i, 2, seed) * 0.25);
    const g = ctx.createRadialGradient(bx - br * 0.4, by - br * 0.5, br * 0.1, bx, by, br);
    g.addColorStop(0, shade(base, 0.28));
    g.addColorStop(0.6, base);
    g.addColorStop(1, shade(base, -0.18));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
  }
  // toques de luz
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = rgba('#e9f7a8', 0.35);
    const px = cx - rad * 0.5 + hash2(i, 3, seed) * rad * 0.8;
    const py = cy - rad * 0.6 + hash2(i, 4, seed) * rad * 0.6;
    ctx.beginPath(); ctx.arc(px, py, 1.3, 0, Math.PI * 2); ctx.fill();
  }
}

const TREE_GREENS = ['#4f9a3c', '#5aa540', '#468f3a', '#62a847', '#3f8a44', '#6aab3e'];

function paintTree(ctx: C, v: number, big: boolean): void {
  const s = big ? 1.35 : 1;
  const seed = v * 17 + (big ? 5 : 0);
  shadowEllipse(ctx, 8, 4, 22 * s, 9 * s, 0.35);
  // tronco
  ctx.fillStyle = '#6b4a2f';
  ctx.beginPath();
  ctx.moveTo(-2.5, 2);
  ctx.lineTo(2.5, 2);
  ctx.lineTo(1.8, -14 * s);
  ctx.lineTo(-1.8, -14 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8a6440';
  ctx.fillRect(-2, -14 * s, 1.5, 15 * s);
  const base = TREE_GREENS[v % TREE_GREENS.length];
  canopy(ctx, 0, -24 * s, 14 * s, base, seed);
  if (big) canopy(ctx, 6, -34 * s, 10 * s, shade(base, 0.05), seed + 3);
}

function paintPine(ctx: C, v: number): void {
  shadowEllipse(ctx, 6, 3, 14, 6, 0.35);
  ctx.fillStyle = '#5a3f28';
  ctx.fillRect(-1.5, -8, 3, 10);
  const base = ['#2f6f45', '#3a7a48', '#2b6640'][v % 3];
  for (let i = 0; i < 4; i++) {
    const y = -10 - i * 9;
    const w = 13 - i * 2.6;
    ctx.fillStyle = shade(base, -0.15);
    ctx.beginPath(); ctx.moveTo(0, y - 13); ctx.lineTo(w + 1, y + 1); ctx.lineTo(0, y + 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(base, 0.12);
    ctx.beginPath(); ctx.moveTo(0, y - 13); ctx.lineTo(-w, y + 1); ctx.lineTo(0, y + 3); ctx.closePath(); ctx.fill();
  }
}

function paintBush(ctx: C, v: number): void {
  shadowEllipse(ctx, 3, 2, 10, 4, 0.25);
  canopy(ctx, 0, -5, 6, TREE_GREENS[(v + 2) % 6], v * 7);
  if (v % 2) {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = ['#f5d547', '#f08a9c', '#ffffff'][v % 3];
      ctx.beginPath(); ctx.arc(-4 + hash2(i, v, 1) * 8, -8 + hash2(i, v, 2) * 5, 1.2, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function paintFlowers(ctx: C, v: number): void {
  const cols = [['#f5d547', '#fff3b0'], ['#f08a9c', '#ffd1da'], ['#b9a6ff', '#ffffff'], ['#ff9f43', '#ffe0b2']][v % 4];
  for (let i = 0; i < 9; i++) {
    const px = (hash2(i, v, 11) - 0.5) * 30;
    const py = (hash2(i, v, 12) - 0.5) * 14;
    ctx.strokeStyle = '#4f8a3a';
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 3); ctx.stroke();
    ctx.fillStyle = cols[i % 2];
    ctx.beginPath(); ctx.arc(px, py - 4, 1.4, 0, Math.PI * 2); ctx.fill();
  }
}

// ───────── roca y ruinas ─────────
function paintRock(ctx: C, v: number): void {
  shadowEllipse(ctx, 6, 5, 28, 11, 0.35);
  const h = 16 + (v % 3) * 7;
  const pts = [[-26, 2], [-18, -h * 0.7], [-4, -h], [12, -h * 0.85], [26, -2], [14, 10], [-10, 11]];
  ctx.fillStyle = PAL.rock[2];
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  // caras iluminadas
  ctx.fillStyle = PAL.rock[1];
  ctx.beginPath(); ctx.moveTo(-26, 2); ctx.lineTo(-18, -h * 0.7); ctx.lineTo(-4, -h); ctx.lineTo(-2, 0); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.rock[0];
  ctx.beginPath(); ctx.moveTo(-4, -h); ctx.lineTo(12, -h * 0.85); ctx.lineTo(8, -2); ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill();
  // grietas
  ctx.strokeStyle = rgba('#4a453d', 0.6);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-12, -h * 0.4); ctx.lineTo(-6, -h * 0.2); ctx.lineTo(-8, 4); ctx.stroke();
  // musgo encima
  ctx.fillStyle = rgba('#6f9d44', 0.9);
  ctx.beginPath(); ctx.ellipse(-8, -h * 0.85, 9, 3.5, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = rgba('#9cc85e', 0.8);
  ctx.beginPath(); ctx.ellipse(-10, -h * 0.9, 4, 1.6, -0.3, 0, Math.PI * 2); ctx.fill();
  if (v % 2 === 0) {
    ctx.fillStyle = rgba('#5d8a3b', 0.85);
    ctx.beginPath(); ctx.ellipse(16, -h * 0.55, 5, 2, 0.4, 0, Math.PI * 2); ctx.fill();
  }
}

function vines(ctx: C, x0: number, y0: number, len: number, seed: number): void {
  ctx.strokeStyle = rgba('#4f8f3a', 0.9);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  let x = x0;
  let y = y0;
  ctx.moveTo(x, y);
  for (let i = 0; i < len; i++) {
    x += (hash2(i, seed, 3) - 0.5) * 3;
    y += 3;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (let i = 0; i < len; i += 2) {
    ctx.fillStyle = hash2(i, seed, 4) > 0.5 ? '#6fb04a' : '#4f8f3a';
    ctx.beginPath();
    ctx.arc(x0 + (hash2(i, seed, 5) - 0.5) * 5, y0 + i * 3, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function windows(ctx: C, from: readonly [number, number], to: readonly [number, number], h0: number, h1: number, rows: number, cols: number, seed: number): void {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const f = (c + 0.5) / cols;
      const x = from[0] + (to[0] - from[0]) * f;
      const y = from[1] + (to[1] - from[1]) * f;
      const hy = h0 + ((h1 - h0) * (r + 0.5)) / rows;
      const broken = hash2(r * 7 + c, seed, 9) > 0.7;
      ctx.fillStyle = broken ? '#3a4a3c' : '#22343a';
      ctx.fillRect(x - 2, y - hy - 3, 4, 5);
      if (!broken && hash2(r, c + seed, 10) > 0.85) {
        ctx.fillStyle = rgba('#8fe3da', 0.55);
        ctx.fillRect(x - 2, y - hy - 3, 4, 2);
      }
    }
  }
}

function paintRuinTower(ctx: C, v: number): void {
  const h = 58 + (v % 3) * 16;
  shadowEllipse(ctx, 14, 8, 34, 14, 0.35);
  const top = isoBox(ctx, 0, 0, 0.8, 0.8, h, '#c7c1b3', '#b3ad9f', '#8d887c');
  // borde superior roto
  ctx.fillStyle = '#9f998c';
  ctx.beginPath();
  ctx.moveTo(top.w[0], top.w[1]);
  ctx.lineTo(top.w[0] + 8, top.w[1] - 7);
  ctx.lineTo(top.s[0] - 4, top.s[1] - 3);
  ctx.lineTo(top.s[0], top.s[1]);
  ctx.closePath();
  ctx.fill();
  windows(ctx, top.wb, top.sb, 6, h - 8, Math.floor(h / 14), 3, v);
  windows(ctx, top.sb, top.eb, 6, h - 8, Math.floor(h / 14), 3, v + 50);
  // musgo en el techo y un árbol que crece arriba
  ctx.fillStyle = rgba('#5f9a41', 0.95);
  ctx.beginPath(); ctx.ellipse((top.n[0] + top.s[0]) / 2, (top.n[1] + top.s[1]) / 2, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
  if (v % 2 === 0) canopy(ctx, (top.n[0] + top.s[0]) / 2, (top.n[1] + top.s[1]) / 2 - 12, 9, '#58a342', v + 1);
  vines(ctx, top.w[0] + 6, top.w[1] + 4, Math.floor(h / 5), v);
  vines(ctx, top.s[0] + 10, top.s[1] + 2, Math.floor(h / 7), v + 9);
}

function paintRuinBlock(ctx: C, v: number): void {
  const h = 22 + (v % 3) * 8;
  shadowEllipse(ctx, 10, 6, 32, 12, 0.3);
  const top = isoBox(ctx, 0, 0, 0.92, 0.92, h, '#bdb7a9', '#aba597', '#86817a');
  windows(ctx, top.wb, top.sb, 6, h - 4, Math.max(1, Math.floor(h / 13)), 3, v + 3);
  windows(ctx, top.sb, top.eb, 6, h - 4, Math.max(1, Math.floor(h / 13)), 3, v + 30);
  // hierros retorcidos
  ctx.strokeStyle = '#8a4b2a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(top.n[0] + 4, top.n[1] + 6); ctx.lineTo(top.n[0] + 6, top.n[1] - 4); ctx.lineTo(top.n[0] + 10, top.n[1] - 6);
  ctx.moveTo(top.e[0] - 10, top.e[1]); ctx.lineTo(top.e[0] - 9, top.e[1] - 9);
  ctx.stroke();
  // escombros + vegetación en la azotea
  ctx.fillStyle = rgba('#6aa347', 0.95);
  ctx.beginPath(); ctx.ellipse(top.n[0] - 2, top.n[1] + 12, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
  if (v % 3 === 1) canopy(ctx, top.n[0] + 2, top.n[1] + 2, 8, '#62a847', v + 7);
  vines(ctx, top.w[0] + 5, top.w[1] + 3, Math.floor(h / 4), v + 2);
}

function paintRuinWall(ctx: C, v: number): void {
  shadowEllipse(ctx, 6, 5, 26, 10, 0.25);
  const h = 14 + (v % 2) * 8;
  isoBox(ctx, -6, -3, 0.9, 0.22, h, '#c2bcae', '#aea899', '#8b867b');
  isoBox(ctx, 10, 8, 0.25, 0.5, h * 0.6, '#c2bcae', '#aea899', '#8b867b');
  ctx.fillStyle = '#9f998c';
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(-14 + hash2(i, v, 1) * 30, 4 + hash2(i, v, 2) * 6, 4, 3);
  }
  vines(ctx, -10, -h - 2, 5, v);
  paintBush(ctx, v + 1);
}

function paintCar(ctx: C, v: number): void {
  shadowEllipse(ctx, 4, 4, 18, 7, 0.3);
  const col = ['#b5532c', '#8a6d3b', '#6e7d6a', '#9b4b3a'][v % 4];
  const axisX = v % 2 === 0;
  const box = axisX ? [0.62, 0.32] : [0.32, 0.62];
  const t = isoBox(ctx, 0, 0, box[0], box[1], 7, shade(col, 0.1), shade(col, -0.05), shade(col, -0.3));
  isoBox(ctx, (t.n[0] + t.s[0]) / 2 - (axisX ? -2 : 2), (t.n[1] + t.s[1]) / 2 + 7, box[0] * 0.55, box[1] * 0.8, 5, '#3c4a4c', shade(col, -0.1), shade(col, -0.35));
  // óxido y hierba
  ctx.fillStyle = rgba('#7a3b1d', 0.6);
  ctx.fillRect(t.w[0] + 3, t.w[1] + 2, 4, 3);
  ctx.strokeStyle = '#8cc152';
  for (let i = 0; i < 6; i++) {
    const gx = -14 + hash2(i, v, 3) * 28;
    ctx.beginPath(); ctx.moveTo(gx, 6); ctx.lineTo(gx + 1, 1); ctx.stroke();
  }
}

function paintLamp(ctx: C, _v: number, time: number): void {
  shadowEllipse(ctx, 6, 2, 6, 3, 0.25);
  ctx.strokeStyle = '#5c666b';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -34); ctx.lineTo(7, -38); ctx.stroke();
  const glow = 0.6 + Math.sin(time / 900) * 0.1;
  const g = ctx.createRadialGradient(8, -36, 0, 8, -36, 10);
  g.addColorStop(0, rgba('#ffd98a', glow));
  g.addColorStop(1, 'rgba(255,217,138,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(8, -36, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffe7b0';
  ctx.fillRect(6, -37, 4, 2);
  vines(ctx, 0, -18, 5, 7);
}

function paintBollard(ctx: C): void {
  isoBox(ctx, 0, 0, 0.12, 0.12, 8, '#dcd6c8', '#c6c0b2', '#9e998c');
  ctx.fillStyle = PAL.amber;
  ctx.fillRect(-2, -7, 4, 2);
}

// ───────── infraestructura del jugador ─────────
function paintSolar(ctx: C, time: number): void {
  shadowEllipse(ctx, 4, 6, 26, 10, 0.25);
  // patas
  ctx.strokeStyle = '#7d8a92';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-12, 4); ctx.lineTo(-12, -6); ctx.moveTo(12, 4); ctx.lineTo(12, -10); ctx.stroke();
  // panel inclinado hacia el sur
  const pts: [number, number][] = [[-26, -6], [0, -19], [26, -8], [0, 5]];
  ctx.fillStyle = '#1f4f6b';
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y - 6) : ctx.moveTo(x, y - 6))); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = PAL.tech;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // celdas
  ctx.strokeStyle = rgba('#9ad7f0', 0.35);
  ctx.lineWidth = 0.8;
  for (let i = 1; i < 4; i++) {
    const f = i / 4;
    ctx.beginPath();
    ctx.moveTo(-26 + 26 * f, -6 - 13 * f - 6); ctx.lineTo(0 + 26 * f, 5 - 13 * f - 6);
    ctx.moveTo(-26 + 26 * f, -6 + 11 * f - 6); ctx.lineTo(0 + 26 * f, -19 + 11 * f - 6);
    ctx.stroke();
  }
  // brillo que se desplaza
  const k = (Math.sin(time / 2600) + 1) / 2;
  ctx.fillStyle = rgba('#ffffff', 0.18);
  ctx.beginPath();
  ctx.moveTo(-26 + 40 * k, -12 - 8 * k);
  ctx.lineTo(-18 + 40 * k, -16 - 8 * k);
  ctx.lineTo(-8 + 40 * k, -8 - 8 * k);
  ctx.lineTo(-16 + 40 * k, -4 - 8 * k);
  ctx.closePath();
  ctx.fill();
}

function paintWarehouse(ctx: C, color: string): void {
  shadowEllipse(ctx, 10, 8, 34, 13, 0.3);
  const t = isoBox(ctx, 0, 0, 0.9, 0.9, 26, '#dfe5e2', '#cdd4d1', '#9ea9a7');
  // franjas ámbar
  ctx.strokeStyle = PAL.amber;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(t.wb[0], t.wb[1] - 20); ctx.lineTo(t.sb[0], t.sb[1] - 20); ctx.stroke();
  ctx.strokeStyle = shade(PAL.amber, -0.25);
  ctx.beginPath(); ctx.moveTo(t.sb[0], t.sb[1] - 20); ctx.lineTo(t.eb[0], t.eb[1] - 20); ctx.stroke();
  // puerta
  ctx.fillStyle = '#56636a';
  const mx = (t.wb[0] + t.sb[0]) / 2;
  const my = (t.wb[1] + t.sb[1]) / 2;
  ctx.beginPath(); ctx.moveTo(mx - 8, my - 4); ctx.lineTo(mx + 6, my + 3); ctx.lineTo(mx + 6, my - 11); ctx.lineTo(mx - 8, my - 18); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = rgba('#8a979d', 0.8);
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(mx - 8, my - 4 - i * 3.5); ctx.lineTo(mx + 6, my + 3 - i * 3.5); ctx.stroke(); }
  // techo con luz del color del jugador
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(t.e[0] - 8, t.e[1] + 2, 2, 0, Math.PI * 2); ctx.fill();
}

function paintAntenna(ctx: C, time: number): void {
  shadowEllipse(ctx, 8, 3, 14, 5, 0.25);
  ctx.strokeStyle = '#aab4b8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-8, 4); ctx.lineTo(0, -62); ctx.lineTo(8, 4);
  for (let i = 0; i < 7; i++) {
    const y = 4 - i * 9;
    const w = 8 - i * 1.1;
    ctx.moveTo(-w, y); ctx.lineTo(w - 1.1, y - 9);
    ctx.moveTo(w, y); ctx.lineTo(-w + 1.1, y - 9);
  }
  ctx.stroke();
  // plato
  ctx.fillStyle = PAL.tech;
  ctx.beginPath(); ctx.ellipse(4, -40, 7, 4, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.techShade;
  ctx.beginPath(); ctx.ellipse(5, -39, 5, 2.5, -0.5, 0, Math.PI * 2); ctx.fill();
  const on = Math.floor(time / 700) % 2 === 0;
  ctx.fillStyle = on ? '#ff5a5a' : '#6b2a2a';
  ctx.beginPath(); ctx.arc(0, -64, 2.2, 0, Math.PI * 2); ctx.fill();
  if (on) {
    ctx.fillStyle = 'rgba(255,90,90,0.25)';
    ctx.beginPath(); ctx.arc(0, -64, 6, 0, Math.PI * 2); ctx.fill();
  }
}

function paintSilo(ctx: C): void {
  shadowEllipse(ctx, 10, 6, 22, 9, 0.3);
  const r = 13;
  const h = 40;
  const g = ctx.createLinearGradient(-r, 0, r, 0);
  g.addColorStop(0, '#dfe5e2');
  g.addColorStop(0.5, '#f4f7f5');
  g.addColorStop(1, '#a9b3b1');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.5, 0, 0, Math.PI);
  ctx.lineTo(-r, -h);
  ctx.ellipse(0, -h, r, r * 0.5, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e9eeec';
  ctx.beginPath(); ctx.ellipse(0, -h, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.teal;
  ctx.fillRect(-r, -h * 0.55, 2 * r, 3);
  ctx.fillStyle = rgba('#1a8f86', 0.5);
  ctx.fillRect(-r * 0.2, -h * 0.55, r * 1.2, 3);
}

function paintGreenhouse(ctx: C): void {
  shadowEllipse(ctx, 8, 6, 30, 12, 0.25);
  isoBox(ctx, 0, 0, 0.85, 0.85, 6, '#d9dfdc', '#c7cfcc', '#a1aba9');
  ctx.fillStyle = rgba('#a8e8e6', 0.45);
  ctx.strokeStyle = rgba('#ffffff', 0.8);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, -6, 24, 12, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(i * 9, -6); ctx.quadraticCurveTo(i * 5, -20, 0, -18); ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#6fb04a' : '#8fd14f';
    ctx.beginPath(); ctx.arc(-14 + i * 5.5, -9 - (i % 3), 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = rgba('#ffffff', 0.3);
  ctx.beginPath(); ctx.ellipse(-8, -14, 6, 2.5, -0.4, 0, Math.PI * 2); ctx.fill();
}

function paintWaterfall(ctx: C, time: number): void {
  ctx.fillStyle = rgba('#e6fbff', 0.55);
  for (let i = 0; i < 5; i++) {
    const x = -10 + i * 5;
    const off = ((time / 60 + i * 7) % 12);
    ctx.fillRect(x, -22 + off, 2, 10);
  }
  ctx.fillStyle = rgba('#ffffff', 0.5);
  for (let i = 0; i < 6; i++) {
    const a = time / 300 + i;
    ctx.beginPath(); ctx.arc(Math.cos(a) * 10, 2 + Math.sin(a * 1.3) * 2, 2.5, 0, Math.PI * 2); ctx.fill();
  }
}

export const ANIMATED_PROPS = new Set<PropKind>(['panel_solar', 'antena', 'farola', 'cascada', 'aspersor']);

export function paintProp(ctx: C, kind: PropKind, v: number, time = 0, color = PAL.teal): void {
  switch (kind) {
    case 'arbol': return paintTree(ctx, v, false);
    case 'arbol_grande': return paintTree(ctx, v, true);
    case 'pino': return paintPine(ctx, v);
    case 'arbusto': return paintBush(ctx, v);
    case 'flores': return paintFlowers(ctx, v);
    case 'roca': return paintRock(ctx, v);
    case 'torre_ruina': return paintRuinTower(ctx, v);
    case 'bloque_ruina': return paintRuinBlock(ctx, v);
    case 'muro_ruina': return paintRuinWall(ctx, v);
    case 'coche': return paintCar(ctx, v);
    case 'farola': return paintLamp(ctx, v, time);
    case 'poste': return paintBollard(ctx);
    case 'panel_solar': return paintSolar(ctx, time);
    case 'almacen': return paintWarehouse(ctx, color);
    case 'antena': return paintAntenna(ctx, time);
    case 'silo': return paintSilo(ctx);
    case 'invernadero': return paintGreenhouse(ctx);
    case 'cascada': return paintWaterfall(ctx, time);
    case 'aspersor': return paintSprinkler(ctx, color, time, 0);
    default: return;
  }
}

/** Altura aproximada del sprite (para reservar lienzo en caché) */
export function propHeight(kind: PropKind): number {
  switch (kind) {
    case 'torre_ruina': return 120;
    case 'arbol_grande': return 80;
    case 'antena': return 75;
    case 'pino': return 60;
    case 'arbol': return 50;
    case 'bloque_ruina': return 60;
    case 'silo': return 55;
    default: return 45;
  }
}

// ───────── recursos ─────────
export const RES_COLORS: Record<ResKind, string> = {
  hierro: '#d0703a',
  cobre: '#3fbf9a',
  silicio: '#9fd8ff',
  chatarra: '#9aa3a8',
  cosecha: '#e6c34f',
};

export function paintResource(ctx: C, kind: ResKind, quality: number, frac: number, time: number): void {
  ctx.save();
  ctx.scale(1.35, 1.35);
  paintResourceInner(ctx, kind, quality, frac, time);
  ctx.restore();
}

function paintResourceInner(ctx: C, kind: ResKind, quality: number, frac: number, time: number): void {
  const n = Math.max(1, Math.round(2 + frac * 3));
  const col = RES_COLORS[kind];
  shadowEllipse(ctx, 2, 3, 16, 6, 0.25);
  switch (kind) {
    case 'hierro':
    case 'cobre':
      for (let i = 0; i < n; i++) {
        const x = -10 + hash2(i, 1, 3) * 20;
        const y = -2 + hash2(i, 2, 3) * 6;
        const s = 5 + hash2(i, 3, 3) * 4;
        ctx.fillStyle = shade('#6d665c', -0.1);
        ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x - s * 0.4, y - s * 1.1); ctx.lineTo(x + s * 0.6, y - s * 0.9); ctx.lineTo(x + s, y); ctx.closePath(); ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(x - s * 0.5, y - s * 0.3); ctx.lineTo(x - s * 0.2, y - s * 0.9); ctx.lineTo(x + s * 0.4, y - s * 0.6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = shade(col, 0.4);
        ctx.fillRect(x - s * 0.2, y - s * 0.8, 1.5, 1.5);
      }
      break;
    case 'silicio':
      for (let i = 0; i < n + 1; i++) {
        const x = -8 + hash2(i, 5, 3) * 16;
        const y = 2 + hash2(i, 6, 3) * 3;
        const h = 8 + hash2(i, 7, 3) * 10;
        const lean = (hash2(i, 8, 3) - 0.5) * 6;
        const g = ctx.createLinearGradient(x, y, x + lean, y - h);
        g.addColorStop(0, '#5aa7d6');
        g.addColorStop(1, '#e8fbff');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + lean, y - h); ctx.lineTo(x + 3, y); ctx.closePath(); ctx.fill();
      }
      {
        const glow = 0.25 + Math.sin(time / 500) * 0.1;
        const g = ctx.createRadialGradient(0, -6, 0, 0, -6, 18);
        g.addColorStop(0, `rgba(160,225,255,${glow})`);
        g.addColorStop(1, 'rgba(160,225,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, -6, 18, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'chatarra':
      for (let i = 0; i < n + 1; i++) {
        const x = -12 + hash2(i, 9, 3) * 22;
        const y = -1 + hash2(i, 10, 3) * 6;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((hash2(i, 11, 3) - 0.5) * 1.2);
        ctx.fillStyle = hash2(i, 12, 3) > 0.6 ? '#b5532c' : i % 2 ? '#8b959a' : '#6f797e';
        ctx.fillRect(-5, -3, 10, 4);
        ctx.fillStyle = rgba('#ffffff', 0.25);
        ctx.fillRect(-5, -3, 10, 1);
        ctx.restore();
      }
      ctx.strokeStyle = '#555f63';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(4, -4, 4, 0, Math.PI * 2); ctx.stroke();
      break;
      break;
  }
  if (quality >= 3) {
    ctx.fillStyle = rgba('#fff6c8', 0.6 + Math.sin(time / 300) * 0.3);
    ctx.beginPath(); ctx.arc(8, -14, 1.6, 0, Math.PI * 2); ctx.fill();
  }
}

// ───────── centro operativo (2×2) ─────────
export function paintBase(ctx: C, color: string, time: number): void {
  // (0,0) = centro del bloque 2×2
  shadowEllipse(ctx, 14, 10, 70, 28, 0.35);
  // zócalo
  isoBox(ctx, 0, 0, 1.9, 1.9, 8, '#cfd6d3', '#b9c2bf', '#8f9a98');
  // cuerpo principal escalonado
  const body = isoBox(ctx, -4, -6, 1.35, 1.35, 44, '#f1f4f2', '#dde3e0', '#aeb9b7');
  // franja de vidrio
  const gy = 18;
  ctx.fillStyle = rgba('#58c9d3', 0.95);
  ctx.beginPath();
  ctx.moveTo(body.wb[0], body.wb[1] - gy); ctx.lineTo(body.sb[0], body.sb[1] - gy);
  ctx.lineTo(body.sb[0], body.sb[1] - gy - 10); ctx.lineTo(body.wb[0], body.wb[1] - gy - 10); ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba('#2f8f9a', 0.95);
  ctx.beginPath();
  ctx.moveTo(body.sb[0], body.sb[1] - gy); ctx.lineTo(body.eb[0], body.eb[1] - gy);
  ctx.lineTo(body.eb[0], body.eb[1] - gy - 10); ctx.lineTo(body.sb[0], body.sb[1] - gy - 10); ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba('#ffffff', 0.35);
  ctx.beginPath();
  ctx.moveTo(body.wb[0] + 8, body.wb[1] - gy - 2); ctx.lineTo(body.wb[0] + 22, body.wb[1] - gy + 5);
  ctx.lineTo(body.wb[0] + 22, body.wb[1] - gy + 1); ctx.lineTo(body.wb[0] + 8, body.wb[1] - gy - 6); ctx.closePath(); ctx.fill();
  // franja ámbar de maquinaria
  ctx.strokeStyle = PAL.amber;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(body.wb[0], body.wb[1] - 4); ctx.lineTo(body.sb[0], body.sb[1] - 4); ctx.stroke();
  ctx.strokeStyle = PAL.amberDark;
  ctx.beginPath(); ctx.moveTo(body.sb[0], body.sb[1] - 4); ctx.lineTo(body.eb[0], body.eb[1] - 4); ctx.stroke();
  // puerta del muelle
  ctx.fillStyle = '#3c4a50';
  const dx = (body.wb[0] + body.sb[0]) / 2;
  const dy = (body.wb[1] + body.sb[1]) / 2;
  ctx.beginPath(); ctx.moveTo(dx - 7, dy - 6); ctx.lineTo(dx + 7, dy + 1); ctx.lineTo(dx + 7, dy - 14); ctx.lineTo(dx - 7, dy - 21); ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba(color, 0.9);
  ctx.fillRect(dx - 6, dy - 22, 12, 2);
  // azotea: paneles y radar
  const cx = (body.n[0] + body.s[0]) / 2;
  const cy = (body.n[1] + body.s[1]) / 2;
  isoBox(ctx, cx - 14, cy + 2, 0.35, 0.5, 4, '#26506a', '#1f455c', '#193a4d');
  isoBox(ctx, cx - 2, cy + 8, 0.35, 0.5, 4, '#26506a', '#1f455c', '#193a4d');
  // radar giratorio
  const ang = time / 1400;
  ctx.strokeStyle = '#aab4b8';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx + 12, cy - 2); ctx.lineTo(cx + 12, cy - 16); ctx.stroke();
  ctx.save();
  ctx.translate(cx + 12, cy - 18);
  ctx.scale(Math.cos(ang), 1);
  ctx.fillStyle = PAL.tech;
  ctx.beginPath(); ctx.ellipse(0, 0, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.techShade;
  ctx.beginPath(); ctx.ellipse(1, 1, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // baliza del color del jugador
  const pulse = 0.5 + Math.sin(time / 400) * 0.5;
  const g = ctx.createRadialGradient(cx - 18, cy - 12, 0, cx - 18, cy - 12, 12);
  g.addColorStop(0, rgba(color, 0.7 * pulse + 0.2));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx - 18, cy - 12, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(cx - 18, cy - 12, 2.5, 0, Math.PI * 2); ctx.fill();
  // hiedra en una esquina (el mundo reclama incluso lo nuevo)
  vines(ctx, body.wb[0] + 3, body.wb[1] - 30, 8, 3);
}

/** marca del muelle de carga en el suelo */
export function paintDock(ctx: C, color: string, time: number): void {
  ctx.strokeStyle = rgba(color, 0.55 + Math.sin(time / 500) * 0.2);
  ctx.lineWidth = 2;
  diamond(ctx, 0, 0, HW * 0.7, HH * 0.7);
  ctx.stroke();
  ctx.strokeStyle = rgba(PAL.amber, 0.8);
  ctx.setLineDash([4, 3]);
  diamond(ctx, 0, 0, HW * 0.85, HH * 0.85);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ───────── robots ─────────
export interface UnitPaintState {
  facing: number; // 0 E, 1 S, 2 O, 3 N
  working: boolean; // extrayendo / escaneando
  moving: boolean;
  carrying: number; // 0..1
}

export function paintUnit(ctx: C, type: UnitType, color: string, time: number, st: UnitPaintState): void {
  if (type === 'base') return paintFactory(ctx, time, st.working);
  if (type === 'granjero' || type === 'hacker') return paintDrone(ctx, type, color, time, st);
  if (type === 'minero') return paintMiner(ctx, color, time, st);
  if (type === 'aspersor') return paintSprinkler(ctx, color, time, st.working ? 1 : 0);
  return paintConstructor(ctx, color, time, st);
}

/** El centro operativo lo dibuja el terreno; aquí sólo el halo de fabricación */
function paintFactory(ctx: C, time: number, working: boolean): void {
  if (!working) return;
  const k = (time % 1200) / 1200;
  ctx.strokeStyle = rgba(PAL.teal, 0.7 * (1 - k));
  ctx.lineWidth = 2;
  diamond(ctx, 0, 0, HW * (0.9 + k * 0.9), HH * (0.9 + k * 0.9));
  ctx.stroke();
}

/** Aspersor: base técnica con depósito y cabezal giratorio */
export function paintSprinkler(ctx: C, color: string, time: number, firing: number): void {
  shadowEllipse(ctx, 6, 5, 20, 8, 0.3);
  isoBox(ctx, 0, 0, 0.55, 0.55, 8, '#dfe5e2', '#cdd4d1', '#9ea9a7');
  // depósito de agua
  const g = ctx.createLinearGradient(-9, -24, 9, -10);
  g.addColorStop(0, '#9fe3f0');
  g.addColorStop(1, '#3f9fc0');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, -10, 9, 4.5, 0, 0, Math.PI);
  ctx.lineTo(-9, -22);
  ctx.ellipse(0, -22, 9, 4.5, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c8f1f7';
  ctx.beginPath(); ctx.ellipse(0, -22, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(-9, -15, 18, 2);
  // mástil y cabezal giratorio
  ctx.strokeStyle = '#7d8a92';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(0, -34); ctx.stroke();
  const a = time / (firing ? 90 : 700);
  ctx.save();
  ctx.translate(0, -35);
  ctx.scale(1, 0.5);
  ctx.rotate(a);
  ctx.strokeStyle = PAL.amber;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke();
  ctx.fillStyle = '#5fb8ff';
  ctx.beginPath(); ctx.arc(9, 0, 2.5, 0, Math.PI * 2); ctx.arc(-9, 0, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (firing) {
    for (let i = 0; i < 8; i++) {
      const k = ((time / 300 + i / 8) % 1);
      const ang = a + i;
      ctx.fillStyle = rgba('#bfefff', 1 - k);
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * 14 * k, -35 + Math.sin(ang) * 6 * k - 8 * k + 14 * k * k, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Cultivo en una parcela según madurez (0-100) y humedad */
export function paintCrop(ctx: C, mat: number, hum: number, planted: boolean, time: number, x: number, y: number): void {
  if (hum > 30) {
    ctx.fillStyle = `rgba(40,28,18,${Math.min(0.35, hum / 250)})`;
    diamond(ctx, 0, 0, HW - 3, HH - 1.5);
    ctx.fill();
    if (hum > 70) {
      ctx.fillStyle = 'rgba(190,235,255,0.35)';
      for (let i = 0; i < 3; i++) ctx.fillRect(-12 + hash2(x, y + i, 3) * 24, -4 + hash2(y, x + i, 4) * 8, 2, 1);
    }
  }
  if (!planted) return;
  const ripe = mat >= 100;
  const stage = ripe ? 1 : mat / 100;
  for (let k = -2; k <= 2; k++) {
    for (let j = 0; j < 5; j++) {
      const [ax, ay] = iso(-0.36 + j * 0.18, k / 6);
      const sway = Math.sin(time / 700 + j + k) * stage * 1.2;
      const h = 2 + stage * 11;
      ctx.strokeStyle = ripe ? '#b8962e' : shade('#6fae3c', -0.2 + stage * 0.15);
      ctx.lineWidth = 1.2 + stage;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(ax + sway, ay - h / 2, ax + sway * 1.5, ay - h);
      ctx.stroke();
      if (stage > 0.35) {
        ctx.fillStyle = ripe ? '#f0cf52' : '#8fd14f';
        ctx.beginPath();
        ctx.ellipse(ax + sway * 1.5 - 1.5, ay - h * 0.6, 2.2 * stage + 0.5, 1.2, -0.6, 0, Math.PI * 2);
        ctx.ellipse(ax + sway * 1.5 + 1.5, ay - h * 0.75, 2.2 * stage + 0.5, 1.2, 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (ripe) {
        ctx.fillStyle = '#ffe07a';
        ctx.beginPath(); ctx.ellipse(ax + sway * 1.5, ay - h - 2, 1.8, 3.2, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  if (ripe) {
    const a = 0.4 + Math.sin(time / 300 + x) * 0.3;
    ctx.fillStyle = `rgba(255,246,200,${a})`;
    ctx.beginPath(); ctx.arc(10, -18, 2, 0, Math.PI * 2); ctx.fill();
  }
}

/** Recursos sueltos en el suelo */
export function paintDrops(ctx: C, kinds: string[], n: number): void {
  shadowEllipse(ctx, 1, 2, 10, 4, 0.25);
  const m = Math.min(8, n);
  for (let i = 0; i < m; i++) {
    const kind = kinds[i % kinds.length] as ResKind;
    const px = -8 + hash2(i, n, 7) * 16;
    const py = -1 + hash2(n, i, 8) * 5;
    ctx.fillStyle = RES_COLORS[kind] ?? '#aaa';
    ctx.beginPath();
    ctx.moveTo(px - 3, py);
    ctx.lineTo(px - 1, py - 3);
    ctx.lineTo(px + 3, py - 2);
    ctx.lineTo(px + 2, py + 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(px - 1, py - 2.5, 1.5, 1);
  }
}

function paintDrone(ctx: C, type: 'granjero' | 'hacker', color: string, time: number, st: UnitPaintState): void {
  const scout = type === 'hacker';
  const hover = (scout ? 22 : 16) + Math.sin(time / 260) * 2;
  shadowEllipse(ctx, 0, 2, scout ? 12 : 14, scout ? 5 : 6, 0.35);
  ctx.save();
  ctx.translate(0, -hover);
  // brazos y rotores
  const arm = scout ? 11 : 13;
  const rot: [number, number][] = [[-arm, -arm * 0.5], [arm, -arm * 0.5], [-arm, arm * 0.5], [arm, arm * 0.5]];
  ctx.strokeStyle = '#6d7a80';
  ctx.lineWidth = 2;
  for (const [x, y] of rot) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x, y); ctx.stroke(); }
  for (const [x, y] of rot) {
    ctx.fillStyle = 'rgba(220,240,240,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y - 2, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
    const a = time / 30;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 6, y - 2 - Math.sin(a) * 2.5); ctx.lineTo(x + Math.cos(a) * 6, y - 2 + Math.sin(a) * 2.5); ctx.stroke();
    ctx.fillStyle = '#4b575c';
    ctx.beginPath(); ctx.arc(x, y - 2, 1.5, 0, Math.PI * 2); ctx.fill();
  }
  // cuerpo
  if (scout) {
    // dron hacker: carcasa grafito, visor rojo, antena de interferencia
    const g = ctx.createLinearGradient(-8, -8, 8, 6);
    g.addColorStop(0, '#5a646a');
    g.addColorStop(1, '#2a3136');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, 9, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rgba('#ff5d73', 0.85);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 1, 11, 6, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#9aa7ab';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(2, -4); ctx.lineTo(3, -10); ctx.lineTo(6, -13); ctx.stroke();
    const on = Math.floor(time / 350) % 2 === 0;
    ctx.fillStyle = on ? '#ff5d73' : '#7a2a35';
    ctx.beginPath(); ctx.arc(6, -13, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(-6, -1, 5, 1.5);
    if (st.working) {
      // ondas de hackeo
      for (let i = 0; i < 3; i++) {
        const k = ((time / 500 + i / 3) % 1);
        ctx.strokeStyle = rgba('#ff5d73', 1 - k);
        ctx.beginPath(); ctx.ellipse(0, 4, 6 + k * 22, 3 + k * 11, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
  } else {
    // dron granjero: blanco, franja verde, depósito de agua y tolva de semillas
    isoBox(ctx, 0, 4, 0.3, 0.3, 9, '#f3f6f4', '#dfe5e2', '#aab5b3');
    ctx.fillStyle = '#8fd14f';
    ctx.fillRect(-9, -2, 18, 2.5);
    ctx.fillStyle = color;
    ctx.fillRect(-9, 0.5, 18, 1.2);
    ctx.fillStyle = rgba('#6fd0f0', 0.9);
    ctx.beginPath(); ctx.ellipse(6, -6, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7d8a92';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, 11); ctx.stroke();
    ctx.fillStyle = '#5d676c';
    ctx.beginPath(); ctx.moveTo(-3, 11); ctx.lineTo(3, 11); ctx.lineTo(0, 14); ctx.closePath(); ctx.fill();
    if (st.carrying > 0) {
      ctx.fillStyle = '#e6c34f';
      ctx.beginPath(); ctx.ellipse(-5, -5, 3.5, 2 + st.carrying * 1.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (st.working) {
      for (let i = 0; i < 6; i++) {
        const k = ((time / 250 + i / 6) % 1);
        ctx.fillStyle = rgba('#9fe3f0', 1 - k);
        ctx.beginPath(); ctx.arc((i - 2.5) * 1.5 * k * 3, 14 + k * 14, 1.3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  // ojo / sensor
  const [fx, fy] = [[5, 2], [0, 4], [-5, 2], [0, -2]][st.facing];
  ctx.fillStyle = scout ? '#ff5d73' : color;
  ctx.beginPath(); ctx.arc(fx, fy - (scout ? 0 : 6), 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(fx - 0.5, fy - (scout ? 1 : 7), 1, 1);
  ctx.restore();
  if (st.working) {
    // haz del taladro / escáner
    ctx.strokeStyle = rgba(scout ? '#5fe8ff' : PAL.amber, 0.6 + Math.sin(time / 60) * 0.3);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -hover + 14); ctx.lineTo(0, 0); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = time / 120 + i * 1.6;
      ctx.fillStyle = rgba(PAL.amber, 0.8);
      ctx.fillRect(Math.cos(a) * 7, -2 + Math.sin(a) * 3 - ((time / 20 + i * 5) % 8), 1.5, 1.5);
    }
  }
}

function paintMiner(ctx: C, color: string, time: number, st: UnitPaintState): void {
  shadowEllipse(ctx, 2, 3, 20, 8, 0.4);
  const alongX = st.facing % 2 === 0;
  const a = alongX ? 0.62 : 0.4;
  const b = alongX ? 0.4 : 0.62;
  // orugas
  isoBox(ctx, 0, 0, a, b, 5, '#3f474b', '#34393c', '#272b2d');
  // chasis ámbar
  const top = isoBox(ctx, 0, -5, a * 0.9, b * 0.85, 9, '#f5b650', PAL.amber, PAL.amberDark);
  // cabina
  isoBox(ctx, alongX ? -4 : 3, -14, a * 0.35, b * 0.4, 7, '#eef2ef', '#dfe5e2', '#aab5b3');
  ctx.fillStyle = rgba('#58c9d3', 0.9);
  ctx.fillRect(alongX ? -8 : 0, -21, 7, 3);
  ctx.fillStyle = color;
  ctx.fillRect(top.w[0] + 4, top.w[1] + 2, 6, 2);
  // taladro frontal
  const dirv = [[1, 0], [0, 1], [-1, 0], [0, -1]][st.facing];
  const [tx, ty] = iso(dirv[0] * 0.45, dirv[1] * 0.45);
  const spin = st.working ? time / 25 : 0;
  ctx.save();
  ctx.translate(tx, ty - 9);
  ctx.fillStyle = '#9aa5aa';
  ctx.beginPath();
  ctx.moveTo(-4, -4);
  ctx.lineTo(4, -4);
  ctx.lineTo(tx > 0 ? 12 : -12, ty >= 0 ? 6 : -6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5d676c';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const k = ((spin + i / 3) % 1) * 0.8;
    ctx.beginPath(); ctx.moveTo(-4 + k * 10 * Math.sign(tx || 1), -4 + k * 6); ctx.lineTo(4 + k * 6 * Math.sign(tx || 1), -4 + k * 8); ctx.stroke();
  }
  ctx.restore();
  // luz de trabajo
  const on = Math.floor(time / 500) % 2 === 0;
  ctx.fillStyle = on ? '#ffd24a' : '#8a6a2a';
  ctx.beginPath(); ctx.arc(top.n[0], top.n[1] - 2, 2, 0, Math.PI * 2); ctx.fill();
  if (st.carrying > 0) {
    ctx.fillStyle = '#b5673a';
    ctx.beginPath(); ctx.ellipse(top.e[0] - 8, top.e[1] + 2, 5, 2.5 * st.carrying + 0.5, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (st.working) {
    for (let i = 0; i < 5; i++) {
      const k = (time / 200 + i * 0.2) % 1;
      ctx.fillStyle = rgba('#b89a78', 1 - k);
      ctx.beginPath(); ctx.arc(tx + (i - 2) * 3 * k, ty - 4 - k * 10, 2 * (1 - k) + 0.5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function paintConstructor(ctx: C, color: string, time: number, _st: UnitPaintState): void {
  shadowEllipse(ctx, 2, 3, 18, 7, 0.4);
  // base con ruedas
  isoBox(ctx, 0, 0, 0.5, 0.5, 6, '#4a5357', '#3c4447', '#2e3437');
  const body = isoBox(ctx, 0, -6, 0.42, 0.42, 14, '#f7f9f8', '#e7ecea', '#b3bebc');
  ctx.fillStyle = '#ef7d2d';
  ctx.fillRect(body.w[0] + 2, body.w[1] + 5, 12, 3);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(body.n[0], body.n[1] + 4, 2, 0, Math.PI * 2); ctx.fill();
  // brazo articulado
  const a1 = -1.1 + Math.sin(time / 900) * 0.25;
  const a2 = 0.9 + Math.sin(time / 700) * 0.35;
  const sx = body.e[0] - 6;
  const sy = body.e[1] + 2;
  const l1 = 18;
  const l2 = 14;
  const ex = sx + Math.cos(a1) * l1;
  const ey = sy + Math.sin(a1) * l1;
  const hx = ex + Math.cos(a1 + a2) * l2;
  const hy = ey + Math.sin(a1 + a2) * l2;
  ctx.strokeStyle = '#ef7d2d';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = '#f5f7f6';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#5d676c';
  ctx.beginPath(); ctx.arc(ex, ey, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5d676c';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(hx - 3, hy + 4); ctx.lineTo(hx, hy); ctx.lineTo(hx + 3, hy + 4); ctx.stroke();
  // chispa de soldadura
  if (Math.floor(time / 180) % 3 === 0) {
    ctx.fillStyle = '#fff4a8';
    ctx.beginPath(); ctx.arc(hx, hy + 5, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,220,120,0.3)';
    ctx.beginPath(); ctx.arc(hx, hy + 5, 6, 0, Math.PI * 2); ctx.fill();
  }
}
