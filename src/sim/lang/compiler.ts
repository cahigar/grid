// PyGrid — compilador AST → bytecode de pila.
import type { Expr, Param, Stmt } from './ast';
import { PySyntaxError } from './lexer';
import { parse } from './parser';

export enum Op {
  NOP, CONST, LOAD_NAME, LOAD_FAST, LOAD_GLOBAL, STORE_NAME, STORE_FAST, STORE_GLOBAL, STORE_DEREF, DEL_NAME,
  POP, DUP, DUP2, ROT2, ROT3,
  BINOP, INPLACE, UNARY, CMP,
  JUMP, JIF, JIT, JIF_OR_POP, JIT_OR_POP,
  BUILD_LIST, BUILD_TUPLE, BUILD_SET, BUILD_DICT, LIST_APPEND, SET_ADD, DICT_SET,
  FORMAT, BUILD_STR,
  SUBSCR, SLICE, STORE_SUBSCR, DEL_SUBSCR, LOAD_ATTR, STORE_ATTR,
  CALL, CALL_METHOD, MAKE_FUNC, RETURN,
  GET_ITER, FOR_ITER, UNPACK,
  SETUP_EXCEPT, POP_BLOCK, EXC_MATCH, RERAISE, RAISE, POP_EXC,
  IMPORT, IMPORT_FROM, IMPORT_STAR,
  ASSERT_FAIL,
  MAKE_CLASS,
}

export interface Code {
  name: string;
  params: string[];
  ndefaults: number;
  ops: Op[];
  args: unknown[];
  lines: number[];
  isFunc: boolean;
  doc: string | null;
}

export interface CompiledModule {
  name: string;
  codes: Code[];
  /** funciones definidas a nivel de módulo (para autocompletado / biblioteca) */
  defs: { name: string; params: string[]; doc: string | null; line: number }[];
}

interface Ctx {
  code: Code;
  isModule: boolean;
  locals: Set<string>;
  globals: Set<string>;
  nonlocals: Set<string>;
  loops: { breaks: number[]; cont: number; tryDepth: number }[];
  tryDepth: number;
}

const cache = new Map<string, CompiledModule>();

export function compileModule(name: string, src: string): CompiledModule {
  const key = name + '\u0000' + src;
  const c = cache.get(key);
  if (c) return c;
  const m = new Compiler(name).module(parse(src));
  if (cache.size > 500) cache.clear();
  cache.set(key, m);
  return m;
}

/** Comprueba el código y devuelve el primer error de sintaxis (o null). */
export function checkSyntax(src: string): { msg: string; line: number; col: number } | null {
  try {
    new Compiler('check').module(parse(src));
    return null;
  } catch (e) {
    if (e instanceof PySyntaxError) return { msg: e.message, line: e.line, col: e.col };
    throw e;
  }
}

class Compiler {
  codes: Code[] = [];
  ctx!: Ctx;
  tmp = 0;
  line = 1;
  constructor(public modName: string) {}

  module(body: Stmt[]): CompiledModule {
    const code = this.newCode('<módulo>', [], 0, false, null);
    this.ctx = { code, isModule: true, locals: new Set(), globals: new Set(), nonlocals: new Set(), loops: [], tryDepth: 0 };
    this.stmts(body);
    this.emit(Op.CONST, null);
    this.emit(Op.RETURN);
    const defs = body
      .filter((s): s is Extract<Stmt, { k: 'def' | 'class' }> => s.k === 'def' || s.k === 'class')
      .map((s) => ({ name: s.name, params: s.k === 'def' ? s.params.map((p) => p.name) : [], doc: s.doc, line: s.line }));
    return { name: this.modName, codes: this.codes, defs };
  }

  newCode(name: string, params: string[], ndefaults: number, isFunc: boolean, doc: string | null): Code {
    const code: Code = { name, params, ndefaults, ops: [], args: [], lines: [], isFunc, doc };
    this.codes.push(code);
    return code;
  }

  emit(op: Op, arg: unknown = null): number {
    const c = this.ctx.code;
    c.ops.push(op);
    c.args.push(arg);
    c.lines.push(this.line);
    return c.ops.length - 1;
  }
  here(): number { return this.ctx.code.ops.length; }
  patch(at: number, target = this.here()): void { this.ctx.code.args[at] = target; }

  err(msg: string, line = this.line): never {
    throw new PySyntaxError('SyntaxError: ' + msg, line);
  }

  // ───── ámbitos ─────
  loadName(id: string): void {
    const c = this.ctx;
    if (c.isModule) this.emit(Op.LOAD_NAME, id);
    else if (c.globals.has(id)) this.emit(Op.LOAD_GLOBAL, id);
    else if (c.locals.has(id)) this.emit(Op.LOAD_FAST, id);
    else this.emit(Op.LOAD_NAME, id);
  }
  storeName(id: string): void {
    const c = this.ctx;
    if (c.isModule) this.emit(Op.STORE_NAME, id);
    else if (c.globals.has(id)) this.emit(Op.STORE_GLOBAL, id);
    else if (c.nonlocals.has(id)) this.emit(Op.STORE_DEREF, id);
    else this.emit(Op.STORE_FAST, id);
  }

  // ───── funciones ─────
  func(name: string, params: Param[], body: Stmt[] | Expr, doc: string | null, line: number): void {
    for (const p of params) if (p.def) this.expr(p.def);
    const code = this.newCode(name, params.map((p) => p.name), params.filter((p) => p.def).length, true, doc);
    const idx = this.codes.length - 1;
    const outer = this.ctx;
    const globals = new Set<string>();
    const nonlocals = new Set<string>();
    const locals = new Set<string>(params.map((p) => p.name));
    if (Array.isArray(body)) {
      collectDecls(body, globals, nonlocals);
      collectAssigned(body, locals);
      for (const g of globals) {
        if (params.some((p) => p.name === g)) this.err(`'${g}' es un parámetro y no puede declararse global`, line);
        locals.delete(g);
      }
      for (const g of nonlocals) locals.delete(g);
    }
    this.ctx = { code, isModule: false, locals, globals, nonlocals, loops: [], tryDepth: 0 };
    const saveLine = this.line;
    if (Array.isArray(body)) {
      this.stmts(body);
      this.emit(Op.CONST, null);
      this.emit(Op.RETURN);
    } else {
      this.expr(body);
      this.emit(Op.RETURN);
    }
    this.ctx = outer;
    this.line = saveLine;
    this.emit(Op.MAKE_FUNC, [idx, params.filter((p) => p.def).length, name]);
  }

  // ───── sentencias ─────
  stmts(list: Stmt[]): void {
    for (const s of list) this.stmt(s);
  }

  stmt(s: Stmt): void {
    this.line = s.line;
    const c = this.ctx;
    switch (s.k) {
      case 'expr':
        this.expr(s.e);
        this.emit(Op.POP);
        break;
      case 'assign': {
        this.expr(s.value);
        for (let i = 0; i < s.targets.length; i++) {
          if (i < s.targets.length - 1) this.emit(Op.DUP);
          this.store(s.targets[i]);
        }
        break;
      }
      case 'aug': {
        const t = s.target;
        if (t.k === 'name') {
          this.loadName(t.id);
          this.expr(s.value);
          this.emit(Op.INPLACE, s.op);
          this.storeName(t.id);
        } else if (t.k === 'sub') {
          this.expr(t.obj);
          this.subIndex(t.index);
          this.emit(Op.DUP2);
          this.emit(Op.SUBSCR);
          this.expr(s.value);
          this.emit(Op.INPLACE, s.op);
          this.emit(Op.ROT3);
          this.emit(Op.STORE_SUBSCR);
        } else if (t.k === 'attr') {
          this.expr(t.obj);
          this.emit(Op.DUP);
          this.emit(Op.LOAD_ATTR, t.name);
          this.expr(s.value);
          this.emit(Op.INPLACE, s.op);
          this.emit(Op.ROT2);
          this.emit(Op.STORE_ATTR, t.name);
        }
        break;
      }
      case 'if': {
        this.expr(s.test);
        const jf = this.emit(Op.JIF);
        this.stmts(s.body);
        if (s.orelse.length) {
          const je = this.emit(Op.JUMP);
          this.patch(jf);
          this.stmts(s.orelse);
          this.patch(je);
        } else this.patch(jf);
        break;
      }
      case 'while': {
        const top = this.here();
        this.line = s.line;
        this.expr(s.test);
        const jf = this.emit(Op.JIF);
        const loop = { breaks: [] as number[], cont: top, tryDepth: c.tryDepth };
        c.loops.push(loop);
        this.stmts(s.body);
        c.loops.pop();
        this.line = s.line;
        this.emit(Op.JUMP, top);
        this.patch(jf);
        this.stmts(s.orelse);
        for (const b of loop.breaks) this.patch(b);
        break;
      }
      case 'for': {
        this.expr(s.iter);
        this.emit(Op.GET_ITER);
        const top = this.here();
        const fi = this.emit(Op.FOR_ITER);
        this.store(s.target);
        const loop = { breaks: [] as number[], cont: top, tryDepth: c.tryDepth };
        c.loops.push(loop);
        this.stmts(s.body);
        c.loops.pop();
        this.line = s.line;
        this.emit(Op.JUMP, top);
        this.patch(fi);
        this.stmts(s.orelse);
        const skip = this.emit(Op.JUMP);
        // los break saltan aquí: hay que retirar el iterador
        for (const b of loop.breaks) this.patch(b);
        if (loop.breaks.length) this.emit(Op.POP);
        this.patch(skip);
        break;
      }
      case 'break':
      case 'continue': {
        const loop = c.loops[c.loops.length - 1];
        if (!loop) this.err(`'${s.k}' fuera de un bucle`);
        for (let i = loop.tryDepth; i < c.tryDepth; i++) this.emit(Op.POP_BLOCK);
        if (s.k === 'break') loop.breaks.push(this.emit(Op.JUMP));
        else this.emit(Op.JUMP, loop.cont);
        break;
      }
      case 'pass':
        break;
      case 'return':
        if (c.isModule) this.err("'return' fuera de una función");
        if (s.value) this.expr(s.value);
        else this.emit(Op.CONST, null);
        this.emit(Op.RETURN);
        break;
      case 'def':
        this.func(s.name, s.params, s.body, s.doc, s.line);
        this.storeName(s.name);
        break;
      case 'class': {
        for (const b of s.bases) this.expr(b);
        const code = this.newCode(s.name, [], 0, false, s.doc);
        const idx = this.codes.length - 1;
        const outer = this.ctx;
        this.ctx = { code, isModule: true, locals: new Set(), globals: new Set(), nonlocals: new Set(), loops: [], tryDepth: 0 };
        this.stmts(s.body);
        this.emit(Op.CONST, null);
        this.emit(Op.RETURN);
        this.ctx = outer;
        this.line = s.line;
        this.emit(Op.MAKE_CLASS, [idx, s.bases.length, s.name]);
        this.storeName(s.name);
        break;
      }
      case 'global':
      case 'nonlocal':
        if (s.k === 'nonlocal' && c.isModule) this.err("'nonlocal' sólo puede usarse dentro de funciones");
        break;
      case 'try': {
        const setup = this.emit(Op.SETUP_EXCEPT);
        c.tryDepth++;
        this.stmts(s.body);
        c.tryDepth--;
        this.emit(Op.POP_BLOCK);
        this.stmts(s.orelse);
        const toEnd = [this.emit(Op.JUMP)];
        this.patch(setup);
        // manejador: la excepción está en la pila
        for (const h of s.handlers) {
          this.line = h.line;
          let jnext = -1;
          if (h.type) {
            this.emit(Op.DUP);
            this.expr(h.type);
            this.emit(Op.EXC_MATCH);
            jnext = this.emit(Op.JIF);
          }
          if (h.name) this.storeName(h.name);
          else this.emit(Op.POP);
          this.stmts(h.body);
          this.emit(Op.POP_EXC);
          toEnd.push(this.emit(Op.JUMP));
          if (jnext >= 0) this.patch(jnext);
        }
        // ninguna coincide: finally + relanzar
        this.stmts(s.fin);
        this.emit(Op.RERAISE);
        for (const j of toEnd) this.patch(j);
        this.stmts(s.fin);
        break;
      }
      case 'raise':
        if (s.exc) { this.expr(s.exc); this.emit(Op.RAISE, 1); }
        else this.emit(Op.RAISE, 0);
        break;
      case 'import':
        for (const n of s.names) {
          if (n.name.includes('.')) this.err('los módulos con puntos no están disponibles');
          this.emit(Op.IMPORT, n.name);
          this.storeName(n.as ?? n.name);
        }
        break;
      case 'from':
        this.emit(Op.IMPORT, s.module);
        for (const n of s.names) {
          if (n.name === '*') {
            if (!c.isModule) this.err("'from … import *' sólo a nivel de módulo");
            this.emit(Op.IMPORT_STAR);
            return;
          }
          this.emit(Op.IMPORT_FROM, n.name);
          this.storeName(n.as ?? n.name);
        }
        this.emit(Op.POP);
        break;
      case 'del':
        for (const t of s.targets) {
          if (t.k === 'name') {
            this.emit(Op.DEL_NAME, t.id);
          } else if (t.k === 'sub') {
            this.expr(t.obj);
            this.subIndex(t.index);
            this.emit(Op.DEL_SUBSCR);
          } else this.err('no se puede borrar esta expresión');
        }
        break;
      case 'assert': {
        this.expr(s.test);
        const jt = this.emit(Op.JIT);
        if (s.msg) this.expr(s.msg);
        else this.emit(Op.CONST, null);
        this.emit(Op.ASSERT_FAIL);
        this.patch(jt);
        break;
      }
    }
  }

  store(t: Expr): void {
    switch (t.k) {
      case 'name':
        this.storeName(t.id);
        return;
      case 'sub':
        this.expr(t.obj);
        this.subIndex(t.index);
        this.emit(Op.STORE_SUBSCR);
        return;
      case 'attr':
        this.expr(t.obj);
        this.emit(Op.STORE_ATTR, t.name);
        return;
      case 'tuple':
      case 'list':
        if (t.items.some((i) => i.k === 'star')) this.err('el desempaquetado con * no está disponible');
        this.emit(Op.UNPACK, t.items.length);
        for (const it of t.items) this.store(it);
        return;
    }
    this.err('destino de asignación inválido');
  }

  subIndex(index: Expr): void {
    if (index.k === 'slice') this.err('asignar o borrar con slices (a[i:j] = …) no está disponible');
    this.expr(index);
  }

  // ───── expresiones ─────
  expr(e: Expr): void {
    const prevLine = this.line;
    if (e.line) this.line = e.line;
    switch (e.k) {
      case 'num':
      case 'str':
        this.emit(Op.CONST, e.v);
        break;
      case 'const':
        this.emit(Op.CONST, e.v);
        break;
      case 'fstr':
        for (const p of e.parts) {
          if (typeof p === 'string') this.emit(Op.CONST, p);
          else { this.expr(p.e); this.emit(Op.FORMAT, [p.spec, p.conv]); }
        }
        this.emit(Op.BUILD_STR, e.parts.length);
        break;
      case 'name':
        this.loadName(e.id);
        break;
      case 'list':
      case 'tuple':
      case 'set':
        if (e.items.some((i) => i.k === 'star')) this.err('el operador * dentro de listas no está disponible');
        for (const it of e.items) this.expr(it);
        this.emit(e.k === 'list' ? Op.BUILD_LIST : e.k === 'tuple' ? Op.BUILD_TUPLE : Op.BUILD_SET, e.items.length);
        break;
      case 'dict':
        for (let i = 0; i < e.keys.length; i++) { this.expr(e.keys[i]); this.expr(e.values[i]); }
        this.emit(Op.BUILD_DICT, e.keys.length);
        break;
      case 'bin':
        this.expr(e.l);
        this.expr(e.r);
        this.emit(Op.BINOP, e.op);
        break;
      case 'unary':
        this.expr(e.e);
        this.emit(Op.UNARY, e.op);
        break;
      case 'bool': {
        this.expr(e.l);
        const j = this.emit(e.op === 'or' ? Op.JIT_OR_POP : Op.JIF_OR_POP);
        this.expr(e.r);
        this.patch(j);
        break;
      }
      case 'cmp': {
        this.expr(e.operands[0]);
        if (e.ops.length === 1) {
          this.expr(e.operands[1]);
          this.emit(Op.CMP, e.ops[0]);
          break;
        }
        const cleanups: number[] = [];
        for (let i = 0; i < e.ops.length; i++) {
          this.expr(e.operands[i + 1]);
          if (i < e.ops.length - 1) {
            this.emit(Op.DUP);
            this.emit(Op.ROT3);
            this.emit(Op.CMP, e.ops[i]);
            cleanups.push(this.emit(Op.JIF_OR_POP));
          } else this.emit(Op.CMP, e.ops[i]);
        }
        const jend = this.emit(Op.JUMP);
        for (const cl of cleanups) this.patch(cl);
        this.emit(Op.ROT2);
        this.emit(Op.POP);
        this.patch(jend);
        break;
      }
      case 'call': {
        const kw = e.kwargs.map((k) => k.name);
        if (e.fn.k === 'attr') {
          this.expr(e.fn.obj);
          for (const a of e.args) this.expr(a);
          for (const k of e.kwargs) this.expr(k.value);
          this.line = e.line;
          this.emit(Op.CALL_METHOD, [e.fn.name, e.args.length, kw]);
        } else {
          this.expr(e.fn);
          for (const a of e.args) this.expr(a);
          for (const k of e.kwargs) this.expr(k.value);
          this.line = e.line;
          this.emit(Op.CALL, [e.args.length, kw]);
        }
        break;
      }
      case 'attr':
        if (e.name.startsWith('__')) this.err('los atributos especiales (__x__) no están disponibles');
        this.expr(e.obj);
        this.emit(Op.LOAD_ATTR, e.name);
        break;
      case 'sub':
        this.expr(e.obj);
        if (e.index.k === 'slice') {
          const sl = e.index;
          for (const p of [sl.lo, sl.hi, sl.step]) {
            if (p) this.expr(p);
            else this.emit(Op.CONST, null);
          }
          this.emit(Op.SLICE);
        } else {
          this.expr(e.index);
          this.emit(Op.SUBSCR);
        }
        break;
      case 'slice':
        this.err('slice fuera de corchetes');
        break;
      case 'ifexp': {
        this.expr(e.test);
        const jf = this.emit(Op.JIF);
        this.expr(e.body);
        const je = this.emit(Op.JUMP);
        this.patch(jf);
        this.expr(e.orelse);
        this.patch(je);
        break;
      }
      case 'lambda':
        this.func('<lambda>', e.params, e.body, null, e.line);
        break;
      case 'comp': {
        const tmp = `.comp${this.tmp++}`;
        if (!this.ctx.isModule) this.ctx.locals.add(tmp);
        for (const g of e.gens) collectTargetNames(g.target, this.ctx.isModule ? new Set() : this.ctx.locals);
        this.emit(e.kind === 'list' ? Op.BUILD_LIST : e.kind === 'set' ? Op.BUILD_SET : Op.BUILD_DICT, 0);
        this.storeName(tmp);
        const exits: { fi: number; top: number }[] = [];
        for (const g of e.gens) {
          this.expr(g.iter);
          this.emit(Op.GET_ITER);
          const top = this.here();
          const fi = this.emit(Op.FOR_ITER);
          this.store(g.target);
          exits.push({ fi, top });
          for (const cond of g.ifs) {
            this.expr(cond);
            this.emit(Op.JIF, top);
          }
        }
        this.loadName(tmp);
        this.expr(e.elt);
        if (e.kind === 'dict') { this.expr(e.val!); this.emit(Op.DICT_SET); }
        else this.emit(e.kind === 'list' ? Op.LIST_APPEND : Op.SET_ADD);
        for (let i = exits.length - 1; i >= 0; i--) {
          this.emit(Op.JUMP, exits[i].top);
          this.patch(exits[i].fi);
        }
        this.loadName(tmp);
        this.emit(Op.DEL_NAME, tmp);
        break;
      }
      case 'star':
        this.err("'*' no está disponible aquí");
    }
    this.line = prevLine;
  }
}

function collectDecls(body: Stmt[], globals: Set<string>, nonlocals: Set<string>): void {
  for (const s of body) {
    if (s.k === 'global') s.names.forEach((n) => globals.add(n));
    else if (s.k === 'nonlocal') s.names.forEach((n) => nonlocals.add(n));
    else if (s.k === 'if' || s.k === 'while' || s.k === 'for') {
      collectDecls(s.body, globals, nonlocals);
      collectDecls(s.orelse, globals, nonlocals);
    } else if (s.k === 'try') {
      collectDecls(s.body, globals, nonlocals);
      s.handlers.forEach((h) => collectDecls(h.body, globals, nonlocals));
      collectDecls(s.orelse, globals, nonlocals);
      collectDecls(s.fin, globals, nonlocals);
    }
  }
}

function collectTargetNames(t: Expr, out: Set<string>): void {
  if (t.k === 'name') out.add(t.id);
  else if (t.k === 'tuple' || t.k === 'list') t.items.forEach((i) => collectTargetNames(i.k === 'star' ? i.e : i, out));
}

function collectAssigned(body: Stmt[], out: Set<string>): void {
  for (const s of body) {
    switch (s.k) {
      case 'assign': s.targets.forEach((t) => collectTargetNames(t, out)); break;
      case 'aug': collectTargetNames(s.target, out); break;
      case 'for':
        collectTargetNames(s.target, out);
        collectAssigned(s.body, out);
        collectAssigned(s.orelse, out);
        break;
      case 'if':
      case 'while':
        collectAssigned(s.body, out);
        collectAssigned(s.orelse, out);
        break;
      case 'def': out.add(s.name); break;
      case 'class': out.add(s.name); break;
      case 'import': s.names.forEach((n) => out.add(n.as ?? n.name)); break;
      case 'from': s.names.forEach((n) => n.name !== '*' && out.add(n.as ?? n.name)); break;
      case 'try':
        collectAssigned(s.body, out);
        s.handlers.forEach((h) => { if (h.name) out.add(h.name); collectAssigned(h.body, out); });
        collectAssigned(s.orelse, out);
        collectAssigned(s.fin, out);
        break;
      case 'del': s.targets.forEach((t) => t.k === 'name' && out.add(t.id)); break;
    }
  }
}
