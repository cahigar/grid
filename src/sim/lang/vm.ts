// PyGrid — máquina virtual con estado serializable y presupuesto de instrucciones.
import { BUILTINS, STD_MODULES, callMethod, hasMethod, type BuiltinFn, type VMApi } from './builtins';
import { compileModule, Op, type Code, type CompiledModule } from './compiler';
import { PySyntaxError } from './lexer';
import {
  binop, compare, delItem, formatValue, getItem, getIter, inplace, iterNext, setItem, slice, unary,
} from './ops';
import { iterToArray } from './ops';
import {
  BoundMethod, Builtin, Env, EXC_TYPES, ExcObj, ExcType, Iter, ModuleObj, PyBound, PyClass, PyDict, PyError, PyFunc,
  PyInstance, PySet, PyRecord, Tuple, err, pyRepr, pyStr, truthy, typeName, type Value,
} from './values';

export const MAX_DEPTH = 200;

/** Petición de acción que suspende la VM hasta que el mundo la resuelva. */
export interface ActionReq {
  action: string;
  args: Value[];
  kw: Record<string, Value>;
}

export interface Host {
  /** Primitivas del juego. Devuelven un valor (síncronas) o una petición de acción. */
  functions: Record<string, (args: Value[], kw: Record<string, Value>) => Value | ActionReq>;
  /** Variables globales del juego (memoria, compartido…) */
  globals?: Record<string, Value>;
  print(text: string, line: number): void;
}

export interface Frame {
  mod: string;
  ci: number;
  ip: number;
  stack: Value[];
  env: Env;
  globals: Env;
  handlers: { ip: number; sp: number }[];
  curExc: ExcObj | null;
  importOf: string | null;
  jsBoundary: boolean;
  classOf: { name: string; bases: Value[] } | null;
  initOf: PyInstance | null;
}

export interface Bundle {
  main: string;
  modules: Record<string, string>;
}

export type RunResult =
  | { s: 'action'; req: ActionReq; line: number }
  | { s: 'done' }
  | { s: 'budget' }
  | { s: 'error'; type: string; msg: string; line: number; mod: string; trace: string[] };

export interface ModState {
  env: Env;
  done: boolean;
}

export function isActionReq(v: unknown): v is ActionReq {
  return typeof v === 'object' && v !== null && 'action' in v && !(v instanceof PyRecord);
}

export class VM implements VMApi {
  frames: Frame[] = [];
  modules = new Map<string, ModState>();
  waiting = false;
  finished = false;
  rngState = 1;
  instrTotal = 0;
  budgetLeft = 0;
  private compiled = new Map<string, CompiledModule>();
  host: Host;
  bundle: Bundle;
  lastLine = 0;
  lastMod = '__main__';
  /** jerarquía de excepciones definidas por el jugador: hija → madre */
  excParent = new Map<string, string>();

  constructor(bundle: Bundle, host: Host, seed = 12345) {
    this.bundle = bundle;
    this.host = host;
    this.rngState = (seed >>> 0) || 1;
  }

  // ───── compilación ─────
  compiledFor(mod: string): CompiledModule {
    let c = this.compiled.get(mod);
    if (!c) {
      const src = mod === '__main__' ? this.bundle.main : this.bundle.modules[mod];
      if (src === undefined) err('ImportError', `no existe el módulo '${mod}'`);
      c = compileModule(mod, src!);
      this.compiled.set(mod, c);
    }
    return c;
  }
  code(f: Frame): Code {
    return this.compiledFor(f.mod).codes[f.ci];
  }

  /** Prepara la ejecución del programa principal. Lanza PySyntaxError si no compila. */
  start(): void {
    this.compiledFor('__main__');
    const g = new Env(null);
    this.installGlobals(g);
    this.modules.set('__main__', { env: g, done: false });
    this.frames = [this.newFrame('__main__', 0, g, g)];
    this.finished = false;
    this.waiting = false;
  }

  installGlobals(g: Env): void {
    g.vars.set('__name__', '__main__');
    if (this.host.globals) for (const k in this.host.globals) g.vars.set(k, this.host.globals[k]);
  }

  newFrame(mod: string, ci: number, env: Env, globals: Env): Frame {
    return { mod, ci, ip: 0, stack: [], env, globals, handlers: [], curExc: null, importOf: null, jsBoundary: false, classOf: null, initOf: null };
  }

  // ───── VMApi ─────
  print(text: string): void {
    this.host.print(text, this.lastLine);
  }
  random(): number {
    // mulberry32 determinista y serializable
    let t = (this.rngState = (this.rngState + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  charge(n: number): void {
    const k = Math.ceil(n);
    this.budgetLeft -= k;
    this.instrTotal += k;
  }

  /** Llamada síncrona desde código nativo (key=, map…). No puede contener acciones. */
  callSync(fn: Value, args: Value[]): Value {
    if (!(fn instanceof PyFunc)) {
      const r = this.callNative(fn, args, {});
      if (isActionReq(r)) err('RuntimeError', 'no se pueden usar acciones del robot dentro de key=, map() o filter()');
      return r as Value;
    }
    const base = this.frames.length;
    const f = this.makeFuncFrame(fn, args, {});
    f.jsBoundary = true;
    this.frames.push(f);
    let guard = 2_000_000;
    try {
      while (this.frames.length > base) {
        const r = this.step(true);
        if (r !== undefined) {
          if (r === 'action') err('RuntimeError', 'no se pueden usar acciones del robot dentro de key=, map() o filter()');
          return (r as { value: Value }).value;
        }
        if (--guard <= 0) err('RuntimeError', 'demasiado cálculo dentro de key=, map() o filter()');
      }
      return null;
    } finally {
      this.frames.length = base;
    }
  }

  // ───── ejecución ─────

  private pendingThrow: PyError | null = null;

  /** Reanuda tras una acción lanzando una excepción en el punto de la llamada. */
  resumeThrow(e: PyError): void {
    if (!this.waiting) return;
    this.waiting = false;
    this.pendingThrow = e;
  }

  /** Reanuda tras una acción, con su resultado. */
  resume(value: Value): void {
    if (!this.waiting) return;
    this.waiting = false;
    this.frames[this.frames.length - 1].stack.push(value);
  }

  run(budget: number): RunResult {
    this.budgetLeft = budget;
    if (this.finished) return { s: 'done' };
    if (this.waiting) throw new Error('VM esperando resultado de acción');
    try {
      if (this.pendingThrow) {
        const e = this.pendingThrow;
        this.pendingThrow = null;
        if (!this.handle(e, false)) throw e;
      }
      while (this.frames.length) {
        if (this.budgetLeft <= 0) return { s: 'budget' };
        const r = this.step(false);
        if (r === 'action') {
          this.waiting = true;
          return { s: 'action', req: this.pendingReq!, line: this.lastLine };
        }
      }
      this.finished = true;
      return { s: 'done' };
    } catch (e) {
      return this.fatal(e);
    }
  }

  private pendingReq: ActionReq | null = null;

  fatal(e: unknown): RunResult {
    this.finished = true;
    const trace = this.frames.map((f) => {
      const c = this.code(f);
      return `  ${f.mod === '__main__' ? '' : f.mod + ': '}${c.name}, línea ${c.lines[Math.max(0, f.ip - 1)] ?? '?'}`;
    });
    this.frames = [];
    if (e instanceof PyError) return { s: 'error', type: e.pyType, msg: e.pyMsg, line: this.lastLine, mod: this.lastMod, trace };
    if (e instanceof PySyntaxError) return { s: 'error', type: 'SyntaxError', msg: e.message.replace(/^\w+Error: /, ''), line: e.line, mod: this.lastMod, trace };
    if (e instanceof RangeError) return { s: 'error', type: 'RecursionError', msg: 'demasiada recursión', line: this.lastLine, mod: this.lastMod, trace };
    return { s: 'error', type: 'InternalError', msg: String((e as Error)?.message ?? e), line: this.lastLine, mod: this.lastMod, trace };
  }

  /**
   * Ejecuta una instrucción. Devuelve 'action' si la VM debe suspenderse,
   * {value} si un frame con frontera JS ha retornado, o undefined.
   */
  step(sync: boolean): 'action' | { value: Value } | undefined {
    const f = this.frames[this.frames.length - 1];
    const code = this.code(f);
    const ip = f.ip++;
    const op = code.ops[ip];
    const arg = code.args[ip];
    this.lastLine = code.lines[ip];
    this.lastMod = f.mod;
    this.budgetLeft--;
    this.instrTotal++;
    const st = f.stack;
    try {
      switch (op) {
        case Op.NOP: break;
        case Op.CONST: st.push(arg as Value); break;
        case Op.LOAD_FAST: {
          const v = f.env.vars.get(arg as string);
          if (v === undefined) err('UnboundLocalError', `la variable local '${arg}' se usa antes de asignarle un valor (si es global, declara 'global ${arg}')`);
          st.push(v as Value);
          break;
        }
        case Op.LOAD_NAME: st.push(this.lookup(f.env, arg as string)); break;
        case Op.LOAD_GLOBAL: st.push(this.lookup(f.globals, arg as string)); break;
        case Op.STORE_NAME: f.env.vars.set(arg as string, st.pop()!); break;
        case Op.STORE_FAST: f.env.vars.set(arg as string, st.pop()!); break;
        case Op.STORE_GLOBAL: f.globals.vars.set(arg as string, st.pop()!); break;
        case Op.STORE_DEREF: {
          let e = f.env.parent;
          while (e && !e.vars.has(arg as string)) e = e.parent;
          if (!e || e === f.globals) err('NameError', `no existe la variable '${arg}' en una función exterior (nonlocal)`);
          e!.vars.set(arg as string, st.pop()!);
          break;
        }
        case Op.DEL_NAME:
          if (!f.env.vars.delete(arg as string) && !f.globals.vars.delete(arg as string)) err('NameError', `'${arg}' no está definido`);
          break;
        case Op.POP: st.pop(); break;
        case Op.DUP: st.push(st[st.length - 1]); break;
        case Op.DUP2: st.push(st[st.length - 2], st[st.length - 1]); break;
        case Op.ROT2: { const a = st.pop()!; const b = st.pop()!; st.push(a, b); break; }
        case Op.ROT3: { const a = st.pop()!; const b = st.pop()!; const c = st.pop()!; st.push(a, c, b); break; }
        case Op.BINOP: { const b = st.pop()!; const a = st.pop()!; st.push(binop(arg as string, a, b)); break; }
        case Op.INPLACE: { const b = st.pop()!; const a = st.pop()!; st.push(inplace(arg as string, a, b)); break; }
        case Op.UNARY: st.push(unary(arg as string, st.pop()!)); break;
        case Op.CMP: { const b = st.pop()!; const a = st.pop()!; st.push(compare(arg as string, a, b)); break; }
        case Op.JUMP: f.ip = arg as number; break;
        case Op.JIF: if (!truthy(st.pop()!)) f.ip = arg as number; break;
        case Op.JIT: if (truthy(st.pop()!)) f.ip = arg as number; break;
        case Op.JIF_OR_POP: if (!truthy(st[st.length - 1])) f.ip = arg as number; else st.pop(); break;
        case Op.JIT_OR_POP: if (truthy(st[st.length - 1])) f.ip = arg as number; else st.pop(); break;
        case Op.BUILD_LIST: st.push(st.splice(st.length - (arg as number), arg as number)); break;
        case Op.BUILD_TUPLE: st.push(new Tuple(st.splice(st.length - (arg as number), arg as number))); break;
        case Op.BUILD_SET: st.push(PySet.from(st.splice(st.length - (arg as number), arg as number))); break;
        case Op.BUILD_DICT: {
          const n = arg as number;
          const items = st.splice(st.length - 2 * n, 2 * n);
          const d = new PyDict();
          for (let i = 0; i < n; i++) d.set(items[2 * i], items[2 * i + 1]);
          st.push(d);
          break;
        }
        case Op.LIST_APPEND: { const v = st.pop()!; const l = st.pop() as Value[]; if (l.length >= 100_000) err('MemoryError', 'lista demasiado larga'); l.push(v); break; }
        case Op.SET_ADD: { const v = st.pop()!; (st.pop() as PySet).add(v); break; }
        case Op.DICT_SET: { const v = st.pop()!; const k = st.pop()!; (st.pop() as PyDict).set(k, v); break; }
        case Op.FORMAT: { const [spec, conv] = arg as [string, string]; st.push(formatValue(st.pop()!, spec, conv)); break; }
        case Op.BUILD_STR: st.push(st.splice(st.length - (arg as number), arg as number).join('')); break;
        case Op.SUBSCR: { const i = st.pop()!; const o = st.pop()!; st.push(getItem(o, i)); break; }
        case Op.SLICE: { const s3 = st.pop()!; const s2 = st.pop()!; const s1 = st.pop()!; const o = st.pop()!; st.push(slice(o, s1, s2, s3)); break; }
        case Op.STORE_SUBSCR: { const i = st.pop()!; const o = st.pop()!; const v = st.pop()!; setItem(o, i, v); break; }
        case Op.DEL_SUBSCR: { const i = st.pop()!; const o = st.pop()!; delItem(o, i); break; }
        case Op.LOAD_ATTR: st.push(this.getAttr(st.pop()!, arg as string)); break;
        case Op.STORE_ATTR: {
          const o = st.pop()!;
          const v = st.pop()!;
          if (o instanceof PyRecord) o.f[arg as string] = v;
          else if (o instanceof PyInstance || o instanceof PyClass) o.attrs.set(arg as string, v);
          else if (o instanceof ModuleObj) this.modules.get(o.name)!.env.vars.set(arg as string, v);
          else err('AttributeError', `no se pueden crear atributos en '${typeName(o)}' (usa un diccionario)`);
          break;
        }
        case Op.CALL: {
          const [n, kwn] = arg as [number, string[]];
          const kwv = st.splice(st.length - kwn.length, kwn.length);
          const args = st.splice(st.length - n, n);
          const fn = st.pop()!;
          const kw: Record<string, Value> = {};
          kwn.forEach((k, i) => (kw[k] = kwv[i]));
          return this.invoke(f, fn, args, kw, sync);
        }
        case Op.ARG_APPEND: { const v = st.pop()!; (st[st.length - 1] as Value[]).push(v); break; }
        case Op.ARG_EXTEND: { const it = st.pop()!; (st[st.length - 1] as Value[]).push(...iterToArray(it)); break; }
        case Op.KW_SET: { const v = st.pop()!; const k = st.pop()!; (st[st.length - 1] as PyDict).set(k, v); break; }
        case Op.KW_UPDATE: {
          const m = st.pop()!;
          if (!(m instanceof PyDict)) err('TypeError', '** necesita un diccionario');
          const d = st[st.length - 1] as PyDict;
          for (const k of (m as PyDict).keys()) {
            if (typeof k !== 'string') err('TypeError', 'con ** las claves del diccionario tienen que ser textos');
            if (d.has(k)) err('TypeError', `el argumento '${k}' aparece dos veces`);
            d.set(k, (m as PyDict).get(k)!);
          }
          break;
        }
        case Op.CALL_EX: {
          const d = st.pop() as PyDict;
          const args = st.pop() as Value[];
          const fn = st.pop()!;
          const kw: Record<string, Value> = {};
          for (const k of d.keys()) kw[k as string] = d.get(k)!;
          return this.invoke(f, fn, args, kw, sync);
        }
        case Op.CALL_METHOD: {
          const [name, n, kwn] = arg as [string, number, string[]];
          const kwv = st.splice(st.length - kwn.length, kwn.length);
          const args = st.splice(st.length - n, n);
          const obj = st.pop()!;
          const kw: Record<string, Value> = {};
          kwn.forEach((k, i) => (kw[k] = kwv[i]));
          if (obj instanceof ModuleObj || (obj instanceof PyRecord && obj.f[name] !== undefined) || obj instanceof PyInstance || obj instanceof PyClass) {
            return this.invoke(f, this.getAttr(obj, name), args, kw, sync);
          }
          if (obj instanceof PyDict && !hasMethod(obj, name) && obj.has(name)) {
            err('AttributeError', `los diccionarios no tienen atributos: usa d["${name}"]`);
          }
          st.push(callMethod(this, obj, name, args, kw));
          break;
        }
        case Op.MAKE_CLASS: {
          const [ci, nb, name] = arg as [number, number, string];
          const bases = st.splice(st.length - nb, nb);
          for (const b of bases) {
            if (!(b instanceof PyClass) && !(b instanceof ExcType)) err('TypeError', `una clase sólo puede heredar de otra clase, no de '${typeName(b)}'`);
          }
          if (this.frames.length >= MAX_DEPTH) err('RecursionError', 'demasiadas llamadas anidadas');
          const nf = this.newFrame(f.mod, ci, new Env(f.env), f.globals);
          nf.classOf = { name, bases };
          this.frames.push(nf);
          break;
        }
        case Op.MAKE_FUNC: {
          const [ci, nd, name] = arg as [number, number, string];
          const defaults = st.splice(st.length - nd, nd);
          st.push(new PyFunc(name, { mod: f.mod, idx: ci }, defaults, f.env, f.globals));
          break;
        }
        case Op.RETURN: {
          const v = st.pop() ?? null;
          this.frames.pop();
          if (f.importOf !== null) {
            this.modules.get(f.importOf)!.done = true;
            const caller = this.frames[this.frames.length - 1];
            if (caller) caller.stack.push(new ModuleObj(f.importOf));
            break;
          }
          let out: Value = v;
          if (f.classOf) out = this.buildClass(f);
          else if (f.initOf) {
            if (v !== null) err('TypeError', '__init__ no debe devolver nada (return sin valor)');
            out = f.initOf;
          }
          if (f.jsBoundary) return { value: out };
          const caller = this.frames[this.frames.length - 1];
          if (caller) caller.stack.push(out);
          break;
        }
        case Op.GET_ITER: st.push(getIter(st.pop()!)); break;
        case Op.FOR_ITER: {
          const it = st[st.length - 1] as Iter;
          const v = iterNext(it);
          if (v === undefined) { st.pop(); f.ip = arg as number; }
          else st.push(v);
          break;
        }
        case Op.UNPACK: {
          const v = st.pop()!;
          const items = Array.isArray(v) ? v : v instanceof Tuple ? v.items : typeof v === 'string' ? [...v] : null;
          if (!items) err('TypeError', `no se puede desempaquetar '${typeName(v)}' en ${arg} variables`);
          if (items!.length !== arg) err('ValueError', `se esperaban ${arg} valores para desempaquetar, pero hay ${items!.length}`);
          for (let i = items!.length - 1; i >= 0; i--) st.push(items![i]);
          break;
        }
        case Op.SETUP_EXCEPT: f.handlers.push({ ip: arg as number, sp: st.length }); break;
        case Op.POP_BLOCK: f.handlers.pop(); break;
        case Op.EXC_MATCH: {
          const t = st.pop()!;
          const e = st.pop() as ExcObj;
          const types = t instanceof Tuple ? t.items : [t];
          st.push(types.some((x) => {
            const nm = x instanceof ExcType ? x.name : x instanceof PyClass && x.excBase ? x.name : null;
            if (!nm) err('TypeError', 'except necesita un tipo de error, p. ej. except ValueError:');
            return this.excIsSub(e.type, nm!);
          }));
          break;
        }
        case Op.RERAISE: {
          const e = st.pop() as ExcObj;
          throw new PyError(e.type, e.msg);
        }
        case Op.POP_EXC: f.curExc = null; break;
        case Op.RAISE: {
          if (arg === 0) {
            const cur = [...this.frames].reverse().find((x) => x.curExc)?.curExc;
            if (!cur) err('RuntimeError', "'raise' sin excepción activa");
            throw new PyError(cur!.type, cur!.msg);
          }
          let e = st.pop()!;
          if (e instanceof ExcType) e = new ExcObj(e.name, '');
          else if (e instanceof PyClass && e.excBase) e = new ExcObj(e.name, '');
          if (!(e instanceof ExcObj)) err('TypeError', 'sólo se pueden lanzar errores, p. ej. raise ValueError("mensaje")');
          throw new PyError((e as ExcObj).type, (e as ExcObj).msg);
        }
        case Op.IMPORT: return this.doImport(f, arg as string);
        case Op.IMPORT_FROM: {
          const m = st[st.length - 1];
          st.push(this.getAttr(m, arg as string));
          break;
        }
        case Op.IMPORT_STAR: {
          const m = st.pop() as ModuleObj;
          if (STD_MODULES[m.name]) {
            for (const k in STD_MODULES[m.name]) f.env.vars.set(k, this.getAttr(m, k));
          } else {
            for (const [k, v] of this.modules.get(m.name)!.env.vars) if (!k.startsWith('_')) f.env.vars.set(k, v);
          }
          break;
        }
        case Op.ASSERT_FAIL: {
          const m = st.pop()!;
          err('AssertionError', m === null ? 'la comprobación (assert) ha fallado' : pyStr(m));
        }
      }
    } catch (e) {
      if (e instanceof PyError || e instanceof RangeError) {
        const pe = e instanceof PyError ? e : new PyError('RecursionError', 'demasiada recursión');
        if (this.handle(pe, sync)) return undefined;
        throw pe;
      }
      throw e;
    }
    return undefined;
  }

  /** Busca un manejador try/except; devuelve true si lo encontró. */
  handle(e: PyError, sync: boolean): boolean {
    const exc = new ExcObj(e.pyType, e.pyMsg);
    while (this.frames.length) {
      const f = this.frames[this.frames.length - 1];
      const h = f.handlers.pop();
      if (h) {
        f.stack.length = h.sp;
        f.stack.push(exc);
        f.curExc = exc;
        f.ip = h.ip;
        return true;
      }
      if (f.jsBoundary && sync) return false; // lo propaga el callSync
      if (this.frames.length === 1) return false;
      this.frames.pop();
      if (f.importOf) this.modules.delete(f.importOf);
    }
    return false;
  }

  buildClass(f: Frame): PyClass {
    const { name, bases } = f.classOf!;
    let excBase: string | null = null;
    const clsBases: PyClass[] = [];
    for (const b of bases) {
      if (b instanceof ExcType) excBase = b.name;
      else if (b instanceof PyClass) { clsBases.push(b); if (b.excBase) excBase = b.name; }
    }
    const cls = new PyClass(name, clsBases, excBase);
    for (const [k, v] of f.env.vars) cls.attrs.set(k, v);
    if (excBase) this.excParent.set(name, excBase);
    return cls;
  }

  excIsSub(type: string, of: string): boolean {
    if (of === 'Exception') return true;
    let t: string | undefined = type;
    for (let i = 0; t && i < 50; i++) {
      if (t === of) return true;
      t = this.excParent.get(t);
    }
    return false;
  }

  /** str() respetando __str__ de las clases del jugador */
  strOf(v: Value): string {
    if (v instanceof PyInstance) {
      const m = v.cls.lookup('__str__') ?? v.cls.lookup('__repr__');
      if (m instanceof PyFunc) return pyStr(this.callSync(m, [v]));
    }
    if (Array.isArray(v) && v.some((x) => x instanceof PyInstance)) {
      return '[' + v.map((x) => (x instanceof PyInstance ? this.strOf(x) : pyRepr(x))).join(', ') + ']';
    }
    return pyStr(v);
  }

  lookup(env: Env, name: string): Value {
    let e: Env | null = env;
    while (e) {
      const v = e.vars.get(name);
      if (v !== undefined) return v;
      e = e.parent;
    }
    return this.builtin(name);
  }

  builtin(name: string): Value {
    if (name in BUILTINS || name in this.host.functions) return new Builtin(name);
    if (EXC_TYPES.includes(name)) return new ExcType(name);
    const hint = suggestName(name, [...Object.keys(BUILTINS), ...Object.keys(this.host.functions)]);
    return err('NameError', `'${name}' no está definido${hint ? ` (¿querías decir '${hint}'?)` : ''}`);
  }

  getAttr(o: Value, name: string): Value {
    if (o instanceof PyInstance) {
      const own = o.attrs.get(name);
      if (own !== undefined) return own;
      const v = o.cls.lookup(name);
      if (v === undefined) {
        const avail = [...o.attrs.keys()].join(', ');
        return err('AttributeError', `el objeto ${o.cls.name} no tiene el atributo '${name}'${avail ? ` (tiene: ${avail})` : ''}`);
      }
      return v instanceof PyFunc ? new PyBound(o, v) : v;
    }
    if (o instanceof PyClass) {
      const v = o.lookup(name);
      if (v === undefined) return err('AttributeError', `la clase ${o.name} no tiene '${name}'`);
      return v;
    }
    if (o instanceof PyRecord) {
      if (name in o.f) return o.f[name];
      return err('AttributeError', `${o.type} no tiene el atributo '${name}' (disponibles: ${Object.keys(o.f).join(', ')})`);
    }
    if (o instanceof ModuleObj) {
      const std = STD_MODULES[o.name];
      if (std) {
        if (!(name in std)) err('AttributeError', `el módulo '${o.name}' no tiene '${name}'`);
        const v = std[name];
        return typeof v === 'function' ? new Builtin(o.name + '.' + name) : (v as Value);
      }
      const m = this.modules.get(o.name);
      const v = m?.env.vars.get(name);
      if (v === undefined) err('AttributeError', `el módulo '${o.name}' no tiene '${name}'`);
      return v as Value;
    }
    if (o instanceof ExcObj) {
      if (name === 'args') return new Tuple([o.msg]);
    }
    if (hasMethod(o, name)) return new BoundMethod(o, name);
    return err('AttributeError', `'${typeName(o)}' no tiene el atributo '${name}'`);
  }

  doImport(f: Frame, name: string): undefined {
    if (STD_MODULES[name]) { f.stack.push(new ModuleObj(name)); return; }
    const m = this.modules.get(name);
    if (m) { f.stack.push(new ModuleObj(name)); return; }
    if (!(name in this.bundle.modules)) {
      const hint = suggestName(name, [...Object.keys(this.bundle.modules), 'math', 'random', 'heapq']);
      err('ImportError', `no existe el módulo '${name}'${hint ? ` (¿querías decir '${hint}'?)` : ''}. Crea el archivo ${name}.py en tu biblioteca`);
    }
    try {
      this.compiledFor(name);
    } catch (e) {
      if (e instanceof PySyntaxError) err('ImportError', `error de sintaxis en ${name}.py línea ${e.line}: ${e.message}`);
      throw e;
    }
    if (this.frames.length >= MAX_DEPTH) err('RecursionError', 'demasiadas llamadas anidadas');
    const g = new Env(null);
    this.installGlobals(g);
    g.vars.set('__name__', name);
    this.modules.set(name, { env: g, done: false });
    const nf = this.newFrame(name, 0, g, g);
    nf.importOf = name;
    this.frames.push(nf);
    return undefined;
  }

  makeFuncFrame(fn: PyFunc, args: Value[], kw: Record<string, Value>): Frame {
    const code = this.compiledFor(fn.code.mod).codes[fn.code.idx];
    const params = code.params;
    if (args.length > params.length && !code.varargs) {
      err('TypeError', `${fn.name}() recibe ${params.length} argumento${params.length === 1 ? '' : 's'}, pero se le pasaron ${args.length}`);
    }
    const env = new Env(fn.env);
    const firstDefault = params.length - code.ndefaults;
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      let v: Value | undefined;
      if (i < args.length) {
        if (p in kw) err('TypeError', `${fn.name}() recibió dos valores para '${p}'`);
        v = args[i];
      } else if (p in kw) v = kw[p];
      else if (i >= firstDefault) v = fn.defaults[i - firstDefault];
      else err('TypeError', `a ${fn.name}() le falta el argumento '${p}'`);
      env.vars.set(p, v as Value);
    }
    if (code.varargs) env.vars.set(code.varargs, new Tuple(args.slice(params.length)));
    const kwonly = code.kwonly ?? [];
    const kwdefs = code.kwdefaults ?? [];
    kwonly.forEach((p) => {
      if (p in kw) env.vars.set(p, kw[p]);
      else {
        const di = kwdefs.indexOf(p);
        if (di < 0) err('TypeError', `a ${fn.name}() le falta el argumento con nombre '${p}'`);
        env.vars.set(p, fn.defaults[code.ndefaults + di]);
      }
    });
    const extra = new PyDict();
    for (const k in kw) {
      if (params.includes(k) || kwonly.includes(k)) continue;
      if (!code.varkw) err('TypeError', `${fn.name}() no tiene ningún parámetro llamado '${k}'`);
      extra.set(k, kw[k]);
    }
    if (code.varkw) env.vars.set(code.varkw, extra);
    const nf = this.newFrame(fn.code.mod, fn.code.idx, env, fn.globals);
    return nf;
  }

  invoke(f: Frame, fn: Value, args: Value[], kw: Record<string, Value>, sync: boolean): 'action' | undefined {
    if (fn instanceof PyBound) {
      args = [fn.self, ...args];
      fn = fn.fn;
    }
    if (fn instanceof PyFunc) {
      if (this.frames.length >= MAX_DEPTH) err('RecursionError', `demasiadas llamadas anidadas (máx. ${MAX_DEPTH}); ¿recursión sin caso base?`);
      this.frames.push(this.makeFuncFrame(fn, args, kw));
      return undefined;
    }
    if (fn instanceof PyClass) {
      if (fn.excBase) { f.stack.push(new ExcObj(fn.name, args.length ? this.strOf(args[0]) : '')); return undefined; }
      const inst = new PyInstance(fn);
      const init = fn.lookup('__init__');
      if (init instanceof PyFunc) {
        if (this.frames.length >= MAX_DEPTH) err('RecursionError', 'demasiadas llamadas anidadas');
        const nf = this.makeFuncFrame(init, [inst, ...args], kw);
        nf.initOf = inst;
        this.frames.push(nf);
        return undefined;
      }
      if (args.length) err('TypeError', `${fn.name}() no recibe argumentos (define __init__ para aceptarlos)`);
      f.stack.push(inst);
      return undefined;
    }
    const r = this.callNative(fn, args, kw);
    if (isActionReq(r)) {
      if (sync) err('RuntimeError', 'no se pueden usar acciones del robot dentro de key=, map() o filter()');
      this.pendingReq = r;
      return 'action';
    }
    f.stack.push(r as Value);
    return undefined;
  }

  callNative(fn: Value, args: Value[], kw: Record<string, Value>): Value | ActionReq {
    if (fn instanceof Builtin) {
      const name = fn.name;
      const dot = name.indexOf('.');
      if (dot > 0) {
        const m = STD_MODULES[name.slice(0, dot)];
        return (m[name.slice(dot + 1)] as BuiltinFn)(this, args, kw);
      }
      // las primitivas del anfitrión tienen prioridad (p. ej. input() en la Academia)
      const h = this.host.functions[name];
      if (h) return h(args, kw);
      const b = BUILTINS[name];
      if (b) return b(this, args, kw);
      return err('NameError', `'${name}' no está definido`);
    }
    if (fn instanceof BoundMethod) return callMethod(this, fn.self, fn.name, args, kw);
    if (fn instanceof ExcType) return new ExcObj(fn.name, args.length ? pyStr(args[0]) : '');
    if (fn instanceof PyFunc) return this.callSync(fn, args);
    if (fn instanceof PyBound) return this.callSync(fn.fn, [fn.self, ...args]);
    if (fn instanceof PyClass) {
      if (fn.excBase) return new ExcObj(fn.name, args.length ? this.strOf(args[0]) : '');
      const inst = new PyInstance(fn);
      const init = fn.lookup('__init__');
      if (init instanceof PyFunc) this.callSync(init, [inst, ...args]);
      return inst;
    }
    return err('TypeError', `'${typeName(fn)}' no es una función (${pyRepr(fn)} no se puede llamar con paréntesis)`);
  }
}

function suggestName(name: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestD = 3;
  for (const c of candidates) {
    const d = lev(name.toLowerCase(), c.toLowerCase());
    if (d < bestD) { bestD = d; best = c; }
  }
  return best && bestD <= Math.max(1, Math.floor(name.length / 3)) ? best : null;
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
