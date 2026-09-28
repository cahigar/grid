// Fuente única de las primitivas del juego: manual, autocompletado y docs/API.md.
import type { UnitType } from './world/types';

export interface ApiDoc {
  name: string;
  sig: string;
  cat: 'Movimiento' | 'Sensores' | 'Granjero' | 'Minero' | 'Constructor' | 'Hacker' | 'Aspersor' | 'Base' | 'Centro operativo' | 'Memoria' | 'Depuración' | 'Errores';
  desc: string;
  returns: string;
  time: string;
  energy: string;
  who?: UnitType[];
  raises?: string;
  example?: string;
}

const MOV: UnitType[] = ['granjero', 'minero', 'constructor', 'hacker'];

export const API: ApiDoc[] = [
  {
    name: 'mover', sig: 'mover(direccion)', cat: 'Movimiento', who: MOV,
    desc: 'Mueve la unidad una casilla. direccion: "N", "S", "E" u "O". Las unidades de tierra chocan con agua, bosque, rocas, ruinas y edificios; los drones vuelan por encima de agua y bosque. Por un camino todo va más rápido.',
    returns: 'True si se movió, False si chocó', time: 'según terreno (hierba 0,7 s · camino 0,35 s · dron 0,3 s)', energy: '1',
    example: 'if not mover("E"):\n    mover("N")',
  },
  {
    name: 'posicion', sig: 'posicion()', cat: 'Sensores',
    desc: 'Coordenadas actuales. x crece hacia el Este, y crece hacia el Sur.', returns: 'tupla (x, y)', time: '0', energy: '0', example: 'x, y = posicion()',
  },
  {
    name: 'escanear', sig: 'escanear()', cat: 'Sensores', who: MOV,
    desc: 'Barre el entorno: revela el terreno y devuelve las vetas detectadas, de la más cercana a la más lejana. Cada una tiene .tipo, .x, .y, .cantidad y .calidad.',
    returns: 'lista de Recurso', time: '1 s', energy: '2', example: 'for r in escanear():\n    print(r.tipo, r.x, r.y)',
  },
  {
    name: 'radar', sig: 'radar()', cat: 'Sensores',
    desc: 'Unidades cercanas (propias y enemigas). Cada una tiene .nombre, .tipo, .x, .y, .dueño y .enemiga.',
    returns: 'lista de Unidad', time: '0', energy: '0', example: 'enemigos = [u for u in radar() if u.enemiga]',
  },
  {
    name: 'mirar', sig: 'mirar(direccion)', cat: 'Sensores',
    desc: 'Terreno de la casilla vecina sin moverse.', returns: 'texto: "hierba", "agua", "camino", "roca"… o "borde"', time: '0,2 s', energy: '0',
  },
  {
    name: 'terreno', sig: 'terreno(x, y)', cat: 'Sensores',
    desc: 'Terreno de una casilla según lo que ha visto tu colonia.', returns: 'texto, o None si no se ha explorado', time: '0', energy: '0',
  },
  {
    name: 'transitable', sig: 'transitable(x, y)', cat: 'Sensores',
    desc: 'True si la casilla es conocida y esta unidad puede entrar. Ideal para BFS / A*.', returns: 'True / False / None', time: '0', energy: '0',
  },
  {
    name: 'coste', sig: 'coste(x, y)', cat: 'Sensores',
    desc: 'Segundos que tardaría esta unidad en entrar en la casilla. Útil para Dijkstra.', returns: 'número o None', time: '0', energy: '0',
  },
  { name: 'bateria', sig: 'bateria()', cat: 'Sensores', desc: 'Energía (0-100). Se recarga con recargar() junto a la base o un panel solar.', returns: 'número', time: '0', energy: '0' },
  { name: 'senal', sig: 'senal()', cat: 'Sensores', desc: 'True si la unidad está dentro del alcance de la base (radio 9) o de una antena propia (radio 7). Sin señal, las acciones tardan el doble.', returns: 'True / False', time: '0', energy: '0' },
  { name: 'carga', sig: 'carga()', cat: 'Sensores', desc: 'Unidades que transporta.', returns: 'entero', time: '0', energy: '0' },
  { name: 'carga_max', sig: 'carga_max()', cat: 'Sensores', desc: 'Capacidad de carga (minero 12, granjero 6).', returns: 'entero', time: '0', energy: '0' },
  { name: 'inventario', sig: 'inventario()', cat: 'Sensores', desc: 'Lo que transporta, por tipo.', returns: 'dict {"hierro": 3, …}', time: '0', energy: '0' },
  { name: 'recurso_aqui', sig: 'recurso_aqui()', cat: 'Sensores', desc: 'Veta de la casilla actual (si ya se escaneó).', returns: 'Recurso o None', time: '0', energy: '0' },
  { name: 'tiempo', sig: 'tiempo()', cat: 'Sensores', desc: 'Segundos desde que empezó el programa.', returns: 'número', time: '0', energy: '0' },
  { name: 'tiempo_restante', sig: 'tiempo_restante()', cat: 'Sensores', desc: 'Segundos que quedan de partida.', returns: 'número o None', time: '0', energy: '0' },
  { name: 'nombre', sig: 'nombre()', cat: 'Sensores', desc: 'Nombre de la unidad (p. ej. "MIN-01").', returns: 'texto', time: '0', energy: '0' },
  { name: 'tipo', sig: 'tipo()', cat: 'Sensores', desc: 'Tipo de la unidad: "granjero", "minero", "constructor", "hacker" o "aspersor".', returns: 'texto', time: '0', energy: '0' },
  { name: 'integridad', sig: 'integridad()', cat: 'Sensores', desc: 'False si un hacker ha modificado el programa que estás ejecutando.', returns: 'True / False', time: '0', energy: '0', example: 'if not integridad():\n    print("¡me han hackeado!")' },

  // base
  { name: 'base', sig: 'base()', cat: 'Base', desc: 'Casilla de aparcamiento de tu base: una casilla libre y transitable pegada al centro operativo (ahí se descarga, se recarga y se carga agua).', returns: 'tupla (x, y)', time: '0', energy: '0' },
  { name: 'almacen', sig: 'almacen()', cat: 'Base', desc: 'Recursos guardados en tu colonia.', returns: 'dict', time: '0', energy: '0' },
  {
    name: 'descargar', sig: 'descargar()', cat: 'Base', who: MOV,
    desc: 'Entrega la carga en la base (a 2 casillas o menos) o en un almacén propio (al lado). Un silo sólo acepta cosecha. Cada recurso suma puntos: hierro 1, chatarra 1, cobre 2, cosecha 3, silicio 4.',
    returns: 'unidades entregadas', time: '0,7 s', energy: '0',
  },
  { name: 'recargar', sig: 'recargar()', cat: 'Base', who: MOV, desc: 'Recarga al 100 % junto a la base o a un panel solar propio.', returns: 'batería', time: 'proporcional a lo que falte', energy: '—' },
  { name: 'esperar', sig: 'esperar(segundos)', cat: 'Base', desc: 'Espera los segundos indicados (tiempo real).', returns: 'None', time: 'lo indicado', energy: '0' },

  // granjero
  { name: 'plantar', sig: 'plantar()', cat: 'Granjero', who: ['granjero'], desc: 'Siembra en la parcela de huerto que hay debajo.', returns: 'True', time: '0,7 s', energy: '1', raises: 'AccionInvalidaError si no hay huerto o ya está plantado' },
  { name: 'regar', sig: 'regar()', cat: 'Granjero', who: ['granjero'], desc: 'Añade 45 de humedad a la parcela. Gasta 1 de agua del depósito (6).', returns: 'True', time: '0,5 s', energy: '1', raises: 'SinRecursosError si el depósito está vacío' },
  {
    name: 'recolectar', sig: 'recolectar()', cat: 'Granjero', who: ['granjero'],
    desc: 'Cosecha la parcela si su madurez es 100: +2 cosecha. Un cultivo madura 1 punto por segundo mientras su humedad sea > 30; la humedad baja sola.',
    returns: 'unidades recogidas', time: '1 s', energy: '1', raises: 'CultivoNoMaduroError si aún no está listo',
    example: 'try:\n    recolectar()\nexcept CultivoNoMaduroError as e:\n    print("todavía no:", e)',
  },
  { name: 'cargar_agua', sig: 'cargar_agua()', cat: 'Granjero', who: ['granjero'], desc: 'Llena el depósito junto al agua o a la base.', returns: 'agua', time: '0,7 s', energy: '0', raises: 'FueraDeRangoError si no hay agua cerca' },
  { name: 'agua', sig: 'agua()', cat: 'Granjero', who: ['granjero', 'aspersor'], desc: 'Agua que queda en el depósito.', returns: 'entero', time: '0', energy: '0' },
  {
    name: 'parcela_aqui', sig: 'parcela_aqui()', cat: 'Granjero',
    desc: 'La parcela de huerto de la casilla actual como objeto Parcela: .plantada, .humedad, .madurez, .lista, .propia, .x, .y.',
    returns: 'Parcela o None', time: '0', energy: '0', example: 'p = parcela_aqui()\nif p and p.humedad < 30:\n    regar()',
  },
  { name: 'parcelas', sig: 'parcelas()', cat: 'Granjero', desc: 'Todas las parcelas de huerto que conoce tu colonia (incluidas las salvajes, sin dueño).', returns: 'lista de Parcela', time: '0', energy: '0' },

  // minero
  { name: 'picar', sig: 'picar()', cat: 'Minero', who: ['minero'], desc: 'Rompe 1 unidad de la veta de la casilla actual; cae al suelo.', returns: '1 si picó, 0 si no hay veta', time: 'hierro 1 s · cobre 1,4 s · silicio 2,1 s · chatarra 0,9 s', energy: '1' },
  { name: 'recoger', sig: 'recoger()', cat: 'Minero', who: ['minero'], desc: 'Mete en la carga lo que hay en el suelo de la casilla (¡también lo que dejó otro minero!).', returns: 'unidades recogidas', time: '0,35 s', energy: '0' },
  { name: 'suelo', sig: 'suelo()', cat: 'Minero', desc: 'Recursos sueltos en la casilla actual.', returns: 'dict', time: '0', energy: '0' },

  // constructor
  {
    name: 'construir', sig: 'construir(tipo, direccion)', cat: 'Constructor', who: ['constructor'],
    desc: 'Construye en la casilla vecina. Tipos y coste: "camino" (1 chatarra; sobre agua es un puente: 3 chatarra + 1 hierro), "almacen" (5 hierro + 3 chatarra), "silo" (3 hierro, sólo cosecha), "panel" (2 silicio + 2 cobre), "antena" (3 cobre + 2 hierro), "aspersor" (2 cobre + 2 hierro).',
    returns: 'True', time: 'camino 0,7 s · edificios 2-3 s', energy: '2', raises: 'SinRecursosError si faltan recursos · AccionInvalidaError si la casilla no vale',
    example: 'try:\n    construir("panel", "S")\nexcept SinRecursosError:\n    print("aún no hay silicio")',
  },
  { name: 'coste_edificio', sig: 'coste_edificio(tipo)', cat: 'Constructor', desc: 'Lo que cuesta un edificio.', returns: 'dict', time: '0', energy: '0' },
  { name: 'edificios', sig: 'edificios()', cat: 'Constructor', desc: 'Tus edificios: .tipo, .x, .y', returns: 'lista de Edificio', time: '0', energy: '0' },

  // hacker
  {
    name: 'hackear', sig: 'hackear(direccion, modo="invertir")', cat: 'Hacker', who: ['hacker'],
    desc: 'Modifica el programa de la unidad enemiga que está en la casilla vecina. Modos: "invertir" cambia una dirección ("N"↔"S", "E"↔"O"), "numero" suma o resta 1 a un número, "borrar" quita un carácter (puede romper el código). La víctima se reinicia con el código cambiado. Hay que empezar al lado; la conexión dura 4 s y se completa aunque el enemigo se aleje. Luego 45 s de enfriamiento. La víctima queda protegida 40 s.',
    returns: 'texto con el cambio, o False si falló', time: '4 s', energy: '3', raises: 'FueraDeRangoError si no hay enemigo al lado · AccionInvalidaError (enfriamiento, protegida o desactivado)',
  },

  // centro operativo
  {
    name: 'fabricar', sig: 'fabricar(tipo, programa=None)', cat: 'Centro operativo', who: ['base'],
    desc: 'La base fabrica una unidad nueva ("granjero", "minero" o "constructor") en una casilla libre junto a ella, pagando con el almacén. Si das un programa (p. ej. "minero.py"), la unidad empieza a ejecutarlo. Máximo 4 de cada tipo.',
    returns: 'nombre de la unidad nueva', time: '10 s', energy: '0',
    raises: 'SinRecursosError si faltan recursos · AccionInvalidaError (máximo alcanzado o sin sitio) · ValueError (tipo o archivo desconocido)',
    example: 'try:\n    print(fabricar("minero", "minero.py"))\nexcept SinRecursosError as e:\n    print("todavía no:", e)',
  },
  { name: 'coste_unidad', sig: 'coste_unidad(tipo)', cat: 'Centro operativo', desc: 'Lo que cuesta fabricar una unidad: granjero 4 hierro + 3 cobre + 1 silicio · minero 6 hierro + 4 chatarra · constructor 5 hierro + 5 chatarra + 2 cobre.', returns: 'dict', time: '0', energy: '0' },
  { name: 'unidades', sig: 'unidades()', cat: 'Centro operativo', desc: 'Lista de todas tus unidades (u.nombre, u.tipo, u.x, u.y).', returns: 'lista de Unidad', time: '0', energy: '0' },

  // aspersor
  {
    name: 'disparar', sig: 'disparar(x, y)', cat: 'Aspersor', who: ['aspersor'],
    desc: 'Lanza agua a una casilla (radio 3): riega esa parcela y sus 4 vecinas, y deja 8 s fuera de juego a los drones enemigos que estén allí (y cancela su hackeo). Gasta 1 de agua; el depósito (10) se rellena solo.',
    returns: 'drones mojados', time: '0,3 s', energy: '0', raises: 'FueraDeRangoError · SinRecursosError',
  },

  // memoria
  { name: 'memoria', sig: 'memoria', cat: 'Memoria', desc: 'Diccionario propio de la unidad que sobrevive a reinicios del programa (y a los hackeos).', returns: 'dict', time: '0', energy: '0', example: 'memoria["vetas"] = memoria.get("vetas", []) + [(x, y)]' },
  { name: 'compartido', sig: 'compartido', cat: 'Memoria', desc: 'Diccionario compartido por todas las unidades de tu colonia.', returns: 'dict', time: '0', energy: '0', example: 'compartido["objetivo"] = (x, y)' },

  // depuración
  { name: 'print', sig: 'print(...)', cat: 'Depuración', desc: 'Escribe en el log de la unidad.', returns: 'None', time: '0', energy: '0' },
  { name: 'dibujar_ruta', sig: 'dibujar_ruta(puntos)', cat: 'Depuración', desc: 'Dibuja en el mapa una lista de coordenadas [(x, y), …].', returns: 'None', time: '0', energy: '0' },

  // errores
  { name: 'SinRecursosError', sig: 'SinRecursosError', cat: 'Errores', desc: 'Faltan recursos, agua o batería para la acción.', returns: 'excepción', time: '', energy: '' },
  { name: 'CultivoNoMaduroError', sig: 'CultivoNoMaduroError', cat: 'Errores', desc: 'Has intentado recolectar antes de tiempo.', returns: 'excepción', time: '', energy: '' },
  { name: 'AccionInvalidaError', sig: 'AccionInvalidaError', cat: 'Errores', desc: 'La acción no tiene sentido aquí (no hay huerto, la unidad no sabe hacerlo, enfriamiento…).', returns: 'excepción', time: '', energy: '' },
  { name: 'FueraDeRangoError', sig: 'FueraDeRangoError', cat: 'Errores', desc: 'El objetivo está demasiado lejos.', returns: 'excepción', time: '', energy: '' },
];

export const API_NAMES = API.map((a) => a.name);
