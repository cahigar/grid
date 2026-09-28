# G.R.I.D. — Primitivas del jugador

> Generado automáticamente desde `src/sim/api.ts` (`npm run docs`).
> El juego sólo ofrece primitivas básicas: el jugador construye sus propias abstracciones.

## Movimiento

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `mover(direccion)` | True si se movió, False si chocó | según terreno (hierba 0,7 s · camino 0,35 s · dron 0,3 s) | 1 |

### `mover(direccion)`

Mueve la unidad una casilla. direccion: "N", "S", "E" u "O". Las unidades de tierra chocan con agua, bosque, rocas, ruinas y edificios; los drones vuelan por encima de agua y bosque. Por un camino todo va más rápido.

```python
if not mover("E"):
    mover("N")
```

## Sensores

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `posicion()` | tupla (x, y) | 0 | 0 |
| `escanear()` | lista de Recurso | 1 s | 2 |
| `radar()` | lista de Unidad | 0 | 0 |
| `mirar(direccion)` | texto: "hierba", "agua", "camino", "roca"… o "borde" | 0,2 s | 0 |
| `terreno(x, y)` | texto, o None si no se ha explorado | 0 | 0 |
| `transitable(x, y)` | True / False / None | 0 | 0 |
| `coste(x, y)` | número o None | 0 | 0 |
| `bateria()` | número | 0 | 0 |
| `senal()` | True / False | 0 | 0 |
| `carga()` | entero | 0 | 0 |
| `carga_max()` | entero | 0 | 0 |
| `inventario()` | dict {"hierro": 3, …} | 0 | 0 |
| `recurso_aqui()` | Recurso o None | 0 | 0 |
| `tiempo()` | número | 0 | 0 |
| `tiempo_restante()` | número o None | 0 | 0 |
| `nombre()` | texto | 0 | 0 |
| `tipo()` | texto | 0 | 0 |
| `integridad()` | True / False | 0 | 0 |

### `posicion()`

Coordenadas actuales. x crece hacia el Este, y crece hacia el Sur.

```python
x, y = posicion()
```

### `escanear()`

Barre el entorno: revela el terreno y devuelve las vetas detectadas, de la más cercana a la más lejana. Cada una tiene .tipo, .x, .y, .cantidad y .calidad.

```python
for r in escanear():
    print(r.tipo, r.x, r.y)
```

### `radar()`

Unidades cercanas (propias y enemigas). Cada una tiene .nombre, .tipo, .x, .y, .dueño y .enemiga.

```python
enemigos = [u for u in radar() if u.enemiga]
```

### `mirar(direccion)`

Terreno de la casilla vecina sin moverse.

### `terreno(x, y)`

Terreno de una casilla según lo que ha visto tu colonia.

### `transitable(x, y)`

True si la casilla es conocida y esta unidad puede entrar. Ideal para BFS / A*.

### `coste(x, y)`

Segundos que tardaría esta unidad en entrar en la casilla. Útil para Dijkstra.

### `bateria()`

Energía (0-100). Se recarga con recargar() junto a la base o un panel solar.

### `senal()`

True si la unidad está dentro del alcance de la base (radio 9) o de una antena propia (radio 7). Sin señal, las acciones tardan el doble.

### `carga()`

Unidades que transporta.

### `carga_max()`

Capacidad de carga (minero 12, granjero 6).

### `inventario()`

Lo que transporta, por tipo.

### `recurso_aqui()`

Veta de la casilla actual (si ya se escaneó).

### `tiempo()`

Segundos desde que empezó el programa.

### `tiempo_restante()`

Segundos que quedan de partida.

### `nombre()`

Nombre de la unidad (p. ej. "MIN-01").

### `tipo()`

Tipo de la unidad: "granjero", "minero", "constructor", "hacker" o "aspersor".

### `integridad()`

False si un hacker ha modificado el programa que estás ejecutando.

```python
if not integridad():
    print("¡me han hackeado!")
```

## Base

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `base()` | tupla (x, y) | 0 | 0 |
| `almacen()` | dict | 0 | 0 |
| `descargar()` | unidades entregadas | 0,7 s | 0 |
| `recargar()` | batería | proporcional a lo que falte | — |
| `esperar(segundos)` | None | lo indicado | 0 |

### `base()`

Coordenadas del muelle de tu base (junto al centro operativo).

### `almacen()`

Recursos guardados en tu colonia.

### `descargar()`

Entrega la carga en la base (a 2 casillas o menos) o en un almacén propio (al lado). Un silo sólo acepta cosecha. Cada recurso suma puntos: hierro 1, chatarra 1, cobre 2, cosecha 3, silicio 4.

### `recargar()`

Recarga al 100 % junto a la base o a un panel solar propio.

### `esperar(segundos)`

Espera los segundos indicados (tiempo real).

## Granjero

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `plantar()` | True | 0,7 s | 1 |
| `regar()` | True | 0,5 s | 1 |
| `recolectar()` | unidades recogidas | 1 s | 1 |
| `cargar_agua()` | agua | 0,7 s | 0 |
| `agua()` | entero | 0 | 0 |
| `parcela_aqui()` | Parcela o None | 0 | 0 |
| `parcelas()` | lista de Parcela | 0 | 0 |

### `plantar()`

Siembra en la parcela de huerto que hay debajo.

### `regar()`

Añade 45 de humedad a la parcela. Gasta 1 de agua del depósito (6).

### `recolectar()`

Cosecha la parcela si su madurez es 100: +2 cosecha. Un cultivo madura 1 punto por segundo mientras su humedad sea > 30; la humedad baja sola.

```python
try:
    recolectar()
except CultivoNoMaduroError as e:
    print("todavía no:", e)
```

### `cargar_agua()`

Llena el depósito junto al agua o a la base.

### `agua()`

Agua que queda en el depósito.

### `parcela_aqui()`

La parcela de huerto de la casilla actual como objeto Parcela: .plantada, .humedad, .madurez, .lista, .propia, .x, .y.

```python
p = parcela_aqui()
if p and p.humedad < 30:
    regar()
```

### `parcelas()`

Todas las parcelas de huerto que conoce tu colonia (incluidas las salvajes, sin dueño).

## Minero

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `picar()` | 1 si picó, 0 si no hay veta | hierro 1 s · cobre 1,4 s · silicio 2,1 s · chatarra 0,9 s | 1 |
| `recoger()` | unidades recogidas | 0,35 s | 0 |
| `suelo()` | dict | 0 | 0 |

### `picar()`

Rompe 1 unidad de la veta de la casilla actual; cae al suelo.

### `recoger()`

Mete en la carga lo que hay en el suelo de la casilla (¡también lo que dejó otro minero!).

### `suelo()`

Recursos sueltos en la casilla actual.

## Constructor

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `construir(tipo, direccion)` | True | camino 0,7 s · edificios 2-3 s | 2 |
| `coste_edificio(tipo)` | dict | 0 | 0 |
| `edificios()` | lista de Edificio | 0 | 0 |

### `construir(tipo, direccion)`

Construye en la casilla vecina. Tipos y coste: "camino" (1 chatarra; sobre agua es un puente: 3 chatarra + 1 hierro), "almacen" (5 hierro + 3 chatarra), "silo" (3 hierro, sólo cosecha), "panel" (2 silicio + 2 cobre), "antena" (3 cobre + 2 hierro), "aspersor" (2 cobre + 2 hierro).

```python
try:
    construir("panel", "S")
except SinRecursosError:
    print("aún no hay silicio")
```

### `coste_edificio(tipo)`

Lo que cuesta un edificio.

### `edificios()`

Tus edificios: .tipo, .x, .y

## Hacker

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `hackear(direccion, modo="invertir")` | texto con el cambio, o False si falló | 4 s | 3 |

### `hackear(direccion, modo="invertir")`

Modifica el programa de la unidad enemiga que está en la casilla vecina. Modos: "invertir" cambia una dirección ("N"↔"S", "E"↔"O"), "numero" suma o resta 1 a un número, "borrar" quita un carácter (puede romper el código). La víctima se reinicia con el código cambiado. Hay que estar 4 s al lado; luego 45 s de enfriamiento. La víctima queda protegida 40 s.

## Aspersor

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `disparar(x, y)` | drones mojados | 0,3 s | 0 |

### `disparar(x, y)`

Lanza agua a una casilla (radio 3): riega esa parcela y sus 4 vecinas, y deja 8 s fuera de juego a los drones enemigos que estén allí (y cancela su hackeo). Gasta 1 de agua; el depósito (10) se rellena solo.

## Memoria

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `memoria` | dict | 0 | 0 |
| `compartido` | dict | 0 | 0 |

### `memoria`

Diccionario propio de la unidad que sobrevive a reinicios del programa (y a los hackeos).

```python
memoria["vetas"] = memoria.get("vetas", []) + [(x, y)]
```

### `compartido`

Diccionario compartido por todas las unidades de tu colonia.

```python
compartido["objetivo"] = (x, y)
```

## Depuración

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `print(...)` | None | 0 | 0 |
| `dibujar_ruta(puntos)` | None | 0 | 0 |

### `print(...)`

Escribe en el log de la unidad.

### `dibujar_ruta(puntos)`

Dibuja en el mapa una lista de coordenadas [(x, y), …].

## Errores

| Primitiva | Devuelve | Tiempo | Energía |
|---|---|---|---|
| `SinRecursosError` | excepción |  |  |
| `CultivoNoMaduroError` | excepción |  |  |
| `AccionInvalidaError` | excepción |  |  |
| `FueraDeRangoError` | excepción |  |  |

### `SinRecursosError`

Faltan recursos, agua o batería para la acción.

### `CultivoNoMaduroError`

Has intentado recolectar antes de tiempo.

### `AccionInvalidaError`

La acción no tiene sentido aquí (no hay huerto, la unidad no sabe hacerlo, enfriamiento…).

### `FueraDeRangoError`

El objetivo está demasiado lejos.

## Python disponible (PyGrid)

def (con valores por defecto, recursión y closures), lambda, if/elif/else, while, for, break, continue, pass, return, global, nonlocal, try/except/finally, raise, assert, listas, tuplas, diccionarios, sets, slicing, comprensiones, f-strings, desempaquetado, `import` / `from … import …` de tus módulos, y los módulos `math`, `random` (determinista) y `heapq`.

No disponible (a propósito): clases, generadores, `with`, `open`, `eval`, `exec`, `input`, red y sistema de archivos.

Límites: 20 000 instrucciones entre dos acciones (si se superan, la unidad pausa 1 s «CPU saturada»), 200 llamadas anidadas, 100 000 elementos por lista/texto.
