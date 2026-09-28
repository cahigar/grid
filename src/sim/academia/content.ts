// Contenido de la Academia: secciones, retos y variantes.
// IMPORTANTE: los id son estables (el código de progreso depende de LEVEL_ORDER). Añade al final, no reordenes.
import { tup, type J } from '../lang/interop';
import { avoids, uses, type Level, type Section, type Variant } from './engine';

/** Mapa con un camino (letras N/S/E/O) desde M hasta ★, con obstáculos deterministas fuera del camino */
export function pathMap(route: string, opts: { pad?: number; seed?: number; rock?: number } = {}): string[] {
  const pad = opts.pad ?? 1;
  const D: Record<string, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], O: [-1, 0] };
  let x = 0;
  let y = 0;
  const pts: [number, number][] = [[0, 0]];
  for (const c of route) { const d = D[c]; x += d[0]; y += d[1]; pts.push([x, y]); }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - x0 + 1 + pad;
  const h = Math.max(...ys) - y0 + 1 + pad;
  const on = new Set(pts.map(([a, b]) => `${a - x0},${b - y0}`));
  let s = (opts.seed ?? 3) * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const rows: string[] = [];
  for (let j = 0; j < h; j++) {
    let r = '';
    for (let i = 0; i < w; i++) {
      if (i === -x0 && j === -y0) r += 'M';
      else if (i === x - x0 && j === y - y0) r += '*';
      else if (on.has(`${i},${j}`)) r += '.';
      else r += rnd() < (opts.rock ?? 0.35) ? '#' : '.';
    }
    rows.push(r);
  }
  return rows;
}

const V = (preset: Record<string, J>, expect: J): Variant => ({ preset, expect });

// ═════════════════ 1 · Datos ═════════════════
const DATOS: Level[] = [
  {
    id: 'd1', kind: 'consola', title: 'Primer contacto', concept: 'Variables, print y str()',
    story: 'La radio de la colonia ya ha guardado dos datos en variables: tu nombre y la batería de tu dron. La base quiere un mensaje con los dos.',
    goal: 'Envía el texto "Operador <nombre>: batería <bateria>%"',
    learn: [
      { text: 'Una variable es una caja con nombre donde guardas un dato. Con print() lo ves en la consola.', code: 'nombre = "Ana"\nprint(nombre)' },
      { text: 'Los textos se unen con +. Un número no es un texto: conviértelo con str(), o usa una f-string.', code: 'edad = 16\nprint("Tengo " + str(edad) + " años")\nprint(f"Tengo {edad} años")' },
    ],
    starter: `# La radio ya ha guardado estos datos:
print(nombre)
print(bateria)

# Une los textos con + (bateria es un número: usa str())
mensaje = "Operador " + nombre
print(mensaje)
enviar(mensaje)
`,
    hints: ['Te falta ": batería ", la batería y el signo %.', 'mensaje = "Operador " + nombre + ": batería " + str(bateria) + "%"', 'Con f-string: mensaje = f"Operador {nombre}: batería {bateria}%"'],
    par: 2,
    variants: [
      V({ nombre: 'Ana', bateria: 80 }, 'Operador Ana: batería 80%'),
      V({ nombre: 'Luis', bateria: 35 }, 'Operador Luis: batería 35%'),
      V({ nombre: 'Noa', bateria: 100 }, 'Operador Noa: batería 100%'),
    ],
  },
  {
    id: 'd2', kind: 'consola', title: 'Voz baja', concept: 'Métodos de texto: strip(), upper(), len()',
    story: 'Los mensajes llegan con espacios de sobra y en minúsculas. La base sólo entiende mayúsculas y sin espacios a los lados.',
    goal: 'Envía el mensaje limpio (sin espacios alrededor) y en MAYÚSCULAS.',
    learn: [
      { text: 'Los textos tienen métodos: se escriben después de un punto y devuelven un texto nuevo.', code: 't = "  hola  "\nprint(t.strip())   # "hola"\nprint(t.upper())   # "  HOLA  "\nprint(len(t))      # 8' },
      { text: 'Puedes encadenarlos: t.strip().upper()' },
    ],
    starter: `print("[" + mensaje + "]")
print("Letras:", len(mensaje))

limpio = mensaje
enviar(limpio)
`,
    hints: ['strip() quita los espacios de los lados y upper() pasa a mayúsculas.', 'limpio = mensaje.strip().upper()'],
    par: 2,
    variants: [
      V({ mensaje: '  alerta en el sector 4  ' }, 'ALERTA EN EL SECTOR 4'),
      V({ mensaje: 'todo en orden   ' }, 'TODO EN ORDEN'),
      V({ mensaje: '   vuelvan a la base' }, 'VUELVAN A LA BASE'),
    ],
  },
  {
    id: 'd3', kind: 'consola', title: 'Coordenadas', concept: 'Índices y trozos: texto[0], texto[1:3], int()',
    story: 'Las coordenadas llegan en un código como "X12Y07": dos cifras para x y dos para y.',
    goal: 'Envía la tupla (x, y) con números, por ejemplo (12, 7).',
    learn: [
      { text: 'Cada letra de un texto tiene una posición, empezando en 0. Con [inicio:fin] sacas un trozo (el fin no se incluye).', code: 'c = "X12Y07"\nprint(c[0])     # "X"\nprint(c[1:3])   # "12"' },
      { text: 'int() convierte un texto con cifras en número. Una tupla son valores entre paréntesis.', code: 'n = int("07")    # 7\npunto = (3, 4)' },
    ],
    starter: `print(codigo)
print(codigo[0])      # la primera letra
print(codigo[1:3])    # las cifras de x (todavía son texto)

x = 0
y = 0
enviar((x, y))
`,
    hints: ['Las cifras de y están en las posiciones 4 y 5: codigo[4:6]', 'x = int(codigo[1:3])  ·  y = int(codigo[4:6])'],
    par: 3,
    variants: [
      V({ codigo: 'X12Y07' }, tup(12, 7)),
      V({ codigo: 'X03Y15' }, tup(3, 15)),
      V({ codigo: 'X40Y09' }, tup(40, 9)),
    ],
  },
  {
    id: 'd4', kind: 'consola', title: 'Ruido en la radio', concept: 'split(), listas y replace()',
    story: 'La ruta del dron llega separada por guiones y en minúsculas: "n-n-e-s".',
    goal: 'Envía la ruta como LISTA de direcciones en mayúsculas: ["N", "N", "E", "S"]',
    learn: [
      { text: 'split(separador) parte un texto y devuelve una lista con los trozos.', code: 'print("a,b,c".split(","))   # ["a", "b", "c"]' },
      { text: 'replace(viejo, nuevo) cambia trozos de texto; join() hace lo contrario que split.', code: 'print("a-b".replace("-", ""))   # "ab"\nprint("-".join(["a", "b"]))      # "a-b"' },
    ],
    starter: `print(senal)
partes = senal.split("-")
print(partes)
enviar(partes)
`,
    hints: ['Antes de partir, pasa el texto a mayúsculas.', 'enviar(senal.upper().split("-"))'],
    par: 2,
    variants: [
      V({ senal: 'n-n-e-s' }, ['N', 'N', 'E', 'S']),
      V({ senal: 'e-e-e' }, ['E', 'E', 'E']),
      V({ senal: 's-o-n-e-e' }, ['S', 'O', 'N', 'E', 'E']),
    ],
  },
  {
    id: 'd5', kind: 'consola', title: 'La ruta de hoy', concept: 'Listas: pop(), append(), len()',
    story: 'El transportista ya ha hecho la primera parada de su lista. Al final del día siempre vuelve a la base.',
    goal: 'Quita la primera parada de ruta, añade "base" al final y envía la lista.',
    learn: [
      { text: 'Una lista guarda varios valores en orden. pop(0) quita el primero y append(x) añade al final.', code: 'l = ["a", "b"]\nl.pop(0)\nl.append("z")\nprint(l)   # ["b", "z"]' },
    ],
    starter: `print("Paradas:", ruta)
print("Quedan", len(ruta))

enviar(ruta)
`,
    hints: ['ruta.pop(0) quita la primera parada.', 'Después: ruta.append("base")'],
    par: 3,
    variants: [
      V({ ruta: ['mina', 'huerto', 'taller'] }, ['huerto', 'taller', 'base']),
      V({ ruta: ['silo', 'mina'] }, ['mina', 'base']),
      V({ ruta: ['antena', 'lago', 'mina', 'silo'] }, ['lago', 'mina', 'silo', 'base']),
    ],
  },
  {
    id: 'd6', kind: 'consola', title: 'Inventario', concept: 'Diccionarios: claves, valores y get()',
    story: 'El minero acaba de recoger material. Hay que sumarlo al inventario… aunque sea un material que todavía no estaba.',
    goal: 'Suma cantidad al material recogido dentro de inventario y envía el diccionario.',
    learn: [
      { text: 'Un diccionario guarda parejas clave: valor. Se lee y se cambia con corchetes.', code: 'inv = {"hierro": 3}\nprint(inv["hierro"])   # 3\ninv["hierro"] = 5' },
      { text: 'get(clave, defecto) devuelve el valor o el defecto si la clave no existe (¡sin error!).', code: 'print(inv.get("cobre", 0))   # 0' },
    ],
    starter: `print(inventario)
print("Recogido:", cantidad, recogido)

# ¿cuánto había antes? (si no había, 0)
antes = inventario[recogido]
inventario[recogido] = antes + cantidad
enviar(inventario)
`,
    hints: ['Si el material no está en el diccionario, inventario[recogido] da KeyError.', 'antes = inventario.get(recogido, 0)'],
    par: 3,
    variants: [
      V({ inventario: { hierro: 3, cobre: 1 }, recogido: 'cobre', cantidad: 2 }, { hierro: 3, cobre: 3 }),
      V({ inventario: { hierro: 3 }, recogido: 'silicio', cantidad: 1 }, { hierro: 3, silicio: 1 }),
      V({ inventario: { chatarra: 5, cobre: 2 }, recogido: 'chatarra', cantidad: 4 }, { chatarra: 9, cobre: 2 }),
    ],
  },
  {
    id: 'd7', kind: 'consola', title: 'Vetas sin repetir', concept: 'Conjuntos (set) y sorted()',
    story: 'El explorador ha apuntado cada veta que ha visto, pero muchas se repiten.',
    goal: 'Envía la lista de tipos SIN repetir y ordenada alfabéticamente.',
    learn: [
      { text: 'Un conjunto (set) no guarda repetidos. sorted() devuelve una lista ordenada.', code: 'print(set([3, 1, 3]))        # {1, 3}\nprint(sorted({"b", "a"}))   # ["a", "b"]' },
    ],
    starter: `print(vistas)
unicas = vistas
enviar(unicas)
`,
    hints: ['set(vistas) quita los repetidos.', 'enviar(sorted(set(vistas)))'],
    par: 2,
    variants: [
      V({ vistas: ['hierro', 'cobre', 'hierro', 'silicio', 'cobre'] }, ['cobre', 'hierro', 'silicio']),
      V({ vistas: ['chatarra', 'chatarra'] }, ['chatarra']),
      V({ vistas: ['silicio', 'hierro', 'cobre', 'chatarra', 'hierro'] }, ['chatarra', 'cobre', 'hierro', 'silicio']),
    ],
  },
  {
    id: 'dj', kind: 'consola', boss: true, title: 'Transmisión cifrada', concept: 'Jefe: textos + listas + diccionarios',
    story: 'Llega una orden con tres datos separados por ";" y cada dato con la forma clave=valor. Hay espacios por todas partes.',
    goal: 'Envía un diccionario {"destino": texto en MAYÚSCULAS, "x": número, "y": número}.',
    learn: [
      { text: 'Parte primero por ";" y después cada trozo por "=". No olvides strip() para limpiar espacios.', code: 'a, b = "x = 3".split("=")\nprint(a.strip(), int(b))' },
    ],
    starter: `print(mensaje)
partes = mensaje.split(";")
print(partes)

orden = {}
enviar(orden)
`,
    hints: ['partes[0] es " destino=Mina Norte " → split("=") y strip()', 'orden["x"] = int(partes[1].split("=")[1])', 'destino = partes[0].split("=")[1].strip().upper()'],
    par: 7,
    variants: [
      V({ mensaje: '  destino=Mina Norte ; x=12 ; y=7  ' }, { destino: 'MINA NORTE', x: 12, y: 7 }),
      V({ mensaje: 'destino= huerto sur;x=3;y= 20' }, { destino: 'HUERTO SUR', x: 3, y: 20 }),
      V({ mensaje: ' destino =Antena ; x= 40 ;y=9' }, { destino: 'ANTENA', x: 40, y: 9 }),
    ],
  },
];

// ═════════════════ 2 · Condicionales ═════════════════
const COND: Level[] = [
  {
    id: 'c1', kind: 'consola', title: 'Alarma de batería', concept: 'if',
    story: 'Si la batería baja de 20, el dron debe volver a recargar.',
    goal: 'Envía "RECARGAR" si bateria es menor que 20; si no, "OK".',
    learn: [
      { text: 'if ejecuta un bloque sólo si la condición es verdadera. Fíjate en los dos puntos y en la sangría (4 espacios).', code: 'if temperatura > 30:\n    print("¡Calor!")' },
      { text: 'Para comparar: <  >  <=  >=  ==  !=   (¡== compara, = asigna!)' },
    ],
    starter: `estado = "OK"
print("Batería:", bateria)
# si bateria < 20, cambia estado
enviar(estado)
`,
    hints: ['if bateria < 20:\n    estado = "RECARGAR"'],
    par: 4,
    requires: [uses(/\bif\b/, 'Usa un if.')],
    variants: [V({ bateria: 50 }, 'OK'), V({ bateria: 12 }, 'RECARGAR'), V({ bateria: 20 }, 'OK')],
  },
  {
    id: 'c2', kind: 'mapa', unit: 'minero', mode: 'meta', title: 'El charco', concept: 'if / else',
    story: 'Delante del minero a veces hay un charco. El minero no nada: tiene que rodearlo por el Sur.',
    goal: 'Llega a la ★ en las 3 variantes (unas con charco y otras sin él).',
    learn: [
      { text: 'mirar("E") te dice qué hay en la casilla del Este sin moverte: "hierba", "agua", "roca"…' },
      { text: 'else es el «si no»: se ejecuta cuando la condición del if es falsa.', code: 'if mirar("E") == "agua":\n    print("hay agua")\nelse:\n    print("vía libre")' },
    ],
    starter: `if mirar("E") == "agua":
    # rodea: Sur, Este, Este, Norte
    mover("S")
else:
    mover("E")
mover("E")
mover("E")
`,
    hints: ['Si hay agua: S, E, E, N (quedas dos casillas más al Este).', 'Si no hay agua: E, E. Después, en los dos casos: E, E.'],
    par: 11,
    requires: [uses(/\belse\s*:/, 'Usa if y else.')],
    variants: [
      { map: ['.....', 'M~..*', '.....'] },
      { map: ['.....', 'M...*', '.....'] },
      { map: ['..#..', 'M~..*', '.....'] },
    ],
  },
  {
    id: 'c3', kind: 'consola', title: 'Clasificador', concept: 'if / elif / else',
    story: 'Cada mineral vale distinto: hierro 1, cobre 2, silicio 4. Cualquier otra cosa no vale nada.',
    goal: 'Envía los puntos del mineral.',
    learn: [
      { text: 'elif («si no, si…») encadena varias condiciones. Sólo se ejecuta la primera que se cumple.', code: 'if nota >= 9:\n    print("sobresaliente")\nelif nota >= 5:\n    print("aprobado")\nelse:\n    print("suspenso")' },
    ],
    starter: `print("Mineral:", mineral)
if mineral == "hierro":
    puntos = 1
else:
    puntos = 0
enviar(puntos)
`,
    hints: ['Añade elif mineral == "cobre": puntos = 2', 'Y otro elif para "silicio" con 4.'],
    par: 9,
    requires: [uses(/\belif\b/, 'Usa elif.')],
    variants: [V({ mineral: 'cobre' }, 2), V({ mineral: 'silicio' }, 4), V({ mineral: 'roca' }, 0)],
  },
  {
    id: 'c4', kind: 'consola', title: '¿Puedo salir?', concept: 'and, or, not',
    story: 'El dron sólo sale si tiene al menos 30 de batería, lleva menos de 10 de carga y NO hay tormenta.',
    goal: 'Envía True si puede salir y False si no.',
    learn: [
      { text: 'and: se tienen que cumplir las dos. or: basta con una. not: le da la vuelta.', code: 'print(3 > 1 and 2 > 5)   # False\nprint(3 > 1 or 2 > 5)    # True\nprint(not True)          # False' },
      { text: 'Una comparación ya es True o False: puedes guardarla en una variable.', code: 'mayor = edad >= 18' },
    ],
    starter: `print(bateria, carga, tormenta)
puede = bateria >= 30
enviar(puede)
`,
    hints: ['puede = bateria >= 30 and carga < 10 and not tormenta'],
    par: 2,
    requires: [uses(/\band\b/, 'Usa and.'), uses(/\bnot\b/, 'Usa not para la tormenta.')],
    variants: [
      V({ bateria: 80, carga: 3, tormenta: false }, true),
      V({ bateria: 80, carga: 3, tormenta: true }, false),
      V({ bateria: 25, carga: 0, tormenta: false }, false),
    ],
  },
  {
    id: 'c5', kind: 'consola', title: 'Dentro del mapa', concept: 'Comparaciones encadenadas e in',
    story: 'Antes de mandar un dron a (x, y), comprueba que la casilla está dentro del mapa y que el terreno se puede pisar.',
    goal: 'Envía True si 0 ≤ x < ancho, 0 ≤ y < alto y terreno es "hierba", "camino" o "puente".',
    learn: [
      { text: 'En Python puedes encadenar comparaciones: 0 <= x < 10 significa «x entre 0 y 9».' },
      { text: 'in comprueba si algo está en una lista o en un texto.', code: 'print("b" in ["a", "b"])   # True\nprint("ol" in "hola")      # True' },
    ],
    starter: `print(x, y, "en un mapa de", ancho, "x", alto, "·", terreno)
dentro = x >= 0
pisable = terreno == "hierba"
enviar(dentro and pisable)
`,
    hints: ['dentro = 0 <= x < ancho and 0 <= y < alto', 'pisable = terreno in ["hierba", "camino", "puente"]'],
    par: 3,
    requires: [uses(/\bin\s*\[|\bin\s*\(|\bin\s+\w/, 'Usa in para el terreno.')],
    variants: [
      V({ x: 3, y: 4, ancho: 10, alto: 8, terreno: 'camino' }, true),
      V({ x: 10, y: 2, ancho: 10, alto: 8, terreno: 'hierba' }, false),
      V({ x: 0, y: 7, ancho: 10, alto: 8, terreno: 'agua' }, false),
    ],
  },
  {
    id: 'c6', kind: 'consola', title: 'Con o sin señal', concept: 'Operador ternario (x if c else y)',
    story: 'Una antena da señal hasta 11 casillas. Queremos el estado en UNA sola línea.',
    goal: 'Envía "con señal" si distancia ≤ 11 y "sin señal" si no, usando el operador ternario.',
    learn: [
      { text: 'El ternario elige entre dos valores en una sola línea: valor_si if condición else valor_no', code: 'edad = 20\ntexto = "mayor" if edad >= 18 else "menor"' },
    ],
    starter: `print("Distancia a la antena:", distancia)
estado = "con señal"
enviar(estado)
`,
    hints: ['estado = "con señal" if distancia <= 11 else "sin señal"'],
    par: 2,
    requires: [{ test: (c) => c.split('\n').some((l) => { const t = l.replace(/#.*$/, '').trim(); return !/^(if|elif|else)\b/.test(t) && /\S\s+if\s+.+\s+else\s+\S/.test(t); }), msg: 'Usa el operador ternario: "a" if condición else "b"' }],
    variants: [V({ distancia: 4 }, 'con señal'), V({ distancia: 12 }, 'sin señal'), V({ distancia: 11 }, 'con señal')],
  },
  {
    id: 'c7', kind: 'consola', title: 'Órdenes de radio', concept: 'match / case',
    story: 'Por radio llegan órdenes: "N", "S", "E", "O" o "PARA". Hay que convertirlas en desplazamientos (dx, dy).',
    goal: 'N → (0, -1) · S → (0, 1) · E → (1, 0) · O → (-1, 0) · PARA → (0, 0) · cualquier otra → None',
    learn: [
      { text: 'match compara un valor con varios casos. _ es el caso «cualquier otra cosa». Con | juntas varios valores en un caso.', code: 'match dia:\n    case "sábado" | "domingo":\n        print("finde")\n    case "lunes":\n        print("ánimo")\n    case _:\n        print("otro día")' },
    ],
    starter: `print("Orden:", orden)
match orden:
    case "N":
        paso = (0, -1)
    case _:
        paso = None
enviar(paso)
`,
    hints: ['Añade un case para "S", "E", "O" y "PARA".', 'case "PARA":\n    paso = (0, 0)'],
    par: 14,
    requires: [uses(/^\s*match\s+.+:/m, 'Usa match / case.')],
    variants: [V({ orden: 'E' }, tup(1, 0)), V({ orden: 'PARA' }, tup(0, 0)), V({ orden: 'X' }, null)],
  },
  {
    id: 'c8', kind: 'consola', title: 'Lecturas de sensores', concept: 'match con tuplas, capturas y guardas',
    story: 'Los sensores envían tuplas como ("temp", 45) o ("hum", 10). Unas lecturas son normales y otras son alarmas.',
    goal: 'temp > 40 → "ALERTA: calor" · otra temp → "temperatura N" · hum < 20 → "ALERTA: seco" · otra hum → "humedad N" · lo demás → "desconocido"',
    learn: [
      { text: 'Un case puede «desmontar» una tupla y guardar partes en variables. Con if añades una condición (guarda).', code: 'match punto:\n    case (0, 0):\n        print("origen")\n    case (x, 0) if x > 0:\n        print("eje x positivo", x)\n    case (x, y):\n        print("otro", x, y)' },
    ],
    starter: `print(lectura)
match lectura:
    case ("temp", t) if t > 40:
        texto = "ALERTA: calor"
    case _:
        texto = "desconocido"
enviar(texto)
`,
    hints: ['case ("temp", t):\n    texto = f"temperatura {t}"', 'Los casos se prueban en orden: pon primero los que tienen guarda.'],
    par: 12,
    requires: [uses(/^\s*match\s+.+:/m, 'Usa match / case.')],
    variants: [V({ lectura: tup('temp', 45) }, 'ALERTA: calor'), V({ lectura: tup('hum', 60) }, 'humedad 60'), V({ lectura: tup('luz', 3) }, 'desconocido')],
  },
  {
    id: 'cj', kind: 'consola', boss: true, title: 'El puente', concept: 'Jefe: todas las decisiones',
    story: 'Un dron quiere cruzar el puente. Reglas: si está "cerrado" → "ESPERA". Si está en "mantenimiento" sólo pasan los que vuelan (tipo "granjero" o "hacker"): los demás → "ESPERA". Si está "abierto": con carga mayor que 10 → "DESCARGA PRIMERO"; si no, con batería menor que 20 → "RECARGA"; si no → "PASA".',
    goal: 'Envía la decisión para dron (un diccionario) y puente (un texto).',
    learn: [
      { text: 'Combina lo que has visto: match para el estado del puente, if/elif dentro, in para los tipos que vuelan.' },
    ],
    starter: `print(dron, puente)
decision = "ESPERA"
enviar(decision)
`,
    hints: ['match puente:\n    case "cerrado": ...\n    case "mantenimiento": ...\n    case "abierto": ...', 'vuela = dron["tipo"] in ["granjero", "hacker"]'],
    par: 14,
    variants: [
      V({ dron: { tipo: 'minero', carga: 4, bateria: 50 }, puente: 'mantenimiento' }, 'ESPERA'),
      V({ dron: { tipo: 'granjero', carga: 12, bateria: 90 }, puente: 'abierto' }, 'DESCARGA PRIMERO'),
      V({ dron: { tipo: 'hacker', carga: 0, bateria: 15 }, puente: 'abierto' }, 'RECARGA'),
    ],
  },
];

// ═════════════════ 3 · Bucles ═════════════════
const corridor = (n: number, len = 9) => ['.'.repeat(len), 'M' + '.'.repeat(n - 1) + '*' + '.'.repeat(Math.max(0, len - n - 1)), '.'.repeat(len)];
const garden = (w: number, h: number) => {
  const rows = ['.'.repeat(w + 2)];
  for (let j = 0; j < h; j++) rows.push((j === 0 ? 'G' : '.') + '*'.repeat(w) + '.');
  rows.push('.'.repeat(w + 2));
  return rows;
};
const wall = (n: number, len = 10) => ['.'.repeat(len), 'M' + '.'.repeat(n - 1) + '*' + '#' + '.'.repeat(Math.max(0, len - n - 2)), '.'.repeat(len)];

const BUCLES: Level[] = [
  {
    id: 'b1', kind: 'mapa', unit: 'minero', mode: 'meta', title: 'Paso a paso', concept: 'for con range()',
    story: 'La ★ está a "pasos" casillas al Este. El número cambia en cada variante: no lo escribas a mano.',
    goal: 'Llega a la ★ repitiendo mover("E") el número de veces que dice pasos.',
    learn: [
      { text: 'for i in range(n) repite el bloque n veces (i vale 0, 1, 2… n-1).', code: 'for i in range(3):\n    print("vuelta", i)' },
    ],
    starter: `print("Pasos:", pasos)
mover("E")
`,
    hints: ['for i in range(pasos):\n    mover("E")'],
    par: 2,
    requires: [uses(/\bfor\b/, 'Usa un for.')],
    variants: [{ preset: { pasos: 3 }, map: corridor(3) }, { preset: { pasos: 5 }, map: corridor(5) }, { preset: { pasos: 7 }, map: corridor(7) }],
  },
  {
    id: 'b2', kind: 'mapa', unit: 'minero', mode: 'meta', title: 'Ruta escrita', concept: 'for sobre un texto',
    story: 'La ruta llega escrita como texto, una letra por paso: "EESSE".',
    goal: 'Recorre la ruta letra a letra y llega a la ★.',
    learn: [
      { text: 'Un for también recorre un texto letra a letra (o una lista elemento a elemento).', code: 'for letra in "hola":\n    print(letra)' },
    ],
    starter: `print("Ruta:", ruta)
`,
    hints: ['for letra in ruta:\n    mover(letra)'],
    par: 2,
    requires: [uses(/\bfor\b/, 'Usa un for.')],
    variants: [
      { preset: { ruta: 'EESSE' }, map: pathMap('EESSE', { seed: 1 }) },
      { preset: { ruta: 'ENNEEES' }, map: pathMap('ENNEEES', { seed: 2 }) },
      { preset: { ruta: 'SSEENNEE' }, map: pathMap('SSEENNEE', { seed: 3 }) },
    ],
  },
  {
    id: 'b3', kind: 'consola', title: 'Carga total', concept: 'for sobre una lista y acumuladores',
    story: 'El transportista ha hecho varios viajes. Queremos saber cuánto ha llevado en total… sin usar sum().',
    goal: 'Envía la suma de todas las cargas usando un bucle.',
    learn: [
      { text: 'Un acumulador es una variable que empieza en 0 y va sumando en cada vuelta.', code: 'total = 0\nfor n in [2, 5, 1]:\n    total = total + n   # o total += n\nprint(total)   # 8' },
    ],
    starter: `print(cargas)
total = 0
enviar(total)
`,
    hints: ['for c in cargas:\n    total += c'],
    par: 4,
    requires: [uses(/\bfor\b/, 'Usa un for.'), avoids(/\bsum\s*\(/, 'Esta vez sin sum(): hazlo tú con el bucle.')],
    variants: [V({ cargas: [3, 5, 2] }, 10), V({ cargas: [12] }, 12), V({ cargas: [1, 1, 4, 9, 6] }, 21)],
  },
  {
    id: 'b4', kind: 'mapa', unit: 'minero', mode: 'meta', title: 'Hasta la pared', concept: 'while',
    story: 'Hay una roca más adelante, pero no sabes a qué distancia. Avanza mientras delante haya hierba.',
    goal: 'Para justo delante de la roca (en la ★).',
    learn: [
      { text: 'while repite MIENTRAS la condición sea verdadera. Útil cuando no sabes cuántas vueltas hacen falta.', code: 'n = 1\nwhile n < 100:\n    n = n * 2\nprint(n)   # 128' },
    ],
    starter: `print(mirar("E"))
mover("E")
`,
    hints: ['while mirar("E") == "hierba":\n    mover("E")'],
    par: 2,
    requires: [uses(/\bwhile\b/, 'Usa un while.')],
    variants: [{ map: wall(4) }, { map: wall(7) }, { map: wall(2) }],
  },
  {
    id: 'b5', kind: 'consola', title: '¿Cuántos viajes?', concept: 'while con contador',
    story: 'Cada viaje gasta 7 de batería y nunca debe bajar de 20. ¿Cuántos viajes puede hacer el dron?',
    goal: 'Envía el número de viajes posibles.',
    learn: [
      { text: 'Un contador empieza en 0 y suma 1 en cada vuelta. Aquí la condición del while depende de la batería.', code: 'viajes = 0\nwhile bateria - 7 >= 20:\n    ...' },
    ],
    starter: `print("Batería inicial:", bateria)
viajes = 0
enviar(viajes)
`,
    hints: ['Dentro del while: bateria -= 7 y viajes += 1'],
    par: 5,
    requires: [uses(/\bwhile\b/, 'Usa un while.')],
    variants: [V({ bateria: 100 }, 11), V({ bateria: 30 }, 1), V({ bateria: 19 }, 0)],
  },
  {
    id: 'b6', kind: 'consola', title: 'Lecturas con ruido', concept: 'break y continue',
    story: 'El sensor manda números. Los negativos son errores (sáltalos) y 999 significa «fin de la transmisión» (para ahí).',
    goal: 'Envía la suma de las lecturas válidas hasta el 999.',
    learn: [
      { text: 'continue salta a la siguiente vuelta. break sale del bucle del todo.', code: 'for n in [1, -2, 3, 0, 5]:\n    if n < 0:\n        continue\n    if n == 0:\n        break\n    print(n)   # 1, 3' },
    ],
    starter: `print(lecturas)
total = 0
for n in lecturas:
    total += n
enviar(total)
`,
    hints: ['if n == 999:\n    break', 'if n < 0:\n    continue'],
    par: 8,
    requires: [uses(/\bbreak\b/, 'Usa break.'), uses(/\bcontinue\b/, 'Usa continue.')],
    variants: [V({ lecturas: [12, 15, -1, 40, 999, 30] }, 67), V({ lecturas: [-5, -5, 999] }, 0), V({ lecturas: [1, 2, 3, -9, 4, 999, 100, 999] }, 10)],
  },
  {
    id: 'b7', kind: 'consola', title: '¿Dónde están las vetas?', concept: 'enumerate()',
    story: 'El escáner devuelve una lista casilla a casilla. Queremos las POSICIONES que no son "roca".',
    goal: 'Envía la lista de posiciones (índices) donde no hay "roca".',
    learn: [
      { text: 'enumerate() da a la vez la posición y el elemento en cada vuelta.', code: 'for i, fruta in enumerate(["pera", "kiwi"]):\n    print(i, fruta)   # 0 pera · 1 kiwi' },
    ],
    starter: `print(casillas)
posiciones = []
enviar(posiciones)
`,
    hints: ['for i, c in enumerate(casillas):\n    if c != "roca":\n        posiciones.append(i)'],
    par: 5,
    requires: [uses(/\benumerate\s*\(/, 'Usa enumerate().')],
    variants: [
      V({ casillas: ['roca', 'hierro', 'roca', 'cobre'] }, [1, 3]),
      V({ casillas: ['roca', 'roca'] }, []),
      V({ casillas: ['silicio', 'roca', 'chatarra', 'hierro', 'roca'] }, [0, 2, 3]),
    ],
  },
  {
    id: 'b8', kind: 'consola', title: 'Parejas', concept: 'zip()',
    story: 'Tienes dos listas: los nombres de las unidades y sus baterías, en el mismo orden.',
    goal: 'Envía la lista de nombres cuya batería es menor que 20.',
    learn: [
      { text: 'zip() recorre dos listas a la vez, emparejando elemento a elemento.', code: 'for n, e in zip(["Ana", "Luis"], [16, 17]):\n    print(n, e)' },
    ],
    starter: `print(nombres)
print(baterias)
bajas = []
enviar(bajas)
`,
    hints: ['for nombre, bat in zip(nombres, baterias):', 'if bat < 20:\n    bajas.append(nombre)'],
    par: 5,
    requires: [uses(/\bzip\s*\(/, 'Usa zip().')],
    variants: [
      V({ nombres: ['MIN-01', 'GRJ-01', 'CON-01'], baterias: [80, 15, 19] }, ['GRJ-01', 'CON-01']),
      V({ nombres: ['HCK-01'], baterias: [90] }, []),
      V({ nombres: ['A', 'B', 'C', 'D'], baterias: [5, 50, 10, 20] }, ['A', 'C']),
    ],
  },
  {
    id: 'b9', kind: 'mapa', unit: 'granjero', mode: 'todas', title: 'Riega el huerto', concept: 'Bucles anidados',
    story: 'El dron granjero tiene que pasar por TODAS las casillas del huerto (★). El huerto mide ancho × alto.',
    goal: 'Visita todas las ★. Pista: fila a fila.',
    learn: [
      { text: 'Un bucle dentro de otro: el de dentro se repite entero en cada vuelta del de fuera.', code: 'for fila in range(2):\n    for col in range(3):\n        print(fila, col)' },
    ],
    starter: `print("Huerto de", ancho, "x", alto)
for col in range(ancho):
    mover("E")
`,
    hints: ['Por cada fila: ancho veces E, ancho veces O, y una vez S.', 'for fila in range(alto):\n    for c in range(ancho):\n        mover("E")\n    for c in range(ancho):\n        mover("O")\n    mover("S")'],
    par: 7,
    requires: [{ test: (c) => /^( {4}|\t)+for\b/m.test(c) && /^for\b/m.test(c), msg: 'Usa un for dentro de otro for.' }],
    variants: [{ preset: { ancho: 3, alto: 2 }, map: garden(3, 2) }, { preset: { ancho: 4, alto: 3 }, map: garden(4, 3) }, { preset: { ancho: 2, alto: 4 }, map: garden(2, 4) }],
  },
  {
    id: 'bj', kind: 'mapa', unit: 'minero', mode: 'meta', boss: true, title: 'El explorador', concept: 'Jefe: bucles + textos',
    story: 'Las instrucciones llegan como una lista de textos: "E3" significa «3 pasos al Este», "S2" «2 al Sur»…',
    goal: 'Sigue todas las instrucciones y llega a la ★.',
    learn: [
      { text: 'Para cada instrucción: la letra es texto[0] y el número es int(texto[1:]).' },
    ],
    starter: `print(instrucciones)
for ins in instrucciones:
    print("dirección", ins[0], "pasos", ins[1:])
`,
    hints: ['d = ins[0]\nn = int(ins[1:])', 'for i in range(n):\n    mover(d)'],
    par: 5,
    variants: [
      { preset: { instrucciones: ['E3', 'S2', 'E1'] }, map: pathMap('EEESSE', { seed: 4 }) },
      { preset: { instrucciones: ['S1', 'E4', 'N3', 'E2'] }, map: pathMap('SEEEENNNEE', { seed: 5 }) },
      { preset: { instrucciones: ['E2', 'S3', 'E2', 'S1', 'O1'] }, map: pathMap('EESSSEESO', { seed: 6 }) },
    ],
  },
];

export const SECTIONS: Section[] = [
  { id: 'datos', n: 1, title: 'Datos', subtitle: 'Variables, textos, listas, tuplas, diccionarios y conjuntos', icon: '📡', levels: DATOS },
  { id: 'condicionales', n: 2, title: 'Condicionales', subtitle: 'if, else, elif, and/or/not, ternario y match/case', icon: '🔀', levels: COND },
  { id: 'bucles', n: 3, title: 'Bucles', subtitle: 'for, range, while, break/continue, enumerate y zip', icon: '🔁', levels: BUCLES },
  { id: 'funciones', n: 4, title: 'Funciones', subtitle: 'def, parámetros, *args, **kwargs, lambda y módulos', icon: '🧩', levels: [], soon: true },
  { id: 'archivos', n: 5, title: 'Archivos', subtitle: 'txt, csv y hojas de cálculo: leer, escribir y modificar', icon: '🗂', levels: [], soon: true },
  { id: 'poo', n: 6, title: 'Objetos', subtitle: 'Clases, métodos, herencia y encapsulación', icon: '🤖', levels: [], soon: true },
  { id: 'apis', n: 7, title: 'APIs', subtitle: 'La red antigua: JSON, peticiones y errores', icon: '🌐', levels: [], soon: true },
];

/** Orden fijo para el código de progreso: sólo se añade al final */
export const LEVEL_ORDER: string[] = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'dj', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'cj', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'bj'];

export const ALL_LEVELS: Level[] = SECTIONS.flatMap((s) => s.levels);
export const levelById = (id: string) => ALL_LEVELS.find((l) => l.id === id);
export const sectionOf = (id: string) => SECTIONS.find((s) => s.levels.some((l) => l.id === id));
