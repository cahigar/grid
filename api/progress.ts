// Progreso del tutorial de cada alumno.
import { db } from './_lib/db.js';
import { body, fail, send, session, str, type Req, type Res } from './_lib/http.js';

export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    const s = session(req);
    if (!s || s.r !== 's') return fail(res, 401, 'Inicia sesión como alumno para guardar tu progreso');
    const q = await db();
    if (req.method === 'GET') {
      const r = await q.query('select level, done, code from grid_progress where student_id = $1 order by level', [s.id]);
      return send(res, 200, { levels: r.rows });
    }
    if (req.method !== 'PUT' && req.method !== 'POST') return fail(res, 405, 'Método no permitido');
    const b = body(req);
    const level = Number(b.level);
    if (!Number.isInteger(level) || level < 1 || level > 20) return fail(res, 400, 'Nivel no válido');
    const code = str(b.code, 20000);
    const done = !!b.done;
    await q.query(
      `insert into grid_progress (student_id, level, done, code, updated_at) values ($1, $2, $3, $4, now())
       on conflict (student_id, level) do update set done = (grid_progress.done or excluded.done), code = excluded.code, updated_at = now()`,
      [s.id, level, done, code],
    );
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'Error del servidor');
  }
}
