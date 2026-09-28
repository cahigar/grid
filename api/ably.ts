// Emite tokens de Ably con permisos mínimos: el profesor controla su sala; cada alumno sólo su canal.
import Ably from 'ably';
import { verify } from './_lib/auth.js';
import { db } from './_lib/db.js';
import { fail, session, str, type Req, type Res } from './_lib/http.js';

export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    const key = process.env.ABLY_API_KEY;
    if (!key) return fail(res, 503, 'Tiempo real no configurado (falta ABLY_API_KEY)');
    const code = str(req.query.room, 12).toUpperCase();
    const pre = `grid:${code}:`;
    let clientId = '';
    let capability: Record<string, string[]> = {};
    const s = session(req);
    const jt = verify<{ room: string; cid: string }>(str(req.query.jt, 2000));
    if (jt && jt.room === code) {
      clientId = jt.cid;
      capability = { [`${pre}all`]: ['subscribe'], [`${pre}c:${jt.cid}`]: ['subscribe'], [`${pre}host`]: ['publish'] };
    } else if (s?.r === 't') {
      const q = await db();
      const r = await q.query('select 1 from grid_rooms where code = $1 and teacher_id = $2', [code, s.id]);
      if (!r.rows.length) return fail(res, 403, 'Esa sala no es tuya');
      clientId = `profe${s.id}`;
      capability = { [`${pre}*`]: ['publish', 'subscribe', 'presence'] };
    } else return fail(res, 401, 'Sin permiso para esta sala');
    const rest = new Ably.Rest({ key });
    const tr = await rest.auth.createTokenRequest({ clientId, capability: JSON.stringify(capability), ttl: 4 * 3600 * 1000 });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(tr);
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'Error del servidor');
  }
}
