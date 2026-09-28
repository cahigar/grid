# G.R.I.D. — Gamified Robotics & Instructional Development

Juego de automatización persistente en vista isométrica donde **no controlas las máquinas: las programas**.
Escribes Python, lo cargas en tus drones y ellos exploran, minan y vuelven a la base en tiempo real,
también cuando cierras el juego.

Esta es la **vertical slice / demo jugable** (iteración 1).

## Ejecutar

Requisitos: Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests del intérprete y de la simulación
npm run build      # build de producción en dist/ (desplegable en Vercel como sitio estático)
npm run build:single   # un único HTML autocontenido en dist-single/
npm run docs       # regenera docs/API.md desde src/sim/api.ts
```

`?galeria` en la URL abre la guía visual de assets.

## Qué incluye la demo

- Mundo 64×64 generado proceduralmente: ciudad en ruinas, río con puentes (algunos derruidos), lago, bosques,
  rocas, huertos; niebla por jugador.
- Tu colonia (centro operativo, paneles solares, almacén, silo, invernadero) y un **dron** programable.
- **PyGrid**: intérprete de un subconjunto real de Python con estado serializable, límites de instrucciones,
  módulos del jugador (`from nav import ir_a`), `math`, `random`, `heapq`, errores en español con línea.
- Primitivas: `mover`, `escanear`, `mirar`, `extraer`, `descargar`, `recargar`, `fabricar`, `esperar`,
  sensores (`posicion`, `bateria`, `carga`, `terreno`, `transitable`, `coste`…), `memoria`, `compartido`,
  `dibujar_ruta` (ver [docs/API.md](docs/API.md)).
- Simulación por eventos con marcas de tiempo: acciones en tiempo real (mover = 2 s), batería con
  hibernación solar, bloqueos con contador de intentos y tiempo perdido, logs compactados.
- **Persistencia**: se guarda en el navegador; al volver se calcula lo ocurrido y aparece el
  **informe de regreso** (8 h de mundo se simulan en ~0,3 s).
- Editor integrado (CodeMirror): resaltado, autocompletado de primitivas y de tus funciones,
  diagnóstico en vivo, errores de ejecución marcados en la línea, versiones, **Probar 5 min**
  (simula tu programa usando sólo el mapa que conoce tu colonia), manual integrado.
- Tres colonias rivales programadas en PyGrid (una usa BFS), rankings diarios múltiples y
  clasificación general por puntos.
- Objetivos guía (sin tutorial): traer mineral → crear una biblioteca → fabricar otra unidad → …

## Estructura

```
src/sim/lang     PyGrid: lexer, parser, compilador, VM, builtins, serialización
src/sim/world    mapa procedural, simulación por eventos, contenido (plantillas y bots)
src/sim/api.ts   fuente única de las primitivas (manual, autocompletado, API.md)
src/client       render isométrico procedural, UI, editor, backend local
tests            tests (node:test)
docs             diseño, arquitectura, API
```

Más detalle en [docs/DISENO.md](docs/DISENO.md) y [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).
