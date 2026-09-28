# G.R.I.D. — Documento de diseño

**Gamified Robotics & Instructional Development**
*«El mundo cayó, pero estamos construyendo algo nuevo.»*

## 1. Pilar

El jugador es un operador que reconstruye un valle postindustrial reclamado por
la naturaleza. No tiene avatar ni controles directos: **selecciona, observa,
programa y deja correr**. Cada mecánica pasa el filtro:

> ¿Puede resolverse programando? Si no, se rediseña.

## 2. Core loop

```
     ┌──────────── sesión 20-40 min ─────────────┐
     │ 1. Leer informe (logs, bloqueos, ranking)  │
     │ 2. Depurar / mejorar funciones             │
     │ 3. Lanzar programas en unidades            │
     │ 4. Observar unos minutos, ajustar          │
     └───────────────┬────────────────────────────┘
                     ▼
     ┌──────────── horas desconectado ───────────┐
     │ El mundo sigue: exploración, minería,      │
     │ transporte… Los errores cuestan tiempo,    │
     │ nunca destruyen progreso.                  │
     └───────────────┬────────────────────────────┘
                     ▼
           Informe de regreso → vuelta a 1
```

### Loop del MVP (primer objetivo)

explorar → encontrar mineral → llegar → extraer → volver → descargar → repetir.

La progresión emerge de las fricciones:

| Fricción que el jugador sufre | Concepto que descubre |
|---|---|
| Escribir `mover("E")` 12 veces | bucles |
| Copiar el mismo bucle en tres programas | funciones, módulos (`import nav`) |
| El dron se estrella contra el agua | condicionales, valor de retorno |
| Olvida dónde vio cobre | estructuras de datos, `memoria`, `compartido` |
| Rodea el lago a ciegas | BFS / grafos |
| La carretera es más rápida que la hierba | Dijkstra / A*, costes |
| Batería a 0 lejos de casa | planificación, heurísticas |
| Varios drones compitiendo por el mismo filón | coordinación, datos compartidos |

## 3. Mundo

- Grid discreta 96×96 (aula de 15-35 jugadores; 64×64 en la demo). Coordenadas
  `(x, y)`, **N = y−1, S = y+1, E = x+1, O = x−1**.
- Terreno con costes distintos (hace que los algoritmos importen):

| Terreno | Transitable | Tiempo `mover` | Notas |
|---|---|---|---|
| hierba | sí | 2,0 s | |
| carretera | sí | 1,2 s | autopistas rotas del viejo mundo |
| hormigón | sí | 1,5 s | plazas y polígonos |
| maleza / musgo | sí | 3,5 s | lento, rodea ruinas |
| bosque | no | — | árboles densos |
| agua | no | — | ríos y lagos (drones aéreos: fase 2) |
| ruina / roca | no | — | edificios caídos, torres |

- Niebla por jugador: lo descubierto es conocimiento compartido entre sus unidades
  (`terreno(x, y)`), pero **las posiciones de recursos sólo llegan por `escanear()`**
  y hay que guardarlas.

## 4. Recursos (MVP)

| Recurso | Dónde | Extracción | Renovable |
|---|---|---|---|
| hierro | junto a roca | 3 s/ud | no |
| cobre | vetas verdes en claros | 4 s/ud | no |
| silicio | cristales en ruinas | 6 s/ud | no |
| chatarra | restos industriales | 2,5 s/ud | no |
| biomasa | matorral | 2 s/ud | sí, lenta |

Cada nodo: posición, cantidad, calidad (1-3, multiplica el valor), dificultad.

## 5. Unidades

| Tipo | Coste | Mover | Escáner | Carga | Mina |
|---|---|---|---|---|---|
| Dron (inicial) | — | ×1 | radio 3 | 8 | sí |
| Explorador | 12 hierro, 6 cobre | ×0,5 | radio 5 | 0 | no |
| Minero | 20 hierro, 8 chatarra | ×1,25 | radio 2 | 20 | sí, ×1,5 |
| Constructor | fase 2 | | | | construye planos |

Se fabrican **programando**: `fabricar("minero")` junto a la base.

## 6. Errores como feedback

- `mover()` contra un obstáculo devuelve `False`; tras 5 fallos seguidos la unidad
  aparece **BLOQUEADA** con intentos fallidos y tiempo perdido acumulados.
- Excepción → estado **ERROR** con línea exacta; la unidad se queda quieta y segura.
- Batería a 0 → **HIBERNANDO** con recarga solar lenta (1 %/30 s). Nunca muere.
- Logs compactados: líneas repetidas se agrupan (`× 3487`).

## 7. Rankings diarios (varios, para que nadie domine todos)

minería · exploración · eficiencia energética (recursos por batería) ·
eficiencia de código (instrucciones por acción) · automatización (minutos de
programa activo sin error) · riqueza. La **clasificación general** suma puestos
(Borda), premiando perfiles variados.

## 8. Sistemas posteriores (diseñados, no en el MVP)

- **Construcción**: `constructor.colocar("pared")`; planos como matrices
  (`["M","P","."]`), `construir_edificio(plano)`.
- **Agricultura**: parcelas con humedad, madurez y plagas; `regar`, `plantar`,
  `recolectar`; ciclos que premian condicionales y planificación.
- **Energía**: red de paneles/baterías; los programas deben decidir cuándo trabajar.
- **Hacking (PvP indirecto)**: interferencia GPS (`posicion()` con ruido),
  sensores falsos, ralentización, ocultar recursos. Siempre con coste, cooldown,
  duración limitada, rastro en logs y **defensas programables**
  (`if señal_sospechosa(): verificar_posicion()`). Nunca destrucción permanente.
- **Eventos globales**: tormentas (movimiento más lento), EMP (escáner falla),
  aparición de yacimientos, plagas. Consultables con `eventos()`; premian código reactivo.
- **Mercado de código**: publicar módulos, comprarlos/alquilarlos, `from autor_tools import …`.
- **Modo profesor**: crear mundo de aula, pausar, retos, ver código (con permiso).

## 9. Dirección de arte

Isométrico ligero, estilizado, ligeramente pictórico. Verde vegetación, teal,
acero, hormigón, blanco técnico, ámbar para maquinaria, acentos neón mínimos,
luz solar cálida desde el noroeste. La naturaleza **atraviesa** lo humano:
carreteras agrietadas con hierba, ruinas con musgo y hiedra, árboles dentro de
edificios. Robots pequeños, funcionales y simpáticos, identificados por color:

- dron: teal + blanco, hélices · explorador: cian, cuerpo fino, anillo luminoso
- minero: ámbar, orugas, taladro frontal · constructor: naranja/blanco, brazo articulado

UI oscura translúcida, iconos antes que texto, jerarquía clara.

## 10. Wireframe (pantalla principal)

```
┌──────────────────────────────────────────────────────────────────────┐
│ G.R.I.D.  ⛏ hierro 42  ◆ cobre 12  ◇ silicio 0  ⚙ chatarra 8   ⏱ 14:32 │
├───────┬──────────────────────────────────────────────┬───────────────┤
│UNIDADES│                                             │ DRN-01  ● ACTIVO│
│ DRN-01 │                                             │ (12, 8) ▮▮▮▮▯ 78%│
│  ● 78% │             MUNDO ISOMÉTRICO                │ carga 5/8       │
│ MIN-01 │        (arrastrar = cámara, rueda = zoom)   │ programa minero │
│  ⚠ BLOQ│                                             │ ▸ extraer() 2 s │
│        │                                             │ LOG             │
│        │                                             │ 12:41 cobre…    │
├───────┴───┐                                          │ [Código] [Stop] │
│ minimapa  │                         [Ranking] [Manual]│                 │
└───────────┴──────────────────────────────────────────┴───────────────┘
 Editor (panel deslizante): pestañas de archivos · código · manual · versiones
```
