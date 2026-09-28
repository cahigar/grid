# G.R.I.D. — Arquitectura técnica

> Regla de oro: **el jugador no controla máquinas. Las programa.**
> Toda decisión técnica se mide contra eso y contra tres restricciones: seguridad, persistencia y coste de servidor casi nulo.

## 1. Visión de conjunto

```
┌──────────────────────────── Navegador ────────────────────────────┐
│  UI (TS + DOM)   Editor (CodeMirror 6)   Render isométrico (Canvas)│
│        │                  │                        ▲               │
│        ▼                  ▼                        │ vista (niebla)│
│  ┌─────────────── Backend (interfaz) ──────────────┴────────────┐  │
│  │ LocalBackend (demo)  ·  RemoteBackend (multijugador, fase 2)  │  │
│  └───────────────┬───────────────────────────────────────────────┘  │
└──────────────────┼──────────────────────────────────────────────────┘
                   ▼
        ┌──────── NÚCLEO DE SIMULACIÓN (src/sim, TS puro) ────────┐
        │  PyGrid: lexer → parser → compilador → VM serializable  │
        │  Mundo: grid, terreno, recursos, niebla por jugador      │
        │  Planificador de eventos por timestamp (cola de prioridad)│
        │  Primitivas de unidades · logs · rankings                │
        └─────────────────────────────────────────────────────────┘
```

El **núcleo** no depende del DOM, de la red ni del reloj del sistema: recibe
«avanza hasta el instante T» y devuelve un estado nuevo. Eso permite ejecutarlo:

- **en el navegador** (demo en solitario, pruebas de código, «simular 10 minutos»);
- **en un proceso Node** permanente (servidor de aula clásico);
- **en funciones serverless** (Vercel): cargar estado → `advanceTo(ahora)` → guardar.

## 2. Por qué un intérprete propio (PyGrid) y no CPython/Pyodide

| Requisito | CPython en sandbox | Pyodide | **PyGrid (VM propia)** |
|---|---|---|---|
| Programas que duran horas en tiempo real | proceso vivo por unidad | no persistible | **estado = JSON** |
| Sobrevivir a reinicios / serverless | ✗ (la pila C no se serializa) | ✗ | **✓ se guarda a mitad de un bucle** |
| Determinismo (repetir, auditar, rankings justos) | difícil | difícil | **✓** |
| Límite de instrucciones exacto | aproximado (señales) | aproximado | **✓ contador por instrucción** |
| Seguridad (sin FS, red, `__import__`, `eval`) | capas de SO | aislado del server pero pesado (≈10 MB) | **✓ por construcción: sólo existe lo que exponemos** |
| Métrica «eficiencia de código» | ✗ | ✗ | **✓ instrucciones por acción** |

PyGrid implementa un **subconjunto real de Python 3**: el código que escribe el
alumno es Python válido y funciona igual fuera del juego (salvo las primitivas).

Soportado en el MVP: `def` (defaults, recursión, closures), `lambda`, `if/elif/else`,
`while`, `for … in`, `break/continue/pass`, `return`, `global`, `try/except`,
listas, tuplas, diccionarios, conjuntos, slicing, comprensiones de listas,
f-strings, desempaquetado `x, y = pos`, `import`/`from … import …` de módulos
del propio jugador y de `math`, `random` (sembrado) y `heapq`.
Pendiente: clases, generadores, `with`.

### Funcionamiento

1. `lexer` (con INDENT/DEDENT) → `parser` (AST) → `compiler` (bytecode de pila).
2. La `VM` ejecuta instrucciones con presupuesto. Cuando el programa llama a una
   **primitiva de acción** (`mover`, `extraer`…), la VM se **suspende** y devuelve
   `{acción, argumentos}` al mundo. El mundo programa el fin de la acción en
   `t + duración`; al llegar ese instante reanuda la VM con el resultado.
3. El estado de la VM (pila, frames, heap con aliasing) se serializa a JSON.
   El código compilado **no** se guarda: se recompila del fuente guardado
   (compilación determinista → mismos índices).

### Límites (anti-bloqueo)

- 20 000 instrucciones de cómputo puro entre dos acciones; si se superan la
  unidad queda «CPU saturada» 1 s de juego y sigue (nunca bloquea el servidor).
- Profundidad de llamadas 200, listas/strings ≤ 100 000 elementos,
  estado serializado ≤ 256 KB → error visible, no caída.
- No existen `open`, `eval`, `exec`, `__import__`, atributos `__x__`, red ni reloj real.

## 3. Simulación por eventos

- Tiempo de juego = milisegundos de tiempo real (`mover` = 2 s, de verdad).
- Cada unidad tiene como mucho **un evento pendiente** (fin de su acción actual)
  en una cola de prioridad `(t, seq)`. `advanceTo(T)` saca eventos en orden
  hasta `T`. Coste proporcional a acciones, no a frames: 35 alumnos × 5 unidades
  ≈ 90 acciones/s → irrelevante para un servidor pequeño.
- **Catch-up**: al volver tras N horas se procesan los eventos pendientes en
  orden. Con acciones de ≥ 0,5 s, 8 h de una unidad son < 60 000 pasos (≈ 1 s).
- Errores nunca destruyen progreso: batería a 0 → hibernación con recarga solar
  lenta; choques → `mover()` devuelve `False` y cuenta «intentos fallidos».

## 4. Persistencia

| Fase | Almacenamiento | Transporte |
|---|---|---|
| Demo (ahora) | `localStorage` (snapshot JSON comprimido del mundo) | — |
| Aula (fase 2) | PostgreSQL (Neon/Supabase si se despliega en Vercel) | HTTP + polling 2 s, o WebSocket en Node |

Esquema previsto (Postgres):

```sql
worlds  (id, seed, config jsonb, sim_time bigint, state jsonb, updated_at)
players (id, world_id, name, token_hash, created_at)
files   (id, player_id, name, source text, version int, created_at)  -- versionado
published_modules (id, author_id, name, version, source, price, license) -- mercado
rankings_daily (world_id, day, category, player_id, value)
```

**Ruta Vercel**: cada petición `GET /api/world/:id/view` hace
`load → advanceTo(now) → save → vista filtrada por niebla` dentro de una
transacción con `SELECT … FOR UPDATE` (un único escritor por mundo). Un cron de
Vercel cada pocos minutos garantiza que el mundo avanza aunque nadie mire.
Alternativa si el aula crece: un proceso Node en Fly/Railway con el mismo núcleo.

## 5. Módulos del jugador y futuro mercado de código

- Cada jugador tiene archivos: programas (`minero.py`) y librería (`nav.py`).
- `import nav` / `from nav import ir_a` se resuelve en el espacio del jugador.
- Al lanzar un programa se **congela una instantánea** de sus módulos
  (versionado implícito: editar la librería no rompe lo que ya corre).
- Mercado: `from jugador17_tools import pathfinder` se resolverá contra
  `published_modules` con la misma VM (sin privilegios extra), con licencia de uso
  registrada. El código comprado puede ejecutarse sin exponerse el fuente
  (bytecode firmado) si se quiere modelo «alquiler».

## 6. Cliente

- **Render**: Canvas 2D isométrico (2:1, tile 64×32). Suelo cacheado por
  chunks de 16×16; objetos altos y unidades ordenados por profundidad; assets
  **procedurales** (pintados por código) → cero dependencias gráficas y estilo
  coherente. Migrable a PixiJS si hiciera falta más escala.
- **UI**: DOM + CSS (paneles translúcidos). Sin framework en el MVP.
- **Editor**: CodeMirror 6 con resaltado Python, autocompletado de primitivas y
  de las funciones del jugador, diagnóstico en vivo con el propio compilador PyGrid.

## 7. Estado (iteración 1) y siguientes pasos

Hecho en la demo: núcleo PyGrid + mundo por eventos + cliente completo con `LocalBackend`
(localStorage, catch-up e informe de regreso). Verificado con tests: semántica Python, suspensión y
serialización a mitad de programa, determinismo (guardar/cargar cada 5 min produce el mismo mundo que
sin guardar), bloqueo por `while True: mover("E")`, hibernación, catch-up de 8 h.

Siguiente iteración propuesta:

1. `RemoteBackend` + API serverless (Vercel) con Postgres: mundos de aula con código de clase.
2. Constructor y planos como matrices (`colocar`, `construir_edificio(plano)`).
3. Eventos globales (tormentas, EMP) consultables con `eventos()`.
4. Agricultura programable en los huertos de la base.
5. Hacking indirecto con defensas programables.
6. Panel del profesor.

## 8. Estructura del repositorio

```
src/sim/lang     lexer, parser, compiler, vm, builtins, serialize
src/sim/world    mapa procedural, entidades, primitivas, planificador, rankings
src/sim/api.ts   definición única de primitivas (doc del juego + autocompletado)
src/client       render, UI, editor, backend local
tests            tests del intérprete y de la simulación (node:test)
docs             diseño, arquitectura, API
```
