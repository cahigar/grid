// Contraseñas (scrypt) y tokens firmados (HMAC) sin dependencias.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const DEV_SECRET = 'grid-dev-secret-cambialo-en-produccion';

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.VERCEL_ENV === 'production') throw new Error('Falta AUTH_SECRET');
  return s || DEV_SECRET;
}

export function hashPass(pass: string): string {
  const salt = randomBytes(16).toString('hex');
  const h = scryptSync(pass, salt, 32).toString('hex');
  return `${salt}:${h}`;
}

export function checkPass(pass: string, stored: string): boolean {
  const [salt, h] = stored.split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(scryptSync(pass, salt, 32).toString('hex'));
  const b = Buffer.from(h);
  return a.length === b.length && timingSafeEqual(a, b);
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function sign(payload: Record<string, unknown>, ttlSec: number): string {
  const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const mac = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verify<T = Record<string, unknown>>(token: string | undefined | null): (T & { exp: number }) | null {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const good = createHmac('sha256', secret()).update(body).digest('base64url');
  if (mac.length !== good.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof p.exp !== 'number' || p.exp < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}

export interface Sess { r: 't' | 's'; id: number; n: string }
