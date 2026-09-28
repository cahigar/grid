// Minimapa isométrico con niebla, unidades y encuadre de cámara.
import type { Game } from '../../sim/world/game';
import { Game as G } from '../../sim/world/game';
import { T } from '../../sim/world/types';
import type { Renderer } from './renderer';

const COL: Record<number, [number, number, number]> = {
  [T.HIERBA]: [106, 162, 74], [T.CARRETERA]: [93, 100, 104], [T.HORMIGON]: [170, 164, 151], [T.MALEZA]: [85, 127, 55],
  [T.BOSQUE]: [52, 104, 48], [T.AGUA]: [47, 143, 166], [T.RUINA]: [142, 137, 125], [T.ROCA]: [122, 116, 104],
  [T.CULTIVO]: [138, 106, 58], [T.PUENTE]: [120, 120, 118], [T.BASE]: [238, 242, 239], [T.ESTRUCTURA]: [210, 214, 212],
  [T.PUENTE_ROTO]: [47, 143, 166],
};

export class Minimap {
  ctx: CanvasRenderingContext2D;
  base: HTMLCanvasElement;
  sig = '';
  W = 220;
  H = 118;

  constructor(public canvas: HTMLCanvasElement, public game: Game, public me: string, public r: Renderer) {
    this.ctx = canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = this.W * dpr;
    canvas.height = this.H * dpr;
    this.ctx.scale(dpr, dpr);
  }

  /** transforma casilla → píxel del minimapa */
  private map(x: number, y: number): [number, number] {
    const { w, h } = this.game.cfg;
    const sx = this.W / (w + h);
    const sy = this.H / (w + h);
    return [(x - y + h) * sx, (x + y) * sy];
  }

  unmap(px: number, py: number): [number, number] {
    const { w, h } = this.game.cfg;
    const a = px / (this.W / (w + h)) - h; // x - y
    const b = py / (this.H / (w + h)); // x + y
    return [(a + b) / 2, (b - a) / 2];
  }

  private rebuild(): void {
    const { w, h } = this.game.cfg;
    const img = new ImageData(w, h);
    const pl = this.game.player(this.me)!;
    for (let i = 0; i < w * h; i++) {
      if (pl.known[i]) {
        const c = COL[this.game.terrain[i]] ?? [100, 100, 100];
        img.data.set([c[0], c[1], c[2], 255], i * 4);
      } else {
        img.data.set([16, 30, 33, 255], i * 4);
      }
    }
    this.base.width = w;
    this.base.height = h;
    this.base.getContext('2d')!.putImageData(img, 0, 0);
  }

  draw(now: number): void {
    const g = this.game;
    const pl = g.player(this.me)!;
    let n = 0;
    for (let i = 0; i < pl.known.length; i += 7) n += pl.known[i];
    const sig = `${n}|${g.version}`;
    if (sig !== this.sig) { this.rebuild(); this.sig = sig; }
    const ctx = this.ctx;
    const { w, h } = g.cfg;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.save();
    // matriz afín: (x,y) → iso
    const sx = this.W / (w + h);
    const sy = this.H / (w + h);
    ctx.setTransform(ctx.getTransform().a * sx, ctx.getTransform().a * sy, -ctx.getTransform().a * sx, ctx.getTransform().a * sy, ctx.getTransform().a * h * sx, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, -0.5, -0.5);
    ctx.restore();
    // recursos conocidos
    for (const id of pl.knownRes) {
      const r = g.resources.get(id);
      if (!r) continue;
      const [px, py] = this.map(r.x, r.y);
      ctx.fillStyle = r.kind === 'hierro' ? '#e0824a' : r.kind === 'cobre' ? '#4fe0b5' : r.kind === 'silicio' ? '#bfe8ff' : r.kind === 'chatarra' ? '#b6bec2' : '#b6e86a';
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
    // bases
    for (const p of g.players.values()) {
      const b = p.p.base;
      if (!pl.known[b.y * w + b.x]) continue;
      const [px, py] = this.map(b.x + 0.5, b.y + 0.5);
      ctx.fillStyle = p.p.color;
      ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // unidades propias
    for (const u of g.unitsOf(this.me)) {
      const [ux, uy] = G.lerpPos(u, now);
      const [px, py] = this.map(ux, uy);
      ctx.fillStyle = u.id === this.r.selectedUnit ? '#ffffff' : '#2fd4c0';
      ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    // encuadre de cámara
    const corners = [[0, 0], [this.r.W, 0], [this.r.W, this.r.H], [0, this.r.H]].map(([a, b]) => {
      const wx = (a - this.r.W / 2) / this.r.cam.zoom + this.r.cam.x;
      const wy = (b - this.r.H / 2) / this.r.cam.zoom + this.r.cam.y;
      const fx = (wx / 32 + wy / 16) / 2;
      const fy = (wy / 16 - wx / 32) / 2;
      return this.map(fx, fy);
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    corners.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
    ctx.closePath();
    ctx.stroke();
  }
}
