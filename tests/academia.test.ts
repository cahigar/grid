import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSyntax } from '../src/sim/lang/compiler';
import { ALL_LEVELS, LEVEL_ORDER, SECTIONS } from '../src/sim/academia/content';
import { evaluate } from '../src/sim/academia/engine';

const SOL: Record<string, string> = {
  d1: 'enviar(f"Operador {nombre}: batería {bateria}%")',
  d2: 'enviar(mensaje.strip().upper())',
  d3: 'x = int(codigo[1:3])\ny = int(codigo[4:6])\nenviar((x, y))',
  d4: 'enviar(senal.upper().split("-"))',
  d5: 'ruta.pop(0)\nruta.append("base")\nenviar(ruta)',
  d6: 'inventario[recogido] = inventario.get(recogido, 0) + cantidad\nenviar(inventario)',
  d7: 'enviar(sorted(set(vistas)))',
  dj: `partes = mensaje.split(";")
destino = partes[0].split("=")[1].strip().upper()
x = int(partes[1].split("=")[1])
y = int(partes[2].split("=")[1])
enviar({"destino": destino, "x": x, "y": y})`,
  c1: 'estado = "OK"\nif bateria < 20:\n    estado = "RECARGAR"\nenviar(estado)',
  c2: `if mirar("E") == "agua":
    mover("S")
    mover("E")
    mover("E")
    mover("N")
else:
    mover("E")
    mover("E")
mover("E")
mover("E")`,
  c3: `if mineral == "hierro":
    puntos = 1
elif mineral == "cobre":
    puntos = 2
elif mineral == "silicio":
    puntos = 4
else:
    puntos = 0
enviar(puntos)`,
  c4: 'enviar(bateria >= 30 and carga < 10 and not tormenta)',
  c5: 'enviar(0 <= x < ancho and 0 <= y < alto and terreno in ["hierba", "camino", "puente"])',
  c6: 'enviar("con señal" if distancia <= 11 else "sin señal")',
  c7: `match orden:
    case "N":
        paso = (0, -1)
    case "S":
        paso = (0, 1)
    case "E":
        paso = (1, 0)
    case "O":
        paso = (-1, 0)
    case "PARA":
        paso = (0, 0)
    case _:
        paso = None
enviar(paso)`,
  c8: `match lectura:
    case ("temp", t) if t > 40:
        texto = "ALERTA: calor"
    case ("temp", t):
        texto = f"temperatura {t}"
    case ("hum", h) if h < 20:
        texto = "ALERTA: seco"
    case ("hum", h):
        texto = f"humedad {h}"
    case _:
        texto = "desconocido"
enviar(texto)`,
  cj: `vuela = dron["tipo"] in ["granjero", "hacker"]
match puente:
    case "cerrado":
        d = "ESPERA"
    case "mantenimiento":
        d = "PASA" if vuela else "ESPERA"
    case _:
        if dron["carga"] > 10:
            d = "DESCARGA PRIMERO"
        elif dron["bateria"] < 20:
            d = "RECARGA"
        else:
            d = "PASA"
enviar(d)`,
  b1: 'for i in range(pasos):\n    mover("E")',
  b2: 'for letra in ruta:\n    mover(letra)',
  b3: 'total = 0\nfor c in cargas:\n    total += c\nenviar(total)',
  b4: 'while mirar("E") == "hierba":\n    mover("E")',
  b5: 'viajes = 0\nwhile bateria - 7 >= 20:\n    bateria -= 7\n    viajes += 1\nenviar(viajes)',
  b6: `total = 0
for n in lecturas:
    if n == 999:
        break
    if n < 0:
        continue
    total += n
enviar(total)`,
  b7: 'p = []\nfor i, c in enumerate(casillas):\n    if c != "roca":\n        p.append(i)\nenviar(p)',
  b8: 'b = []\nfor n, x in zip(nombres, baterias):\n    if x < 20:\n        b.append(n)\nenviar(b)',
  b9: `for fila in range(alto):
    for c in range(ancho):
        mover("E")
    for c in range(ancho):
        mover("O")
    mover("S")`,
  bj: 'for ins in instrucciones:\n    for i in range(int(ins[1:])):\n        mover(ins[0])',
};

for (const lvl of ALL_LEVELS) {
  test(`academia ${lvl.id} · ${lvl.title}: la solución pasa las 3 variantes`, () => {
    assert.equal(lvl.variants.length, 3);
    const ev = evaluate(lvl, SOL[lvl.id]);
    assert.equal(ev.reqFail, null);
    ev.results.forEach((r, i) => assert.ok(r.ok, `variante ${i + 1}: ${r.msg}\n${r.prints.join('\n')}`));
    assert.equal(ev.stars, 3, `líneas ${ev.lines} > par ${lvl.par}`);
    // el código inicial compila y no se da por bueno
    assert.equal(checkSyntax(lvl.starter), null);
    assert.ok(evaluate(lvl, lvl.starter).stars < 2, 'el código inicial no debería resolverlo');
  });
}

test('academia: orden estable de niveles', () => {
  const ids = SECTIONS.flatMap((s) => s.levels.map((l) => l.id));
  assert.deepEqual([...ids].sort(), [...LEVEL_ORDER].filter((id) => ids.includes(id)).sort());
  assert.equal(new Set(LEVEL_ORDER).size, LEVEL_ORDER.length);
});

test('academia: los requisitos y los errores se detectan', () => {
  const c7 = ALL_LEVELS.find((l) => l.id === 'c7')!;
  const trampa = 'd = {"N": (0, -1), "S": (0, 1), "E": (1, 0), "O": (-1, 0), "PARA": (0, 0)}\nenviar(d.get(orden))';
  const ev = evaluate(c7, trampa);
  assert.ok(ev.reqFail);
  assert.equal(ev.stars, 0);
  const b4 = ALL_LEVELS.find((l) => l.id === 'b4')!;
  const bucle = evaluate(b4, 'while True:\n    mirar("E")');
  assert.match(bucle.results[0].msg, /no termina/);
  const d6 = ALL_LEVELS.find((l) => l.id === 'd6')!;
  const ke = evaluate(d6, d6.starter);
  assert.equal(ke.results[0].ok, true);
  assert.match(ke.results[1].msg, /KeyError/);
  assert.equal(ke.stars, 1);
});

import { emptyProgress, exportCode, importCode, unlocked, points } from '../src/sim/academia/progress';

test('academia: código de progreso ida y vuelta, errores detectados y desbloqueos', () => {
  const p = emptyProgress();
  p.stars = { d1: 3, d2: 1, dj: 2, c1: 3, b9: 1 };
  p.secs = { datos: 25 * 60 + 12, bucles: 3 * 60 };
  p.last = 'c1';
  const code = exportCode(p);
  assert.match(code, /^[0-9A-Z]{4}(-[0-9A-Z]{1,4})+$/);
  const q = importCode(code.toLowerCase().replace(/-/g, ' '))!;
  assert.deepEqual(q.stars, p.stars);
  assert.equal(q.secs.datos, 25 * 60);
  assert.equal(q.secs.bucles, 180);
  assert.equal(q.last, 'c1');
  // un carácter cambiado → inválido
  const bad = code.slice(0, 5) + (code[5] === 'A' ? 'B' : 'A') + code.slice(6);
  assert.equal(importCode(bad), null);
  assert.equal(importCode('HOLA'), null);
  // desbloqueos
  const e = emptyProgress();
  assert.ok(unlocked(e, 'd1'));
  assert.ok(!unlocked(e, 'd2'));
  assert.ok(unlocked(e, 'c1'), 'cada sección empieza abierta');
  assert.ok(!unlocked(e, 'dj'));
  e.stars = { d1: 1, d2: 1, d3: 1, d4: 1, d5: 1, d6: 1, d7: 1 };
  assert.ok(unlocked(e, 'dj'));
  assert.equal(points(e), 70);
});
