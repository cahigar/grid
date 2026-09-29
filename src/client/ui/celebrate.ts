// Celebraciones: ventana de reto superado con estrellas y confeti de neón.
import { sound } from '../audio';

const NEON = ['#2fd4c0', '#5fe8ff', '#8fd14f', '#f2a93b', '#ff5d9e', '#b98cff', '#fff27a'];

/** confeti de neón cayendo sobre toda la pantalla */
export function confetti(ms = 3800, count = 160): void {
  if (matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.appendChild(c);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (c.width = innerWidth * dpr);
  const H = (c.height = innerHeight * dpr);
  const ctx = c.getContext('2d')!;
  const parts = Array.from({ length: count }, () => ({
    x: Math.random() * W,
    y: -Math.random() * H * 0.6,
    vx: (Math.random() - 0.5) * 2.2 * dpr,
    vy: (2 + Math.random() * 3.5) * dpr,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    w: (5 + Math.random() * 7) * dpr,
    h: (3 + Math.random() * 4) * dpr,
    col: NEON[Math.floor(Math.random() * NEON.length)],
    sway: Math.random() * Math.PI * 2,
  }));
  const t0 = performance.now();
  const tick = (t: number) => {
    const k = (t - t0) / ms;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      p.sway += 0.05;
      p.x += p.vx + Math.sin(p.sway) * 0.8 * dpr;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, Math.min(1, 1.6 - k * 1.6));
      ctx.shadowColor = p.col;
      ctx.shadowBlur = 10 * dpr;
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.sway)) + 1);
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(tick);
    else c.remove();
  };
  requestAnimationFrame(tick);
}

export interface Criterion { ok: boolean; text: string }

export interface CelebrateOpts {
  title: string;
  stars: number;
  best: number;
  improved: boolean;
  criteria: Criterion[];
  message: string;
  next?: { href: string; label: string } | null;
  boss?: boolean;
}

/** ventana de «¡reto superado!» con las estrellas y el porqué */
export function showLevelComplete(o: CelebrateOpts): void {
  document.querySelectorAll('.win-bg').forEach((e) => e.remove());
  const bg = document.createElement('div');
  bg.className = 'win-bg';
  bg.innerHTML = `<div class="win panel ${o.boss ? 'boss' : ''}" role="dialog" aria-label="Reto superado">
    <div class="k-lbl">${o.boss ? '👑 Jefe derrotado' : 'Reto superado'}</div>
    <h2>${o.title}</h2>
    <div class="win-stars">${[0, 1, 2].map((i) => `<span class="ws ${i < o.stars ? 'on' : ''}" style="animation-delay:${0.25 + i * 0.35}s">★</span>`).join('')}</div>
    <p class="win-msg">${o.message}</p>
    <ul class="win-why">${o.criteria.map((c) => `<li class="${c.ok ? 'ok' : 'ko'}"><span>${c.ok ? '✓' : '✗'}</span>${c.text}</li>`).join('')}</ul>
    ${o.best > o.stars ? `<p class="sm">Tu mejor marca en este reto sigue siendo ${'★'.repeat(o.best)}.</p>` : ''}
    <div class="foot">
      <a class="btn" href="#/academia">Academia</a>
      <button class="btn" id="win-stay">${o.stars < 3 ? 'Mejorar mi código' : 'Seguir aquí'}</button>
      ${o.next ? `<a class="btn go" id="win-next" href="${o.next.href}">${o.next.label}</a>` : ''}
    </div>
  </div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  bg.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  (bg.querySelector('#win-stay') as HTMLButtonElement).onclick = close;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', onKey); } };
  window.addEventListener('keydown', onKey);
  if (o.boss) sound.fanfare(); else sound.success();
  for (let i = 0; i < o.stars; i++) setTimeout(() => sound.star(i), 250 + i * 350);
  confetti(o.stars === 3 || o.boss ? 4200 : 3000, o.stars === 3 || o.boss ? 200 : 120);
}
