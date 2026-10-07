// Cliente de la API (Vercel). Si no hay API disponible, modo local (todo en este navegador) para probar.
import { AblyTransport, LocalTransport, type Transport } from './transport';

export interface Me { role: 'teacher' | 'student' | null; id?: number; name?: string }
export type RoomKind = 'partida' | 'espera';
export interface JoinInfo { code: string; title: string; cid: string; name: string; jt: string; kind?: RoomKind }
export interface RoomInfo { code: string; title: string; open: boolean; created_at?: string; kind?: RoomKind }
export interface LevelProgress { level: number; done: boolean; code: string | null }

class ApiError extends Error {}

function lsGet<T>(k: string, def: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
}
function lsSet(k: string, v: unknown): void {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
}

export class Api {
  mode: 'remote' | 'local' = 'local';
  ably = false;
  me: Me = { role: null };

  async init(): Promise<void> {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      if (r.ok) {
        const h = await r.json();
        if (h.ok) {
          this.mode = 'remote';
          this.ably = !!h.ably;
        }
      }
    } catch { /* sin API: modo local */ }
    this.me = await this.whoami();
  }

  private async call<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
    const r = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: data ? { 'Content-Type': 'application/json' } : undefined,
      body: data ? JSON.stringify(data) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(j.error ?? `Error ${r.status}`);
    return j as T;
  }

  async whoami(): Promise<Me> {
    if (this.mode === 'remote') return this.call<Me>('/api/auth');
    return lsGet<Me>('grid.local.me', { role: null });
  }

  // ───── cuentas ─────
  async teacherRegister(email: string, password: string, name: string, code?: string): Promise<Me> {
    if (this.mode === 'remote') return (this.me = await this.call<Me>('/api/auth', 'POST', { action: 'teacher-register', email, password, name, code }));
    const all = lsGet<Record<string, { name: string; password: string }>>('grid.local.teachers', {});
    if (all[email]) throw new ApiError('Ya existe una cuenta con ese email');
    if (password.length < 8) throw new ApiError('La contraseña debe tener al menos 8 caracteres');
    all[email] = { name: name || email.split('@')[0], password };
    lsSet('grid.local.teachers', all);
    this.me = { role: 'teacher', id: 1, name: all[email].name };
    lsSet('grid.local.me', this.me);
    return this.me;
  }

  async teacherLogin(email: string, password: string): Promise<Me> {
    if (this.mode === 'remote') return (this.me = await this.call<Me>('/api/auth', 'POST', { action: 'teacher-login', email, password }));
    const all = lsGet<Record<string, { name: string; password: string }>>('grid.local.teachers', {});
    if (!all[email] || all[email].password !== password) throw new ApiError('Email o contraseña incorrectos');
    this.me = { role: 'teacher', id: 1, name: all[email].name };
    lsSet('grid.local.me', this.me);
    return this.me;
  }

  async studentRegister(username: string, pin: string): Promise<Me> {
    if (this.mode === 'remote') return (this.me = await this.call<Me>('/api/auth', 'POST', { action: 'student-register', username, pin }));
    const u = username.toLowerCase();
    if (!/^[a-z0-9_.-]{3,24}$/.test(u)) throw new ApiError('El usuario debe tener 3-24 letras o números, sin espacios');
    if (!/^\d{4}$/.test(pin)) throw new ApiError('El PIN debe tener 4 cifras');
    const all = lsGet<Record<string, string>>('grid.local.students', {});
    if (all[u]) throw new ApiError('Ese nombre de usuario ya está cogido');
    all[u] = pin;
    lsSet('grid.local.students', all);
    this.me = { role: 'student', id: 1, name: u };
    lsSet('grid.local.me', this.me);
    return this.me;
  }

  async studentLogin(username: string, pin: string): Promise<Me> {
    if (this.mode === 'remote') return (this.me = await this.call<Me>('/api/auth', 'POST', { action: 'student-login', username, pin }));
    const u = username.toLowerCase();
    const all = lsGet<Record<string, string>>('grid.local.students', {});
    if (all[u] !== pin) throw new ApiError('Usuario o PIN incorrectos');
    this.me = { role: 'student', id: 1, name: u };
    lsSet('grid.local.me', this.me);
    return this.me;
  }

  async logout(): Promise<void> {
    if (this.mode === 'remote') await this.call('/api/auth', 'POST', { action: 'logout' });
    lsSet('grid.local.me', { role: null });
    this.me = { role: null };
  }

  // ───── salas ─────
  async createRoom(title: string, kind: RoomKind = 'partida'): Promise<RoomInfo> {
    if (this.mode === 'remote') return this.call<RoomInfo>('/api/rooms', 'POST', { action: 'create', title, kind });
    const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    const rooms = lsGet<RoomInfo[]>('grid.local.rooms', []);
    const r: RoomInfo = { code, title: title || (kind === 'espera' ? 'Sala de espera' : 'Clase'), open: true, created_at: new Date().toISOString(), kind };
    rooms.unshift(r);
    lsSet('grid.local.rooms', rooms.slice(0, 30));
    return r;
  }

  async myRooms(): Promise<RoomInfo[]> {
    if (this.mode === 'remote') return (await this.call<{ rooms: RoomInfo[] }>('/api/rooms')).rooms;
    return lsGet<RoomInfo[]>('grid.local.rooms', []);
  }

  async roomInfo(code: string): Promise<RoomInfo> {
    if (this.mode === 'remote') return this.call<RoomInfo>(`/api/rooms?code=${encodeURIComponent(code)}`);
    const r = lsGet<RoomInfo[]>('grid.local.rooms', []).find((x) => x.code === code);
    return r ?? { code, title: 'Sala local', open: true, kind: 'partida' };
  }

  async closeRoom(code: string): Promise<void> {
    if (this.mode === 'remote') { await this.call('/api/rooms', 'POST', { action: 'close', code }); return; }
    const rooms = lsGet<RoomInfo[]>('grid.local.rooms', []);
    const r = rooms.find((x) => x.code === code);
    if (r) { r.open = false; lsSet('grid.local.rooms', rooms); }
  }

  async join(code: string, name: string): Promise<JoinInfo> {
    // un id por pestaña (sessionStorage): sobrevive a recargar, pero dos pestañas son dos alumnos
    const key = `grid.cid.${code}`;
    let prev = '';
    try { prev = sessionStorage.getItem(key) ?? ''; } catch { /* nada */ }
    const keep = (cid: string) => { try { sessionStorage.setItem(key, cid); } catch { /* nada */ } };
    if (this.mode === 'remote') {
      const j = await this.call<JoinInfo>('/api/rooms', 'POST', { action: 'join', code, name, cid: prev });
      keep(j.cid);
      return j;
    }
    const cid = prev || 'g' + Math.random().toString(36).slice(2, 12);
    keep(cid);
    return { code, title: 'Sala local', cid, name, jt: '' };
  }

  async saveResults(code: string, data: unknown): Promise<void> {
    if (this.mode === 'remote') await this.call('/api/results', 'POST', { code, data });
    else {
      const all = lsGet<unknown[]>('grid.local.results', []);
      all.unshift({ code, t: Date.now(), data });
      lsSet('grid.local.results', all.slice(0, 20));
    }
  }

  // ───── tutorial ─────
  async progress(): Promise<LevelProgress[]> {
    if (this.mode === 'remote' && this.me.role === 'student') {
      try { return (await this.call<{ levels: LevelProgress[] }>('/api/progress')).levels; } catch { /* sigue local */ }
    }
    return lsGet<LevelProgress[]>('grid.local.progress', []);
  }

  async saveProgress(level: number, done: boolean, code: string): Promise<void> {
    const all = lsGet<LevelProgress[]>('grid.local.progress', []);
    const cur = all.find((l) => l.level === level);
    if (cur) { cur.done = cur.done || done; cur.code = code; } else all.push({ level, done, code });
    lsSet('grid.local.progress', all);
    if (this.mode === 'remote' && this.me.role === 'student') {
      try { await this.call('/api/progress', 'PUT', { level, done, code }); } catch { /* sin conexión */ }
    }
  }

  // ───── tiempo real ─────
  transport(code: string, role: 'host' | 'student', cid: string, jt = ''): Transport {
    if (this.mode === 'remote' && this.ably) {
      const url = `/api/ably?room=${encodeURIComponent(code)}${role === 'student' ? `&jt=${encodeURIComponent(jt)}` : ''}`;
      return new AblyTransport(code, url, cid);
    }
    return new LocalTransport(code);
  }
}

export const api = new Api();
