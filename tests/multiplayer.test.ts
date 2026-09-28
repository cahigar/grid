import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HostSession, MirrorSession, type ToStudent } from '../src/client/net/multiplayer';
import type { Channel, Transport } from '../src/client/net/transport';

/** Bus en memoria con entrega asíncrona (como la red) */
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

test('anfitrión y espejos: lobby, inicio, niebla, programas y puntos', async () => {
  const bus = new Bus();
  const host = new HostSession(bus.transport(), 'ABC123', 'Clase de prueba');
  host.settings.prepMin = 0.05;
  host.settings.playMin = 2;
  const students = ['ana', 'luis', 'eva'].map((cid) => {
    const t = bus.transport();
    const inbox: ToStudent[] = [];
    t.listen(`c:${cid}`, (m) => inbox.push(m as ToStudent));
    t.listen('all', (m) => inbox.push(m as ToStudent));
    t.send('host', { type: 'hello', cid, name: cid.toUpperCase(), want: 'init' });
    return { cid, t, inbox, mirror: null as MirrorSession | null };
  });
  bus.flush();
  assert.equal(host.roster().length, 3);
  host.start();
  let clock = 0;
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      clock += 100;
      host.tick(clock);
      bus.flush();
      for (const s of students) {
        for (const m of s.inbox.splice(0)) {
          if (m.type === 'init') s.mirror = new MirrorSession(s.t, s.cid, m);
          else if (m.type === 'patch') s.mirror?.apply(m);
        }
      }
    }
  };
  // el reloj del host usa performance.now: lo simulamos avanzando gameTime a mano
  host.lastReal = 0;
  step(1000);
  for (const s of students) {
    assert.ok(s.mirror, 'init recibido');
    const hg = host.game;
    const mg = s.mirror!.game;
    assert.deepEqual([...mg.terrain], [...hg.terrain], 'mismo terreno');
    assert.equal(mg.unitsOf(s.cid).length, 5);
    const mk = hg.player(s.cid)!.known;
    for (const r of mg.resources.values()) assert.equal(mk[r.y * hg.cfg.w + r.x], 1, 'sólo vetas en casillas descubiertas');
    const known = [...mg.player(s.cid)!.known].reduce((a, b) => a + b, 0);
    assert.ok(known > 30);
  }
  // Ana programa su minero para escanear y moverse
  const ana = students[0];
  const minero = ana.mirror!.game.unitsOf('ana').find((u) => u.type === 'minero')!;
  ana.mirror!.saveFile('ana', 'minero.py', 'for d in "EEEE":\n    mover(d)\nprint(len(escanear()))\n');
  const r = ana.mirror!.run(minero.id, 'minero.py');
  assert.ok(r.ok && r.pending);
  step(20_000);
  const hostU = host.game.units.get(minero.id)!.u;
  assert.equal(hostU.status, 'DONE', hostU.logs.map((l) => l.m).join('\n'));
  const mirU = ana.mirror!.game.units.get(minero.id)!.u;
  assert.equal(mirU.x, hostU.x);
  assert.ok(mirU.logs.some((l) => /^\d+$/.test(l.m)), 'log de print recibido');
  // Luis no ve la unidad de Ana si no la conoce, pero sí las puntuaciones
  assert.ok(students[1].mirror!.game.player('ana'));
  // el profesor edita el código de Luis y le llega
  host.saveFile('luis', 'granjero.py', '# cambiado por el profe\n');
  step(1000);
  assert.equal(students[1].mirror!.game.player('luis')!.p.files['granjero.py'], '# cambiado por el profe\n');
  assert.ok(students[1].mirror!.filesVersion > 0);
});
