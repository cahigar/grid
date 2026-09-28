import type { Req, Res } from './_lib/http.js';
import { send } from './_lib/http.js';
import { dbUrl } from './_lib/db.js';

export default function handler(_req: Req, res: Res): void {
  send(res, 200, { ok: true, db: !!(dbUrl()), ably: !!process.env.ABLY_API_KEY });
}
