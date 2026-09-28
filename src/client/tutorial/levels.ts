// Niveles del tutorial: cada uno presenta un concepto de Python a través de un reto del juego.
import { Game } from '../../sim/world/game';
import { buildLevel, type LevelSpec } from '../../sim/world/level';
import { T, type Unit } from '../../sim/world/types';

export interface LevelCtx {
  game: Game;
  code: string;
  beacons: [number, number][];
  visited: Set<string>;
}

export interface Level {
  n: number;
  title: string;
  concept: string;
  intro: string;
  goal: string;
  unit: Unit['type'];
  spec: LevelSpec;
  starter: string;
  hints: string[];
  check: (c: LevelCtx) => { done: boolean; progress: string; fail?: string };
  setup?: (g: Game) => void;
}

/** líneas de código reales (sin vacías ni comentarios) */
export function codeLines(src: string): number {
  return src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;
}

const unitOf = (g: Game, type: Unit['type']) => g.unitsOf('p1').find((u) => u.type === type)!;
const at = (u: Unit, b: [number, number]) => u.x === b[0] && u.y === b[1];

export const LEVELS: Level[] = [
  {
    n: 1,
    title: 'Primeros pasos',
    concept: 'Instrucciones en orden · textos ("strings")',
    intro: 'Tu minero sólo entiende órdenes muy simples. mover("E") lo mueve una casilla al Este. Las direcciones son textos: "N", "S", "E" y "O".',
    goal: 'Lleva el minero hasta la baliza ★.',
    unit: 'minero',
    spec: {
      map: [
        'TTTTTTTTTT',
        'T........T',
        'T.M......T',
        'T........T',
        'T.....*..T',
        'T........T',
        'TTTTTTTTTT',
      ],
      known: 'all',
    },
    starter: `# Cada línea es una orden. Se ejecutan de arriba abajo.
# La baliza ★ está 4 casillas al Este y 2 al Sur.
mover("E")
mover("S")
`,
    hints: ['Necesitas 4 veces mover("E") y 2 veces mover("S").', 'El orden no importa aquí, pero cada orden va en su propia línea.'],
    check: ({ game, beacons }) => {
      const u = unitOf(game, 'minero');
      return { done: at(u, beacons[0]), progress: `Posición (${u.x}, ${u.y}) · baliza (${beacons[0].join(', ')})` };
    },
  },
  {
    n: 2,
    title: 'Repetir sin repetirse',
    concept: 'Bucles: for y range()',
    intro: 'La baliza está lejos, al final de la carretera. Escribir mover("E") catorce veces es aburrido… y tu programa sólo puede tener 3 líneas.',
    goal: 'Llega a la baliza con un programa de 3 líneas o menos.',
    unit: 'minero',
    spec: {
      map: [
        'TTTTTTTTTTTTTTTTTT',
        'T................T',
        'TM==============*T',
        'T................T',
        'TTTTTTTTTTTTTTTTTT',
      ],
      known: 'all',
    },
    starter: `# for i in range(3):   repite 3 veces lo que va con sangría (4 espacios)
for i in range(3):
    mover("E")
`,
    hints: ['Cuenta las casillas que hay hasta la baliza.', 'range(n) repite n veces. ¿Cuánto tiene que valer n?'],
    check: ({ game, beacons, code }) => {
      const u = unitOf(game, 'minero');
      const lines = codeLines(code);
      if (at(u, beacons[0]) && lines > 3) return { done: false, progress: `Has llegado, pero con ${lines} líneas`, fail: 'Llegaste, pero el reto es hacerlo con 3 líneas o menos. Usa un bucle for.' };
      return { done: at(u, beacons[0]) && lines <= 3, progress: `Líneas: ${lines}/3 · posición (${u.x}, ${u.y})` };
    },
  },
  {
    n: 3,
    title: 'Decidir',
    concept: 'Condicionales: if / else · valores True y False',
    intro: 'mover() devuelve True si avanzó y False si chocó. Este pasillo baja en escalera: cuando no puedas ir al Este, baja al Sur.',
    goal: 'Llega a la baliza con un programa de 6 líneas o menos.',
    unit: 'minero',
    spec: {
      map: [
        'RRRRRRRRRRRRRR',
        'RM..RRRRRRRRRR',
        'RRR....RRRRRRR',
        'RRRRRR...RRRRR',
        'RRRRRRRR....RR',
        'RRRRRRRRRRR.*R',
        'RRRRRRRRRRRRRR',
      ],
      known: 'all',
    },
    starter: `# Pista: repite muchas veces "intenta Este; si no puedes, baja"
for i in range(20):
    if not mover("E"):
        pass   # ¿qué harías aquí?
`,
    hints: ['Sustituye pass por mover("S").', 'Si llegas a la baliza antes de acabar el bucle, no pasa nada: los choques sólo cuestan tiempo.'],
    check: ({ game, beacons, code }) => {
      const u = unitOf(game, 'minero');
      const lines = codeLines(code);
      return { done: at(u, beacons[0]) && lines <= 6, progress: `Líneas: ${lines}/6 · posición (${u.x}, ${u.y})` };
    },
  },
  {
    n: 4,
    title: 'Tu primera función',
    concept: 'Funciones: def, parámetros y return',
    intro: 'Hay tres balizas. En vez de calcular cada ruta a mano, crea una función ir_a(x, y) que lleve al minero a cualquier casilla usando posicion().',
    goal: 'Visita las 3 balizas en orden usando una función def.',
    unit: 'minero',
    spec: {
      map: [
        '..............',
        '.M.........*..',
        '..............',
        '..............',
        '....*.........',
        '..............',
        '.........*....',
        '..............',
      ],
      known: 'all',
    },
    starter: `def ir_a(x, y):
    mx, my = posicion()
    # mientras no esté en x, muévete hacia el Este o el Oeste
    while mx != x:
        if mx < x:
            mover("E")
        else:
            mover("O")
        mx, my = posicion()
    # …y ahora lo mismo con y (Norte / Sur)

ir_a(11, 1)
`,
    hints: ['Copia el while de la x y adáptalo a la y: "S" si my < y, "N" si no.', 'Después llama a ir_a(4, 4) y a ir_a(9, 6).'],
    check: ({ game, beacons, code, visited }) => {
      const u = unitOf(game, 'minero');
      for (const b of beacons) if (at(u, b)) visited.add(b.join(','));
      const n = visited.size;
      if (n === 3 && !/^\s*def\s/m.test(code)) return { done: false, progress: '3/3 balizas', fail: 'Muy bien, pero el reto es hacerlo con una función def ir_a(x, y).' };
      return { done: n === 3 && /^\s*def\s/m.test(code), progress: `Balizas visitadas: ${n}/3` };
    },
  },
  {
    n: 5,
    title: 'Recordar y ordenar',
    concept: 'Listas, diccionarios y bucles for sobre listas',
    intro: 'escanear() devuelve una LISTA de vetas. Cada una tiene .tipo, .x y .y. Recórrela con for, pica cada veta, recoge y vuelve a descargar. inventario() te dice lo que llevas en un DICCIONARIO.',
    goal: 'Entrega en la base al menos 10 unidades de mineral.',
    unit: 'minero',
    spec: {
      map: [
        'B...........',
        '............',
        'M..u........',
        '............',
        '..i.........',
        '.x..........',
        '............',
      ],
      known: 'all',
      amount: 6,
    },
    starter: `def ir_a(x, y):
    mx, my = posicion()
    while mx != x:
        mover("E" if mx < x else "O")
        mx, my = posicion()
    while my != y:
        mover("S" if my < y else "N")
        mx, my = posicion()

vetas = escanear()
print("He encontrado", len(vetas), "vetas")
for v in vetas:
    print(v.tipo, v.x, v.y)
    # ve a la veta, pica unas cuantas veces y recoge
bx, by = base()
# vuelve y descarga
`,
    hints: ['Dentro del for: ir_a(v.x, v.y), luego for i in range(4): picar(), y después recoger().', 'Al final: ir_a(bx, by) y descargar(). Mira inventario() con print antes de descargar.'],
    check: ({ game }) => {
      const s = game.player('p1')!.p.storage;
      const n = s.hierro + s.cobre + s.chatarra + s.silicio;
      return { done: n >= 10, progress: `Entregado: ${n}/10` };
    },
  },
  {
    n: 6,
    title: 'Cuando algo sale mal',
    concept: 'Excepciones: try / except',
    intro: 'El dron granjero cosecha con recolectar(), pero si el cultivo no está maduro lanza CultivoNoMaduroError y el programa se para. Con try/except puedes capturar el error y seguir. Las parcelas ya están plantadas y regadas.',
    goal: 'Recoge 3 cosechas y entrégalas en la base, usando try/except.',
    unit: 'granjero',
    spec: {
      map: [
        'B.....',
        '...hhh',
        'G.....',
        '......',
      ],
      known: 'all',
    },
    setup: (g) => {
      const w = g.cfg.w;
      const mats = [100, 60, 100];
      [3, 4, 5].forEach((x, i) => {
        const p = g.parcels.get(1 * w + x)!;
        p.planted = true;
        p.mat = mats[i];
        p.hum = 90;
        p.owner = 'p1';
      });
    },
    starter: `for x in [3, 4, 5]:
    # vuela a la parcela (x, 1)
    while posicion()[0] < x:
        mover("E")
    while posicion()[1] > 1:
        mover("N")
    recolectar()   # ¡cuidado! alguna no está madura
    print("inventario:", inventario())
`,
    hints: ['Envuelve recolectar() así:\ntry:\n    recolectar()\nexcept CultivoNoMaduroError as e:\n    print("aún no:", e)', 'La parcela verde madura sola si tiene humedad: vuelve a por ella más tarde (esperar(20)) y luego vuelve a la base a descargar().'],
    check: ({ game, code }) => {
      const s = game.player('p1')!.p.storage.cosecha;
      const hasTry = /\btry\s*:/.test(code) && /\bexcept\b/.test(code);
      if (s >= 3 && !hasTry) return { done: false, progress: `Cosecha: ${s}`, fail: 'Lo has conseguido, pero el reto es usar try/except.' };
      return { done: s >= 3 && hasTry, progress: `Cosecha entregada: ${s}/3` };
    },
  },
  {
    n: 7,
    title: 'Planos y objetos',
    concept: 'Clases, objetos y métodos',
    intro: 'El constructor necesita cruzar el río. Crea una clase Obra con un método para construir un tramo de camino (sobre el agua se convierte en puente). Tu almacén tiene materiales de sobra.',
    goal: 'Construye un camino continuo hasta la otra orilla (la baliza ★) usando una clase.',
    unit: 'constructor',
    spec: {
      map: [
        'B.....~~.....',
        '......~~.....',
        'C.....~~....*',
        '......~~.....',
      ],
      known: 'all',
      storage: { chatarra: 40, hierro: 10 },
    },
    starter: `class Obra:
    def __init__(self, direccion):
        self.direccion = direccion
        self.tramos = 0

    def tramo(self):
        construir("camino", self.direccion)
        mover(self.direccion)
        self.tramos += 1

obra = Obra("E")
obra.tramo()
print("tramos:", obra.tramos)
`,
    hints: ['Llama a obra.tramo() dentro de un bucle hasta llegar a la baliza (x = 12).', 'while posicion()[0] < 12: obra.tramo()'],
    check: ({ game, beacons, code }) => {
      const b = beacons[0];
      let n = 0;
      for (let x = 1; x < b[0]; x++) {
        const t = game.terrainAt(x, b[1]);
        if (t === T.CAMINO || t === T.PUENTE) n++;
      }
      const need = b[0] - 1;
      const hasClass = /^\s*class\s/m.test(code);
      return { done: n >= need && hasClass, progress: `Tramos: ${n}/${need}${hasClass ? '' : ' · falta la clase'}` };
    },
  },
  {
    n: 8,
    title: 'Hacker',
    concept: 'Textos como datos · radar() y listas de objetos',
    intro: 'Un minero rival va y viene junto a ti. Con radar() lo detectas; cuando esté en una casilla vecina, hackear(direccion, "invertir") le cambia un "N" por un "S" en su código. Tienes 4 s de hackeo y luego 45 s de enfriamiento.',
    goal: 'Hackea con éxito la unidad rival.',
    unit: 'hacker',
    spec: {
      map: [
        'B.......E.',
        '..........',
        '...H.m....',
        '..........',
      ],
      known: 'all',
    },
    setup: (g) => {
      const e = g.unitsOf('p2')[0];
      g.runProgram(e.id, 'rival.py', { 'rival.py': 'while True:\n    mover("N")\n    esperar(2)\n    mover("S")\n    esperar(2)\n' });
      g.player('p2')!.p.files['rival.py'] = 'while True:\n    mover("N")\n    esperar(2)\n    mover("S")\n    esperar(2)\n';
    },
    starter: `for u in radar():
    print(u.nombre, u.tipo, u.x, u.y, "enemiga:", u.enemiga)

mover("E")
# ¿dónde está ahora el rival respecto a ti? usa posicion() y radar()
`,
    hints: ['Cuando estés en (4, 2) y el rival en (5, 2), está al Este: hackear("E", "invertir").', 'Si se ha movido, captura el error:\ntry:\n    print(hackear("E"))\nexcept FueraDeRangoError:\n    esperar(1)'],
    check: ({ game }) => {
      const h = game.player('p1')!.p.totals.hacks;
      return { done: h >= 1, progress: `Hackeos con éxito: ${h}/1` };
    },
  },
];

export function buildTutorial(level: Level, time = Date.now()) {
  const built = buildLevel({ ...level.spec, timeScale: 0.3 }, time);
  level.setup?.(built.game);
  return built;
}
