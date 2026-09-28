// Cuentas: profesor (email + contraseña) y alumno (usuario + PIN de 4 cifras, sin email).
import { checkPass, hashPass } from './_lib/auth.js';
import { db } from './_lib/db.js';
import { body, fail, send, session, setSession, str, type Req, type Res } from './_lib/http.js';

export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    if (req.method === 'GET') {
      const s = session(req);
      send(res, 200, s ? { role: s.r === 't' ? 'teacher' : 'student', id: s.id, name: s.n } : { role: null });
      return;
    }
    if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');
    const b = body(req);
    const action = str(b.action, 40);
    const q = await db();
    if (action === 'logout') {
      setSession(res, null);
      return send(res, 200, { ok: true });
    }
    if (action === 'teacher-register' || action === 'teacher-login') {
      const email = str(b.email, 120).toLowerCase();
      const pass = typeof b.password === 'string' ? b.password : '';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 400, 'Email no válido');
      if (pass.length < 8) return fail(res, 400, 'La contraseña debe tener al menos 8 caracteres');
      if (action === 'teacher-register') {
        const code = process.env.TEACHER_CODE;
        if (code && str(b.code, 80) !== code) return fail(res, 403, 'Código de registro de profesor incorrecto');
        const name = str(b.name, 60) || email.split('@')[0];
        const ex = await q.query('select id from grid_teachers where email = $1', [email]);
        if (ex.rows.length) return fail(res, 409, 'Ya existe una cuenta con ese email');
        const r = await q.query('insert into grid_teachers (email, name, pass) values ($1, $2, $3) returning id', [email, name, hashPass(pass)]);
        const id = Number(r.rows[0].id);
        setSession(res, { r: 't', id, n: name });
        return send(res, 200, { role: 'teacher', id, name });
      }
      const r = await q.query('select id, name, pass from grid_teachers where email = $1', [email]);
      const row = r.rows[0];
      if (!row || !checkPass(pass, String(row.pass))) return fail(res, 401, 'Email o contraseña incorrectos');
      setSession(res, { r: 't', id: Number(row.id), n: String(row.name) });
      return send(res, 200, { role: 'teacher', id: Number(row.id), name: row.name });
    }
    if (action === 'student-register' || action === 'student-login') {
      const username = str(b.username, 24).toLowerCase();
      const pin = str(b.pin, 8);
      if (!/^[a-z0-9_.-]{3,24}$/.test(username)) return fail(res, 400, 'El usuario debe tener 3-24 letras, números, punto o guion (sin espacios)');
      if (!/^\d{4}$/.test(pin)) return fail(res, 400, 'El PIN debe tener 4 cifras');
      if (action === 'student-register') {
        const ex = await q.query('select id from grid_students where username = $1', [username]);
        if (ex.rows.length) return fail(res, 409, 'Ese nombre de usuario ya está cogido');
        const r = await q.query('insert into grid_students (username, pin) values ($1, $2) returning id', [username, hashPass(pin)]);
        const id = Number(r.rows[0].id);
        setSession(res, { r: 's', id, n: username });
        return send(res, 200, { role: 'student', id, name: username });
      }
      const r = await q.query('select id, pin, fails, locked_until from grid_students where username = $1', [username]);
      const row = r.rows[0];
      if (!row) return fail(res, 401, 'Usuario o PIN incorrectos');
      if (row.locked_until && new Date(String(row.locked_until)).getTime() > Date.now()) {
        return fail(res, 429, 'Demasiados intentos. Espera 10 minutos o pide ayuda al profesor.');
      }
      if (!checkPass(pin, String(row.pin))) {
        const fails = Number(row.fails ?? 0) + 1;
        const lock = fails >= 8 ? new Date(Date.now() + 10 * 60_000).toISOString() : null;
        await q.query('update grid_students set fails = $1, locked_until = $2 where id = $3', [lock ? 0 : fails, lock, row.id]);
        return fail(res, 401, 'Usuario o PIN incorrectos');
      }
      await q.query('update grid_students set fails = 0, locked_until = null where id = $1', [row.id]);
      setSession(res, { r: 's', id: Number(row.id), n: username });
      return send(res, 200, { role: 'student', id: Number(row.id), name: username });
    }
    return fail(res, 400, 'Acción desconocida');
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'Error del servidor');
  }
}
