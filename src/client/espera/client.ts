// Sala de espera — alumno: predice su propio movimiento y suaviza el de los demás.
import type { Transport } from '../net/transport';
import { FLIES, freeSpot, moveInterval, step, type ChatMsg, type Person, type Sprite, type WaitToStudent } from './protocol';

export interface Remote {
  cid: string;
  x: number; y: number;
  fx: number; fy: number;
  tx: number; ty: number;
  t0: number;
  moving: boolean;
}

export class WaitClient {
  me: { x: number; y: number; dx: number; dy: number; tx: number | null; ty: number | null; sprite: Sprite } | null = null;
  ep = 0;
  people: Person[] = [];
  hands: string[] = [];
  chat: ChatMsg[] = [];
  title = '';
  banner: ChatMsg | null = null;
  prof = 'Profe';
  remotes = new Map<string, Remote>();
  lastMsgAt = 0;
  private mi = 200;
  private lastSent = 0;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSig = '';
  private unsub: (() => void)[] = [];
  /** eventos para la interfaz */
  onChat?: (m: ChatMsg) => void;
  onEmote?: (cid: string, e: number) => void;
  onHand?: (cid: string, up: boolean, by?: 'profe') => void;
  onRoster?: () => void;
  onChatReset?: () => void;
  onNotice?: (text: string) => void;
  onKick?: (reason: string) => void;
  onClose?: () => void;
  onInit?: () => void;

  constructor(public t: Transport, public cid: string, public name: string) {
    this.unsub.push(t.listen('all', (m) => this.onMessage(m as WaitToStudent)));
    this.unsub.push(t.listen(`c:${cid}`, (m) => this.onMessage(m as WaitToStudent)));
  }

  hello(): void { this.t.send('host', { type: 'w-hello', cid: this.cid, name: this.name }); }
  ping(): void { this.t.send('host', { type: 'w-ping', cid: this.cid }); }

  private onMessage(m: WaitToStudent): void {
    if (!m || typeof m !== 'object') return;
    this.lastMsgAt = Date.now();
    switch (m.type) {
      case 'w-init':
        this.me = { x: m.x, y: m.y, dx: 0, dy: 0, tx: null, ty: null, sprite: m.you };
        this.ep = m.ep;
        this.chat = m.chat;
        this.onChatReset?.();
        this.onInit?.();
        break;
      case 'w-state': {
        const now = performance.now();
        const seen = new Set<string>();
        for (const [cid, x, y, mv] of m.p) {
          seen.add(cid);
          if (cid === this.cid) {
            // la sala se ha reiniciado: el profe manda
            if (this.me && m.ep !== this.ep) {
              this.ep = m.ep;
              this.me.x = x; this.me.y = y; this.me.dx = this.me.dy = 0; this.me.tx = this.me.ty = null;
            }
            continue;
          }
          const r = this.remotes.get(cid);
          if (!r) { this.remotes.set(cid, { cid, x, y, fx: x, fy: y, tx: x, ty: y, t0: now, moving: !!mv }); continue; }
          r.fx = r.x; r.fy = r.y; r.tx = x; r.ty = y; r.t0 = now; r.moving = !!mv;
          // salto grande (reinicio): sin animación
          if (Math.hypot(x - r.x, y - r.y) > 500) { r.x = r.fx = x; r.y = r.fy = y; }
        }
        for (const cid of [...this.remotes.keys()]) if (!seen.has(cid)) this.remotes.delete(cid);
        if (this.ep !== m.ep && !this.me) this.ep = m.ep;
        break;
      }
      case 'w-roster':
        this.people = m.people;
        this.hands = m.hands;
        this.title = m.title;
        this.banner = m.banner;
        if (m.prof) this.prof = m.prof;
        this.mi = Math.max(moveInterval(1), m.mi);
        this.onRoster?.();
        break;
      case 'w-chat':
        if (!this.chat.some((c) => c.id === m.m.id)) {
          this.chat.push(m.m);
          if (this.chat.length > 150) this.chat.shift();
          this.onChat?.(m.m);
        }
        break;
      case 'w-del':
        this.chat = this.chat.filter((c) => c.id !== m.id);
        this.onChatReset?.();
        break;
      case 'w-clear':
        this.chat = [];
        this.onChatReset?.();
        break;
      case 'w-emote': this.onEmote?.(m.cid, m.e); break;
      case 'w-hand': this.onHand?.(m.cid, m.up, m.by); break;
      case 'w-notice': this.onNotice?.(m.text); break;
      case 'w-kick': this.onKick?.(m.reason); break;
      case 'w-close': this.onClose?.(); break;
    }
  }

  // ───── entrada ─────

  setDir(dx: number, dy: number): void {
    if (!this.me) return;
    if (dx === this.me.dx && dy === this.me.dy) return;
    this.me.dx = dx;
    this.me.dy = dy;
    if (dx || dy) { this.me.tx = this.me.ty = null; }
    this.queueSend();
  }

  goTo(x: number, y: number): void {
    if (!this.me) return;
    this.me.dx = this.me.dy = 0;
    [this.me.tx, this.me.ty] = [x, y];
    this.queueSend();
  }

  chatSend(text: string): void { this.t.send('host', { type: 'w-chat', cid: this.cid, text: text.slice(0, 160) }); }
  emote(e: number): void { this.t.send('host', { type: 'w-emote', cid: this.cid, e }); }
  hand(up: boolean): void { this.t.send('host', { type: 'w-hand', cid: this.cid, up }); }
  handUp(): boolean { return this.hands.includes(this.cid); }

  /** envío con límite de frecuencia (el primero sale ya; los siguientes se agrupan) */
  private queueSend(): void {
    if (this.sendTimer) return;
    const wait = Math.max(0, this.lastSent + this.mi - Date.now());
    if (wait === 0) { this.flush(); return; }
    this.sendTimer = setTimeout(() => { this.sendTimer = null; this.flush(); }, wait);
  }

  private flush(): void {
    const me = this.me;
    if (!me) return;
    const sig = `${Math.round(me.x)},${Math.round(me.y)},${me.dx},${me.dy},${me.tx},${me.ty}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.lastSent = Date.now();
    this.t.send('host', {
      type: 'w-move', cid: this.cid, x: Math.round(me.x), y: Math.round(me.y), dx: me.dx, dy: me.dy,
      tx: me.tx === null ? null : Math.round(me.tx), ty: me.ty === null ? null : Math.round(me.ty),
    });
  }

  /** avanza la predicción propia y la interpolación de los demás. Devuelve si me he movido. */
  update(dt: number, nowPerf: number): boolean {
    let moved = false;
    if (this.me) {
      const hadTarget = this.me.tx !== null;
      moved = step(this.me, this.me.sprite.k, dt);
      // al llegar al destino (o quedarse atascado) avisa de la posición final
      if (hadTarget && this.me.tx === null) this.queueSend();
    }
    for (const r of this.remotes.values()) {
      const k = Math.min(1, (nowPerf - r.t0) / 200);
      r.x = r.fx + (r.tx - r.fx) * k;
      r.y = r.fy + (r.ty - r.fy) * k;
    }
    return moved;
  }

  /** si me reinician el sprite por uno volador/terrestre me recoloco */
  fixSpot(): void {
    if (!this.me) return;
    [this.me.x, this.me.y] = freeSpot(this.me.x, this.me.y, FLIES[this.me.sprite.k]);
  }

  close(): void {
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.t.send('host', { type: 'w-bye', cid: this.cid });
    this.unsub.forEach((f) => f());
  }
}
