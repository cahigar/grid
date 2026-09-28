// Transporte de mensajes en tiempo real: Ably (producción) o BroadcastChannel (mismo navegador, pruebas).
export type Channel = 'host' | 'all' | `c:${string}`;

export interface Transport {
  readonly kind: 'ably' | 'local';
  send(channel: Channel, msg: unknown): void;
  listen(channel: Channel, cb: (msg: unknown) => void): () => void;
  close(): void;
  onStatus?: (s: 'ok' | 'connecting' | 'error', detail?: string) => void;
}

export class LocalTransport implements Transport {
  readonly kind = 'local' as const;
  private chans = new Map<string, BroadcastChannel>();
  onStatus?: (s: 'ok' | 'connecting' | 'error', detail?: string) => void;
  constructor(private room: string) {}
  private ch(name: Channel): BroadcastChannel {
    let c = this.chans.get(name);
    if (!c) {
      c = new BroadcastChannel(`grid:${this.room}:${name}`);
      this.chans.set(name, c);
    }
    return c;
  }
  send(channel: Channel, msg: unknown): void {
    // BroadcastChannel no entrega a la propia pestaña: en local profe y alumno van en pestañas distintas
    this.ch(channel).postMessage(msg);
  }
  listen(channel: Channel, cb: (msg: unknown) => void): () => void {
    const c = this.ch(channel);
    const h = (e: MessageEvent) => cb(e.data);
    c.addEventListener('message', h);
    setTimeout(() => this.onStatus?.('ok'), 0);
    return () => c.removeEventListener('message', h);
  }
  close(): void {
    for (const c of this.chans.values()) c.close();
    this.chans.clear();
  }
}

type AblyRealtime = import('ably').Realtime;

export class AblyTransport implements Transport {
  readonly kind = 'ably' as const;
  private client: AblyRealtime | null = null;
  private ready: Promise<AblyRealtime>;
  private pending: [Channel, unknown][] = [];
  onStatus?: (s: 'ok' | 'connecting' | 'error', detail?: string) => void;

  constructor(private room: string, authUrl: string, clientId: string) {
    this.ready = import('ably').then((Ably) => {
      void clientId;
      const c = new Ably.Realtime({ authUrl, echoMessages: false, authMethod: 'GET' });
      c.connection.on((ch) => {
        if (ch.current === 'connected') this.onStatus?.('ok');
        else if (ch.current === 'failed' || ch.current === 'suspended') this.onStatus?.('error', ch.reason?.message);
        else if (ch.current === 'connecting' || ch.current === 'disconnected') this.onStatus?.('connecting');
      });
      this.client = c;
      for (const [chn, m] of this.pending) this.send(chn, m);
      this.pending = [];
      return c;
    });
  }

  private name(ch: Channel): string {
    return `grid:${this.room}:${ch}`;
  }

  send(channel: Channel, msg: unknown): void {
    if (!this.client) { this.pending.push([channel, msg]); return; }
    this.client.channels.get(this.name(channel)).publish('m', msg).catch((e: Error) => this.onStatus?.('error', e.message));
  }

  listen(channel: Channel, cb: (msg: unknown) => void): () => void {
    let off = () => {};
    let closed = false;
    this.ready.then((c) => {
      if (closed) return;
      const chn = c.channels.get(this.name(channel));
      const h = (m: { data?: unknown }) => cb(m.data);
      chn.subscribe('m', h);
      off = () => chn.unsubscribe('m', h);
    });
    return () => { closed = true; off(); };
  }

  close(): void {
    this.client?.close();
  }
}
