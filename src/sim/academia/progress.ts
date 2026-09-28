// Progreso de la Academia sin cuenta: estado local y código de exportación (base32 con suma de control).
import { LEVEL_ORDER, SECTIONS, sectionOf } from './content';

export interface Progress {
  v: 1;
  stars: Record<string, number>;
  code: Record<string, string>;
  /** segundos por sección */
  secs: Record<string, number>;
  last: string | null;
}

export const emptyProgress = (): Progress => ({ v: 1, stars: {}, code: {}, secs: {}, last: null });

export const POINTS_PER_STAR = 10;
export const BOSS_BONUS = 2;

export function points(p: Progress): number {
  let n = 0;
  for (const s of SECTIONS) for (const l of s.levels) n += (p.stars[l.id] ?? 0) * POINTS_PER_STAR * (l.boss ? BOSS_BONUS : 1);
  return n;
}
export const totalStars = (p: Progress) => Object.values(p.stars).reduce((a, b) => a + b, 0);
export const totalSecs = (p: Progress) => Object.values(p.secs).reduce((a, b) => a + b, 0);

/** ¿se puede jugar este nivel? (dentro de cada sección se desbloquean en orden; el jefe al completar el resto) */
export function unlocked(p: Progress, id: string): boolean {
  const s = sectionOf(id);
  if (!s || s.soon) return false;
  const i = s.levels.findIndex((l) => l.id === id);
  if (i <= 0) return true;
  const lvl = s.levels[i];
  if (lvl.boss) return s.levels.filter((l) => !l.boss).every((l) => (p.stars[l.id] ?? 0) > 0);
  return (p.stars[s.levels[i - 1].id] ?? 0) > 0;
}

export function addTime(p: Progress, levelId: string, secs: number): void {
  const s = sectionOf(levelId);
  if (!s) return;
  p.secs[s.id] = (p.secs[s.id] ?? 0) + secs;
}

// ───── código de exportación ─────
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function crc8(bytes: number[]): number {
  let c = 0;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
}

function toB32(bytes: number[]): string {
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(acc >>> (bits - 5)) & 31]; bits -= 5; }
    acc &= (1 << bits) - 1;
  }
  if (bits) out += B32[(acc << (5 - bits)) & 31];
  return out;
}

function fromB32(s: string): number[] | null {
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const ch of s) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) { out.push((acc >>> (bits - 8)) & 255); bits -= 8; acc &= (1 << bits) - 1; }
  }
  return out;
}

export function exportCode(p: Progress): string {
  const n = LEVEL_ORDER.length;
  const bytes = [1, n];
  for (let i = 0; i < n; i += 4) {
    let b = 0;
    for (let j = 0; j < 4; j++) b |= Math.min(3, p.stars[LEVEL_ORDER[i + j]] ?? 0) << (j * 2);
    bytes.push(b);
  }
  for (const s of SECTIONS) {
    // minutos por sección (máx. 255 ≈ 4 h)
    bytes.push(Math.min(255, Math.floor((p.secs[s.id] ?? 0) / 60)));
  }
  const li = p.last ? LEVEL_ORDER.indexOf(p.last) : -1;
  bytes.push(li < 0 ? 255 : li);
  bytes.push(crc8(bytes));
  return toB32(bytes).match(/.{1,4}/g)!.join('-');
}

export function importCode(code: string): Progress | null {
  const clean = code.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  const bytes = fromB32(clean);
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] !== 1) return null;
  const n = bytes[1];
  const starBytes = Math.ceil(n / 4);
  const need = 2 + starBytes + SECTIONS.length + 1 + 1;
  if (bytes.length < need) return null;
  const body = bytes.slice(0, need - 1);
  if (crc8(body) !== bytes[need - 1]) return null;
  const p = emptyProgress();
  for (let i = 0; i < n && i < LEVEL_ORDER.length; i++) {
    const st = (bytes[2 + (i >> 2)] >> ((i & 3) * 2)) & 3;
    if (st) p.stars[LEVEL_ORDER[i]] = st;
  }
  let o = 2 + starBytes;
  for (const s of SECTIONS) {
    const m = bytes[o];
    o += 1;
    if (m) p.secs[s.id] = m * 60;
  }
  const li = bytes[o];
  p.last = li < LEVEL_ORDER.length ? LEVEL_ORDER[li] : null;
  return p;
}

/** Une dos progresos quedándose con lo mejor de cada uno */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const out = emptyProgress();
  for (const id of new Set([...Object.keys(a.stars), ...Object.keys(b.stars)])) out.stars[id] = Math.max(a.stars[id] ?? 0, b.stars[id] ?? 0);
  for (const id of new Set([...Object.keys(a.secs), ...Object.keys(b.secs)])) out.secs[id] = Math.max(a.secs[id] ?? 0, b.secs[id] ?? 0);
  out.code = { ...b.code, ...a.code };
  out.last = b.last ?? a.last;
  return out;
}

export function fmtTime(secs: number): string {
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
