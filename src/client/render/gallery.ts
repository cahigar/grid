// Guía visual: todos los assets procedurales del juego, animados.
import { T, type PropKind, type UnitType } from '../../sim/world/types';
import {
  HH, HW, PAL, diamond, paintBase, paintCrop, paintGround, paintProp, paintResource, paintUnit,
} from './art';

type Item = { label: string; draw: (ctx: CanvasRenderingContext2D, t: number) => void; tile?: T; h?: number };

const ground = (t: T) => (ctx: CanvasRenderingContext2D) => {
  // pequeño parche 3×3 del terreno
  for (let s = -2; s <= 2; s++) {
    for (let x = -1; x <= 1; x++) {
      const y = s - x;
      if (y < -1 || y > 1) continue;
      ctx.save();
      ctx.translate((x - y) * HW, (x + y) * HH);
      paintGround(ctx, t, x + 10, y + 10, (dx, dy) => {
        const nx = x + dx;
        const ny = y + dy;
        if (t === T.AGUA && (Math.abs(nx) > 1 || Math.abs(ny) > 1)) return T.HIERBA;
        if (t === T.CARRETERA && ny !== 0) return T.HIERBA;
        return t;
      }, 42);
      ctx.restore();
    }
  }
};

const prop = (k: PropKind, v = 0) => (ctx: CanvasRenderingContext2D, t: number) => {
  ctx.scale(1.15, 1.15);
  ctx.save();
  diamond(ctx, 0, 0, HW, HH);
  ctx.fillStyle = 'rgba(111,166,75,0.35)';
  ctx.fill();
  ctx.restore();
  paintProp(ctx, k, v, t, PAL.teal);
};

const unit = (k: UnitType, working = false) => (ctx: CanvasRenderingContext2D, t: number) => {
  ctx.scale(1.9, 1.9);
  ctx.save();
  diamond(ctx, 0, 0, HW, HH);
  ctx.fillStyle = 'rgba(179,173,160,0.5)';
  ctx.fill();
  ctx.restore();
  paintUnit(ctx, k, PAL.teal, t, { facing: Math.floor(t / 1500) % 4, working, moving: false, carrying: 0.6 });
};

const SECTIONS: { title: string; note: string; items: Item[] }[] = [
  {
    title: 'Robots', note: 'Pequeños, funcionales, simpáticos. Color = tipo; acento = colonia.',
    items: [
      { label: 'Dron granjero', draw: unit('granjero', true) },
      { label: 'Minero', draw: unit('minero', true) },
      { label: 'Constructor', draw: unit('constructor') },
      { label: 'Dron hacker', draw: unit('hacker', true) },
      { label: 'Aspersor', draw: (c, t) => { c.scale(1.4, 1.4); unit('aspersor', true)(c, t); } },
    ],
  },
  {
    title: 'Infraestructura', note: 'Formas industriales limpias, blanco técnico, teal y ámbar.',
    items: [
      { label: 'Centro operativo', draw: (c, t) => { c.save(); c.scale(0.62, 0.62); paintBase(c, PAL.teal, t); c.restore(); }, h: 1 },
      { label: 'Almacén', draw: prop('almacen') },
      { label: 'Paneles solares', draw: prop('panel_solar') },
      { label: 'Silo', draw: prop('silo') },
      { label: 'Invernadero', draw: prop('invernadero') },
      { label: 'Antena', draw: prop('antena') },
    ],
  },
  {
    title: 'Edificios de la colonia', note: 'Lo que levanta el constructor para ganar puntos: tecnología limpia y vegetación.',
    items: [
      { label: 'Vivienda modular', draw: prop('casa') },
      { label: 'Taller', draw: prop('taller') },
      { label: 'Aerogenerador', draw: prop('aerogenerador') },
      { label: 'Laboratorio', draw: prop('laboratorio') },
      { label: 'Torre verde', draw: prop('torre_verde') },
    ],
  },
  {
    title: 'Naturaleza', note: 'Verde abundante, luz cálida desde el noroeste.',
    items: [
      { label: 'Árbol', draw: prop('arbol', 1) },
      { label: 'Árbol grande', draw: prop('arbol_grande', 2) },
      { label: 'Pino', draw: prop('pino', 0) },
      { label: 'Arbusto', draw: prop('arbusto', 1) },
      { label: 'Flores', draw: prop('flores', 1) },
      { label: 'Roca con musgo', draw: prop('roca', 2) },
    ],
  },
  {
    title: 'Ruinas del viejo mundo', note: 'La naturaleza atraviesa lo humano.',
    items: [
      { label: 'Torre', draw: prop('torre_ruina', 0) },
      { label: 'Bloque', draw: prop('bloque_ruina', 1) },
      { label: 'Muro', draw: prop('muro_ruina', 1) },
      { label: 'Coche abandonado', draw: prop('coche', 0) },
      { label: 'Farola', draw: prop('farola') },
      { label: 'Cascada', draw: (c, t) => { ground(T.AGUA)(c); paintProp(c, 'cascada', 0, t); } },
    ],
  },
  {
    title: 'Recursos', note: 'Visibles sólo tras escanear. Calidad ★ brilla.',
    items: (['hierro', 'cobre', 'silicio', 'chatarra'] as const).map((k) => ({
      label: k[0].toUpperCase() + k.slice(1),
      draw: (c: CanvasRenderingContext2D, t: number) => { c.save(); diamond(c, 0, 0, HW, HH); c.fillStyle = 'rgba(111,166,75,0.35)'; c.fill(); c.restore(); paintResource(c, k, 3, 1, t); },
    })),
  },
  {
    title: 'Terreno', note: 'Cada terreno tiene su coste de movimiento: los algoritmos importan.',
    items: [
      { label: 'Hierba · 2 s', draw: ground(T.HIERBA) },
      { label: 'Maleza · 3,5 s', draw: ground(T.MALEZA) },
      { label: 'Carretera · 1,2 s', draw: ground(T.CARRETERA) },
      { label: 'Hormigón · 1,5 s', draw: ground(T.HORMIGON) },
      { label: 'Agua · bloquea', draw: ground(T.AGUA) },
      { label: 'Camino · 1 s', draw: ground(T.CAMINO) },
      { label: 'Huerto (cultivo maduro)', draw: (c, t) => { ground(T.CULTIVO)(c); for (const [x, y] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) { c.save(); c.translate((x - y) * HW, (x + y) * HH); paintCrop(c, x === 0 && y === 0 ? 100 : 30 + (x + 2) * 20, 60, true, t, x, y); c.restore(); } } },
    ],
  },
];

export const SWATCHES: [string, string][] = [
  ['Vegetación', '#6fa64b'], ['Bosque', '#3d6f33'], ['Teal', PAL.teal], ['Agua', PAL.water], ['Acero', PAL.steel],
  ['Hormigón', '#b3ada0'], ['Blanco técnico', PAL.tech], ['Ámbar', PAL.amber], ['Neón (acento)', '#5fe8ff'], ['UI', '#0b1416'],
];

export function drawGallery(canvas: HTMLCanvasElement, t: number): number {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth;
  const cols = Math.max(2, Math.floor(W / 150));
  const cellW = W / cols;
  const cellH = 170;
  let rows = 0;
  for (const s of SECTIONS) rows += Math.ceil(s.items.length / cols);
  const H = rows * cellH + SECTIONS.length * 52 + 70;
  if (canvas.height !== Math.round(H * dpr) || canvas.width !== Math.round(W * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = `${H}px`;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  // paleta
  let y = 8;
  const sw = W / SWATCHES.length;
  SWATCHES.forEach(([name, col], i) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect(i * sw + 4, y, sw - 8, 26, 6);
    ctx.fill();
    ctx.fillStyle = '#8aa6a1';
    ctx.font = '11px "Space Grotesk", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, i * sw + sw / 2, y + 42);
  });
  y += 62;
  for (const s of SECTIONS) {
    ctx.textAlign = 'left';
    ctx.fillStyle = PAL.amber;
    ctx.font = '600 12px "Space Grotesk", system-ui, sans-serif';
    ctx.fillText(s.title.toUpperCase(), 6, y + 18);
    ctx.fillStyle = '#8aa6a1';
    ctx.font = '12px "Space Grotesk", system-ui, sans-serif';
    ctx.fillText(s.note, 6, y + 36);
    y += 52;
    s.items.forEach((it, i) => {
      const cx = (i % cols) * cellW + cellW / 2;
      const cy = y + Math.floor(i / cols) * cellH + 115;
      ctx.save();
      ctx.translate(cx, cy);
      it.draw(ctx, t + i * 400);
      ctx.restore();
      ctx.fillStyle = '#e3efec';
      ctx.font = '12px "Space Grotesk", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(it.label, cx, cy + 42);
    });
    y += Math.ceil(s.items.length / cols) * cellH;
  }
  return H;
}
