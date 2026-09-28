# G.R.I.D. — Gamified Robotics & Instructional Development

Juego de estrategia en vista isométrica donde **tú escribes el código y las máquinas construyen el futuro**.
Escribes Python, lo cargas en tus robots y compites con tu clase en partidas de 15 minutos.

Producción: **https://grid.carloshidalgo.eu**

## Qué hay

| Ruta | Pantalla |
|---|---|
| `#/` | Inicio (entrar con código de sala, tutorial, práctica, guía, profesor) |
| `#/entrar` | Cuentas: alumno (usuario + PIN de 4 cifras) y profesor (email + contraseña) |
| `#/tutorial`, `#/tutorial/N` | 10 niveles: strings → bucles → condicionales → funciones → biblioteca propia (módulos) → listas → excepciones → diccionarios (fábrica) → clases → hackeo |
| `#/academia`, `#/academia/ID` | Academia: Python desde cero sin cuenta (Datos, Condicionales, Bucles… con 3 casos por reto, estrellas y código de progreso) |
| `#/practica` | Colonia propia persistente en el navegador con colonias bot |
| `#/guia` | Guía del operador (unidades, edificios, huertos, hackeo, primitivas, Python) |
| `#/profe`, `#/profe/CODIGO` | Salas del profesor: lobby con QR, ajustes, partida en **modo dios** |
| `#/sala/CODIGO` | Alumno: nombre → lobby → partida → resultados |

Cada alumno empieza con **dron granjero**, **minero** (tierra), **constructor** (caminos, almacén, silo,
panel solar, antena, aspersor) y **dron hacker**. Gana quien más puntos entrega en su base.

## Arquitectura (resumen)

- **Cliente** (Vite + TypeScript, Canvas 2D isométrico, CodeMirror 6). El intérprete PyGrid y la
  simulación por eventos (`src/sim`) son TypeScript puro y deterministas.
- **Partida**: el navegador del profesor es el servidor autoritativo. Los alumnos regeneran el mapa desde la
  semilla y reciben parches filtrados por niebla cada ~330 ms; envían archivos y órdenes de ejecución.
- **Tiempo real**: Ably (canales `grid:SALA:host|all|c:ID`, tokens con permisos mínimos emitidos por `/api/ably`).
  Sin Ably (desarrollo) se usa `BroadcastChannel` entre pestañas.
- **API** (`/api`, funciones de Vercel): cuentas, salas, progreso del tutorial y resultados en Postgres (Neon).
  Tablas con prefijo `grid_` (se crean solas). En local, sin URL de base de datos, usa pg-mem.

Más detalle en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md), [docs/DISENO.md](docs/DISENO.md) y
[docs/API.md](docs/API.md).

## Desarrollo

```bash
npm install
npm run dev     # http://localhost:5173 (incluye /api con pg-mem)
npm test        # intérprete, mecánicas, multijugador, tutorial y retos de la Academia
npm run build   # tsc + vite build → dist/
npm run docs    # regenera docs/API.md
```

## Despliegue (Vercel)

Variables de entorno: `GRID_URL` (o `DATABASE_URL`) de Neon, `ABLY_API_KEY`, `AUTH_SECRET` (cadena larga
aleatoria). Opcional: `TEACHER_CODE` para restringir el registro de profesores.
