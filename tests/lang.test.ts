import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSyntax } from '../src/sim/lang/compiler';
import { deserializeVM, serializeVM } from '../src/sim/lang/serialize';
import { PyDict, type Value } from '../src/sim/lang/values';
import { VM, type Host, type RunResult } from '../src/sim/lang/vm';

function makeHost(out: string[], extra: Partial<Host> = {}): Host {
  return {
    functions: {
      mover: (args) => ({ action: 'mover', args, kw: {} }),
      sensor: () => 42,
    },
    print: (t) => out.push(t),
    ...extra,
  };
}

/** Ejecuta hasta terminar; las acciones devuelven True. Opcionalmente serializa en cada acción. */
function run(src: string, opts: { modules?: Record<string, string>; roundtrip?: boolean; budget?: number } = {}) {
  const out: string[] = [];
  const host = makeHost(out);
  let vm = new VM({ main: src, modules: opts.modules ?? {} }, host);
  vm.start();
  let actions = 0;
  let r: RunResult;
  for (let guard = 0; guard < 100000; guard++) {
    r = vm.run(opts.budget ?? 1_000_000);
    if (r.s === 'action') {
      actions++;
      if (opts.roundtrip) {
        const json = JSON.parse(JSON.stringify(serializeVM(vm)));
        vm = deserializeVM(json, host);
      }
      vm.resume(true);
      continue;
    }
    if (r.s === 'budget') continue;
    return { out, r, actions, vm };
  }
  throw new Error('no terminó');
}

const outOf = (src: string, o?: Parameters<typeof run>[1]) => {
  const res = run(src, o);
  if (res.r.s === 'error') throw new Error(`${res.r.type}: ${res.r.msg} (línea ${res.r.line})`);
  return res.out.join('\n');
};

test('aritmética y print', () => {
  assert.equal(outOf('print(1 + 2 * 3, 7 // 2, 7 % 3, -7 // 2, -7 % 3, 2 ** 10, 7 / 2)'), '7 3 1 -4 2 1024 3.5');
  assert.equal(outOf('print("a" + "b", "ab" * 3, len("hola"))'), 'ab ababab 4');
  assert.equal(outOf('x = 5\nx += 3\nx *= 2\nprint(x)'), '16');
});

test('estructuras de control', () => {
  const src = `
total = 0
for i in range(10):
    if i % 2 == 0:
        continue
    if i > 7:
        break
    total += i
print(total)
n = 0
while n < 5:
    n += 1
else:
    print("fin", n)
print(1 < 2 < 3, 1 < 3 < 2, 0 if False else 1)
`;
  assert.equal(outOf(src), '16\nfin 5\nTrue False 1');
});

test('funciones, defaults, recursión, closures, lambda', () => {
  const src = `
def fact(n):
    return 1 if n <= 1 else n * fact(n - 1)
def saluda(nombre, signo="!"):
    return "hola " + nombre + signo
def contador():
    c = 0
    def inc():
        nonlocal c
        c += 1
        return c
    return inc
k = contador()
k(); k()
print(fact(10), saluda("dron"), saluda("x", signo="?"), k())
pts = [(3, 1), (1, 2), (2, 0)]
print(sorted(pts, key=lambda p: p[1]), max(pts, key=lambda p: p[0]))
`;
  assert.equal(outOf(src), 'hola dron! hola x? 3'.replace(/^/, '3628800 ') + '\n[(2, 0), (3, 1), (1, 2)] (3, 1)');
});

test('diccionarios con tuplas, sets, comprensiones, f-strings, slicing', () => {
  const src = `
mapa = {}
mapa[(1, 2)] = "hierro"
vis = set()
vis.add((0, 0)); vis.add((0, 0)); vis.add((1, 0))
cuadrados = [x * x for x in range(6) if x % 2 == 0]
d = {k: v for k, v in [("a", 1), ("b", 2)]}
x, y = (3, 4)
print(mapa[(1, 2)], len(vis), (1, 0) in vis, cuadrados, d)
print(f"pos=({x}, {y}) bat={87.456:.1f}% {'ok':>4}|")
l = [0, 1, 2, 3, 4, 5]
print(l[1:4], l[::-1], l[-2:], "robot"[1:3])
for i, v in enumerate(["a", "b"]):
    print(i, v)
`;
  assert.equal(outOf(src), "hierro 2 True [0, 4, 16] {'a': 1, 'b': 2}\npos=(3, 4) bat=87.5%   ok|\n[1, 2, 3] [5, 4, 3, 2, 1, 0] [4, 5] ob\n0 a\n1 b");
});

test('try/except y errores con línea', () => {
  const src = `
try:
    x = [1, 2][5]
except IndexError as e:
    print("capturado:", e)
try:
    int("abc")
except (TypeError, ValueError):
    print("valor")
finally:
    print("siempre")
`;
  assert.equal(outOf(src), 'capturado: índice 5 fuera de rango (lista de longitud 2)\nvalor\nsiempre');
  const r = run('a = 1\nb = c + 1\n').r;
  assert.equal(r.s, 'error');
  if (r.s === 'error') { assert.equal(r.type, 'NameError'); assert.equal(r.line, 2); }
  const r2 = run('n = 0\ndef f():\n    n += 1\nf()\n').r;
  assert.ok(r2.s === 'error' && r2.type === 'UnboundLocalError' && r2.msg.includes("global n"));
});

test('errores de sintaxis', () => {
  assert.equal(checkSyntax('x = 1\nif x == 1\n    print(x)')?.line, 2);
  assert.ok(checkSyntax('def f(:\n  pass'));
  assert.equal(checkSyntax('for i in range(3):\n    print(i)\n'), null);
  assert.ok(checkSyntax('while True:\nprint(1)')?.msg.includes('IndentationError'));
});

test('acciones suspenden la VM y la serialización mantiene el estado', () => {
  const src = `
visitados = set()
pos = [0, 0]
ruta = []
def paso(d):
    ok = mover(d)
    if d == "E":
        pos[0] += 1
    visitados.add(tuple(pos))
    ruta.append(d)
    return ok
for i in range(5):
    paso("E")
alias = ruta
alias.append("fin")
print(len(visitados), ruta, sensor())
`;
  const a = run(src);
  const b = run(src, { roundtrip: true });
  assert.equal(a.actions, 5);
  assert.deepEqual(a.out, b.out);
  assert.equal(b.out[0], "5 ['E', 'E', 'E', 'E', 'E', 'fin'] 42");
});

test('presupuesto de instrucciones: el bucle infinito no bloquea', () => {
  const out: string[] = [];
  const vm = new VM({ main: 'n = 0\nwhile True:\n    n += 1\n', modules: {} }, makeHost(out));
  vm.start();
  const r = vm.run(5000);
  assert.equal(r.s, 'budget');
  assert.ok(vm.instrTotal >= 5000 && vm.instrTotal < 5010);
});

test('recursión infinita da RecursionError', () => {
  const r = run('def f(n):\n    return f(n + 1)\nf(0)').r;
  assert.ok(r.s === 'error' && r.type === 'RecursionError');
});

test('módulos del jugador: import y from-import', () => {
  const modules = {
    nav: 'PASOS = 0\ndef ir(n):\n    global PASOS\n    for _ in range(n):\n        mover("E")\n        PASOS += 1\n    return PASOS\n',
    util: 'def doble(x):\n    return x * 2\n',
  };
  const src = 'import nav\nfrom util import doble\nprint(nav.ir(3), doble(nav.PASOS))';
  assert.equal(outOf(src, { modules }), '3 6');
  assert.equal(outOf(src, { modules, roundtrip: true }), '3 6');
  const r = run('import navegacion', { modules }).r;
  assert.ok(r.s === 'error' && r.type === 'ImportError');
});

test('BFS y Dijkstra con heapq (algoritmos del jugador)', () => {
  const src = `
import heapq
from collections_fake import *
`;
  void src;
  const bfs = `
grid = ["....#", ".##.#", "...#.", "#...."]
def vecinos(p):
    x, y = p
    for dx, dy in [(1,0),(-1,0),(0,1),(0,-1)]:
        nx, ny = x + dx, y + dy
        if 0 <= ny < len(grid) and 0 <= nx < len(grid[0]) and grid[ny][nx] != "#":
            yield_ = (nx, ny)
            res.append(yield_)
def bfs(inicio, fin):
    cola = [inicio]
    padre = {inicio: None}
    while cola:
        actual = cola.pop(0)
        if actual == fin:
            break
        global res
        res = []
        vecinos(actual)
        for v in res:
            if v not in padre:
                padre[v] = actual
                cola.append(v)
    camino = []
    n = fin
    while n is not None:
        camino.append(n)
        n = padre[n]
    return camino[::-1]
res = []
print(len(bfs((0, 0), (4, 3))) - 1)
import heapq
def dijkstra(costes, ini, fin):
    dist = {ini: 0}
    h = [(0, ini)]
    while h:
        d, p = heapq.heappop(h)
        if p == fin:
            return d
        if d > dist.get(p, float("inf")):
            continue
        for q, c in costes.get(p, []):
            nd = d + c
            if nd < dist.get(q, float("inf")):
                dist[q] = nd
                heapq.heappush(h, (nd, q))
    return None
g = {"a": [("b", 7), ("c", 2)], "c": [("b", 3), ("d", 8)], "b": [("d", 1)]}
print(dijkstra(g, "a", "d"))
`;
  assert.equal(outOf(bfs), '7\n6');
});

test('random determinista por semilla y externos compartidos', () => {
  const out: string[] = [];
  const mem = new PyDict();
  const host = makeHost(out, { globals: { memoria: mem as Value } });
  const vm = new VM({ main: 'import random\nmemoria["x"] = random.randint(1, 100)\nmover("N")\nprint(memoria["x"])', modules: {} }, host, 7);
  vm.start();
  const r = vm.run(1e6);
  assert.equal(r.s, 'action');
  const st = JSON.parse(JSON.stringify(serializeVM(vm, new Map([[mem, 'memoria']]))));
  const vm2 = deserializeVM(st, host, { memoria: mem });
  vm2.resume(true);
  vm2.run(1e6);
  assert.equal(out[0], String(mem.get('x')));
});

test('clases: __init__, métodos, herencia, __str__, isinstance, excepciones propias', () => {
  const src = `
class Ruta:
    """Una lista de pasos"""
    def __init__(self, nombre, pasos=None):
        self.nombre = nombre
        self.pasos = pasos if pasos else []
    def agregar(self, d):
        self.pasos.append(d)
        return self
    def __len__(self):
        return len(self.pasos)
    def __str__(self):
        return f"Ruta {self.nombre}: {''.join(self.pasos)}"

class RutaSegura(Ruta):
    def agregar(self, d):
        if d not in "NSEO":
            raise DireccionError("mala: " + d)
        return Ruta.agregar(self, d)

class DireccionError(Exception):
    pass

r = RutaSegura("a")
r.agregar("N").agregar("E")
print(r, isinstance(r, Ruta), isinstance(r, RutaSegura), r.pasos)
try:
    r.agregar("X")
except DireccionError as e:
    print("capturado", e)
try:
    r.agregar("Z")
except Exception as e:
    print("general", e)
for d in r.pasos:
    mover(d)
print(r.nombre, len(r.pasos))
`;
  const a = outOf(src);
  const b = outOf(src, { roundtrip: true });
  assert.equal(a, b);
  assert.equal(a, 'Ruta a: NE True True [\'N\', \'E\']\ncapturado mala: X\ngeneral mala: Z\na 2');
});
