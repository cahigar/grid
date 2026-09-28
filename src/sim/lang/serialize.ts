// PyGrid — serialización del estado completo de la VM (con aliasing y ciclos).
import { VM, type Bundle, type Frame, type Host } from './vm';
import {
  BoundMethod, Builtin, Env, ExcObj, ExcType, Iter, ModuleObj, PyDict, PyFunc, PySet, Range, PyRecord, Tuple, type Value,
} from './values';

type Enc = null | boolean | number | string | { r: number } | { n: string } | { x: string };
type HeapEntry = unknown[];

export interface VMState {
  v: 1;
  bundle: Bundle;
  heap: HeapEntry[];
  frames: {
    mod: string; ci: number; ip: number; stack: Enc[]; env: Enc; globals: Enc;
    handlers: { ip: number; sp: number }[]; curExc: Enc; importOf: string | null;
  }[];
  modules: [string, Enc, boolean][];
  waiting: boolean;
  finished: boolean;
  rng: number;
  instr: number;
}

function makeEncoder(externals: Map<object, string>) {
  const ids = new Map<object, number>();
  const heap: HeapEntry[] = [];

  const enc = (v: Value | Env | null | undefined): Enc => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') {
      if (Number.isFinite(v)) return v;
      return { n: Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf' };
    }
    const ext = externals.get(v as object);
    if (ext) return { x: ext };
    const known = ids.get(v as object);
    if (known !== undefined) return { r: known };
    const id = heap.length;
    ids.set(v as object, id);
    const entry: unknown[] = [];
    heap.push(entry);
    if (Array.isArray(v)) entry.push('L', v.map(enc));
    else if (v instanceof Tuple) entry.push('T', v.items.map(enc));
    else if (v instanceof PyDict) entry.push('D', [...v.m.values()].map(([k, x]) => [enc(k), enc(x)]));
    else if (v instanceof PySet) entry.push('S', v.items().map(enc));
    else if (v instanceof Env) entry.push('E', enc(v.parent), [...v.vars].map(([k, x]) => [k, enc(x)]));
    else if (v instanceof PyFunc) entry.push('F', v.name, v.code.mod, v.code.idx, v.defaults.map(enc), enc(v.env), enc(v.globals));
    else if (v instanceof Builtin) entry.push('B', v.name);
    else if (v instanceof BoundMethod) entry.push('M', enc(v.self), v.name);
    else if (v instanceof PyRecord) entry.push('R', v.type, Object.entries(v.f).map(([k, x]) => [k, enc(x)]));
    else if (v instanceof Range) entry.push('G', v.start, v.stop, v.step);
    else if (v instanceof Iter) entry.push('I', v.kind, enc(v.src), v.i);
    else if (v instanceof ModuleObj) entry.push('O', v.name);
    else if (v instanceof ExcType) entry.push('X', v.name);
    else if (v instanceof ExcObj) entry.push('Y', v.type, v.msg);
    else throw new Error('valor no serializable');
    return { r: id };
  };
  return { enc, heap };
}

export interface ValueState { heap: HeapEntry[]; root: Enc }

export function serializeValue(v: Value, externals: Map<object, string> = new Map()): ValueState {
  const { enc, heap } = makeEncoder(externals);
  const root = enc(v);
  return { heap, root };
}

export function deserializeValue(s: ValueState, externals: Record<string, object> = {}): Value {
  const dec = makeDecoder(s.heap, externals);
  return dec(s.root);
}

export function serializeVM(vm: VM, externals: Map<object, string> = new Map()): VMState {
  const { enc, heap } = makeEncoder(externals);
  const frames = vm.frames.map((f) => ({
    mod: f.mod, ci: f.ci, ip: f.ip, stack: f.stack.map(enc), env: enc(f.env), globals: enc(f.globals),
    handlers: f.handlers.map((h) => ({ ...h })), curExc: enc(f.curExc), importOf: f.importOf,
  }));
  const modules: [string, Enc, boolean][] = [...vm.modules].map(([k, m]) => [k, enc(m.env), m.done]);
  return {
    v: 1, bundle: vm.bundle, heap, frames, modules,
    waiting: vm.waiting, finished: vm.finished, rng: vm.rngState, instr: vm.instrTotal,
  };
}

function makeDecoder(heapIn: HeapEntry[], externals: Record<string, object>) {
  const s = { heap: heapIn };
  const objs: unknown[] = new Array(s.heap.length);

  // 1ª pasada: crear cascarones
  s.heap.forEach((e, i) => {
    switch (e[0]) {
      case 'L': objs[i] = []; break;
      case 'T': objs[i] = new Tuple([]); break;
      case 'D': objs[i] = new PyDict(); break;
      case 'S': objs[i] = new PySet(); break;
      case 'E': objs[i] = new Env(null); break;
      case 'F': objs[i] = new PyFunc(e[1] as string, { mod: e[2] as string, idx: e[3] as number }, [], null as unknown as Env, null as unknown as Env); break;
      case 'B': objs[i] = new Builtin(e[1] as string); break;
      case 'M': objs[i] = new BoundMethod(null, e[2] as string); break;
      case 'R': objs[i] = new PyRecord(e[1] as string, {}); break;
      case 'G': objs[i] = new Range(e[1] as number, e[2] as number, e[3] as number); break;
      case 'I': objs[i] = new Iter(e[1] as 'seq', null, e[3] as number); break;
      case 'O': objs[i] = new ModuleObj(e[1] as string); break;
      case 'X': objs[i] = new ExcType(e[1] as string); break;
      case 'Y': objs[i] = new ExcObj(e[1] as string, e[2] as string); break;
      default: throw new Error('entrada de heap desconocida');
    }
  });

  const dec = (x: Enc): Value => {
    if (x === null || typeof x !== 'object') return x as Value;
    if ('r' in x) return objs[x.r] as Value;
    if ('n' in x) return x.n === 'inf' ? Infinity : x.n === '-inf' ? -Infinity : NaN;
    if ('x' in x) {
      const o = externals[x.x];
      if (!o) throw new Error('externo desconocido ' + x.x);
      return o as Value;
    }
    return null;
  };

  // 2ª pasada: rellenar
  s.heap.forEach((e, i) => {
    const o = objs[i];
    switch (e[0]) {
      case 'L': (o as Value[]).push(...(e[1] as Enc[]).map(dec)); break;
      case 'T': (o as Tuple).items = (e[1] as Enc[]).map(dec); break;
      case 'E': {
        const env = o as Env;
        env.parent = dec(e[1] as Enc) as unknown as Env | null;
        for (const [k, v] of e[2] as [string, Enc][]) env.vars.set(k, dec(v));
        break;
      }
      case 'F': {
        const f = o as PyFunc;
        f.defaults = (e[4] as Enc[]).map(dec);
        f.env = dec(e[5] as Enc) as unknown as Env;
        f.globals = dec(e[6] as Enc) as unknown as Env;
        break;
      }
      case 'M': (o as BoundMethod).self = dec(e[1] as Enc); break;
      case 'R': for (const [k, v] of e[2] as [string, Enc][]) (o as PyRecord).f[k] = dec(v); break;
      case 'I': (o as Iter).src = dec(e[2] as Enc); break;
    }
  });

  // 3ª pasada: diccionarios y sets (sus claves deben estar completas para calcular el hash)
  s.heap.forEach((e, i) => {
    if (e[0] === 'D') for (const [k, v] of e[1] as [Enc, Enc][]) (objs[i] as PyDict).set(dec(k), dec(v));
    else if (e[0] === 'S') for (const v of e[1] as Enc[]) (objs[i] as PySet).add(dec(v));
  });
  return dec;
}

export function deserializeVM(s: VMState, host: Host, externals: Record<string, object> = {}): VM {
  const vm = new VM(s.bundle, host);
  const dec = makeDecoder(s.heap, externals);

  vm.frames = s.frames.map((f): Frame => ({
    mod: f.mod, ci: f.ci, ip: f.ip, stack: f.stack.map(dec), env: dec(f.env) as unknown as Env,
    globals: dec(f.globals) as unknown as Env, handlers: f.handlers.map((h) => ({ ...h })),
    curExc: dec(f.curExc) as unknown as ExcObj | null, importOf: f.importOf, jsBoundary: false,
  }));
  for (const [name, env, done] of s.modules) vm.modules.set(name, { env: dec(env) as unknown as Env, done });
  vm.waiting = s.waiting;
  vm.finished = s.finished;
  vm.rngState = s.rng;
  vm.instrTotal = s.instr;
  return vm;
}
