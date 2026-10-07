import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WaitClient } from '../src/client/espera/client';
import { WaitHost } from '../src/client/espera/host';
import { OBSTACLES, RADIUS, cleanText, freeSpot, randomSprite, spawnPoint, step, type Motion } from '../src/client/espera/protocol';
import type { Channel, Transport } from '../src/client/net/transport';

class Bus {
  subs = new Map<string, Set<(m: unknown) => void>>();
  queue: [string, unknown][] = [];
  flush() {
    while (this.queue.length) {
      const [ch, m] = this.queue.shift()!;
      for (const cb of this.subs.get(ch) ?? []) cb(JSON.parse(JSON.stringify(m)));
    }
  }
  transport(): Transport {
    return {
      kind: 'local',
      send: (ch: Channel, m: unknown) => this.queue.push([ch, m]),
      listen: (ch: Channel, cb: (m: unknown) => void) => {
        if (!this.subs.has(ch)) this.subs.set(ch, new Set());
        this.subs.get(ch)!.add(cb);
        return () => this.subs.get(ch)!.delete(cb);
      },
      close: () => {},
    };
  }
}

(globalThis as { performance?: unknown }).performance ??= { now: () => Date.now() };

test('sala de espera: entrar, moverse, chat, manos, emotes y moderación', () => {
  const bus = new Bus();
  let clock = 1_000_000;
  const host = new WaitHost(bus.transport(), 'ESP123', 'Espera', () => clock);
  const events: string[] = [];
  host.onEvent = (e) => events.push(`${e.kind}:${e.cid}`);
  const ana = new WaitClient(bus.transport(), 'ana', 'Ana');
  const luis = new WaitClient(bus.transport(), 'luis', 'Luis');
  ana.hello(); luis.hello();
  bus.flush();
  host.tick(clock);
  bus.flush();
  assert.equal(host.onlineCount(), 2);
  assert.ok(ana.me && luis.me, 'ambos reciben su avatar');
  assert.ok(events.includes('join:ana'));
  assert.equal(ana.people.length, 2);

  // ana camina hacia la derecha 1 s: host y alumno llegan al mismo sitio
  const x0 = ana.me!.x;
  ana.setDir(1, 0);
  bus.flush();
  for (let i = 0; i < 20; i++) {
    clock += 50;
    ana.update(0.05, clock);
    host.tick(clock);
    bus.flush();
  }
  ana.setDir(0, 0);
  bus.flush();
  const ha = host.avatars.get('ana')!;
  assert.ok(ana.me!.x > x0 + 50, 'se ha movido');
  assert.ok(Math.abs(ha.x - ana.me!.x) < 2, `host ${ha.x} ≈ alumno ${ana.me!.x}`);
  // luis ve a ana
  clock += 300; host.tick(clock); bus.flush();
  luis.update(0.3, Number.MAX_SAFE_INTEGER);
  assert.ok(Math.abs(luis.remotes.get('ana')!.x - ha.x) < 2);

  // chat con límite de frecuencia y filtro
  const notices: string[] = [];
  luis.onNotice = (n) => notices.push(n);
  luis.chatSend('hola joder');
  luis.chatSend('otra vez');
  bus.flush();
  assert.equal(host.chat.length, 1);
  assert.equal(host.chat[0].text, 'hola j****');
  assert.equal(ana.chat.length, 1);
  assert.equal(notices.length, 1, 'aviso por escribir demasiado rápido');

  // manos: cola en orden y el profe atiende
  luis.hand(true); ana.hand(true);
  bus.flush();
  assert.deepEqual(host.hands, ['luis', 'ana']);
  assert.ok(events.includes('hand:luis'));
  host.tick(clock + 1000); bus.flush();
  assert.deepEqual(ana.hands, ['luis', 'ana']);
  let attended = '';
  luis.onHand = (cid, up, by) => { if (!up && by === 'profe') attended = cid; };
  assert.equal(host.attendNext(), 'luis');
  bus.flush();
  assert.equal(attended, 'luis');
  assert.deepEqual(host.hands, ['ana']);

  // emotes
  let em = -1;
  luis.onEmote = (_c, e) => { em = e; };
  ana.emote(3);
  bus.flush();
  assert.equal(em, 3);

  // moderación: borrar, vaciar, silenciar, expulsar, reiniciar
  host.teacherSay('Empezamos en 5 minutos');
  bus.flush();
  assert.equal(ana.chat.at(-1)!.t, true);
  assert.equal(host.banner?.text, 'Empezamos en 5 minutos');
  host.deleteMsg(host.chat[0].id);
  bus.flush();
  assert.equal(ana.chat.length, 1);
  host.clearChat();
  bus.flush();
  assert.equal(ana.chat.length, 0);
  host.setMuted('luis', true);
  clock += 5000;
  luis.chatSend('¿me oís?');
  bus.flush();
  assert.equal(host.chat.length, 0);
  let kicked = '';
  luis.onKick = (r) => { kicked = r; };
  host.kick('luis');
  bus.flush();
  assert.ok(kicked);
  luis.hello();
  bus.flush();
  assert.ok(!host.avatars.has('luis'), 'no puede volver');
  const ep = host.ep;
  host.reset();
  clock += 300; host.tick(clock); bus.flush();
  assert.equal(host.ep, ep + 1);
  assert.equal(ana.ep, host.ep);
  assert.equal(Math.round(ana.me!.x), Math.round(host.avatars.get('ana')!.x));
  assert.deepEqual(host.hands, []);

  // persistencia del anfitrión
  const h2 = new WaitHost(bus.transport(), 'ESP123', 'Espera', () => clock);
  h2.restore(host.snapshot());
  assert.ok(h2.avatars.has('ana'));
  assert.ok(h2.banned.has('luis'));
});

test('movimiento: no atraviesa mesas (salvo drones) ni sale del aula', () => {
  const desk = OBSTACLES.find((o) => o.kind === 'desk')!;
  const m: Motion = { x: desk.x + desk.w / 2, y: desk.y - RADIUS - 30, dx: 0, dy: 1, tx: null, ty: null };
  for (let i = 0; i < 60; i++) step(m, 'android', 0.05);
  assert.ok(m.y <= desk.y - RADIUS + 0.01, 'el androide se para ante la mesa');
  const d: Motion = { ...m, y: desk.y - RADIUS - 30 };
  for (let i = 0; i < 60; i++) step(d, 'drone', 0.05);
  assert.ok(d.y > desk.y + desk.h, 'el dron pasa por encima');
  const w: Motion = { x: 200, y: 600, dx: -1, dy: 0, tx: null, ty: null };
  for (let i = 0; i < 200; i++) step(w, 'rc', 0.05);
  assert.ok(w.x >= 46 + RADIUS - 0.01);
  // ir a un destino por clic
  const g: Motion = { x: 1200, y: 1200, dx: 0, dy: 0, tx: 1300, ty: 1250 };
  for (let i = 0; i < 100 && g.tx !== null; i++) step(g, 'android', 0.05);
  assert.equal(g.tx, null);
  assert.ok(Math.hypot(g.x - 1300, g.y - 1250) < 1);
  // aparecer siempre en sitio libre
  for (let i = 0; i < 50; i++) {
    const [x, y] = spawnPoint();
    const [fx, fy] = freeSpot(x, y);
    assert.equal(fx, x); assert.equal(fy, y);
  }
});

test('sprites y filtro', () => {
  const counts: Record<string, number> = {};
  let s = 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 4000; i++) { const k = randomSprite(rnd).k; counts[k] = (counts[k] ?? 0) + 1; }
  assert.ok(counts.tree > 100 && counts.tree < 500, `árboles raros: ${counts.tree}`);
  assert.ok(counts.android > counts.tree * 3);
  assert.equal(cleanText('  hola\n\nmundo  ', true), 'hola mundo');
  assert.equal(cleanText('Qué MIERDA', true), 'Qué M*****');
  assert.equal(cleanText('Qué mierda', false), 'Qué mierda');
});

test('filtro: palabras completas', () => {
  assert.equal(cleanText('mi computadora y la disputa', true), 'mi computadora y la disputa');
  assert.equal(cleanText('idiotas!', true), 'i******!');
});
