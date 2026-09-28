import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOTS, STARTER_FILES } from '../src/sim/world/content';
import { Game, cargoCount } from '../src/sim/world/game';

const T0 = Date.UTC(2026, 8, 27, 8, 0, 0);
const cfg = { w: 64, h: 64, seed: 20260927, tzOffsetMin: 120, name: 'Valle de prueba' };

function newGame() {
  const g = Game.create(cfg, T0, 4);
  g.addPlayer('p1', 'Carlos', false, { ...STARTER_FILES });
  for (const b of BOTS) {
    g.addPlayer(b.id, b.name, true, b.files);
  }
  return g;
}

const SOLUCION = `
from rutas import ir_a
while True:
    vetas = [r for r in escanear() if r.tipo != "biomasa"]
    if not vetas:
        lado = memoria.get("lado", 3)
        d = memoria.get("d", 0)
        for _ in range(lado):
            mover(["E", "S", "O", "N"][d])
        memoria["d"] = (d + 1) % 4
        memoria["lado"] = lado + 2 if d % 2 == 1 else lado
        if bateria() < 30:
            bx, by = base()
            ir_a(bx, by)
            recargar()
        continue
    v = vetas[0]
    if ir_a(v.x, v.y):
        while carga() < carga_max() and extraer():
            pass
    bx, by = base()
    ir_a(bx, by)
    descargar()
    recargar()
`;

test('el mundo se genera y los jugadores tienen base, dron y niebla', () => {
  const g = newGame();
  assert.equal(g.players.size, 4);
  const p = g.player('p1')!;
  const units = g.unitsOf('p1');
  assert.equal(units.length, 1);
  assert.equal(units[0].name, 'DRN-01');
  assert.equal(units[0].x, p.p.dock.x);
  const known = p.known.reduce((a, b) => a + b, 0);
  assert.ok(known > 50 && known < 400, `conocidas: ${known}`);
  assert.ok(g.resources.size > 30);
});

test('bucle completo: explorar, minar, volver, descargar (y persistir)', () => {
  const g = newGame();
  const bfs = BOTS.find((b) => b.id === 'bot-taller9')!.files['rutas.py'];
  const files = { 'main.py': SOLUCION, 'rutas.py': bfs };
  const [u] = g.unitsOf('p1');
  const r = g.runProgram(u.id, 'main.py', files);
  assert.ok(r.ok, r.error ?? '');
  for (const b of BOTS) g.runProgram(g.unitsOf(b.id)[0].id, b.main, b.files);

  // copia que se guarda y recarga cada 5 minutos: debe evolucionar igual
  let g2 = Game.fromState(JSON.parse(JSON.stringify(g.toState())));
  const HOUR = 3600_000;
  for (let t = T0; t <= T0 + HOUR; t += 5 * 60_000) {
    g.advanceTo(t);
    g2.advanceTo(t);
    g2 = Game.fromState(JSON.parse(JSON.stringify(g2.toState())));
  }
  const p = g.player('p1')!;
  const stored = Object.values(p.p.storage).reduce((a, b) => a + b, 0);
  const uu = g.unitsOf('p1')[0];
  assert.ok(stored > 10, `almacenado: ${stored}; estado ${uu.status}; logs:\n${uu.logs.slice(-12).map((l) => l.m).join('\n')}`);
  assert.deepEqual(g2.player('p1')!.p.storage, p.p.storage);
  assert.equal(g2.unitsOf('p1')[0].x, uu.x);
  assert.equal(g2.unitsOf('p1')[0].y, uu.y);
  for (const b of BOTS) {
    const bu = g.unitsOf(b.id)[0];
    assert.notEqual(bu.status, 'ERROR', `${b.name}: ${bu.error?.type} ${bu.error?.msg} línea ${bu.error?.line}`);
  }
  const rk = g.rankings();
  assert.equal(rk[0].key, 'general');
  console.log('almacén jugador:', p.p.storage, 'cargo', cargoCount(uu), 'eventos', g.eventsProcessed);
  for (const b of BOTS) console.log(b.name, g.player(b.id)!.p.storage, g.unitsOf(b.id)[0].status);
});

test('while True: mover("E") queda BLOQUEADO con contador, sin romper nada', () => {
  const g = newGame();
  const [u] = g.unitsOf('p1');
  g.runProgram(u.id, 'main.py', { 'main.py': 'while True:\n    mover("E")\n' });
  g.advanceTo(T0 + 2 * 3600_000);
  assert.ok(u.blocked && u.blocked.attempts > 1000, JSON.stringify(u.blocked));
  assert.ok(u.logs.some((l) => l.m.startsWith('BLOQUEADO')));
  assert.equal(u.status, 'RUNNING');
});

test('errores de ejecución y de sintaxis se reportan con línea', () => {
  const g = newGame();
  const [u] = g.unitsOf('p1');
  const bad = g.runProgram(u.id, 'main.py', { 'main.py': 'mover("E")\nif True\n  pass' });
  assert.equal(bad.ok, false);
  assert.equal(bad.line, 2);
  g.runProgram(u.id, 'main.py', { 'main.py': 'mover("E")\nx = [1][3]\n' });
  g.advanceTo(T0 + 60_000);
  assert.equal(u.status, 'ERROR');
  assert.equal(u.error?.line, 2);
  assert.equal(u.error?.type, 'IndexError');
});

test('la batería se agota → hiberna y se recupera sola', () => {
  const g = newGame();
  const [u] = g.unitsOf('p1');
  g.runProgram(u.id, 'main.py', { 'main.py': 'while True:\n    escanear()\n' });
  g.advanceTo(T0 + 3 * 60_000);
  assert.equal(u.status, 'HIBERNATING');
  g.advanceTo(T0 + 30 * 60_000);
  assert.ok(u.logs.filter((l) => l.m.startsWith('Escaneo')).reduce((a, l) => a + l.n, 0) > 60);
});

test('catch-up: 8 horas desconectado se calculan rápido', () => {
  const g = newGame();
  for (const b of BOTS) g.runProgram(g.unitsOf(b.id)[0].id, b.main, b.files);
  const t0 = performance.now();
  g.advanceTo(T0 + 8 * 3600_000);
  const ms = performance.now() - t0;
  console.log(`8 h simuladas en ${ms.toFixed(0)} ms (${g.eventsProcessed} eventos)`);
  assert.ok(ms < 20_000);
});

test('fabricar() crea una unidad nueva que se puede programar', () => {
  const g = newGame();
  const p = g.player('p1')!;
  p.p.storage.hierro = 40;
  p.p.storage.cobre = 10;
  p.p.storage.chatarra = 10;
  const [u] = g.unitsOf('p1');
  g.runProgram(u.id, 'main.py', { 'main.py': 'print(fabricar("explorador"))\nprint(fabricar("minero"))\nprint(fabricar("minero"))\n' });
  g.advanceTo(T0 + 10 * 60_000);
  const names = g.unitsOf('p1').map((x) => x.name);
  assert.deepEqual(names, ['DRN-01', 'EXP-01', 'MIN-01']);
  assert.ok(u.logs.some((l) => l.m === 'None'), 'el tercero falla por recursos');
  const exp = g.unitsOf('p1')[1];
  const r = g.runProgram(exp.id, 'e.py', { 'e.py': 'for _ in range(3):\n    mover("N")\nprint(escanear())' });
  assert.ok(r.ok);
  g.advanceTo(T0 + 12 * 60_000);
  assert.equal(exp.status, 'DONE');
});
