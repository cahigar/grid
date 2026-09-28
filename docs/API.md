# G.R.I.D. — Primitivas del jugador

> Generado automáticamente desde `src/sim/api.ts` (`npm run docs`).
> El juego sólo ofrece primitivas básicas: el jugador construye sus propias abstracciones.

## Movimiento

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `mover(direccion)` | True si se movió, False si chocó | 2 s en hierba · 1,2 s carretera · 1,5 s hormigón · 3,5 s maleza | 1 |

### `mover(direccion)`

Mueve la unidad una casilla. direccion: "N", "S", "E" u "O". Si la casilla está bloqueada (agua, ruina, roca, bosque, borde) la unidad choca y pierde 1 s.

```python
if not mover("E"):
    mover("N")
```

## Sensores

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `posicion()` | tupla (x, y) | 0 | 0 |
| `escanear()` | lista de Recurso | 3 s | 2 |
| `mirar(direccion)` | texto: "hierba", "carretera", "agua", "ruina", "roca", "bosque"… o "borde" | 0,5 s | 0 |
| `terreno(x, y)` | texto, o None si la casilla no se ha explorado | 0 | 0 |
| `transitable(x, y)` | True / False / None (desconocida) | 0 | 0 |
| `coste(x, y)` | número o None | 0 | 0 |
| `bateria()` | número | 0 | 0 |
| `carga()` | entero | 0 | 0 |
| `carga_max()` | entero | 0 | 0 |
| `inventario()` | diccionario {"hierro": 3, …} | 0 | 0 |
| `recurso_aqui()` | Recurso o None | 0 | 0 |
| `tiempo()` | número | 0 | 0 |
| `nombre()` | texto | 0 | 0 |

### `posicion()`

Coordenadas actuales de la unidad. x crece hacia el Este, y crece hacia el Sur.

```python
x, y = posicion()
```

### `escanear()`

Barre el entorno con el sensor (radio 3 en el dron). Revela el terreno en el mapa del jugador y devuelve los recursos detectados. Cada recurso tiene .tipo, .x, .y, .cantidad y .calidad.

```python
for r in escanear():
    print(r.tipo, r.x, r.y)
```

### `mirar(direccion)`

Consulta el terreno de la casilla vecina sin moverse.

```python
if mirar("E") != "agua":
    mover("E")
```

### `terreno(x, y)`

Terreno de una casilla según el mapa conocido por tu colonia (lo que han visto todas tus unidades).

### `transitable(x, y)`

True si la casilla es conocida y la unidad puede pisarla. Útil para BFS / A*.

### `coste(x, y)`

Segundos que tardaría esta unidad en entrar en la casilla (según terreno conocido). None si es intransitable o desconocida. Útil para Dijkstra.

### `bateria()`

Energía actual (0-100). Los paneles de la unidad recargan ~2 % por minuto.

### `carga()`

Unidades de recurso que transporta ahora.

### `carga_max()`

Capacidad de carga de la unidad.

### `inventario()`

Contenido de la carga por tipo de recurso.

### `recurso_aqui()`

Recurso que hay en la casilla actual (si ya fue escaneado).

### `tiempo()`

Segundos transcurridos desde que empezó el programa.

### `nombre()`

Nombre de la unidad que ejecuta el programa (p. ej. "DRN-01"). Útil cuando varias unidades comparten código.

## Trabajo

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `extraer()` | 1 si extrajo, 0 si no había recurso o la carga está llena | hierro 3 s · cobre 4 s · silicio 6 s · chatarra 2,5 s · biomasa 2 s | 1 |
| `esperar(segundos)` | None | los segundos indicados | 0 |

### `extraer()`

Extrae una unidad del recurso de la casilla actual. Hay que estar encima del recurso.

```python
while carga() < carga_max() and extraer():
    pass
```

### `esperar(segundos)`

Espera sin hacer nada (mínimo 1 s). Los paneles siguen recargando.

## Base

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `descargar()` | unidades descargadas | 2 s | 0 |
| `recargar()` | nueva batería | 0,4 s por cada 1 % | — |
| `base()` | tupla (x, y) | 0 | 0 |
| `almacen()` | diccionario | 0 | 0 |
| `fabricar(tipo)` | nombre de la unidad nueva, o None si faltan recursos | 60-120 s | 5 |

### `descargar()`

Descarga toda la carga en el almacén de la base. Hay que estar junto a la base (el muelle de base() sirve).

### `recargar()`

Recarga la batería al 100 % junto a la base.

### `base()`

Coordenadas del muelle de tu base (casilla libre al sur del centro operativo).

### `almacen()`

Recursos guardados en tu base.

### `fabricar(tipo)`

Fabrica una unidad nueva junto a la base. tipo: "dron" (10 hierro, 4 cobre), "explorador" (12 hierro, 6 cobre; vuela, radio 5, no mina) o "minero" (20 hierro, 8 chatarra; carga 20, mina más rápido).

## Memoria

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `memoria` | dict | 0 | 0 |
| `compartido` | dict | 0 | 0 |

### `memoria`

Diccionario propio de la unidad que sobrevive a reinicios del programa. Guarda aquí lo que quieras recordar.

```python
memoria["hierro"] = memoria.get("hierro", []) + [(x, y)]
```

### `compartido`

Diccionario compartido por todas las unidades de tu colonia: la forma de que se pasen información.

## Depuración

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `print(...)` | None | 0 | 0 |
| `dibujar_ruta(puntos)` | None | 0 | 0 |

### `print(...)`

Escribe en el log de la unidad.

### `dibujar_ruta(puntos)`

Dibuja en el mapa una lista de coordenadas [(x, y), …]. Ideal para depurar tu pathfinding.

```python
dibujar_ruta(camino)
```

## Python disponible (PyGrid)

def (con valores por defecto, recursión y closures), lambda, if/elif/else, while, for, break, continue, pass, return, global, nonlocal, try/except/finally, raise, assert, listas, tuplas, diccionarios, sets, slicing, comprensiones, f-strings, desempaquetado, `import` / `from … import …` de tus módulos, y los módulos `math`, `random` (determinista) y `heapq`.

No disponible (a propósito): clases, generadores, `with`, `open`, `eval`, `exec`, `input`, red y sistema de archivos.

Límites: 20 000 instrucciones entre dos acciones (si se superan, la unidad pausa 1 s «CPU saturada»), 200 llamadas anidadas, 100 000 elementos por lista/texto.
