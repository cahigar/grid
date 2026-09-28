import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEVELS, buildTutorial, type LevelCtx } from '../src/client/tutorial/levels';

const SOL: Record<number, string> = {
  1: 'for _ in range(4):\n    mover("E")\nmover("S")\nmover("S")\n',
  2: 'for i in range(15):\n    mover("E")\n',
  3: 'for i in range(20):\n    if not mover("E"):\n        mover("S")\n',
  4: `def ir_a(x, y):
    mx, my = posicion()
    while mx != x:
        mover("E" if mx < x else "O")
        mx, my = posicion()
    while my != y:
        mover("S" if my < y else "N")
        mx, my = posicion()
ir_a(11, 1)
ir_a(4, 4)
ir_a(9, 6)
`,
  5: `def ir_a(x, y):
    mx, my = posicion()
    while mx != x:
        mover("E" if mx < x else "O")
        mx, my = posicion()
    while my != y:
        mover("S" if my < y else "N")
        mx, my = posicion()
for v in escanear():
    ir_a(v.x, v.y)
    for i in range(4):
        picar()
    recoger()
bx, by = base()
ir_a(bx, by)
print(inventario())
descargar()
`,
  6: `pendientes = [3, 4, 5]
while pendientes:
    for x in list(pendientes):
        while posicion()[0] < x:
            mover("E")
        while posicion()[0] > x:
            mover("O")
        while posicion()[1] > 1:
            mover("N")
        try:
            recolectar()
            pendientes.remove(x)
        except CultivoNoMaduroError as e:
            print("aún no:", e)
    if pendientes:
        esperar(10)
while posicion()[1] < 2:
    mover("S")
while posicion()[0] > 0:
    mover("O")
descargar()
`,
  7: `class Obra:
    def __init__(self, d):
        self.d = d
    def tramo(self):
        construir("camino", self.d)
        mover(self.d)
obra = Obra("E")
while posicion()[0] < 11:
    obra.tramo()
construir("camino", "E")
`,
  8: `while True:
    rivales = [u for u in radar() if u.enemiga]
    x, y = posicion()
    hecho = False
    for r in rivales:
        if r.x == x + 1 and r.y == y:
            try:
                print(hackear("E"))
                hecho = True
            except Exception as e:
                print(e)
    if hecho:
        break
    if x < 4:
        mover("E")
    else:
        esperar(0.5)
`,
};

for (const lvl of LEVELS) {
  test(`nivel ${lvl.n}: ${lvl.title} se puede resolver`, () => {
    const t0 = Date.UTC(2026, 8, 28);
    const { game, beacons } = buildTutorial(lvl, t0);
    const u = game.unitsOf('p1').find((x) => x.type === lvl.unit)!;
    const code = SOL[lvl.n];
    const r = game.runProgram(u.id, 'nivel.py', { 'nivel.py': code });
    assert.ok(r.ok, r.error ?? '');
    const ctx: LevelCtx = { game, code, beacons, visited: new Set() };
    let res = lvl.check(ctx);
    for (let t = t0; t < t0 + 10 * 60_000 && !res.done; t += 250) {
      game.advanceTo(t);
      res = lvl.check(ctx);
    }
    assert.ok(res.done, `${res.progress} ${res.fail ?? ''}\n${u.status} ${u.error?.type} ${u.error?.msg} l${u.error?.line}\n${u.logs.slice(-6).map((l) => l.m).join('\n')}`);
    // el código de partida no debe romper (no tiene por qué resolverlo)
    const b2 = buildTutorial(lvl, t0);
    const u2 = b2.game.unitsOf('p1').find((x) => x.type === lvl.unit)!;
    assert.ok(b2.game.runProgram(u2.id, 'nivel.py', { 'nivel.py': lvl.starter }).ok);
  });
}
