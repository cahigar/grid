import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOT_FILES, BOT_NAMES, DEFAULT_PROGRAM, STARTER_FILES } from '../src/sim/world/content';
import { Game, cargoCount } from '../src/sim/world/game';
import { buildLevel } from '../src/sim/world/level';
import { T } from '../src/sim/world/types';

const T0 = Date.UTC(2026, 8, 28, 8, 0, 0);

function run(g: Game, unitName: string, src: string, owner = 'p1', extra: Record<string, string> = {}) {
  const u = g.unitsOf(owner).find((x) => x.name === unitName)!;
  const r = g.runProgram(u.id, 'main.py', { 'main.py': src, ...extra });
  assert.ok(r.ok, r.error ?? '');
  return u;
}

function logs(u: { logs: { m: string }[] }) {
  return u.logs.map((l) => l.m).join('\n');
}

test('partida de 20: mapa, bases, 4 unidades, parcelas y almacén inicial', () => {
  const cfg = { w: 88, h: 88, seed: 12345, tzOffsetMin: 0, name: 'Sala', timeScale: 0.35, match: { start: T0, prepMs: 60_000, playMs: 15 * 60_000, hacking: true, hackBreak: false }, startStorage: { hierro: 6, cobre: 4, silicio: 2, chatarra: 6 } };
  const g = Game.create(cfg, T0, 20);
  for (let i = 0; i < 20; i++) g.addPlayer(`p${i}`, `Alumno ${i}`, false, { ...STARTER_FILES });
  assert.equal(g.players.size, 20);
  const us = g.unitsOf('p7');
  assert.deepEqual(us.map((u) => u.type).sort(), ['base', 'constructor', 'granjero', 'hacker', 'minero']);
  const pl = g.player('p7')!;
  assert.equal(pl.p.storage.hierro, 6);
  const b = pl.p.base;
  assert.equal(g.terrain[(b.y + 1) * 88 + b.x + 3], T.CULTIVO);
  assert.ok(g.parcels.size >= 120);
  for (const u of us) assert.notEqual(g.terrainAt(u.x, u.y), T.CULTIVO);
});

test('fases: en preparación no se mueve nada; al acabar se congela', () => {
  const { game: g } = buildLevel({ map: ['B.......', '........', 'M.......', '........'] }, T0);
  g.cfg.match = { start: T0, prepMs: 10_000, playMs: 20_000, hacking: true, hackBreak: true };
  const u = run(g, 'MIN-01', 'while True:\n    mover("E")\n    mover("O")\n');
  g.advanceTo(T0 + 9_000);
  assert.equal(g.phase(), 'prep');
  assert.equal(u.actions, 0);
  g.advanceTo(T0 + 20_000);
  assert.equal(g.phase(), 'play');
  const mid = u.actions;
  assert.ok(mid > 3);
  g.advanceTo(T0 + 60_000);
  assert.equal(g.phase(), 'end');
  const end = u.actions;
  g.advanceTo(T0 + 120_000);
  assert.equal(u.actions, end);
  assert.equal(g.runProgram(u.id, 'main.py', { 'main.py': 'pass' }).ok, false);
});

test('granjero: plantar, regar, excepción si no está maduro, cosechar y entregar', () => {
  const { game: g } = buildLevel({ map: ['B..hh.', '......', 'G.....'] }, T0);
  const src = `
for _ in range(3):
    mover("E")
mover("N")
mover("N")
plantar()
regar()
regar()
try:
    recolectar()
except CultivoNoMaduroError as e:
    print("aún no:", e)
while not parcela_aqui().lista:
    if parcela_aqui().humedad < 40:
        regar()
    esperar(5)
print("cosechado", recolectar())
for _ in range(3):
    mover("O")
mover("S")
mover("S")
print("descargado", descargar())
`;
  const u = run(g, 'GRJ-01', src);
  g.advanceTo(T0 + 5 * 60_000);
  assert.equal(u.status, 'DONE', logs(u));
  assert.match(logs(u), /aún no: el cultivo está al \d+ % de madurez/);
  assert.match(logs(u), /cosechado 2/);
  assert.equal(g.player('p1')!.p.storage.cosecha, 2);
  assert.equal(g.player('p1')!.p.totals.delivered, 6);
});

test('granjero: se queda sin agua → SinRecursosError; minero no puede plantar', () => {
  const { game: g } = buildLevel({ map: ['B..h..', '......', 'G..M..'] }, T0);
  const u = run(g, 'GRJ-01', 'for _ in range(3):\n    mover("E")\nmover("N")\nmover("N")\nfor _ in range(10):\n    regar()\n');
  const m = run(g, 'MIN-01', 'plantar()');
  g.advanceTo(T0 + 60_000);
  assert.equal(u.status, 'ERROR');
  assert.equal(u.error?.type, 'SinRecursosError');
  assert.equal(m.error?.type, 'AccionInvalidaError');
  assert.match(m.error!.msg, /Minero no puede usar plantar/);
});

test('minero: picar deja recursos en el suelo, recoger, descargar', () => {
  const { game: g } = buildLevel({ map: ['B.....', '......', 'M..i..'] }, T0);
  const u = run(g, 'MIN-01', `
for _ in range(3):
    mover("E")
for _ in range(5):
    picar()
print(suelo())
recoger()
print(inventario())
for _ in range(3):
    mover("O")
descargar()
`);
  g.advanceTo(T0 + 3 * 60_000);
  assert.equal(u.status, 'DONE', logs(u));
  assert.match(logs(u), /\{'hierro': 5\}/);
  assert.equal(g.player('p1')!.p.storage.hierro, 5);
  assert.equal(cargoCount(u), 0);
});

test('constructor: camino, puente, SinRecursosError capturable, aspersor programable', () => {
  const { game: g } = buildLevel({ map: ['B.....', '......', 'C~....', '......'], storage: { chatarra: 4, hierro: 3, cobre: 2 } }, T0);
  const u = run(g, 'CON-01', `
construir("camino", "E")
try:
    construir("panel", "S")
except SinRecursosError as e:
    print("sin recursos:", e)
construir("aspersor", "S")
print(edificios())
`);
  g.advanceTo(T0 + 60_000);
  assert.equal(u.status, 'DONE', logs(u));
  assert.equal(g.terrainAt(1, 2), T.PUENTE);
  assert.match(logs(u), /sin recursos: faltan recursos/);
  const asp = g.unitsOf('p1').find((x) => x.type === 'aspersor');
  assert.ok(asp);
  assert.equal(g.terrainAt(0, 3), T.ESTRUCTURA);
  assert.deepEqual(g.player('p1')!.p.storage, { hierro: 0, cobre: 0, silicio: 0, chatarra: 1, cosecha: 0 });
});

test('aspersor moja a un dron enemigo y riega el huerto', () => {
  const { game: g } = buildLevel({ map: ['B.....E.', '........', '..hg....', '........'], storage: {} }, T0);
  const pl = g.player('p1')!;
  const asp = g.spawnUnit(pl, 'aspersor', [2, 1]);
  const enemy = g.unitsOf('p2')[0];
  g.runProgram(enemy.id, 'e.py', { 'e.py': 'while True:\n    mover("E")\n    mover("O")\n' });
  g.runProgram(asp.id, 'a.py', { 'a.py': 'for u in radar():\n    if u.enemiga:\n        print("disparo", disparar(u.x, u.y))\n' });
  g.advanceTo(T0 + 3000);
  assert.match(logs(asp), /disparo 1/);
  assert.ok(enemy.wetUntil > T0);
  assert.ok(g.parcelAt(2, 2)!.hum > 30);
  const before = enemy.actions;
  g.advanceTo(T0 + 6000);
  assert.equal(enemy.actions, before, 'mojado: no actúa');
});

test('hacker: invierte una dirección del enemigo, que se reinicia; enfriamiento e inmunidad', () => {
  const { game: g } = buildLevel({ map: ['B.....E.', '........', '..Hm....', '........'] }, T0);
  const victim = g.unitsOf('p2')[0];
  const vsrc = 'while True:\n    print(integridad())\n    esperar(1)\n    if tiempo() > 9999:\n        mover("N")\n';
  g.runProgram(victim.id, 'minero.py', { 'minero.py': vsrc });
  g.player('p2')!.p.files['minero.py'] = vsrc;
  const h = run(g, 'HCK-01', `
print(hackear("E", "invertir"))
try:
    hackear("E")
except AccionInvalidaError as e:
    print("espera:", e)
`);
  g.advanceTo(T0 + 20_000);
  assert.equal(h.status, 'DONE', logs(h));
  assert.match(logs(h), /línea \d: mover\("S"\)/);
  assert.match(logs(h), /espera: el módulo de hackeo se está enfriando/);
  assert.ok(victim.hacked);
  assert.match(logs(victim), /HACKEADO/);
  assert.match(logs(victim), /False/);
  assert.notEqual(g.player('p2')!.p.files['minero.py'], victim.program!.original);
  assert.ok(victim.immuneUntil > T0);
});

test('hackeo desactivado por el profesor', () => {
  const { game: g } = buildLevel({ map: ['B.....E.', '........', '..Hm....'] }, T0);
  g.cfg.match = { start: T0 - 1, prepMs: 0, playMs: 600_000, hacking: false, hackBreak: false };
  const h = run(g, 'HCK-01', 'hackear("E")');
  g.advanceTo(T0 + 5000);
  assert.equal(h.error?.type, 'AccionInvalidaError');
  assert.match(h.error!.msg, /desactivado/);
});

test('sin señal: las acciones tardan el doble', () => {
  const map = ['B' + '.'.repeat(29), '.'.repeat(30), 'M' + '.'.repeat(29)];
  const { game: g } = buildLevel({ map }, T0);
  g.cfg.match = { start: T0 - 1, prepMs: 0, playMs: 3_600_000, hacking: true, hackBreak: false };
  const u = run(g, 'MIN-01', 'for _ in range(20):\n    mover("E")\nprint(senal())\nt0 = tiempo()\nmover("E")\n');
  g.advanceTo(T0 + 120_000);
  assert.match(logs(u), /False/);
  assert.ok(u.logs.some((l) => l.m.startsWith('Sin señal')));
});

test('partida completa de 15 min con 6 colonias bot: puntos sin errores', () => {
  const cfg = { w: 64, h: 64, seed: 99, tzOffsetMin: 0, name: 'Sala', timeScale: 0.35, match: { start: T0, prepMs: 30_000, playMs: 15 * 60_000, hacking: true, hackBreak: false }, startStorage: { hierro: 6, cobre: 4, silicio: 2, chatarra: 6 } };
  const g = Game.create(cfg, T0, 6);
  for (let i = 0; i < 6; i++) {
    g.addPlayer(`b${i}`, BOT_NAMES[i % BOT_NAMES.length], true, { ...BOT_FILES });
    for (const u of g.unitsOf(`b${i}`)) {
      if (u.type === 'hacker' && i % 2) continue;
      const r = g.runProgram(u.id, DEFAULT_PROGRAM[u.type], { ...BOT_FILES });
      assert.ok(r.ok, r.error ?? '');
    }
  }
  const t0 = performance.now();
  g.advanceTo(T0 + 16 * 60_000);
  const ms = performance.now() - t0;
  const rk = g.rankings()[0].rows;
  console.log('puntos:', rk.map((r) => `${r.name} ${r.value}`).join(' · '), `(${ms.toFixed(0)} ms, ${g.eventsProcessed} eventos)`);
  for (const [, rt] of g.units) {
    if (rt.u.status === 'ERROR') console.log(rt.u.name, rt.u.type, rt.u.error);
  }
  assert.ok(rk[0].value > 10);
  const errs = [...g.units.values()].filter((r) => r.u.status === 'ERROR' && !r.u.hacked);
  assert.equal(errs.length, 0, errs.map((e) => `${e.u.type} ${e.u.error?.type}: ${e.u.error?.msg} l${e.u.error?.line}`).join('\n'));
});

test('guardar y cargar a mitad de partida da el mismo resultado', () => {
  const cfg = { w: 48, h: 48, seed: 5, tzOffsetMin: 0, name: 'x', timeScale: 0.35, match: { start: T0, prepMs: 0, playMs: 10 * 60_000, hacking: false, hackBreak: false }, startStorage: { hierro: 6, cobre: 4, silicio: 2, chatarra: 6 } };
  const g = Game.create(cfg, T0, 2);
  for (let i = 0; i < 2; i++) {
    g.addPlayer(`b${i}`, `B${i}`, true, { ...BOT_FILES });
    for (const u of g.unitsOf(`b${i}`)) if (u.type !== 'hacker') g.runProgram(u.id, DEFAULT_PROGRAM[u.type], { ...BOT_FILES });
  }
  let g2 = Game.fromState(JSON.parse(JSON.stringify(g.toState())));
  for (let t = T0; t <= T0 + 10 * 60_000; t += 60_000) {
    g.advanceTo(t);
    g2.advanceTo(t);
    g2 = Game.fromState(JSON.parse(JSON.stringify(g2.toState())));
  }
  assert.deepEqual(g2.player('b0')!.p.storage, g.player('b0')!.p.storage);
  assert.deepEqual(g2.player('b1')!.p.totals, g.player('b1')!.p.totals);
});

test('hackeo: una vez empezado se completa aunque el objetivo se aleje', () => {
  const { game: g } = buildLevel({ map: ['B.....E.', '........', '..Hm....', '........'] }, T0);
  const victim = g.unitsOf('p2')[0];
  const vsrc = 'mover("E")\nmover("E")\nesperar(60)\nmover("N")\n';
  g.runProgram(victim.id, 'minero.py', { 'minero.py': vsrc });
  g.player('p2')!.p.files['minero.py'] = vsrc;
  const h = run(g, 'HCK-01', 'print(hackear("E", "invertir"))');
  g.advanceTo(T0 + 6000);
  assert.ok(victim.x > 3, 'el objetivo se ha movido');
  assert.ok(victim.hacked, logs(h));
  assert.match(logs(h), /Hackeo con éxito/);
});

test('base(): aparcamiento libre junto a la base aunque el mapa acabe debajo', () => {
  const { game: g } = buildLevel({ map: ['......', '..B...', '......'] }, T0);
  const d = g.player('p1')!.p.dock;
  const b = g.player('p1')!.p.base;
  assert.equal(g.distRect(d.x, d.y, b.x, b.y, 2, 2), 1);
  assert.ok(d.y < 3 && d.x >= 0);
  assert.notEqual(g.terrainAt(d.x, d.y), T.BASE);
});

test('la base fabrica unidades con recursos y les carga un programa', () => {
  const { game: g } = buildLevel({ map: ['.......', '.B.....', '.......', '.......', '.......'], baseUnit: true, storage: { hierro: 12, chatarra: 4 } }, T0);
  const cen = g.unitsOf('p1').find((u) => u.type === 'base')!;
  const files = { 'main.py': 'print(fabricar("minero", "m.py"))\ntry:\n    fabricar("minero")\nexcept SinRecursosError as e:\n    print("falta:", e)\n', 'm.py': 'print("hola desde", nombre())\n' };
  g.player('p1')!.p.files = { ...files };
  const r = g.runProgram(cen.id, 'main.py', files);
  assert.ok(r.ok);
  g.advanceTo(T0 + 30_000);
  const mins = g.unitsOf('p1').filter((u) => u.type === 'minero');
  assert.equal(mins.length, 1, logs(cen));
  assert.match(logs(cen), /MIN-01/);
  assert.match(logs(cen), /falta: faltan 4 chatarra/);
  assert.match(logs(mins[0]), /hola desde MIN-01/);
  assert.equal(g.player('p1')!.p.storage.hierro, 6);
  const m = mins[0];
  assert.equal(g.distRect(m.x, m.y, 1, 1, 2, 2) >= 1, true);
});

test('las vetas de casillas descubiertas se ven sin escanear', () => {
  const cfg = { w: 60, h: 60, seed: 99, tzOffsetMin: 0, name: 'x', timeScale: 0.35 };
  const g = Game.create(cfg, T0, 4);
  g.addPlayer('p1', 'A', false, { ...STARTER_FILES });
  const pl = g.player('p1')!;
  for (const id of pl.knownRes) {
    const r = g.resources.get(id)!;
    assert.equal(pl.known[r.y * 60 + r.x], 1);
  }
  const visible = [...g.resources.values()].filter((r) => pl.known[r.y * 60 + r.x]);
  assert.equal(visible.length, pl.knownRes.size);
  assert.ok(g.resources.size > 60, `vetas: ${g.resources.size}`);
});
