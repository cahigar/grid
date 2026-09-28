// Resultados de las partidas (los guarda el navegador del profesor al terminar).
import { db } from './_lib/db.js';
import { body, fail, send, session, str, type Req, type Res } from './_lib/http.js';

export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    const s = session(req);
    if (!s || s.r !== 't') return fail(res, 401, 'Sólo para profesores');
    const q = await db();
    if (req.method === 'GET') {
      const r = await q.query(
        `select r.id, r.room_code, r.created_at, r.data from grid_results r join grid_rooms m on m.code = r.room_code
         where m.teacher_id = $1 order by r.created_at desc limit 50`, [s.id]);
      return send(res, 200, { results: r.rows });
    }
    if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');
    const b = body(req);
    const code = str(b.code, 12).toUpperCase();
    const own = await q.query('select 1 from grid_rooms where code = $1 and teacher_id = $2', [code, s.id]);
    if (!own.rows.length) return fail(res, 403, 'Esa sala no es tuya');
    const data = JSON.stringify(b.data ?? {}).slice(0, 200_000);
    await q.query('insert into grid_results (room_code, data) values ($1, $2)', [code, data]);
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'Error del servidor');
  }
}
