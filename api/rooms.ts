// Salas: el profesor las crea; los alumnos se unen con el código (o el QR) y reciben un token de sala.
import { randomBytes } from 'node:crypto';
import { sign } from './_lib/auth.js';
import { db } from './_lib/db.js';
import { body, fail, send, session, str, type Req, type Res } from './_lib/http.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode(): string {
  const b = randomBytes(6);
  return [...b].map((x) => ALPHA[x % ALPHA.length]).join('');
}

export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    const q = await db();
    const s = session(req);
    if (req.method === 'GET') {
      const code = str(req.query.code, 12).toUpperCase();
      if (code) {
        const r = await q.query('select code, title, open, kind from grid_rooms where code = $1', [code]);
        if (!r.rows.length) return fail(res, 404, 'No existe ninguna sala con ese código');
        return send(res, 200, r.rows[0]);
      }
      if (!s || s.r !== 't') return fail(res, 401, 'Sólo para profesores');
      const r = await q.query('select code, title, open, kind, created_at from grid_rooms where teacher_id = $1 order by created_at desc limit 30', [s.id]);
      return send(res, 200, { rooms: r.rows });
    }
    if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');
    const b = body(req);
    const action = str(b.action, 20);
    if (action === 'create') {
      if (!s || s.r !== 't') return fail(res, 401, 'Inicia sesión como profesor');
      const kind = str(b.kind, 12) === 'espera' ? 'espera' : 'partida';
      const title = str(b.title, 60) || (kind === 'espera' ? 'Sala de espera' : 'Clase');
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const ex = await q.query('select 1 from grid_rooms where code = $1', [code]);
        if (ex.rows.length) continue;
        await q.query('insert into grid_rooms (code, teacher_id, title, kind) values ($1, $2, $3, $4)', [code, s.id, title, kind]);
        return send(res, 200, { code, title, kind, open: true });
      }
      return fail(res, 500, 'No se pudo generar un código');
    }
    if (action === 'join') {
      const code = str(b.code, 12).toUpperCase();
      const r = await q.query('select code, title, open, kind from grid_rooms where code = $1', [code]);
      const room = r.rows[0];
      if (!room) return fail(res, 404, 'No existe ninguna sala con ese código');
      if (!room.open) return fail(res, 403, 'La sala está cerrada');
      const name = str(b.name, 24) || (s?.r === 's' ? s.n : '');
      if (!name) return fail(res, 400, 'Escribe tu nombre');
      let cid = str(b.cid, 40);
      if (s?.r === 's') cid = `s${s.id}`;
      else if (!/^g[a-z0-9]{6,20}$/.test(cid)) cid = 'g' + randomBytes(6).toString('hex');
      const jt = sign({ room: code, cid, name }, 12 * 3600);
      return send(res, 200, { code, title: room.title, kind: room.kind ?? 'partida', cid, name, jt });
    }
    if (action === 'close') {
      if (!s || s.r !== 't') return fail(res, 401, 'Sólo para profesores');
      const code = str(b.code, 12).toUpperCase();
      await q.query('update grid_rooms set open = false where code = $1 and teacher_id = $2', [code, s.id]);
      return send(res, 200, { ok: true });
    }
    return fail(res, 400, 'Acción desconocida');
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'Error del servidor');
  }
}
