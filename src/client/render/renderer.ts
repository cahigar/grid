// Render isométrico con caché de chunks de suelo y sprites.
import { Game, cargoCount } from '../../sim/world/game';
import { SIGNAL, T, UNIT_TYPES, type Prop, type Unit } from '../../sim/world/types';
import {
  ANIMATED_PROPS, HH, HW, PAL, RES_COLORS, diamond, paintBase, paintCrop, paintDock, paintDrops, paintFog, paintGridLine,
  paintGround, paintProp, paintResource, paintUnit, propHeight, rgba,
} from './art';

const CH = 16;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface Effect {
  kind: 'text' | 'pulse' | 'bump' | 'spray' | 'glitch';
  fx?: number;
  fy?: number;
  x: number;
  y: number;
  t0: number;
  dur: number;
  text?: string;
  color: string;
  r?: number;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cam: Camera = { x: 0, y: 0, zoom: 1 };
  W = 0;
  H = 0;
  dpr = 1;
  showGrid = true;
  hover: { x: number; y: number } | null = null;
  selectedUnit: string | null = null;
  selectedTile: { x: number; y: number } | null = null;
  private chunks = new Map<string, { canvas: HTMLCanvasElement; sig: string; used: number; ox: number; oy: number; s: number }>();
  private sprites = new Map<string, { c: HTMLCanvasElement; ax: number; ay: number }>();
  private propsAt = new Map<number, Prop[]>();
  private propsVersion = '';
  private allKnown: Uint8Array | null = null;
  /** vista de profesor: ve todo */
  god = false;
  showSignal = false;
  /** balizas del tutorial */
  beacons: [number, number][] = [];
  private effects: Effect[] = [];
  private lastEventT = 0;
  private terrainSig = '';
  frame = 0;

  constructor(canvas: HTMLCanvasElement, public game: Game, public me: string) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.lastEventT = game.time;
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.W = r.width;
    this.H = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  // ───── coordenadas ─────
  static tileToWorld(x: number, y: number): [number, number] {
    return [(x - y) * HW, (x + y) * HH];
  }
  worldToScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.cam.x) * this.cam.zoom + this.W / 2, (wy - this.cam.y) * this.cam.zoom + this.H / 2];
  }
  screenToTile(sx: number, sy: number): { x: number; y: number } {
    const wx = (sx - this.W / 2) / this.cam.zoom + this.cam.x;
    const wy = (sy - this.H / 2) / this.cam.zoom + this.cam.y;
    const fx = (wx / HW + wy / HH) / 2;
    const fy = (wy / HH - wx / HW) / 2;
    return { x: Math.round(fx), y: Math.round(fy) };
  }
  centerOn(x: number, y: number): void {
    const [wx, wy] = Renderer.tileToWorld(x, y);
    this.cam.x = wx;
    this.cam.y = wy;
  }

  private bucket(): number {
    const s = this.cam.zoom * this.dpr;
    return s <= 0.6 ? 0.5 : s <= 1.2 ? 1 : s <= 2.2 ? 2 : 3;
  }

  // ───── suelo por chunks ─────
  private chunkSig(cx: number, cy: number, known: Uint8Array): string {
    const { w, h } = this.game.cfg;
    let n = 0;
    for (let y = cy * CH; y < Math.min(h, cy * CH + CH + 1); y++) {
      for (let x = cx * CH; x < Math.min(w, cx * CH + CH + 1); x++) n += known[y * w + x];
    }
    return `${n}|${this.showGrid ? 1 : 0}|${this.terrainSig}`;
  }

  private buildChunk(cx: number, cy: number, s: number, known: Uint8Array) {
    const { w, h, seed } = this.game.cfg;
    const x0 = cx * CH;
    const y0 = cy * CH;
    const x1 = Math.min(w, x0 + CH);
    const y1 = Math.min(h, y0 + CH);
    const minX = (x0 - (y1 - 1)) * HW - HW - 2;
    const maxX = (x1 - 1 - y0) * HW + HW + 2;
    const minY = (x0 + y0) * HH - HH - 8;
    const maxY = (x1 - 1 + y1 - 1) * HH + HH + 6;
    const c = document.createElement('canvas');
    c.width = Math.ceil((maxX - minX) * s);
    c.height = Math.ceil((maxY - minY) * s);
    const ctx = c.getContext('2d')!;
    ctx.scale(s, s);
    ctx.translate(-minX, -minY);
    const ter = this.game.terrain;
    const K = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && known[y * w + x] === 1;
    for (let sum = x0 + y0; sum <= x1 - 1 + y1 - 1; sum++) {
      for (let x = x0; x < x1; x++) {
        const y = sum - x;
        if (y < y0 || y >= y1) continue;
        const [px, py] = Renderer.tileToWorld(x, y);
        ctx.save();
        ctx.translate(px, py);
        if (K(x, y)) {
          const t = ter[y * w + x] as T;
          const nb = (dx: number, dy: number) => {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) return -1;
            return ter[ny * w + nx] as T;
          };
          paintGround(ctx, t, x, y, nb, seed);
          if (this.showGrid) paintGridLine(ctx, 0.07);
        } else {
          const edge = K(x + 1, y) || K(x - 1, y) || K(x, y + 1) || K(x, y - 1);
          paintFog(ctx, x, y, seed, edge);
        }
        ctx.restore();
      }
    }
    // bruma suave sobre las casillas conocidas junto a la niebla
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!K(x, y)) continue;
        const edge = !K(x + 1, y) || !K(x - 1, y) || !K(x, y + 1) || !K(x, y - 1);
        if (!edge) continue;
        const [px, py] = Renderer.tileToWorld(x, y);
        const g = ctx.createRadialGradient(px, py, 4, px, py, HW);
        g.addColorStop(0, 'rgba(13,24,27,0)');
        g.addColorStop(1, 'rgba(13,24,27,0.35)');
        ctx.fillStyle = g;
        diamond(ctx, px, py);
        ctx.fill();
      }
    }
    return { canvas: c, ox: minX, oy: minY, s };
  }

  private drawGround(known: Uint8Array): void {
    const { w, h } = this.game.cfg;
    const s = this.bucket();
    const ctx = this.ctx;
    const ncx = Math.ceil(w / CH);
    const ncy = Math.ceil(h / CH);
    for (let cy = 0; cy < ncy; cy++) {
      for (let cx = 0; cx < ncx; cx++) {
        // visibilidad aproximada del chunk
        const corners = [
          Renderer.tileToWorld(cx * CH, cy * CH), Renderer.tileToWorld(cx * CH + CH, cy * CH),
          Renderer.tileToWorld(cx * CH, cy * CH + CH), Renderer.tileToWorld(cx * CH + CH, cy * CH + CH),
        ].map(([a, b]) => this.worldToScreen(a, b));
        const minX = Math.min(...corners.map((c) => c[0])) - HW * this.cam.zoom;
        const maxX = Math.max(...corners.map((c) => c[0])) + HW * this.cam.zoom;
        const minY = Math.min(...corners.map((c) => c[1])) - HH * 2 * this.cam.zoom;
        const maxY = Math.max(...corners.map((c) => c[1])) + HH * 2 * this.cam.zoom;
        if (maxX < 0 || minX > this.W || maxY < 0 || minY > this.H) continue;
        const key = `${cx},${cy},${s}`;
        const sig = this.chunkSig(cx, cy, known);
        let ch = this.chunks.get(key);
        if (!ch || ch.sig !== sig) {
          const b = this.buildChunk(cx, cy, s, known);
          ch = { canvas: b.canvas, sig, used: this.frame, ox: b.ox, oy: b.oy, s };
          this.chunks.set(key, ch);
        }
        ch.used = this.frame;
        const [sx, sy] = this.worldToScreen(ch.ox, ch.oy);
        ctx.drawImage(ch.canvas, sx, sy, (ch.canvas.width / ch.s) * this.cam.zoom, (ch.canvas.height / ch.s) * this.cam.zoom);
      }
    }
    if (this.chunks.size > 80) {
      const old = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.chunks.size - 60);
      for (const [k] of old) this.chunks.delete(k);
    }
  }

  private sprite(prop: Prop, owner: string): { c: HTMLCanvasElement; ax: number; ay: number } {
    const s = this.bucket();
    const key = `${prop.kind}|${prop.v}|${s}|${owner}`;
    let sp = this.sprites.get(key);
    if (!sp) {
      const ph = propHeight(prop.kind);
      const c = document.createElement('canvas');
      c.width = Math.ceil(170 * s);
      c.height = Math.ceil((ph + 50) * s);
      const ctx = c.getContext('2d')!;
      ctx.scale(s, s);
      ctx.translate(85, ph + 25);
      paintProp(ctx, prop.kind, prop.v, 0, owner);
      sp = { c, ax: 85, ay: ph + 25 };
      this.sprites.set(key, sp);
    }
    return sp;
  }

  private resSprite(kind: string, q: number, frac: number): { c: HTMLCanvasElement; ax: number; ay: number } {
    const s = this.bucket();
    const key = `res|${kind}|${q}|${frac}|${s}`;
    let sp = this.sprites.get(key);
    if (!sp) {
      const c = document.createElement('canvas');
      c.width = Math.ceil(80 * s);
      c.height = Math.ceil(70 * s);
      const ctx = c.getContext('2d')!;
      ctx.scale(s, s);
      ctx.translate(40, 50);
      paintResource(ctx, kind as 'hierro', q, Math.max(0.05, frac), 0);
      sp = { c, ax: 40, ay: 50 };
      this.sprites.set(key, sp);
    }
    return sp;
  }

  private indexProps(): void {
    const ver = `${this.game.props.length}|${this.game.terrainVersion}`;
    if (this.propsVersion === ver) return;
    this.propsAt.clear();
    const w = this.game.cfg.w;
    for (const p of this.game.props) {
      const k = p.y * w + p.x;
      const arr = this.propsAt.get(k);
      if (arr) arr.push(p);
      else this.propsAt.set(k, [p]);
    }
    this.propsVersion = ver;
    this.terrainSig = ver;
  }

  // ───── efectos ─────
  private consumeEvents(now: number): void {
    const evs = this.game.events;
    for (const e of evs) {
      if (e.t <= this.lastEventT) continue;
      if (e.owner !== this.me && !this.god) continue;
      if (e.t < this.game.time - 5000) continue;
      if (e.kind === 'extract') this.effects.push({ kind: 'text', x: e.x, y: e.y, t0: now, dur: 1400, text: `+1 ${e.text}`, color: RES_COLORS[e.text as keyof typeof RES_COLORS] ?? '#fff' });
      else if (e.kind === 'deliver') this.effects.push({ kind: 'text', x: e.x, y: e.y, t0: now, dur: 2200, text: `▼ ${e.text}`, color: PAL.teal });
      else if (e.kind === 'scan') this.effects.push({ kind: 'pulse', x: e.x, y: e.y, t0: now, dur: 1200, color: '#5fe8ff', r: UNIT_TYPES[this.game.units.get(e.unit)?.u.type ?? 'minero'].scan });
      else if (e.kind === 'bump') this.effects.push({ kind: 'bump', x: e.x, y: e.y, t0: now, dur: 600, color: '#ff6b5a' });
      else if (e.kind === 'error') this.effects.push({ kind: 'text', x: e.x, y: e.y, t0: now, dur: 2600, text: `✖ ${e.text}`, color: '#ff6b5a' });
      else if (e.kind === 'build') this.effects.push({ kind: 'text', x: e.x, y: e.y, t0: now, dur: 2600, text: `★ ${e.text}`, color: PAL.amber });
      else if (e.kind === 'harvest') this.effects.push({ kind: 'text', x: e.x, y: e.y, t0: now, dur: 1800, text: `+${e.text} cosecha`, color: '#f0cf52' });
      else if (e.kind === 'plant') this.effects.push({ kind: 'text', x: e.x, y: e.y, t0: now, dur: 1200, text: '🌱', color: '#8fd14f' });
      else if (e.kind === 'pickup') this.effects.push({ kind: 'text', x: e.x, y: e.y, t0: now, dur: 1200, text: `▲ ${e.text}`, color: '#e3efec' });
      else if (e.kind === 'splash') {
        const src = this.game.units.get(e.unit)?.u;
        this.effects.push({ kind: 'spray', x: e.x, y: e.y, fx: src?.x ?? e.x, fy: src?.y ?? e.y, t0: now, dur: 900, color: '#9fe3f0' });
      } else if (e.kind === 'wet') this.effects.push({ kind: 'text', x: e.x, y: e.y, t0: now, dur: 2200, text: '💧 ¡mojado!', color: '#9fe3f0' });
      else if (e.kind === 'hacked') {
        this.effects.push({ kind: 'glitch', x: e.x, y: e.y, t0: now, dur: 1600, color: '#ff5d73' });
        this.effects.push({ kind: 'text', x: e.x, y: e.y, t0: now, dur: 3000, text: '⚠ HACKEADO', color: '#ff5d73' });
      } else if (e.kind === 'hack') this.effects.push({ kind: 'glitch', x: e.x, y: e.y, t0: now, dur: 900, color: '#ff5d73' });
    }
    if (evs.length) this.lastEventT = Math.max(this.lastEventT, evs[evs.length - 1].t);
  }

  // ───── frame ─────
  draw(now: number, realNow: number): void {
    this.frame++;
    this.indexProps();
    const ctx = this.ctx;
    const g = this.game;
    const pl = g.player(this.me);
    const { w, h } = g.cfg;
    if (this.god || !pl) {
      if (!this.allKnown || this.allKnown.length !== w * h) this.allKnown = new Uint8Array(w * h).fill(1);
    }
    const known = this.god || !pl ? this.allKnown! : pl.known;
    const resKnown = (id: number) => this.god || !pl || pl.knownRes.has(id);
    this.consumeEvents(realNow);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // fondo
    const bg = ctx.createLinearGradient(0, 0, 0, this.H);
    bg.addColorStop(0, '#0f1d20');
    bg.addColorStop(1, '#0a1315');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.W, this.H);

    this.drawGround(known);

    const z = this.cam.zoom;
    const toS = (x: number, y: number) => {
      const [wx, wy] = Renderer.tileToWorld(x, y);
      return this.worldToScreen(wx, wy);
    };
    // rango visible (aprox.)
    const c1 = this.screenToTile(0, 0);
    const c2 = this.screenToTile(this.W, 0);
    const c3 = this.screenToTile(0, this.H);
    const c4 = this.screenToTile(this.W, this.H);
    const vx0 = Math.max(0, Math.min(c1.x, c3.x) - 3);
    const vx1 = Math.min(w - 1, Math.max(c2.x, c4.x) + 3);
    const vy0 = Math.max(0, Math.min(c1.y, c2.y) - 3);
    const vy1 = Math.min(h - 1, Math.max(c3.y, c4.y) + 6);

    // ── superposiciones de suelo ──
    const drawDiamond = (x: number, y: number, stroke: string, fill?: string, lw = 2) => {
      const [sx, sy] = toS(x, y);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(z, z);
      diamond(ctx, 0, 0, HW - 1, HH - 0.5);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw / z;
      ctx.stroke();
      ctx.restore();
    };
    for (const p of g.players.values()) {
      const d = p.p.dock;
      if (!known[d.y * w + d.x]) continue;
      const [sx, sy] = toS(d.x, d.y);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(z, z);
      paintDock(ctx, p.p.color, realNow);
      ctx.restore();
    }
    if (this.hover && this.hover.x >= 0 && this.hover.y >= 0 && this.hover.x < w && this.hover.y < h) {
      drawDiamond(this.hover.x, this.hover.y, 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.06)', 1.5);
    }
    for (const [bx, by] of this.beacons) {
      const [sx, sy] = toS(bx, by);
      const pulse = 0.6 + Math.sin(realNow / 300) * 0.4;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(z, z);
      ctx.fillStyle = rgba(PAL.amber, 0.18 * pulse + 0.1);
      diamond(ctx, 0, 0, HW - 2, HH - 1);
      ctx.fill();
      ctx.strokeStyle = rgba(PAL.amber, 0.9);
      ctx.lineWidth = 2;
      ctx.stroke();
      const g2 = ctx.createLinearGradient(0, -60, 0, 0);
      g2.addColorStop(0, 'rgba(242,169,59,0)');
      g2.addColorStop(1, rgba(PAL.amber, 0.5 * pulse));
      ctx.fillStyle = g2;
      ctx.fillRect(-6, -60, 12, 60);
      ctx.fillStyle = '#ffd98a';
      ctx.font = '700 18px "Space Grotesk", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★', 0, -62 - Math.sin(realNow / 400) * 3);
      ctx.restore();
    }
    if (this.selectedTile) drawDiamond(this.selectedTile.x, this.selectedTile.y, PAL.amber, rgba(PAL.amber, 0.12));

    const myUnits = this.god ? [...g.units.values()].map((r) => r.u).filter((u) => u.id === this.selectedUnit) : g.unitsOf(this.me);
    // alcance de señal (base + antenas) de la colonia de la unidad seleccionada
    const selU = this.selectedUnit ? g.units.get(this.selectedUnit)?.u : null;
    if (g.cfg.match && (this.showSignal || (selU && !g.inSignal(selU)))) {
      const owner = selU?.owner ?? this.me;
      const op = g.player(owner);
      if (op) {
        const rings: [number, number, number][] = [[op.p.base.x + 0.5, op.p.base.y + 0.5, SIGNAL.base], ...g.ownBuildings(owner, 'antena').map((a) => [a.x, a.y, SIGNAL.antena] as [number, number, number])];
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -realNow / 60;
        for (const [cx, cy, r] of rings) {
          const [sx, sy] = toS(cx, cy);
          ctx.strokeStyle = rgba(op.p.color, 0.5);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.ellipse(sx, sy, r * HW * z * 1.414, r * HH * z * 1.414, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = rgba(op.p.color, 0.04);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    // rastro y rutas
    for (const u of myUnits) {
      const sel = u.id === this.selectedUnit;
      const alpha = sel ? 1 : 0.35;
      u.trail.forEach(([x, y], i) => {
        const [sx, sy] = toS(x, y);
        ctx.fillStyle = rgba(PAL.teal, ((i + 1) / u.trail.length) * 0.5 * alpha);
        ctx.beginPath();
        ctx.ellipse(sx, sy, 3 * z, 1.5 * z, 0, 0, Math.PI * 2);
        ctx.fill();
      });
      if (u.route && u.route.length) {
        ctx.save();
        ctx.strokeStyle = rgba('#5fe8ff', 0.85 * (sel ? 1 : 0.5));
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#5fe8ff';
        ctx.shadowBlur = sel ? 8 : 0;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -realNow / 40;
        ctx.beginPath();
        const [ux, uy] = Game.lerpPos(u, now);
        const [s0x, s0y] = toS(ux, uy);
        ctx.moveTo(s0x, s0y);
        for (const [x, y] of u.route) {
          const [sx, sy] = toS(x, y);
          ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        const last = u.route[u.route.length - 1];
        const [lx, ly] = toS(last[0], last[1]);
        ctx.fillStyle = '#5fe8ff';
        ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      if (sel) {
        const [ux, uy] = Game.lerpPos(u, now);
        const [sx, sy] = toS(ux, uy);
        const pulse = 1 + Math.sin(realNow / 250) * 0.08;
        ctx.strokeStyle = rgba(PAL.teal, 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(sx, sy, 22 * z * pulse, 11 * z * pulse, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = rgba(PAL.teal, 0.3);
        ctx.lineWidth = 6;
        ctx.stroke();
      }
    }

    // ── objetos ordenados por profundidad ──
    type Item = { d: number; fn: () => void };
    const items: Item[] = [];
    for (let y = vy0; y <= vy1; y++) {
      for (let x = vx0; x <= vx1; x++) {
        const k = y * w + x;
        if (!known[k]) continue;
        const props = this.propsAt.get(k);
        if (props) {
          for (const p of props) {
            if (g.terrain[k] === T.BASE) continue;
            if (p.kind === 'aspersor') continue;
            if (z < 0.55 && (p.kind === 'flores' || p.kind === 'poste' || p.kind === 'arbusto')) continue;
            const owner = p.owner ? g.player(p.owner)?.p.color ?? PAL.teal : PAL.teal;
            items.push({
              d: x + y + 0.1,
              fn: () => {
                const [sx, sy] = toS(x, y);
                if (ANIMATED_PROPS.has(p.kind)) {
                  ctx.save();
                  ctx.translate(sx, sy);
                  ctx.scale(z, z);
                  paintProp(ctx, p.kind, p.v, realNow, owner);
                  ctx.restore();
                } else {
                  const sp = this.sprite(p, owner);
                  const s = this.bucket();
                  ctx.drawImage(sp.c, sx - sp.ax * z, sy - sp.ay * z, (sp.c.width / s) * z, (sp.c.height / s) * z);
                }
              },
            });
          }
        }
        const par = g.parcels.get(k);
        if (par) {
          const pp = g.settleParcel(par, now);
          items.push({
            d: x + y + 0.02,
            fn: () => {
              const [sx, sy] = toS(x, y);
              ctx.save();
              ctx.translate(sx, sy);
              ctx.scale(z, z);
              paintCrop(ctx, pp.mat, pp.hum, pp.planted, realNow, x, y);
              ctx.restore();
            },
          });
        }
        const drop = g.drops.get(k);
        if (drop) {
          const kinds = Object.keys(drop).filter((kk) => (drop as Record<string, number>)[kk] > 0);
          const n = kinds.reduce((a, kk) => a + (drop as Record<string, number>)[kk], 0);
          if (n > 0) {
            items.push({
              d: x + y + 0.03,
              fn: () => {
                const [sx, sy] = toS(x, y);
                ctx.save();
                ctx.translate(sx, sy + 4 * z);
                ctx.scale(z, z);
                paintDrops(ctx, kinds, n);
                ctx.restore();
              },
            });
          }
        }
        const rid = g.resAt.get(k);
        if (rid !== undefined && resKnown(rid)) {
          const r = g.resources.get(rid)!;
          if (r.amount >= 1) {
            items.push({
              d: x + y + 0.05,
              fn: () => {
                const [sx, sy] = toS(x, y);
                const sp = this.resSprite(r.kind, r.quality, Math.round((r.amount / r.max) * 4) / 4);
                const s = this.bucket();
                ctx.drawImage(sp.c, sx - sp.ax * z, sy - sp.ay * z, (sp.c.width / s) * z, (sp.c.height / s) * z);
                if (r.kind === 'silicio' || r.quality >= 3) {
                  // brillo animado barato
                  const a = 0.35 + Math.sin(realNow / 400 + x) * 0.25;
                  ctx.fillStyle = r.kind === 'silicio' ? `rgba(190,235,255,${a})` : `rgba(255,246,200,${a})`;
                  ctx.beginPath();
                  ctx.arc(sx + 10 * z, sy - 18 * z, 2 * z, 0, Math.PI * 2);
                  ctx.fill();
                }
              },
            });
          }
        }
      }
    }
    for (const p of g.players.values()) {
      const b = p.p.base;
      if (!known[b.y * w + b.x] && !known[(b.y + 1) * w + b.x + 1]) continue;
      items.push({
        d: b.x + b.y + 2 + 0.2,
        fn: () => {
          const [sx, sy] = toS(b.x + 0.5, b.y + 0.5);
          ctx.save();
          ctx.translate(sx, sy);
          ctx.scale(z, z);
          paintBase(ctx, p.p.color, realNow);
          ctx.restore();
          if (z > 0.55) {
            ctx.font = `600 ${Math.round(11 * Math.min(1.3, z))}px "Space Grotesk", system-ui, sans-serif`;
            ctx.textAlign = 'center';
            const label = p.p.name;
            const tw = ctx.measureText(label).width;
            const ly = sy - 88 * z;
            ctx.fillStyle = 'rgba(10,20,22,0.7)';
            roundRect(ctx, sx - tw / 2 - 8, ly - 11, tw + 16, 17, 8);
            ctx.fill();
            ctx.fillStyle = p.p.color;
            ctx.fillRect(sx - tw / 2 - 4, ly - 5, 4, 4);
            ctx.fillStyle = '#e9f3f1';
            ctx.fillText(label, sx + 3, ly + 1);
          }
        },
      });
    }
    const drawnUnits: { u: Unit; sx: number; sy: number }[] = [];
    for (const rt of g.units.values()) {
      const u = rt.u;
      const mine = u.owner === this.me || this.god;
      if (!mine && !known[u.y * w + u.x]) continue;
      const [ux, uy] = Game.lerpPos(u, now);
      const color = g.player(u.owner)?.p.color ?? PAL.teal;
      items.push({
        d: ux + uy + 0.5,
        fn: () => {
          const [sx, sy] = toS(ux, uy);
          const a = u.action;
          let facing = 1;
          if (a && a.name === 'mover') {
            const d = a.label.charAt(7);
            facing = d === 'E' ? 0 : d === 'S' ? 1 : d === 'O' ? 2 : 3;
          } else if (u.trail.length >= 2) {
            const [p1, p2] = u.trail.slice(-2);
            facing = p2[0] > p1[0] ? 0 : p2[1] > p1[1] ? 1 : p2[0] < p1[0] ? 2 : 3;
          }
          const working = !!a && ['picar', 'escanear', 'regar', 'plantar', 'recolectar', 'hackear', 'disparar', 'construir'].includes(a.name) && a.ok && now < a.end;
          ctx.save();
          ctx.translate(sx, sy);
          const sc = u.type === 'aspersor' ? 1 : 1.3;
          ctx.scale(z * sc, z * sc);
          if (!mine) ctx.globalAlpha = 0.85;
          if (u.wetUntil > now) ctx.filter = 'saturate(0.4) brightness(1.15)';
          paintUnit(ctx, u.type, color, realNow + u.id.length * 300, {
            facing, working, moving: !!a && a.name === 'mover', carrying: cargoCount(u) / Math.max(1, UNIT_TYPES[u.type].cargo),
          });
          ctx.restore();
          ctx.filter = 'none';
          if (u.owner !== this.me && !this.god) {
            // marca de color de la colonia rival
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(sx, sy + 6 * z, 3 * z, 0, Math.PI * 2); ctx.fill();
          }
          if (mine) drawnUnits.push({ u, sx, sy });
        },
      });
    }
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.fn();

    // ── superposiciones superiores ──
    for (const { u, sx, sy } of drawnUnits) {
      const sel = u.id === this.selectedUnit;
      let icon = '';
      let col = '';
      if (u.status === 'ERROR') { icon = '✖'; col = '#ff6b5a'; }
      else if (u.blocked && u.blocked.attempts >= 5) { icon = '!'; col = '#ff6b5a'; }
      else if (u.status === 'HIBERNATING') { icon = 'ϟ'; col = PAL.amber; }
      else if (u.status === 'DONE') { icon = '✓'; col = '#8fd14f'; }
      else if (u.status === 'IDLE') { icon = '‖'; col = '#9fb3b0'; }
      if (u.wetUntil > now) { icon = '≈'; col = '#9fe3f0'; }
      if (u.hacked && now - u.hacked.t < 20_000) { icon = '⚠'; col = '#ff5d73'; }
      const top = sy - 60 * z;
      if (icon) {
        const bounce = Math.sin(realNow / 300) * 2;
        ctx.fillStyle = 'rgba(10,20,22,0.8)';
        ctx.beginPath(); ctx.arc(sx, top - 8 + bounce, 9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.font = '700 11px "Space Grotesk", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(icon, sx, top - 4 + bounce);
      }
      if (sel || z > 1.7 || (this.hover && Math.abs(this.hover.x - u.x) + Math.abs(this.hover.y - u.y) === 0)) {
        ctx.font = `600 ${sel ? 12 : 10}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        const tw = ctx.measureText(u.name).width;
        const ly = top + (icon ? -22 : -6);
        ctx.fillStyle = sel ? 'rgba(47,212,192,0.92)' : 'rgba(10,20,22,0.7)';
        roundRect(ctx, sx - tw / 2 - 6, ly - 11, tw + 12, 16, 6);
        ctx.fill();
        ctx.fillStyle = sel ? '#06201d' : '#dfeeee';
        ctx.fillText(u.name, sx, ly + 1);
      }
      // barra de progreso de la acción
      const a = u.action;
      if (a && sel && a.end > now) {
        const k = Math.min(1, (now - a.start) / (a.end - a.start));
        ctx.fillStyle = 'rgba(10,20,22,0.8)';
        roundRect(ctx, sx - 18, sy + 10 * z, 36, 5, 2.5);
        ctx.fill();
        ctx.fillStyle = a.ok ? PAL.teal : '#ff6b5a';
        roundRect(ctx, sx - 18, sy + 10 * z, 36 * k, 5, 2.5);
        ctx.fill();
      }
    }
    // efectos
    this.effects = this.effects.filter((e) => realNow - e.t0 < e.dur);
    for (const e of this.effects) {
      const k = (realNow - e.t0) / e.dur;
      const [sx, sy] = toS(e.x, e.y);
      if (e.kind === 'text') {
        ctx.globalAlpha = 1 - k * k;
        ctx.font = '700 13px "Space Grotesk", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8,16,18,0.85)';
        ctx.strokeText(e.text!, sx, sy - 40 * z - k * 30);
        ctx.fillStyle = e.color;
        ctx.fillText(e.text!, sx, sy - 40 * z - k * 30);
        ctx.globalAlpha = 1;
      } else if (e.kind === 'pulse') {
        const r = (e.r ?? 3) * k;
        ctx.strokeStyle = rgba(e.color, 0.7 * (1 - k));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(sx, sy, r * HW * z * 1.4, r * HH * z * 1.4, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind === 'spray') {
        const [fx, fy] = toS(e.fx!, e.fy!);
        for (let i = 0; i < 10; i++) {
          const kk = Math.min(1, k * 1.4 - i * 0.03);
          if (kk <= 0) continue;
          const px = fx + (sx - fx) * kk;
          const py = fy - 35 * z + (sy - fy + 35 * z) * kk - Math.sin(kk * Math.PI) * 40 * z;
          ctx.fillStyle = rgba('#9fe3f0', 0.9 - k * 0.6);
          ctx.beginPath(); ctx.arc(px + (i % 3) * 2, py + (i % 2) * 2, 2.2 * z, 0, Math.PI * 2); ctx.fill();
        }
        if (k > 0.6) {
          ctx.strokeStyle = rgba('#bfefff', (1 - k) * 2);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(sx, sy, 30 * z * k, 15 * z * k, 0, 0, Math.PI * 2); ctx.stroke();
        }
      } else if (e.kind === 'glitch') {
        for (let i = 0; i < 6; i++) {
          const oy = (Math.random() - 0.5) * 40 * z;
          ctx.fillStyle = rgba(i % 2 ? '#ff5d73' : '#5fe8ff', 0.7 * (1 - k));
          ctx.fillRect(sx - 20 * z + Math.random() * 10, sy - 20 * z + oy, 30 * z * Math.random() + 8, 2);
        }
      } else if (e.kind === 'bump') {
        ctx.strokeStyle = rgba(e.color, 1 - k);
        ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(sx + Math.cos(a) * 8, sy - 14 * z + Math.sin(a) * 5);
          ctx.lineTo(sx + Math.cos(a) * (12 + k * 8), sy - 14 * z + Math.sin(a) * (7 + k * 4));
          ctx.stroke();
        }
      }
    }
    // luz cálida ambiental (viñeta)
    const vg = ctx.createRadialGradient(this.W * 0.35, this.H * 0.2, 0, this.W * 0.5, this.H * 0.5, Math.max(this.W, this.H) * 0.8);
    vg.addColorStop(0, 'rgba(255,214,150,0.07)');
    vg.addColorStop(0.6, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,10,12,0.35)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  /** unidad propia bajo el cursor */
  pickUnit(sx: number, sy: number, now: number): Unit | null {
    let best: Unit | null = null;
    let bestD = 30;
    const pl = this.game.player(this.me);
    const w = this.game.cfg.w;
    for (const rt of this.game.units.values()) {
      const u = rt.u;
      const visible = this.god || u.owner === this.me || (pl && pl.known[u.y * w + u.x]);
      if (!visible) continue;
      const [ux, uy] = Game.lerpPos(u, now);
      const [px, py] = this.worldToScreen(...Renderer.tileToWorld(ux, uy));
      const d = Math.hypot(sx - px, sy - (py - 14 * this.cam.zoom));
      if (d < bestD * Math.max(0.7, this.cam.zoom)) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, h / 2, Math.abs(w) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
