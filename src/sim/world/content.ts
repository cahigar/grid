// Contenido inicial: plantillas del jugador y colonias rivales (programadas en PyGrid, como un jugador más).

export const STARTER_FILES: Record<string, string> = {
  'main.py': `# ═══════════════ G.R.I.D. · programa de tu dron ═══════════════
# Tu dron sólo sabe hacer cosas muy básicas. Todo lo demás lo programas tú.
# Pulsa ▶ Ejecutar (Ctrl+Enter) para cargar este programa en la unidad
# seleccionada. El mundo sigue funcionando aunque cierres el juego.
#
# PRIMER OBJETIVO
#   encontrar mineral → llegar → extraer → volver → descargar → repetir
#
# Primitivas: mover("N"|"S"|"E"|"O")  escanear()  extraer()  descargar()
#             posicion()  base()  bateria()  carga()  print()
# Consulta el Manual (📖) para ver todas, con su tiempo y coste.

print("Hola, soy", nombre(), "y estoy en", posicion())

for i in range(4):
    mover("E")

recursos = escanear()
print("Veo", len(recursos), "recursos")
for r in recursos:
    print(r.tipo, "en", (r.x, r.y))
`,
  'nav.py': `# ═══ Tu biblioteca personal ═══
# Las funciones que escribas aquí se pueden usar desde cualquier programa:
#
#     from nav import ir_a
#
# Idea: escribe ir_a(x, y) usando posicion() y mover(), y ya no tendrás
# que volver a pensar en cómo moverte.
`,
};

const BFS_LIB = `
DIRS = {"N": (0, -1), "S": (0, 1), "E": (1, 0), "O": (-1, 0)}

def bfs(destino):
    inicio = posicion()
    padre = {inicio: None}
    cola = [inicio]
    i = 0
    while i < len(cola) and i < 900:
        p = cola[i]
        i += 1
        if p == destino:
            break
        for d, (dx, dy) in DIRS.items():
            q = (p[0] + dx, p[1] + dy)
            if q not in padre and (q == destino or transitable(q[0], q[1])):
                padre[q] = (p, d)
                cola.append(q)
    if destino not in padre:
        return None
    pasos = []
    n = destino
    while padre[n] is not None:
        p, d = padre[n]
        pasos.append(d)
        n = p
    pasos.reverse()
    return pasos

def ir_a(x, y):
    camino = bfs((x, y))
    if camino is None:
        return False
    puntos = []
    px, py = posicion()
    for d in camino:
        px, py = px + DIRS[d][0], py + DIRS[d][1]
        puntos.append((px, py))
    dibujar_ruta(puntos)
    for d in camino:
        if not mover(d):
            return False
    return True
`;

export const BOTS: { id: string; name: string; files: Record<string, string>; main: string }[] = [
  {
    id: 'bot-aurora',
    name: 'Colonia Aurora',
    main: 'minero.py',
    files: {
      'minero.py': `import random
# Minero voraz: se acerca en línea recta y esquiva al azar.
def ir_a(tx, ty):
    for _ in range(120):
        x, y = posicion()
        if (x, y) == (tx, ty):
            return True
        opciones = []
        if tx > x: opciones.append("E")
        if tx < x: opciones.append("O")
        if ty > y: opciones.append("S")
        if ty < y: opciones.append("N")
        if not mover(random.choice(opciones)):
            mover(random.choice(["N", "S", "E", "O"]))
    return False

while True:
    if bateria() < 35:
        bx, by = base()
        ir_a(bx, by)
        recargar()
    vetas = [r for r in escanear() if r.tipo != "biomasa"]
    if vetas:
        v = vetas[0]
        if ir_a(v.x, v.y):
            while carga() < carga_max() and extraer():
                pass
        bx, by = base()
        ir_a(bx, by)
        descargar()
        if bateria() < 50:
            recargar()
    else:
        for _ in range(5):
            mover(random.choice(["N", "S", "E", "O"]))
`,
    },
  },
  {
    id: 'bot-taller9',
    name: 'Taller 9',
    main: 'logistica.py',
    files: {
      'rutas.py': BFS_LIB,
      'logistica.py': `from rutas import ir_a, DIRS
import random
# Explora con escáner, recuerda vetas en memoria y usa BFS para moverse.
if "vetas" not in memoria:
    memoria["vetas"] = []

def explorar():
    d = random.choice(["N", "S", "E", "O"])
    for _ in range(random.randint(3, 7)):
        if not mover(d):
            break

while True:
    if bateria() < 35:
        bx, by = base()
        if not ir_a(bx, by):
            explorar()
        recargar()
    for r in escanear():
        if r.tipo in ("hierro", "cobre", "silicio") and (r.x, r.y) not in memoria["vetas"]:
            memoria["vetas"].append((r.x, r.y))
    if memoria["vetas"]:
        x, y = memoria["vetas"][0]
        if ir_a(x, y):
            while carga() < carga_max():
                if not extraer():
                    memoria["vetas"].pop(0)
                    break
        else:
            memoria["vetas"].pop(0)
        if carga() > 0:
            bx, by = base()
            ir_a(bx, by)
            descargar()
            if bateria() < 60:
                recargar()
    else:
        explorar()
`,
    },
  },
  {
    id: 'bot-nido',
    name: 'Nido Verde',
    main: 'espiral.py',
    files: {
      'espiral.py': `# Exploración en espiral: tramos cada vez más largos, escaneando en cada esquina.
lado = 2
d = 0
orden = ["E", "S", "O", "N"]
while True:
    for _ in range(2):
        for _ in range(lado):
            mover(orden[d])
        d = (d + 1) % 4
        encontrados = escanear()
        for r in encontrados:
            compartido[(r.x, r.y)] = r.tipo
    lado += 2
    if lado > 14:
        bx, by = base()
        while posicion() != (bx, by):
            x, y = posicion()
            if x != bx:
                ok = mover("E" if bx > x else "O")
            else:
                ok = mover("S" if by > y else "N")
            if not ok:
                d = (d + 1) % 4
                mover(orden[d])
                mover(orden[d])
        recargar()
        lado = 2
`,
    },
  },
];
