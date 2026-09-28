// PyGrid — funciones integradas, métodos y módulos estándar (math, random, heapq).
import {
  contains, getIter, isCallable, iterNext, iterToArray, len, MAX_SEQ,
} from './ops';
import {
  Builtin, BoundMethod, ExcObj, ExcType, PyDict, PyFunc, PySet, Range, PyRecord, Tuple, err, fmtNum, pyCmp, pyEq,
  pyRepr, pyStr, seqItems, toInt, toNum, truthy, typeName, type Value,
} from './values';

export interface VMApi {
  callSync(fn: Value, args: Value[]): Value;
  print(text: string): void;
  random(): number;
  charge(instr: number): void;
}

export type BuiltinFn = (vm: VMApi, args: Value[], kw: Record<string, Value>) => Value;

function argc(name: string, args: Value[], min: number, max = min): void {
  if (args.length < min || args.length > max) {
    const exp = min === max ? `${min}` : `entre ${min} y ${max}`;
    err('TypeError', `${name}() recibe ${exp} argumento${max === 1 ? '' : 's'}, pero se le pasaron ${args.length}`);
  }
}

function sortValues(vm: VMApi, items: Value[], key: Value, reverse: boolean): Value[] {
  vm.charge(items.length * Math.max(1, Math.log2(items.length + 1)));
  const keyed = items.map((v, i) => ({ v, k: key === null ? v : vm.callSync(key, [v]), i }));
  keyed.sort((a, b) => {
    const c = pyCmp(a.k, b.k);
    return (reverse ? -c : c) || a.i - b.i;
  });
  return keyed.map((e) => e.v);
}

function minmax(vm: VMApi, name: string, args: Value[], kw: Record<string, Value>, sign: number): Value {
  const items = args.length === 1 ? iterToArray(args[0]) : args;
  if (!items.length) {
    if ('default' in kw) return kw.default;
    err('ValueError', `${name}() de una secuencia vacía`);
  }
  const key = kw.key ?? null;
  let best = items[0];
  let bestK = key === null ? best : vm.callSync(key, [best]);
  for (let i = 1; i < items.length; i++) {
    const k = key === null ? items[i] : vm.callSync(key, [items[i]]);
    if (pyCmp(k, bestK) * sign > 0) { best = items[i]; bestK = k; }
  }
  vm.charge(items.length);
  return best;
}

function toStrNum(name: string, v: Value, int: boolean): number {
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (!int && (t === 'inf' || t === 'infinity' || t === '+inf')) return Infinity;
    if (!int && t === '-inf') return -Infinity;
    const n = int ? (/^[-+]?\d+$/.test(t) ? Number(t) : NaN) : Number(t);
    if (t === '' || Number.isNaN(n)) err('ValueError', `no se puede convertir ${pyRepr(v)} a ${name}`);
    return n;
  }
  const n = toNum(v);
  return int ? Math.trunc(n) : n;
}

export const BUILTINS: Record<string, BuiltinFn> = {
  print: (vm, args, kw) => {
    const sep = kw.sep !== undefined ? pyStr(kw.sep) : ' ';
    vm.print(args.map((a) => pyStr(a)).join(sep));
    return null;
  },
  len: (_vm, args) => { argc('len', args, 1); return len(args[0]); },
  range: (_vm, args) => {
    argc('range', args, 1, 3);
    const n = args.map((a) => toInt(a, 'entero en range()'));
    const [a, b, c] = n.length === 1 ? [0, n[0], 1] : [n[0], n[1], n[2] ?? 1];
    if (c === 0) err('ValueError', 'el paso de range() no puede ser 0');
    return new Range(a, b, c);
  },
  abs: (_vm, args) => { argc('abs', args, 1); return Math.abs(toNum(args[0])); },
  min: (vm, args, kw) => minmax(vm, 'min', args, kw, -1),
  max: (vm, args, kw) => minmax(vm, 'max', args, kw, 1),
  sum: (vm, args) => {
    argc('sum', args, 1, 2);
    const items = iterToArray(args[0]);
    vm.charge(items.length);
    let s = args[1] !== undefined ? toNum(args[1]) : 0;
    for (const x of items) s += toNum(x, 'número en sum()');
    return s;
  },
  int: (_vm, args) => { argc('int', args, 0, 1); return args.length ? toStrNum('int', args[0], true) : 0; },
  float: (_vm, args) => { argc('float', args, 0, 1); return args.length ? toStrNum('float', args[0], false) : 0; },
  str: (_vm, args) => { argc('str', args, 0, 1); return args.length ? pyStr(args[0]) : ''; },
  repr: (_vm, args) => { argc('repr', args, 1); return pyRepr(args[0]); },
  bool: (_vm, args) => { argc('bool', args, 0, 1); return args.length ? truthy(args[0]) : false; },
  list: (vm, args) => { argc('list', args, 0, 1); const r = args.length ? iterToArray(args[0]) : []; vm.charge(r.length); return r; },
  tuple: (_vm, args) => { argc('tuple', args, 0, 1); return new Tuple(args.length ? iterToArray(args[0]) : []); },
  set: (_vm, args) => { argc('set', args, 0, 1); return PySet.from(args.length ? iterToArray(args[0]) : []); },
  dict: (_vm, args, kw) => {
    const d = new PyDict();
    if (args[0] instanceof PyDict) for (const [k, v] of args[0].m.values()) d.set(k, v);
    else if (args.length) for (const p of iterToArray(args[0])) {
      const it = seqItems(p);
      if (!it || it.length !== 2) err('ValueError', 'dict() necesita pares (clave, valor)');
      d.set(it![0], it![1]);
    }
    for (const k in kw) d.set(k, kw[k]);
    return d;
  },
  sorted: (vm, args, kw) => {
    argc('sorted', args, 1);
    return sortValues(vm, iterToArray(args[0]), kw.key ?? null, truthy(kw.reverse ?? false));
  },
  reversed: (_vm, args) => { argc('reversed', args, 1); return iterToArray(args[0]).reverse(); },
  enumerate: (_vm, args, kw) => {
    argc('enumerate', args, 1, 2);
    const start = toInt(args[1] ?? kw.start ?? 0);
    return iterToArray(args[0]).map((v, i) => new Tuple([i + start, v]));
  },
  zip: (_vm, args) => {
    const lists = args.map(iterToArray);
    const n = lists.length ? Math.min(...lists.map((l) => l.length)) : 0;
    const out: Value[] = [];
    for (let i = 0; i < n; i++) out.push(new Tuple(lists.map((l) => l[i])));
    return out;
  },
  map: (vm, args) => {
    argc('map', args, 2);
    const items = iterToArray(args[1]);
    return items.map((v) => vm.callSync(args[0], [v]));
  },
  filter: (vm, args) => {
    argc('filter', args, 2);
    const items = iterToArray(args[1]);
    return items.filter((v) => truthy(args[0] === null ? v : vm.callSync(args[0], [v])));
  },
  any: (_vm, args) => { argc('any', args, 1); return iterToArray(args[0]).some(truthy); },
  all: (_vm, args) => { argc('all', args, 1); return iterToArray(args[0]).every(truthy); },
  round: (_vm, args) => {
    argc('round', args, 1, 2);
    const x = toNum(args[0]);
    const d = args[1] !== undefined && args[1] !== null ? toInt(args[1]) : 0;
    const f = Math.pow(10, d);
    const y = x * f;
    // redondeo del banquero, como Python
    let r = Math.round(y);
    if (Math.abs(y % 1) === 0.5 && r % 2 !== 0) r -= 1;
    return r / f;
  },
  divmod: (_vm, args) => {
    argc('divmod', args, 2);
    const a = toNum(args[0]);
    const b = toNum(args[1]);
    if (b === 0) err('ZeroDivisionError', 'divmod entre cero');
    const q = Math.floor(a / b);
    return new Tuple([q, a - q * b]);
  },
  pow: (_vm, args) => { argc('pow', args, 2); return Math.pow(toNum(args[0]), toNum(args[1])); },
  chr: (_vm, args) => { argc('chr', args, 1); return String.fromCodePoint(toInt(args[0])); },
  ord: (_vm, args) => {
    argc('ord', args, 1);
    if (typeof args[0] !== 'string' || [...args[0]].length !== 1) err('TypeError', 'ord() necesita un único carácter');
    return (args[0] as string).codePointAt(0)!;
  },
  isinstance: (_vm, args) => {
    argc('isinstance', args, 2);
    const types = args[1] instanceof Tuple ? args[1].items : [args[1]];
    const tn = typeName(args[0]);
    return types.some((t) => {
      if (t instanceof Builtin) return t.name === tn || (t.name === 'float' && tn === 'int') || (t.name === 'int' && tn === 'bool');
      if (t instanceof ExcType) return args[0] instanceof ExcObj && (t.name === 'Exception' || t.name === args[0].type);
      return false;
    });
  },
  type: (_vm, args) => { argc('type', args, 1); return typeName(args[0]); },
  callable: (_vm, args) => isCallable(args[0]),
  input: () => err('RuntimeError', 'input() no está disponible: tus robots no tienen teclado. Usa variables o memoria.'),
  open: () => err('RuntimeError', 'open() no está disponible: no hay sistema de archivos. Usa memoria o compartido.'),
  eval: () => err('RuntimeError', 'eval() no está disponible en PyGrid'),
  exec: () => err('RuntimeError', 'exec() no está disponible en PyGrid'),
  hash: (_vm, args) => { argc('hash', args, 1); let h = 0; for (const c of pyRepr(args[0])) h = (h * 31 + c.charCodeAt(0)) | 0; return h; },
};

// ───────────── módulos estándar ─────────────

export const STD_MODULES: Record<string, Record<string, BuiltinFn | Value>> = {
  math: {
    pi: Math.PI,
    e: Math.E,
    inf: Infinity,
    sqrt: (_vm, a) => {
      const x = toNum(a[0]);
      if (x < 0) err('ValueError', 'math.sqrt de un número negativo');
      return Math.sqrt(x);
    },
    floor: (_vm, a) => Math.floor(toNum(a[0])),
    ceil: (_vm, a) => Math.ceil(toNum(a[0])),
    fabs: (_vm, a) => Math.abs(toNum(a[0])),
    hypot: (_vm, a) => Math.hypot(...a.map((x) => toNum(x))),
    atan2: (_vm, a) => Math.atan2(toNum(a[0]), toNum(a[1])),
    sin: (_vm, a) => Math.sin(toNum(a[0])),
    cos: (_vm, a) => Math.cos(toNum(a[0])),
    tan: (_vm, a) => Math.tan(toNum(a[0])),
    log: (_vm, a) => (a.length > 1 ? Math.log(toNum(a[0])) / Math.log(toNum(a[1])) : Math.log(toNum(a[0]))),
    exp: (_vm, a) => Math.exp(toNum(a[0])),
    dist: (_vm, a) => {
      const p = seqItems(a[0]) ?? [];
      const q = seqItems(a[1]) ?? [];
      return Math.hypot(...p.map((x, i) => toNum(x) - toNum(q[i])));
    },
    isinf: (_vm, a) => !Number.isFinite(toNum(a[0])) && !Number.isNaN(toNum(a[0])),
    copysign: (_vm, a) => Math.sign(toNum(a[1]) || 1) * Math.abs(toNum(a[0])),
  },
  random: {
    random: (vm) => vm.random(),
    randint: (vm, a) => {
      argc('randint', a, 2);
      const lo = toInt(a[0]);
      const hi = toInt(a[1]);
      if (hi < lo) err('ValueError', 'randint(a, b) necesita a <= b');
      return lo + Math.floor(vm.random() * (hi - lo + 1));
    },
    uniform: (vm, a) => toNum(a[0]) + vm.random() * (toNum(a[1]) - toNum(a[0])),
    choice: (vm, a) => {
      const items = iterToArray(a[0]);
      if (!items.length) err('IndexError', 'random.choice de una secuencia vacía');
      return items[Math.floor(vm.random() * items.length)];
    },
    shuffle: (vm, a) => {
      const l = a[0];
      if (!Array.isArray(l)) err('TypeError', 'random.shuffle necesita una lista');
      const arr = l as Value[];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(vm.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return null;
    },
  },
  heapq: {
    heappush: (vm, a) => {
      argc('heappush', a, 2);
      const h = a[0];
      if (!Array.isArray(h)) err('TypeError', 'heappush necesita una lista');
      const arr = h as Value[];
      if (arr.length >= MAX_SEQ) err('MemoryError', 'montículo demasiado grande');
      arr.push(a[1]);
      let i = arr.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (pyCmp(arr[i], arr[p]) >= 0) break;
        [arr[i], arr[p]] = [arr[p], arr[i]];
        i = p;
      }
      vm.charge(Math.log2(arr.length + 1));
      return null;
    },
    heappop: (vm, a) => {
      argc('heappop', a, 1);
      const arr = a[0];
      if (!Array.isArray(arr)) return err('TypeError', 'heappop necesita una lista');
      if (!arr.length) err('IndexError', 'heappop de un montículo vacío');
      const top = arr[0];
      const last = arr.pop()!;
      if (arr.length) {
        arr[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < arr.length && pyCmp(arr[l], arr[m]) < 0) m = l;
          if (r < arr.length && pyCmp(arr[r], arr[m]) < 0) m = r;
          if (m === i) break;
          [arr[i], arr[m]] = [arr[m], arr[i]];
          i = m;
        }
      }
      vm.charge(Math.log2(arr.length + 2));
      return top;
    },
    heapify: (vm, a) => {
      const arr = a[0];
      if (!Array.isArray(arr)) return err('TypeError', 'heapify necesita una lista');
      const sorted = sortValues(vm, arr, null, false);
      arr.splice(0, arr.length, ...sorted);
      return null;
    },
  },
};

// ───────────── métodos ─────────────

function listIndex(l: Value[], v: Value): number {
  const i = l.findIndex((x) => pyEq(x, v));
  if (i < 0) err('ValueError', `${pyRepr(v)} no está en la lista`);
  return i;
}

export function callMethod(vm: VMApi, obj: Value, name: string, args: Value[], kw: Record<string, Value>): Value {
  if (Array.isArray(obj)) {
    const l = obj;
    switch (name) {
      case 'append':
        argc('append', args, 1);
        if (l.length >= MAX_SEQ) err('MemoryError', 'lista demasiado larga (máx. 100 000)');
        l.push(args[0]);
        return null;
      case 'extend': {
        const it = iterToArray(args[0]);
        if (l.length + it.length > MAX_SEQ) err('MemoryError', 'lista demasiado larga');
        l.push(...it);
        return null;
      }
      case 'insert': argc('insert', args, 2); l.splice(toInt(args[0]) < 0 ? Math.max(0, l.length + toInt(args[0])) : toInt(args[0]), 0, args[1]); return null;
      case 'pop': {
        if (!l.length) err('IndexError', 'pop de una lista vacía');
        let i = args.length ? toInt(args[0]) : l.length - 1;
        if (i < 0) i += l.length;
        if (i < 0 || i >= l.length) err('IndexError', 'índice de pop fuera de rango');
        vm.charge(i === l.length - 1 ? 1 : l.length - i);
        return l.splice(i, 1)[0];
      }
      case 'remove': argc('remove', args, 1); l.splice(listIndex(l, args[0]), 1); return null;
      case 'index': return listIndex(l, args[0]);
      case 'count': return l.filter((x) => pyEq(x, args[0])).length;
      case 'sort': {
        const s = sortValues(vm, l, kw.key ?? null, truthy(kw.reverse ?? false));
        l.splice(0, l.length, ...s);
        return null;
      }
      case 'reverse': l.reverse(); return null;
      case 'copy': return l.slice();
      case 'clear': l.length = 0; return null;
    }
  } else if (obj instanceof PyDict) {
    const d = obj;
    switch (name) {
      case 'get': { const v = d.get(args[0]); return v === undefined ? (args[1] ?? null) : v; }
      case 'keys': return d.keys();
      case 'values': return d.values();
      case 'items': return [...d.m.values()].map(([k, v]) => new Tuple([k, v]));
      case 'pop': {
        const v = d.get(args[0]);
        if (v === undefined) {
          if (args.length > 1) return args[1];
          err('KeyError', `la clave ${pyRepr(args[0])} no existe`);
        }
        d.delete(args[0]);
        return v as Value;
      }
      case 'setdefault': {
        const v = d.get(args[0]);
        if (v !== undefined) return v;
        d.set(args[0], args[1] ?? null);
        return args[1] ?? null;
      }
      case 'update':
        if (args[0] instanceof PyDict) for (const [k, v] of args[0].m.values()) d.set(k, v);
        for (const k in kw) d.set(k, kw[k]);
        return null;
      case 'copy': return PyDict.from([...d.m.values()].map(([k, v]) => [k, v] as [Value, Value]));
      case 'clear': d.m.clear(); return null;
    }
  } else if (obj instanceof PySet) {
    const s = obj;
    switch (name) {
      case 'add':
        if (s.size >= MAX_SEQ) err('MemoryError', 'set demasiado grande');
        s.add(args[0]);
        return null;
      case 'remove': if (!s.delete(args[0])) err('KeyError', `${pyRepr(args[0])} no está en el set`); return null;
      case 'discard': s.delete(args[0]); return null;
      case 'pop': {
        const first = s.items()[0];
        if (first === undefined) err('KeyError', 'pop de un set vacío');
        s.delete(first);
        return first;
      }
      case 'clear': s.m.clear(); return null;
      case 'copy': return PySet.from(s.items());
      case 'update': for (const v of iterToArray(args[0])) s.add(v); return null;
      case 'union': return PySet.from([...s.items(), ...args.flatMap(iterToArray)]);
      case 'intersection': { const o = PySet.from(iterToArray(args[0])); return PySet.from(s.items().filter((x) => o.has(x))); }
      case 'difference': { const o = PySet.from(iterToArray(args[0])); return PySet.from(s.items().filter((x) => !o.has(x))); }
      case 'issubset': { const o = PySet.from(iterToArray(args[0])); return s.items().every((x) => o.has(x)); }
    }
  } else if (typeof obj === 'string') {
    const s = obj;
    const str = (i: number) => {
      const v = args[i];
      if (typeof v !== 'string') err('TypeError', `se esperaba texto, no '${typeName(v)}'`);
      return v as string;
    };
    switch (name) {
      case 'upper': return s.toUpperCase();
      case 'lower': return s.toLowerCase();
      case 'strip': return args.length ? trimChars(s, str(0), 3) : s.trim();
      case 'lstrip': return args.length ? trimChars(s, str(0), 1) : s.trimStart();
      case 'rstrip': return args.length ? trimChars(s, str(0), 2) : s.trimEnd();
      case 'split': {
        if (!args.length || args[0] === null) return s.trim().split(/\s+/).filter((x) => x.length);
        return s.split(str(0));
      }
      case 'join': return iterToArray(args[0]).map((x) => {
        if (typeof x !== 'string') err('TypeError', `join() necesita textos, encontró '${typeName(x)}' (usa str())`);
        return x;
      }).join(s);
      case 'replace': return s.split(str(0)).join(str(1));
      case 'startswith': return s.startsWith(str(0));
      case 'endswith': return s.endsWith(str(0));
      case 'find': return s.indexOf(str(0));
      case 'index': { const i = s.indexOf(str(0)); if (i < 0) err('ValueError', 'subcadena no encontrada'); return i; }
      case 'count': return s.split(str(0)).length - 1;
      case 'isdigit': return /^\d+$/.test(s);
      case 'isalpha': return /^\p{L}+$/u.test(s);
      case 'capitalize': return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
      case 'title': return s.replace(/\p{L}+/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      case 'ljust': return s.padEnd(toInt(args[0]), (args[1] as string) ?? ' ');
      case 'rjust': return s.padStart(toInt(args[0]), (args[1] as string) ?? ' ');
      case 'center': { const w = toInt(args[0]); const p = Math.max(0, w - s.length); return ' '.repeat(Math.floor(p / 2)) + s + ' '.repeat(Math.ceil(p / 2)); }
      case 'zfill': return s.padStart(toInt(args[0]), '0');
      case 'format': {
        let i = 0;
        return s.replace(/\{(\w*)\}/g, (_m, k: string) => pyStr(k === '' ? args[i++] : /^\d+$/.test(k) ? args[Number(k)] : kw[k]));
      }
    }
  } else if (obj instanceof Tuple) {
    if (name === 'index') return listIndex(obj.items, args[0]);
    if (name === 'count') return obj.items.filter((x) => pyEq(x, args[0])).length;
  } else if (obj instanceof ExcObj) {
    // sin métodos
  }
  if (obj instanceof PyRecord && typeof obj.f[name] !== 'undefined') {
    return vm.callSync(obj.f[name], args);
  }
  return err('AttributeError', `'${typeName(obj)}' no tiene el método '${name}'`);
}

function trimChars(s: string, chars: string, mode: number): string {
  let a = 0;
  let b = s.length;
  if (mode & 1) while (a < b && chars.includes(s[a])) a++;
  if (mode & 2) while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

export function hasMethod(obj: Value, name: string): boolean {
  const M: Record<string, string[]> = {
    list: ['append', 'extend', 'insert', 'pop', 'remove', 'index', 'count', 'sort', 'reverse', 'copy', 'clear'],
    dict: ['get', 'keys', 'values', 'items', 'pop', 'setdefault', 'update', 'copy', 'clear'],
    set: ['add', 'remove', 'discard', 'pop', 'clear', 'copy', 'update', 'union', 'intersection', 'difference', 'issubset'],
    str: ['upper', 'lower', 'strip', 'lstrip', 'rstrip', 'split', 'join', 'replace', 'startswith', 'endswith', 'find', 'index', 'count', 'isdigit', 'isalpha', 'capitalize', 'title', 'ljust', 'rjust', 'center', 'zfill', 'format'],
    tuple: ['index', 'count'],
  };
  return (M[typeName(obj)] ?? (typeName(obj) === 'int' || typeName(obj) === 'float' ? [] : [])).includes(name);
}

export { BoundMethod, fmtNum, getIter, iterNext, contains, PyFunc };
