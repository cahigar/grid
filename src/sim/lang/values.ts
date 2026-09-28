// PyGrid — modelo de valores en tiempo de ejecución.

export class PyError extends Error {
  constructor(public pyType: string, public pyMsg: string) {
    super(`${pyType}: ${pyMsg}`);
  }
}

export const err = (type: string, msg: string): never => {
  throw new PyError(type, msg);
};

export class Tuple {
  constructor(public items: Value[]) {}
}

export class PyDict {
  m = new Map<string, [Value, Value]>();
  get(k: Value): Value | undefined {
    const e = this.m.get(hashKey(k));
    return e ? e[1] : undefined;
  }
  set(k: Value, v: Value): void {
    const h = hashKey(k);
    const e = this.m.get(h);
    if (e) e[1] = v;
    else this.m.set(h, [k, v]);
  }
  has(k: Value): boolean { return this.m.has(hashKey(k)); }
  delete(k: Value): boolean { return this.m.delete(hashKey(k)); }
  keys(): Value[] { return [...this.m.values()].map((e) => e[0]); }
  values(): Value[] { return [...this.m.values()].map((e) => e[1]); }
  get size(): number { return this.m.size; }
  static from(entries: [Value, Value][]): PyDict {
    const d = new PyDict();
    for (const [k, v] of entries) d.set(k, v);
    return d;
  }
}

export class PySet {
  m = new Map<string, Value>();
  add(v: Value): void { this.m.set(hashKey(v), v); }
  has(v: Value): boolean { return this.m.has(hashKey(v)); }
  delete(v: Value): boolean { return this.m.delete(hashKey(v)); }
  items(): Value[] { return [...this.m.values()]; }
  get size(): number { return this.m.size; }
  static from(items: Value[]): PySet {
    const s = new PySet();
    for (const v of items) s.add(v);
    return s;
  }
}

export interface CodeRef {
  mod: string;
  idx: number;
}

export class Env {
  vars = new Map<string, Value>();
  constructor(public parent: Env | null) {}
}

export class PyFunc {
  constructor(
    public name: string,
    public code: CodeRef,
    public defaults: Value[],
    public env: Env,
    public globals: Env,
  ) {}
}

export class Builtin {
  constructor(public name: string) {}
}

export class BoundMethod {
  constructor(public self: Value, public name: string) {}
}

/** Registro con atributos (resultados de sensores): r.tipo y r["tipo"]. */
export class PyRecord {
  constructor(public type: string, public f: Record_<Value>) {}
}
type Record_<T> = { [k: string]: T };

export class Range {
  constructor(public start: number, public stop: number, public step: number) {}
  get length(): number {
    if (this.step > 0) return Math.max(0, Math.ceil((this.stop - this.start) / this.step));
    return Math.max(0, Math.ceil((this.start - this.stop) / -this.step));
  }
  at(i: number): number { return this.start + i * this.step; }
}

export class Iter {
  constructor(public kind: 'seq' | 'range' | 'str', public src: Value, public i: number) {}
}

export class ModuleObj {
  constructor(public name: string) {}
}

let instanceSeq = 1;

/** Clase definida por el jugador (class Nombre: …) */
export class PyClass {
  attrs = new Map<string, Value>();
  constructor(public name: string, public bases: PyClass[], public excBase: string | null) {}
  lookup(name: string): Value | undefined {
    const v = this.attrs.get(name);
    if (v !== undefined) return v;
    for (const b of this.bases) {
      const w = b.lookup(name);
      if (w !== undefined) return w;
    }
    return undefined;
  }
  isSub(c: PyClass): boolean {
    return c === this || this.bases.some((b) => b.isSub(c));
  }
}

export class PyInstance {
  attrs = new Map<string, Value>();
  id: number;
  constructor(public cls: PyClass, id?: number) {
    this.id = id ?? instanceSeq++;
    if (id !== undefined && id >= instanceSeq) instanceSeq = id + 1;
  }
}

export class PyBound {
  constructor(public self: Value, public fn: PyFunc) {}
}

export class ExcType {
  constructor(public name: string) {}
}

export class ExcObj {
  constructor(public type: string, public msg: string) {}
}

export type Value =
  | null
  | boolean
  | number
  | string
  | Value[]
  | Tuple
  | PyDict
  | PySet
  | PyFunc
  | Builtin
  | BoundMethod
  | PyRecord
  | Range
  | Iter
  | ModuleObj
  | ExcType
  | ExcObj
  | PyClass
  | PyInstance
  | PyBound;

export const EXC_TYPES = [
  'Exception', 'ValueError', 'TypeError', 'IndexError', 'KeyError', 'ZeroDivisionError', 'NameError',
  'AttributeError', 'RuntimeError', 'AssertionError', 'RecursionError', 'MemoryError', 'UnboundLocalError',
  'ImportError', 'StopIteration', 'OverflowError',
  // errores del juego
  'SinEnergiaError', 'SinRecursosError', 'CultivoNoMaduroError', 'AccionInvalidaError', 'FueraDeRangoError',
];

// ───────────── utilidades ─────────────

export function typeName(v: Value): string {
  if (v === null) return 'NoneType';
  switch (typeof v) {
    case 'boolean': return 'bool';
    case 'number': return Number.isInteger(v) ? 'int' : 'float';
    case 'string': return 'str';
  }
  if (Array.isArray(v)) return 'list';
  if (v instanceof Tuple) return 'tuple';
  if (v instanceof PyDict) return 'dict';
  if (v instanceof PySet) return 'set';
  if (v instanceof PyFunc) return 'function';
  if (v instanceof Builtin || v instanceof BoundMethod) return 'builtin_function';
  if (v instanceof PyRecord) return v.type;
  if (v instanceof Range) return 'range';
  if (v instanceof Iter) return 'iterator';
  if (v instanceof ModuleObj) return 'module';
  if (v instanceof ExcType) return 'type';
  if (v instanceof ExcObj) return v.type;
  if (v instanceof PyInstance) return v.cls.name;
  if (v instanceof PyClass) return 'type';
  if (v instanceof PyBound) return 'method';
  return 'object';
}

export function truthy(v: Value): boolean {
  if (v === null || v === false) return false;
  if (v === true) return true;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Tuple) return v.items.length > 0;
  if (v instanceof PyDict || v instanceof PySet) return v.size > 0;
  if (v instanceof Range) return v.length > 0;
  return true;
}

export function hashKey(v: Value): string {
  if (v === null) return 'N';
  if (v === true) return 'n1';
  if (v === false) return 'n0';
  if (typeof v === 'number') return 'n' + v;
  if (typeof v === 'string') return 's' + v;
  if (v instanceof Tuple) return 't(' + v.items.map(hashKey).join(',') + ')';
  if (v instanceof ExcType || v instanceof Builtin) return 'b' + v.name;
  if (v instanceof PyInstance) return 'i' + v.id;
  if (v instanceof PyClass) return 'c' + v.name;
  if (Array.isArray(v)) return err('TypeError', "una lista no puede ser clave de diccionario ni elemento de set (usa una tupla: (x, y))");
  return err('TypeError', `el tipo '${typeName(v)}' no puede usarse como clave`);
}

export function pyEq(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (typeof a === 'number' || typeof a === 'boolean') {
    if (typeof b === 'number' || typeof b === 'boolean') return Number(a) === Number(b);
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!pyEq(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof Tuple) {
    if (!(b instanceof Tuple) || a.items.length !== b.items.length) return false;
    for (let i = 0; i < a.items.length; i++) if (!pyEq(a.items[i], b.items[i])) return false;
    return true;
  }
  if (a instanceof PyDict) {
    if (!(b instanceof PyDict) || a.size !== b.size) return false;
    for (const [h, [, v]] of a.m) {
      const o = b.m.get(h);
      if (!o || !pyEq(v, o[1])) return false;
    }
    return true;
  }
  if (a instanceof PySet) {
    if (!(b instanceof PySet) || a.size !== b.size) return false;
    for (const h of a.m.keys()) if (!b.m.has(h)) return false;
    return true;
  }
  if (a instanceof PyRecord) {
    if (!(b instanceof PyRecord) || a.type !== b.type) return false;
    const ka = Object.keys(a.f);
    if (ka.length !== Object.keys(b.f).length) return false;
    return ka.every((k) => k in b.f && pyEq(a.f[k], b.f[k]));
  }
  if (a instanceof Range && b instanceof Range) return a.start === b.start && a.stop === b.stop && a.step === b.step;
  if (a instanceof ExcType && b instanceof ExcType) return a.name === b.name;
  if (a instanceof Builtin && b instanceof Builtin) return a.name === b.name;
  return false;
}

/** Comparación de orden: devuelve <0, 0, >0 */
export function pyCmp(a: Value, b: Value): number {
  const na = typeof a === 'number' || typeof a === 'boolean';
  const nb = typeof b === 'number' || typeof b === 'boolean';
  if (na && nb) {
    const x = Number(a);
    const y = Number(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  const seqA = Array.isArray(a) ? a : a instanceof Tuple ? a.items : null;
  const seqB = Array.isArray(b) ? b : b instanceof Tuple ? b.items : null;
  if (seqA && seqB && Array.isArray(a) === Array.isArray(b)) {
    const n = Math.min(seqA.length, seqB.length);
    for (let i = 0; i < n; i++) {
      if (!pyEq(seqA[i], seqB[i])) return pyCmp(seqA[i], seqB[i]);
    }
    return seqA.length - seqB.length;
  }
  return err('TypeError', `no se pueden comparar '${typeName(a)}' y '${typeName(b)}' con < o >`);
}

export function fmtNum(n: number): string {
  if (Number.isNaN(n)) return 'nan';
  if (n === Infinity) return 'inf';
  if (n === -Infinity) return '-inf';
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n);
  const s = String(n);
  return s.replace(/e([+-])(\d)$/, 'e$10$2');
}

export function pyRepr(v: Value, depth = 0): string {
  if (depth > 20) return '...';
  if (typeof v === 'string') {
    const q = v.includes("'") && !v.includes('"') ? '"' : "'";
    return q + v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(q === "'" ? /'/g : /"/g, '\\' + q) + q;
  }
  return pyStr(v, depth, true);
}

export function pyStr(v: Value, depth = 0, _repr = false): string {
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'string') return v;
  const r = (x: Value) => pyRepr(x, depth + 1);
  if (Array.isArray(v)) return '[' + v.map(r).join(', ') + ']';
  if (v instanceof Tuple) return v.items.length === 1 ? '(' + r(v.items[0]) + ',)' : '(' + v.items.map(r).join(', ') + ')';
  if (v instanceof PyDict) return '{' + [...v.m.values()].map(([k, x]) => r(k) + ': ' + r(x)).join(', ') + '}';
  if (v instanceof PySet) return v.size ? '{' + v.items().map(r).join(', ') + '}' : 'set()';
  if (v instanceof PyRecord) {
    return v.type + '(' + Object.entries(v.f).map(([k, x]) => k + '=' + r(x)).join(', ') + ')';
  }
  if (v instanceof PyFunc) return `<función ${v.name}>`;
  if (v instanceof Builtin) return `<función ${v.name}>`;
  if (v instanceof BoundMethod) return `<método ${v.name}>`;
  if (v instanceof Range) return v.step === 1 ? `range(${v.start}, ${v.stop})` : `range(${v.start}, ${v.stop}, ${v.step})`;
  if (v instanceof ModuleObj) return `<módulo '${v.name}'>`;
  if (v instanceof ExcType) return `<class '${v.name}'>`;
  if (v instanceof ExcObj) return _repr ? `${v.type}(${pyRepr(v.msg)})` : v.msg;
  if (v instanceof Iter) return '<iterador>';
  if (v instanceof PyInstance) return `<objeto ${v.cls.name}>`;
  if (v instanceof PyClass) return `<clase '${v.name}'>`;
  if (v instanceof PyBound) return `<método ${v.fn.name}>`;
  return '<objeto>';
}

export function toNum(v: Value, what = 'número'): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return err('TypeError', `se esperaba un ${what}, no '${typeName(v)}'`);
}

export function toInt(v: Value, what = 'entero'): number {
  const n = toNum(v, what);
  if (!Number.isInteger(n)) err('TypeError', `se esperaba un ${what}, no un decimal (${fmtNum(n)}); usa int()`);
  return n;
}

export function seqItems(v: Value): Value[] | null {
  if (Array.isArray(v)) return v;
  if (v instanceof Tuple) return v.items;
  return null;
}
