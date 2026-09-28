// Fuente única de las primitivas del juego: documentación interna, autocompletado y API.md.

export interface ApiDoc {
  name: string;
  sig: string;
  cat: 'Movimiento' | 'Sensores' | 'Trabajo' | 'Base' | 'Memoria' | 'Depuración';
  desc: string;
  returns: string;
  time: string;
  energy: string;
  example?: string;
}

export const API: ApiDoc[] = [
  {
    name: 'mover', sig: 'mover(direccion)', cat: 'Movimiento',
    desc: 'Mueve la unidad una casilla. direccion: "N", "S", "E" u "O". Si la casilla está bloqueada (agua, ruina, roca, bosque, borde) la unidad choca y pierde 1 s.',
    returns: 'True si se movió, False si chocó', time: '2 s en hierba · 1,2 s carretera · 1,5 s hormigón · 3,5 s maleza', energy: '1',
    example: 'if not mover("E"):\n    mover("N")',
  },
  {
    name: 'posicion', sig: 'posicion()', cat: 'Sensores',
    desc: 'Coordenadas actuales de la unidad. x crece hacia el Este, y crece hacia el Sur.',
    returns: 'tupla (x, y)', time: '0', energy: '0', example: 'x, y = posicion()',
  },
  {
    name: 'escanear', sig: 'escanear()', cat: 'Sensores',
    desc: 'Barre el entorno con el sensor (radio 3 en el dron). Revela el terreno en el mapa del jugador y devuelve los recursos detectados. Cada recurso tiene .tipo, .x, .y, .cantidad y .calidad.',
    returns: 'lista de Recurso', time: '3 s', energy: '2',
    example: 'for r in escanear():\n    print(r.tipo, r.x, r.y)',
  },
  {
    name: 'mirar', sig: 'mirar(direccion)', cat: 'Sensores',
    desc: 'Consulta el terreno de la casilla vecina sin moverse.',
    returns: 'texto: "hierba", "carretera", "agua", "ruina", "roca", "bosque"… o "borde"', time: '0,5 s', energy: '0',
    example: 'if mirar("E") != "agua":\n    mover("E")',
  },
  {
    name: 'terreno', sig: 'terreno(x, y)', cat: 'Sensores',
    desc: 'Terreno de una casilla según el mapa conocido por tu colonia (lo que han visto todas tus unidades).',
    returns: 'texto, o None si la casilla no se ha explorado', time: '0', energy: '0',
  },
  {
    name: 'transitable', sig: 'transitable(x, y)', cat: 'Sensores',
    desc: 'True si la casilla es conocida y la unidad puede pisarla. Útil para BFS / A*.',
    returns: 'True / False / None (desconocida)', time: '0', energy: '0',
  },
  {
    name: 'coste', sig: 'coste(x, y)', cat: 'Sensores',
    desc: 'Segundos que tardaría esta unidad en entrar en la casilla (según terreno conocido). None si es intransitable o desconocida. Útil para Dijkstra.',
    returns: 'número o None', time: '0', energy: '0',
  },
  {
    name: 'bateria', sig: 'bateria()', cat: 'Sensores',
    desc: 'Energía actual (0-100). Los paneles de la unidad recargan ~2 % por minuto.',
    returns: 'número', time: '0', energy: '0',
  },
  {
    name: 'carga', sig: 'carga()', cat: 'Sensores',
    desc: 'Unidades de recurso que transporta ahora.', returns: 'entero', time: '0', energy: '0',
  },
  {
    name: 'carga_max', sig: 'carga_max()', cat: 'Sensores',
    desc: 'Capacidad de carga de la unidad.', returns: 'entero', time: '0', energy: '0',
  },
  {
    name: 'inventario', sig: 'inventario()', cat: 'Sensores',
    desc: 'Contenido de la carga por tipo de recurso.', returns: 'diccionario {"hierro": 3, …}', time: '0', energy: '0',
  },
  {
    name: 'recurso_aqui', sig: 'recurso_aqui()', cat: 'Sensores',
    desc: 'Recurso que hay en la casilla actual (si ya fue escaneado).', returns: 'Recurso o None', time: '0', energy: '0',
  },
  {
    name: 'extraer', sig: 'extraer()', cat: 'Trabajo',
    desc: 'Extrae una unidad del recurso de la casilla actual. Hay que estar encima del recurso.',
    returns: '1 si extrajo, 0 si no había recurso o la carga está llena', time: 'hierro 3 s · cobre 4 s · silicio 6 s · chatarra 2,5 s · biomasa 2 s', energy: '1',
    example: 'while carga() < carga_max() and extraer():\n    pass',
  },
  {
    name: 'descargar', sig: 'descargar()', cat: 'Base',
    desc: 'Descarga toda la carga en el almacén de la base. Hay que estar junto a la base (el muelle de base() sirve).',
    returns: 'unidades descargadas', time: '2 s', energy: '0',
  },
  {
    name: 'recargar', sig: 'recargar()', cat: 'Base',
    desc: 'Recarga la batería al 100 % junto a la base.', returns: 'nueva batería', time: '0,4 s por cada 1 %', energy: '—',
  },
  {
    name: 'base', sig: 'base()', cat: 'Base',
    desc: 'Coordenadas del muelle de tu base (casilla libre al sur del centro operativo).',
    returns: 'tupla (x, y)', time: '0', energy: '0',
  },
  {
    name: 'almacen', sig: 'almacen()', cat: 'Base',
    desc: 'Recursos guardados en tu base.', returns: 'diccionario', time: '0', energy: '0',
  },
  {
    name: 'fabricar', sig: 'fabricar(tipo)', cat: 'Base',
    desc: 'Fabrica una unidad nueva junto a la base. tipo: "dron" (10 hierro, 4 cobre), "explorador" (12 hierro, 6 cobre; vuela, radio 5, no mina) o "minero" (20 hierro, 8 chatarra; carga 20, mina más rápido).',
    returns: 'nombre de la unidad nueva, o None si faltan recursos', time: '60-120 s', energy: '5',
  },
  {
    name: 'esperar', sig: 'esperar(segundos)', cat: 'Trabajo',
    desc: 'Espera sin hacer nada (mínimo 1 s). Los paneles siguen recargando.', returns: 'None', time: 'los segundos indicados', energy: '0',
  },
  {
    name: 'tiempo', sig: 'tiempo()', cat: 'Sensores',
    desc: 'Segundos transcurridos desde que empezó el programa.', returns: 'número', time: '0', energy: '0',
  },
  {
    name: 'nombre', sig: 'nombre()', cat: 'Sensores',
    desc: 'Nombre de la unidad que ejecuta el programa (p. ej. "DRN-01"). Útil cuando varias unidades comparten código.',
    returns: 'texto', time: '0', energy: '0',
  },
  {
    name: 'memoria', sig: 'memoria', cat: 'Memoria',
    desc: 'Diccionario propio de la unidad que sobrevive a reinicios del programa. Guarda aquí lo que quieras recordar.',
    returns: 'dict', time: '0', energy: '0', example: 'memoria["hierro"] = memoria.get("hierro", []) + [(x, y)]',
  },
  {
    name: 'compartido', sig: 'compartido', cat: 'Memoria',
    desc: 'Diccionario compartido por todas las unidades de tu colonia: la forma de que se pasen información.',
    returns: 'dict', time: '0', energy: '0',
  },
  {
    name: 'print', sig: 'print(...)', cat: 'Depuración',
    desc: 'Escribe en el log de la unidad.', returns: 'None', time: '0', energy: '0',
  },
  {
    name: 'dibujar_ruta', sig: 'dibujar_ruta(puntos)', cat: 'Depuración',
    desc: 'Dibuja en el mapa una lista de coordenadas [(x, y), …]. Ideal para depurar tu pathfinding.',
    returns: 'None', time: '0', energy: '0', example: 'dibujar_ruta(camino)',
  },
];

export const API_NAMES = API.map((a) => a.name);
