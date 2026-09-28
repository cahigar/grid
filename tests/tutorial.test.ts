import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEVELS, LIB_FILE, LIB_FROM, LIB_TEMPLATE, buildTutorial, type LevelCtx } from '../src/client/tutorial/levels';

const IRA = `def ir_a(x, y):
    mx, my = posicion()
    while mx != x:
        mover("E" if mx < x else "O")
        mx, my = posicion()
    while my != y:
        mover("S" if my < y else "N")
        mx, my = posicion()
`;

const SOL: Record<string, string> = {
  'Primeros pasos': 'for _ in range(4):\n    mover("E")\nmover("S")\nmover("S")\n',
  'Repetir sin repetirse': 'for i in range(15):\n    mover("E")\n',
  'Decidir': 'for i in range(20):\n    if not mover("E"):\n        mover("S")\n',
  'Tu primera función': `def ir_a(x, y):
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
  'Recordar y ordenar': `from mi_biblioteca import ir_a
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
  'Cuando algo sale mal': `pendientes = [3, 4, 5]
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
  'Tu biblioteca': `from mi_biblioteca import ir_a
ir_a(9, 1)
ir_a(3, 5)
`,
  'Fábrica': `def puedo_pagar(tipo):
    alm = almacen()
    for recurso, cantidad in coste_unidad(tipo).items():
        if alm[recurso] < cantidad:
            return False
    return True
for tipo in ["constructor", "minero", "granjero"]:
    if puedo_pagar(tipo):
        fabricar(tipo)
`,
  'Planos y objetos': `class Obra:
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
  'Hacker': `while True:
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
    const code = SOL[lvl.title];
    assert.ok(code, 'falta la solución');
    const files: Record<string, string> = { 'nivel.py': code };
    if (lvl.n >= LIB_FROM) files[LIB_FILE] = IRA;
    game.player('p1')!.p.files = { ...files };
    const r = game.runProgram(u.id, 'nivel.py', files);
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
    const f2: Record<string, string> = { 'nivel.py': lvl.starter };
    if (lvl.n >= LIB_FROM) f2[LIB_FILE] = LIB_TEMPLATE;
    assert.ok(b2.game.runProgram(u2.id, 'nivel.py', f2).ok);
  });
}

test('tutorial: 10 niveles y la biblioteca empieza en el 5', () => {
  assert.equal(LEVELS.length, 10);
  assert.equal(LIB_FROM, 5);
  assert.deepEqual(LEVELS.map((l) => l.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('tutorial: con la plantilla de la biblioteca, el nivel 5 no se da por bueno', () => {
  const lvl = LEVELS[4];
  const t0 = Date.UTC(2026, 8, 28);
  const { game, beacons } = buildTutorial(lvl, t0);
  const u = game.unitsOf('p1').find((x) => x.type === lvl.unit)!;
  const code = 'def ir_a(x, y):\n    pass\n' + IRA + 'ir_a(9, 1)\nir_a(3, 5)\n';
  game.player('p1')!.p.files = { 'nivel.py': code, [LIB_FILE]: LIB_TEMPLATE };
  game.runProgram(u.id, 'nivel.py', { 'nivel.py': code, [LIB_FILE]: LIB_TEMPLATE });
  game.advanceTo(t0 + 120_000);
  const res = lvl.check({ game, code, beacons, visited: new Set() });
  assert.equal(res.done, false);
});
