// PyGrid — operadores y protocolo de objetos.
import {
  Builtin, ExcObj, ExcType, Iter, ModuleObj, PyDict, PyFunc, PySet, Range, PyRecord, Tuple, err, fmtNum, hashKey,
  pyCmp, pyEq, pyRepr, pyStr, seqItems, toInt, toNum, truthy, typeName, type Value,
} from './values';

export const MAX_SEQ = 100_000;

const opName: Record<string, string> = { '+': 'sumar', '-': 'restar', '*': 'multiplicar', '/': 'dividir', '//': 'dividir', '%': 'calcular el resto de', '**': 'elevar' };

function num(v: Value): v is number | boolean {
  return typeof v === 'number' || typeof v === 'boolean';
}

export function binop(op: string, a: Value, b: Value): Value {
  if (num(a) && num(b)) {
    const x = Number(a);
    const y = Number(b);
    switch (op) {
      case '+': return x + y;
      case '-': return x - y;
      case '*': return x * y;
      case '/':
        if (y === 0) err('ZeroDivisionError', 'división entre cero');
        return x / y;
      case '//':
        if (y === 0) err('ZeroDivisionError', 'división entera entre cero');
        return Math.floor(x / y);
      case '%': {
        if (y === 0) err('ZeroDivisionError', 'módulo entre cero');
        const r = x % y;
        return r !== 0 && (r < 0) !== (y < 0) ? r + y : r;
      }
      case '**': {
        if (x === 0 && y < 0) err('ZeroDivisionError', '0 no puede elevarse a una potencia negativa');
        const r = Math.pow(x, y);
        if (!Number.isFinite(r) && Number.isFinite(x) && Number.isFinite(y)) err('OverflowError', 'resultado demasiado grande');
        return r;
      }
      case '&': return toInt(a) & toInt(b);
      case '|': return toInt(a) | toInt(b);
      case '^': return toInt(a) ^ toInt(b);
      case '<<': return toInt(a) << toInt(b);
      case '>>': return toInt(a) >> toInt(b);
    }
  }
  if (op === '+') {
    if (typeof a === 'string' && typeof b === 'string') {
      if (a.length + b.length > MAX_SEQ) err('MemoryError', 'texto demasiado largo');
      return a + b;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length + b.length > MAX_SEQ) err('MemoryError', 'lista demasiado larga');
      return a.concat(b);
    }
    if (a instanceof Tuple && b instanceof Tuple) return new Tuple(a.items.concat(b.items));
    if (typeof a === 'string' || typeof b === 'string') {
      const other = typeof a === 'string' ? b : a;
      err('TypeError', `no se puede sumar texto (str) y ${typeName(other)}; convierte con str(${typeName(other) === 'int' ? 'numero' : 'valor'})`);
    }
  }
  if (op === '*') {
    const s = typeof a === 'string' || Array.isArray(a) || a instanceof Tuple ? a : typeof b === 'string' || Array.isArray(b) || b instanceof Tuple ? b : null;
    const n = s === a ? b : a;
    if (s !== null && num(n)) {
      const k = Math.max(0, toInt(n));
      const len = typeof s === 'string' ? s.length : Array.isArray(s) ? s.length : (s as Tuple).items.length;
      if (len * k > MAX_SEQ) err('MemoryError', 'resultado demasiado grande');
      if (typeof s === 'string') return s.repeat(k);
      const items = Array.isArray(s) ? s : (s as Tuple).items;
      const out: Value[] = [];
      for (let i = 0; i < k; i++) out.push(...items);
      return Array.isArray(s) ? out : new Tuple(out);
    }
  }
  if (a instanceof PySet && b instanceof PySet) {
    switch (op) {
      case '|': return PySet.from([...a.items(), ...b.items()]);
      case '&': return PySet.from(a.items().filter((x) => b.has(x)));
      case '-': return PySet.from(a.items().filter((x) => !b.has(x)));
      case '^': return PySet.from([...a.items().filter((x) => !b.has(x)), ...b.items().filter((x) => !a.has(x))]);
    }
  }
  if (op === '%' && typeof a === 'string') {
    const vals = b instanceof Tuple ? b.items : [b];
    let i = 0;
    return a.replace(/%([-0-9.]*)([sdfr%])/g, (_m, spec: string, t: string) => {
      if (t === '%') return '%';
      const v = vals[i++];
      if (t === 's') return pyStr(v);
      if (t === 'r') return pyRepr(v);
      if (t === 'd') return String(Math.trunc(toNum(v)));
      const p = spec.includes('.') ? Number(spec.split('.')[1]) : 6;
      return toNum(v).toFixed(p);
    });
  }
  return err('TypeError', `no se puede ${opName[op] ?? 'operar'} '${typeName(a)}' ${op} '${typeName(b)}'`);
}

export function inplace(op: string, a: Value, b: Value): Value {
  if (op === '+' && Array.isArray(a)) {
    const items = iterToArray(b);
    if (a.length + items.length > MAX_SEQ) err('MemoryError', 'lista demasiado larga');
    a.push(...items);
    return a;
  }
  return binop(op, a, b);
}

export function unary(op: string, v: Value): Value {
  switch (op) {
    case 'not': return !truthy(v);
    case '-': return -toNum(v);
    case '+': return toNum(v);
    case '~': return ~toInt(v);
  }
  return err('TypeError', 'operador desconocido');
}

export function contains(container: Value, item: Value): boolean {
  if (typeof container === 'string') {
    if (typeof item !== 'string') err('TypeError', "'in <texto>' necesita texto a la izquierda");
    return container.includes(item as string);
  }
  if (Array.isArray(container)) return container.some((x) => pyEq(x, item));
  if (container instanceof Tuple) return container.items.some((x) => pyEq(x, item));
  if (container instanceof PyDict) return container.has(item);
  if (container instanceof PySet) return container.has(item);
  if (container instanceof Range) {
    if (typeof item !== 'number' || !Number.isInteger(item)) return false;
    const r = container;
    if (r.step > 0 ? item < r.start || item >= r.stop : item > r.start || item <= r.stop) return false;
    return (item - r.start) % r.step === 0;
  }
  if (container instanceof PyRecord) return typeof item === 'string' && item in container.f;
  return err('TypeError', `no se puede usar 'in' con '${typeName(container)}'`);
}

export function compare(op: string, a: Value, b: Value): boolean {
  switch (op) {
    case '==': return pyEq(a, b);
    case '!=': return !pyEq(a, b);
    case '<': return pyCmp(a, b) < 0;
    case '>': return pyCmp(a, b) > 0;
    case '<=': return pyCmp(a, b) <= 0;
    case '>=': return pyCmp(a, b) >= 0;
    case 'in': return contains(b, a);
    case 'not in': return !contains(b, a);
    case 'is': return a === b || (a === null && b === null) || (typeof a !== 'object' && pyEq(a, b) && typeof a === typeof b);
    case 'is not': return !compare('is', a, b);
  }
  return err('TypeError', 'comparación desconocida');
}

function normIndex(i: Value, len: number, what: string): number {
  if (typeof i === 'boolean') i = i ? 1 : 0;
  if (typeof i !== 'number') err('TypeError', `los índices de ${what} deben ser enteros, no '${typeName(i)}'`);
  if (!Number.isInteger(i)) err('TypeError', `los índices de ${what} deben ser enteros, no decimales (usa int())`);
  let k = i as number;
  if (k < 0) k += len;
  if (k < 0 || k >= len) err('IndexError', `índice ${i} fuera de rango (${what} de longitud ${len})`);
  return k;
}

export function getItem(obj: Value, idx: Value): Value {
  if (Array.isArray(obj)) return obj[normIndex(idx, obj.length, 'lista')];
  if (obj instanceof Tuple) return obj.items[normIndex(idx, obj.items.length, 'tupla')];
  if (typeof obj === 'string') return obj[normIndex(idx, obj.length, 'texto')];
  if (obj instanceof Range) return obj.at(normIndex(idx, obj.length, 'range'));
  if (obj instanceof PyDict) {
    const v = obj.get(idx);
    if (v === undefined) err('KeyError', `la clave ${pyRepr(idx)} no existe (usa .get(clave) o comprueba con 'in')`);
    return v as Value;
  }
  if (obj instanceof PyRecord) {
    if (typeof idx === 'string' && idx in obj.f) return obj.f[idx];
    err('KeyError', `${obj.type} no tiene el campo ${pyRepr(idx)}`);
  }
  return err('TypeError', `'${typeName(obj)}' no admite índices [ ]`);
}

export function setItem(obj: Value, idx: Value, v: Value): void {
  if (Array.isArray(obj)) { obj[normIndex(idx, obj.length, 'lista')] = v; return; }
  if (obj instanceof PyDict) {
    if (obj.size >= MAX_SEQ && !obj.has(idx)) err('MemoryError', 'diccionario demasiado grande');
    obj.set(idx, v);
    return;
  }
  if (obj instanceof Tuple) err('TypeError', 'las tuplas no se pueden modificar (son inmutables); usa una lista');
  if (typeof obj === 'string') err('TypeError', 'los textos no se pueden modificar; crea uno nuevo');
  if (obj instanceof PyRecord) { obj.f[String(idx)] = v; return; }
  err('TypeError', `'${typeName(obj)}' no admite asignación con [ ]`);
}

export function delItem(obj: Value, idx: Value): void {
  if (Array.isArray(obj)) { obj.splice(normIndex(idx, obj.length, 'lista'), 1); return; }
  if (obj instanceof PyDict) {
    if (!obj.delete(idx)) err('KeyError', `la clave ${pyRepr(idx)} no existe`);
    return;
  }
  err('TypeError', `'${typeName(obj)}' no admite del [ ]`);
}

export function slice(obj: Value, lo: Value, hi: Value, st: Value): Value {
  const seq = typeof obj === 'string' ? obj : Array.isArray(obj) ? obj : obj instanceof Tuple ? obj.items : null;
  if (seq === null) return err('TypeError', `'${typeName(obj)}' no admite slices [a:b]`);
  const len = seq.length;
  const step = st === null ? 1 : toInt(st);
  if (step === 0) err('ValueError', 'el paso de un slice no puede ser 0');
  const clamp = (v: Value, def: number, lower: number, upper: number) => {
    if (v === null) return def;
    let k = toInt(v);
    if (k < 0) k += len;
    return Math.min(Math.max(k, lower), upper);
  };
  let start: number;
  let stop: number;
  if (step > 0) { start = clamp(lo, 0, 0, len); stop = clamp(hi, len, 0, len); }
  else { start = clamp(lo, len - 1, -1, len - 1); stop = clamp(hi, -1, -1, len - 1); }
  const idxs: number[] = [];
  if (step > 0) for (let i = start; i < stop; i += step) idxs.push(i);
  else for (let i = start; i > stop; i += step) idxs.push(i);
  if (typeof seq === 'string') return idxs.map((i) => seq[i]).join('');
  const out = idxs.map((i) => (seq as Value[])[i]);
  return Array.isArray(obj) ? out : new Tuple(out);
}

export function getIter(v: Value): Iter {
  if (Array.isArray(v) || v instanceof Tuple) return new Iter('seq', v, 0);
  if (typeof v === 'string') return new Iter('str', v, 0);
  if (v instanceof Range) return new Iter('range', v, 0);
  if (v instanceof PyDict) return new Iter('seq', v.keys(), 0);
  if (v instanceof PySet) return new Iter('seq', v.items(), 0);
  if (v instanceof Iter) return v;
  if (typeof v === 'number') return err('TypeError', `un número no se puede recorrer con for; ¿querías range(${fmtNum(v)})?`);
  return err('TypeError', `'${typeName(v)}' no se puede recorrer con for`);
}

/** Devuelve el siguiente valor o undefined si se agota. */
export function iterNext(it: Iter): Value | undefined {
  const src = it.src;
  if (it.kind === 'range') {
    const r = src as Range;
    if (it.i >= r.length) return undefined;
    return r.at(it.i++);
  }
  if (it.kind === 'str') {
    const s = src as string;
    if (it.i >= s.length) return undefined;
    return s[it.i++];
  }
  const items = Array.isArray(src) ? src : (src as Tuple).items;
  if (it.i >= items.length) return undefined;
  return items[it.i++];
}

export function iterToArray(v: Value): Value[] {
  const s = seqItems(v);
  if (s) return s.slice();
  if (typeof v === 'string') return [...v];
  if (v instanceof Range) {
    if (v.length > MAX_SEQ) err('MemoryError', 'range demasiado grande para convertirlo en lista');
    const out: Value[] = [];
    for (let i = 0; i < v.length; i++) out.push(v.at(i));
    return out;
  }
  if (v instanceof PyDict) return v.keys();
  if (v instanceof PySet) return v.items();
  if (v instanceof Iter) {
    const out: Value[] = [];
    let x: Value | undefined;
    while ((x = iterNext(v)) !== undefined) out.push(x);
    return out;
  }
  return err('TypeError', `'${typeName(v)}' no se puede recorrer`);
}

export function len(v: Value): number {
  if (typeof v === 'string' || Array.isArray(v)) return v.length;
  if (v instanceof Tuple) return v.items.length;
  if (v instanceof PyDict || v instanceof PySet) return v.size;
  if (v instanceof Range) return v.length;
  if (v instanceof PyRecord) return Object.keys(v.f).length;
  return err('TypeError', `'${typeName(v)}' no tiene longitud (len)`);
}

export function formatValue(v: Value, spec: string, conv: string): string {
  if (conv === 'r') v = pyRepr(v);
  else if (conv === 's') v = pyStr(v);
  if (!spec) return pyStr(v);
  const m = /^(?:(.)?([<>^]))?([+ -])?(0)?(\d+)?(,)?(?:\.(\d+))?([sdf%eg])?$/.exec(spec);
  if (!m) err('ValueError', `formato '${spec}' no soportado`);
  const [, fillCh, align, sign, zero, widthS, comma, precS, type] = m!;
  let s: string;
  if (type === 'f' || type === '%' || (precS && typeof v === 'number')) {
    let x = toNum(v);
    if (type === '%') x *= 100;
    s = x.toFixed(precS ? Number(precS) : 6);
    if (type === '%') s += '%';
  } else if (type === 'd') {
    s = String(Math.trunc(toNum(v)));
  } else if (type === 'e') {
    s = toNum(v).toExponential(precS ? Number(precS) : 6).replace(/e([+-])(\d)$/, 'e$10$2');
  } else s = pyStr(v);
  if (comma) s = s.replace(/^(-?\d+)/, (d) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  if (sign === '+' && typeof v === 'number' && v >= 0) s = '+' + s;
  const width = widthS ? Number(widthS) : 0;
  if (s.length < width) {
    const isNum = typeof v === 'number';
    const al = align ?? (isNum ? '>' : '<');
    const fill = fillCh ?? (zero ? '0' : ' ');
    const pad = width - s.length;
    if (zero && !align && isNum) {
      const neg = s.startsWith('-');
      s = (neg ? '-' : '') + '0'.repeat(pad) + (neg ? s.slice(1) : s);
    } else if (al === '<') s = s + fill.repeat(pad);
    else if (al === '>') s = fill.repeat(pad) + s;
    else s = fill.repeat(Math.floor(pad / 2)) + s + fill.repeat(Math.ceil(pad / 2));
  }
  return s;
}

export function isCallable(v: Value): boolean {
  return v instanceof PyFunc || v instanceof Builtin || v instanceof ExcType;
}

export { hashKey, ModuleObj, ExcObj };
