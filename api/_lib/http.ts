// Utilidades HTTP para las funciones de Vercel.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sign, verify, type Sess } from './auth.js';

export type Req = VercelRequest;
export type Res = VercelResponse;

export function send(res: Res, status: number, data: unknown): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(data);
}

export function fail(res: Res, status: number, error: string): void {
  send(res, status, { error });
}

export function body(req: Req): Record<string, unknown> {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return b as Record<string, unknown>;
}

const COOKIE = 'grid_s';

export function session(req: Req): Sess | null {
  const raw = req.headers.cookie ?? '';
  const m = raw.split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  return verify<Sess>(m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null);
}

export function setSession(res: Res, s: Sess | null): void {
  const secure = process.env.VERCEL ? '; Secure' : '';
  if (!s) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
    return;
  }
  const days = s.r === 't' ? 30 : 180;
  const tok = sign({ ...s }, days * 86400);
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(tok)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${secure}`);
}

export function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
