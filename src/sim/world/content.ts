// Contenido inicial: plantillas del jugador y programas de las colonias bot (escritos en PyGrid).

export const STARTER_FILES: Record<string, string> = {
  'minero.py': `# ═══ MINERO ═══  vehículo de tierra: pica vetas y recoge lo que suelta
# picar()    → rompe 1 unidad de la veta que tienes debajo (cae al suelo)
# recoger()  → mete en la carga lo que hay en el suelo
# escanear() → lista de vetas cercanas (r.tipo, r.x, r.y, r.cantidad)
# descargar() junto a la base o a un almacén → ¡puntos!

print("Minero listo en", posicion())
vetas = escanear()
print("Veo", len(vetas), "vetas")
for v in vetas:
    print(v.tipo, "en", (v.x, v.y))
`,
  'granjero.py': `# ═══ DRON GRANJERO ═══  vuela sobre todo; trabaja en los huertos
# plantar()  regar()  recolectar()  cargar_agua()  agua()
# parcela_aqui() → Parcela (humedad, madurez, lista) o None
# Tu huerto está 3 casillas al Este del muelle.
# Un cultivo crece si su humedad es > 30. ¡Recolectar antes de tiempo lanza un error!

for i in range(3):
    mover("E")
p = parcela_aqui()
print("Parcela:", p)
plantar()
regar()
`,
  'constructor.py': `# ═══ CONSTRUCTOR ═══  construir(tipo, direccion)
# tipos: "camino", "almacen", "silo", "panel", "antena", "aspersor"
# edificios que dan PUNTOS: "casa" (12), "taller" (18), "aerogenerador" (24),
#                           "laboratorio" (36), "torre_verde" (45)
# coste_edificio(tipo) → cuánto cuesta. Los recursos salen de tu almacén.
# Si no hay recursos → SinRecursosError (¡usa try/except!)

print("Almacén:", almacen())
print("Un panel cuesta", coste_edificio("panel"))
mover("S")
construir("camino", "S")
`,
  'hacker.py': `# ═══ DRON HACKER ═══  vuela; junto a una unidad enemiga puede tocar su código
# radar() → unidades cercanas (u.nombre, u.tipo, u.x, u.y, u.enemiga)
# hackear(direccion, modo)  modos: "invertir" ("N"↔"S", "E"↔"O"), "numero" (±1), "borrar"
# Reglas: empieza al lado del objetivo; en 4 s el hackeo se completa aunque se aleje.
# Luego 45 s de enfriamiento; la víctima queda protegida 40 s.
# Un aspersor enemigo puede mojarte y cancelar el hackeo.

for u in radar():
    print(u.nombre, u.tipo, (u.x, u.y), "enemiga" if u.enemiga else "aliada")
`,
  'aspersor.py': `# ═══ ASPERSOR ═══  edificio programable (constrúyelo con el constructor)
# disparar(x, y) → riega esa casilla y sus 4 vecinas; moja drones enemigos (radio 3)
# radar() → unidades cercanas   agua() → depósito (se rellena solo)

while True:
    for u in radar():
        if u.enemiga and u.tipo in ("granjero", "hacker"):
            disparar(u.x, u.y)
    esperar(1)
`,
  'base.py': `# ═══ CENTRO OPERATIVO ═══  tu base también se programa
# fabricar(tipo, programa) → crea una unidad junto a la base (tarda 10 s)
#   tipos: "granjero", "minero", "constructor"   (máximo 4 de cada)
#   programa (opcional): archivo que empieza a ejecutar, p. ej. "minero.py"
# coste_unidad(tipo) → dict con lo que cuesta   almacen() → lo que tienes
# unidades() → lista de tus unidades

print("Almacén:", almacen())
print("Un minero cuesta", coste_unidad("minero"))
try:
    nombre = fabricar("minero", "minero.py")
    print("Nueva unidad:", nombre)
except SinRecursosError as e:
    print("Todavía no:", e)
`,
  'nav.py': `# ═══ Tu biblioteca ═══
# Las funciones de este archivo se pueden usar desde cualquier programa:
#     from nav import ir_a
# Idea: escribe ir_a(x, y) con posicion() y mover(), y úsala en todas tus unidades.
`,
};

/** Qué archivo se asigna por defecto a cada tipo de unidad */
export const DEFAULT_PROGRAM: Record<string, string> = {
  minero: 'minero.py', granjero: 'granjero.py', constructor: 'constructor.py', hacker: 'hacker.py', aspersor: 'aspersor.py', base: 'base.py',
};

const RUTAS = `
DIRS = {"N": (0, -1), "S": (0, 1), "E": (1, 0), "O": (-1, 0)}

def bfs(destino, limite=1500):
    inicio = posicion()
    padre = {inicio: None}
    cola = [inicio]
    i = 0
    while i < len(cola) and i < limite:
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
    for d in camino:
        if not mover(d):
            return False
    return True

def volver():
    bx, by = base()
    return ir_a(bx, by)
`;

export const BOT_FILES: Record<string, string> = {
  'rutas.py': RUTAS,
  'minero.py': `from rutas import ir_a, volver
import random
if "vetas" not in memoria:
    memoria["vetas"] = []

def explorar():
    d = random.choice(["N", "S", "E", "O"])
    for _ in range(random.randint(3, 6)):
        if not mover(d):
            break

while True:
    if bateria() < 30:
        volver()
        recargar()
    for r in escanear():
        if (r.x, r.y) not in memoria["vetas"]:
            memoria["vetas"].append((r.x, r.y))
    if not memoria["vetas"]:
        explorar()
        continue
    x, y = memoria["vetas"][0]
    if ir_a(x, y):
        while carga() < carga_max():
            if not picar():
                memoria["vetas"].pop(0)
                recoger()
                break
            recoger()
    else:
        memoria["vetas"].pop(0)
    if carga() > 0:
        volver()
        descargar()
`,
  'granjero.py': `from rutas import ir_a, volver

def cuidar(p):
    ir_a(p.x, p.y)
    if agua() == 0:
        volver()
        cargar_agua()
        ir_a(p.x, p.y)
    aqui = parcela_aqui()
    if not aqui.plantada:
        plantar()
    elif aqui.lista and carga() < carga_max():
        recolectar()
    regar()

while True:
    hice_algo = False
    for p in parcelas():
        if not p.propia:
            continue
        if not p.plantada or p.humedad < 45 or p.lista:
            try:
                cuidar(p)
            except (AccionInvalidaError, CultivoNoMaduroError) as e:
                pass
            hice_algo = True
    if carga() >= 4 or (carga() > 0 and not hice_algo):
        volver()
        descargar()
    if bateria() < 30:
        volver()
        recargar()
    if not hice_algo:
        esperar(3)
`,
  'constructor.py': `bx, by = base()
plan = [("panel", "S"), ("antena", "O"), ("aspersor", "E")]
for tipo, d in plan:
    while True:
        try:
            construir(tipo, d)
            break
        except SinRecursosError:
            esperar(10)
        except AccionInvalidaError as e:
            print("no puedo:", e)
            break
    mover("S")
for obra in ["casa", "taller", "casa", "aerogenerador"]:
    for intento in range(4):
        try:
            construir(obra, "E")
            break
        except SinRecursosError:
            esperar(20)
        except AccionInvalidaError:
            mover("S")
    mover("S")
`,
  'hacker.py': `from rutas import ir_a
import random
while True:
    enemigos = [u for u in radar() if u.enemiga and u.tipo != "aspersor"]
    if not enemigos:
        for _ in range(4):
            mover(random.choice(["N", "S", "E", "O"]))
        continue
    e = enemigos[0]
    x, y = posicion()
    if abs(e.x - x) + abs(e.y - y) == 1:
        d = "E" if e.x > x else "O" if e.x < x else "S" if e.y > y else "N"
        try:
            print(hackear(d, "invertir"))
        except Exception as err:
            print("no se pudo:", err)
            esperar(5)
    else:
        mover("E" if e.x > x else "O" if e.x < x else "S" if e.y > y else "N")
`,
  'aspersor.py': STARTER_FILES['aspersor.py'],
  'base.py': `esperar(30)
while True:
    for tipo in ["minero", "granjero", "minero"]:
        try:
            fabricar(tipo, tipo + ".py")
        except Exception as e:
            pass
    esperar(40)
`,
};

export const BOT_NAMES = ['Colonia Aurora', 'Taller 9', 'Nido Verde', 'Brote Norte', 'Estación Kappa'];
