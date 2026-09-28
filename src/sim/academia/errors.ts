// Explicaciones sencillas de los errores más habituales al empezar.
export function explainError(type: string, msg: string): string | null {
  const m = msg.toLowerCase();
  if (type === 'NameError') {
    const name = /'([^']+)'/.exec(msg)?.[1] ?? '';
    if (/^[NSEO]$/.test(name) || /^[A-ZÁÉÍÓÚ][a-záéíóú]+$/.test(name)) {
      return `¿Querías escribir un texto? Los textos van entre comillas: "${name}".`;
    }
    return `La variable «${name}» no existe (todavía). Comprueba que la has creado antes con ${name} = … y que está escrita igual: las mayúsculas cuentan.`;
  }
  if (type === 'TiempoAgotado') return 'Un bucle que nunca acaba: en un while, algo de dentro tiene que cambiar para que la condición llegue a ser falsa.';
  if (m.includes('indentationerror') || m.includes('sangría')) return 'Lo que va dentro de un if, for, while, def, match o case se escribe 4 espacios más a la derecha. Y todo lo que va al mismo nivel, alineado.';
  if (m.includes("falta ':'")) return 'Las líneas que empiezan por if, elif, else, for, while, def, match o case terminan en dos puntos (:).';
  if (m.includes("'=' asigna")) return '= guarda un valor en una variable; para preguntar «¿es igual?» se usa ==.';
  if (m.includes('sin cerrar')) return 'Has abierto unas comillas y no las has cerrado: "así".';
  if (type === 'SyntaxError') return 'Python no entiende esa línea: revisa paréntesis, comillas, dos puntos y comas.';
  if (type === 'TypeError' && m.includes('sumar texto')) return 'No se puede sumar un texto y un número. Convierte el número con str(n) o usa una f-string: f"total: {n}".';
  if (type === 'TypeError' && m.includes('argumento')) return 'Revisa cuántos valores le pasas a la función entre paréntesis.';
  if (type === 'IndexError') return 'Las posiciones empiezan en 0: en una lista de 3 elementos las posiciones válidas son 0, 1 y 2 (y -1 es el último).';
  if (type === 'KeyError') return 'Esa clave no está en el diccionario. Usa dic.get(clave, valor_por_defecto) o pregunta antes con: if clave in dic:';
  if (type === 'ValueError' && m.includes('convertir')) return 'int() sólo convierte textos que son cifras. Limpia antes los espacios (strip) o quédate sólo con el trozo de las cifras.';
  if (type === 'AttributeError') return 'Ese método no existe para este tipo de dato. ¿Está bien escrito? Algunos de texto: upper, lower, strip, split, replace. De lista: append, pop, sort.';
  if (type === 'ZeroDivisionError') return 'No se puede dividir entre 0: comprueba el divisor antes con un if.';
  return null;
}
