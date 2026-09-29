// PyGrid — parser descendente recursivo.
import type { CompGen, Expr, Handler, Param, Stmt } from './ast';
import { PySyntaxError, tokenize, type Token } from './lexer';

const UNSUPPORTED: Record<string, string> = {
  with: "'with' no está disponible en PyGrid",
  yield: 'los generadores (yield) no están disponibles en PyGrid',
  async: "'async' no está disponible en PyGrid",
  await: "'await' no está disponible en PyGrid",
};

export function parse(src: string): Stmt[] {
  return new Parser(tokenize(src)).program();
}

/** patrón de match/case (sólo en el parser: se traduce a if) */
type Pat =
  | { k: 'lit'; e: Expr; is: boolean }
  | { k: 'any' }
  | { k: 'cap'; name: string }
  | { k: 'or'; alts: Pat[] }
  | { k: 'seq'; items: Pat[]; star: string | null | undefined }
  | { k: 'val'; e: Expr }
  | { k: 'map'; keys: Expr[]; pats: Pat[] };

class Parser {
  p = 0;
  private matchN = 0;
  constructor(private toks: Token[]) {}

  get tok(): Token { return this.toks[this.p]; }
  peek(o = 1): Token { return this.toks[Math.min(this.p + o, this.toks.length - 1)]; }

  err(msg: string, t: Token = this.tok): never {
    throw new PySyntaxError('SyntaxError: ' + msg, t.line, t.col);
  }

  isOp(v: string): boolean { return this.tok.t === 'op' && this.tok.v === v; }
  isKw(v: string): boolean { return this.tok.t === 'name' && this.tok.v === v; }

  eatOp(v: string): boolean {
    if (this.isOp(v)) { this.p++; return true; }
    return false;
  }
  eatKw(v: string): boolean {
    if (this.isKw(v)) { this.p++; return true; }
    return false;
  }
  expectOp(v: string, what?: string): Token {
    if (v === ':' && this.isOp('=')) this.err("'=' asigna; para comparar usa '=='");
    if (v === ':' && this.tok.t === 'nl') this.err("falta ':' al final de la línea");
    if (!this.isOp(v)) this.err(what ?? `se esperaba '${v}'` + this.near());
    return this.toks[this.p++];
  }
  expectKw(v: string): Token {
    if (!this.isKw(v)) this.err(`se esperaba '${v}'` + this.near());
    return this.toks[this.p++];
  }
  near(): string {
    const t = this.tok;
    if (t.t === 'nl') return ' al final de la línea';
    if (t.t === 'eof') return ' al final del archivo';
    if (t.t === 'indent') return ' (sangría inesperada)';
    return ` cerca de '${t.v}'`;
  }
  ident(): string {
    const t = this.tok;
    if (t.t !== 'name') this.err('se esperaba un nombre' + this.near());
    if (isKeyword(t.v)) this.err(`'${t.v}' es una palabra reservada y no puede usarse como nombre`);
    this.p++;
    return t.v;
  }

  program(): Stmt[] {
    const out: Stmt[] = [];
    while (this.tok.t !== 'eof') {
      if (this.tok.t === 'nl') { this.p++; continue; }
      if (this.tok.t === 'indent') this.err('IndentationError: sangría inesperada');
      out.push(...this.statement());
    }
    return out;
  }

  block(): Stmt[] {
    // tras ':'
    if (this.tok.t !== 'nl') {
      // bloque en una línea: if x: y
      const s = this.simpleLine();
      return s;
    }
    this.p++;
    if (this.toks[this.p].t !== 'indent') this.err('IndentationError: se esperaba un bloque con sangría');
    this.p++;
    const out: Stmt[] = [];
    while (this.toks[this.p].t !== 'dedent' && this.toks[this.p].t !== 'eof') {
      if (this.tok.t === 'nl') { this.p++; continue; }
      out.push(...this.statement());
    }
    if (this.toks[this.p].t === 'dedent') this.p++;
    return out;
  }

  statement(): Stmt[] {
    const t = this.tok;
    if (t.t === 'name') {
      if (UNSUPPORTED[t.v]) this.err(UNSUPPORTED[t.v]);
      if (t.v === 'match' && this.looksLikeMatch()) return this.matchStmt();
      if (t.v === 'case' && this.peek().t !== 'op') this.err("'case' sólo puede ir dentro de un bloque 'match'");
      switch (t.v) {
        case 'if': return [this.ifStmt()];
        case 'while': {
          this.p++;
          const test = this.expr();
          this.expectOp(':');
          const body = this.block();
          let orelse: Stmt[] = [];
          if (this.isKw('else')) { this.p++; this.expectOp(':'); orelse = this.block(); }
          return [{ k: 'while', test, body, orelse, line: t.line }];
        }
        case 'for': {
          this.p++;
          const target = this.targetList();
          this.expectKw('in');
          const iter = this.exprList();
          this.expectOp(':');
          const body = this.block();
          let orelse: Stmt[] = [];
          if (this.isKw('else')) { this.p++; this.expectOp(':'); orelse = this.block(); }
          return [{ k: 'for', target, iter, body, orelse, line: t.line }];
        }
        case 'def': {
          this.p++;
          const name = this.ident();
          this.expectOp('(');
          const params = this.params(')');
          this.expectOp(')');
          if (this.eatOp('->')) this.expr();
          this.expectOp(':');
          const body = this.block();
          let doc: string | null = null;
          const f = body[0];
          if (f && f.k === 'expr' && f.e.k === 'str') doc = f.e.v;
          return [{ k: 'def', name, params, body, line: t.line, doc }];
        }
        case 'class': {
          this.p++;
          const name = this.ident();
          const bases: Expr[] = [];
          if (this.eatOp('(')) {
            while (!this.isOp(')')) {
              bases.push(this.expr());
              if (!this.eatOp(',')) break;
            }
            this.expectOp(')');
          }
          this.expectOp(':');
          const body = this.block();
          let doc: string | null = null;
          const f = body[0];
          if (f && f.k === 'expr' && f.e.k === 'str') doc = f.e.v;
          return [{ k: 'class', name, bases, body, line: t.line, doc }];
        }
        case 'try': {
          this.p++;
          this.expectOp(':');
          const body = this.block();
          const handlers: Handler[] = [];
          while (this.isKw('except')) {
            const ht = this.tok;
            this.p++;
            let type: Expr | null = null;
            let name: string | null = null;
            if (!this.isOp(':')) {
              type = this.expr();
              if (this.eatKw('as')) name = this.ident();
            }
            this.expectOp(':');
            handlers.push({ type, name, body: this.block(), line: ht.line });
          }
          let orelse: Stmt[] = [];
          let fin: Stmt[] = [];
          if (this.isKw('else')) { this.p++; this.expectOp(':'); orelse = this.block(); }
          if (this.isKw('finally')) { this.p++; this.expectOp(':'); fin = this.block(); }
          if (!handlers.length && !fin.length) this.err("se esperaba 'except' o 'finally' tras 'try'");
          return [{ k: 'try', body, handlers, orelse, fin, line: t.line }];
        }
      }
    }
    return this.simpleLine();
  }

  // ───── match / case (palabra clave «blanda») ─────
  looksLikeMatch(): boolean {
    let j = this.p + 1;
    if (this.toks[j]?.t === 'op' && ['=', '.', ':', ',', ')', ']'].includes(this.toks[j].v)) return false;
    while (j < this.toks.length && this.toks[j].t !== 'nl' && this.toks[j].t !== 'eof') j++;
    const last = this.toks[j - 1];
    return !!last && last.t === 'op' && last.v === ':' && this.toks[j + 1]?.t === 'indent';
  }

  matchStmt(): Stmt[] {
    const t = this.tok;
    this.p++;
    const subject = this.exprList();
    this.expectOp(':');
    if (this.tok.t !== 'nl') this.err("tras 'match …:' los 'case' van en líneas nuevas con sangría");
    this.p++;
    if (this.toks[this.p].t !== 'indent') this.err('IndentationError: se esperaba un bloque con sangría');
    this.p++;
    const n = ++this.matchN;
    const line = t.line;
    const mName = `__match${n}`;
    const okName = `__caso${n}`;
    const M: Expr = { k: 'name', id: mName, line };
    const out: Stmt[] = [
      { k: 'assign', targets: [{ k: 'name', id: mName, line }], value: subject, line },
      { k: 'assign', targets: [{ k: 'name', id: okName, line }], value: { k: 'const', v: false, line }, line },
    ];
    let cases = 0;
    while (this.toks[this.p].t !== 'dedent' && this.toks[this.p].t !== 'eof') {
      if (this.tok.t === 'nl') { this.p++; continue; }
      if (!this.isKw('case')) this.err("dentro de 'match' sólo puede haber bloques 'case'" + this.near());
      const ct = this.tok;
      this.p++;
      const pat = this.pattern();
      const guard = this.eatKw('if') ? this.expr() : null;
      this.expectOp(':');
      const body = this.block();
      const binds: [string, Expr][] = [];
      const test = this.patTest(pat, M, binds, ct.line);
      const l = ct.line;
      const core: Stmt[] = [{ k: 'assign', targets: [{ k: 'name', id: okName, line: l }], value: { k: 'const', v: true, line: l }, line: l }, ...body];
      const inner: Stmt[] = binds.map(([name, e]) => ({ k: 'assign', targets: [{ k: 'name', id: name, line: l }], value: e, line: l }) as Stmt);
      if (guard) inner.push({ k: 'if', test: guard, body: core, orelse: [], line: l });
      else inner.push(...core);
      const notOk: Expr = { k: 'unary', op: 'not', e: { k: 'name', id: okName, line: l }, line: l };
      out.push({ k: 'if', test: { k: 'bool', op: 'and', l: notOk, r: test, line: l }, body: inner, orelse: [], line: l });
      cases++;
    }
    if (!cases) this.err("'match' necesita al menos un 'case'");
    if (this.toks[this.p].t === 'dedent') this.p++;
    return out;
  }

  pattern(): Pat {
    const first = this.orPattern();
    if (!this.isOp(',')) return first;
    const items = [first];
    while (this.eatOp(',')) {
      if (this.isOp(':') || this.isKw('if')) break;
      items.push(this.orPattern());
    }
    return this.seqPat(items);
  }

  private seqPat(items: Pat[]): Pat {
    let star: string | null | undefined;
    const plain: Pat[] = [];
    items.forEach((it, i) => {
      if (it.k === 'cap' && it.name.startsWith('*')) {
        if (i !== items.length - 1) this.err('en un patrón, *resto sólo puede ir al final');
        star = it.name.slice(1) === '_' ? null : it.name.slice(1);
      } else plain.push(it);
    });
    return { k: 'seq', items: plain, star };
  }

  orPattern(): Pat {
    const alts = [this.closedPattern()];
    while (this.eatOp('|')) alts.push(this.closedPattern());
    return alts.length === 1 ? alts[0] : { k: 'or', alts };
  }

  closedPattern(): Pat {
    const t = this.tok;
    const line = t.line;
    if (t.t === 'num') { this.p++; return { k: 'lit', e: { k: 'num', v: Number(t.v), line }, is: false }; }
    if (t.t === 'str') { this.p++; return { k: 'lit', e: { k: 'str', v: t.v, line }, is: false }; }
    if (t.t === 'op') {
      if (t.v === '-' && this.peek().t === 'num') { this.p++; const n = this.tok; this.p++; return { k: 'lit', e: { k: 'num', v: -Number(n.v), line }, is: false }; }
      if (t.v === '*') {
        this.p++;
        const nm = this.tok;
        if (nm.t !== 'name') this.err('tras * va un nombre: *resto');
        this.p++;
        return { k: 'cap', name: '*' + nm.v };
      }
      if (t.v === '(' || t.v === '[') {
        const close = t.v === '(' ? ')' : ']';
        this.p++;
        const items: Pat[] = [];
        let comma = false;
        while (!this.isOp(close)) {
          items.push(this.orPattern());
          if (!this.eatOp(',')) break;
          comma = true;
        }
        this.expectOp(close);
        if (close === ')' && items.length === 1 && !comma) return items[0];
        return this.seqPat(items);
      }
      if (t.v === '{') {
        this.p++;
        const keys: Expr[] = [];
        const pats: Pat[] = [];
        while (!this.isOp('}')) {
          const kt = this.tok;
          if (kt.t !== 'str' && kt.t !== 'num') this.err('en un patrón de diccionario las claves deben ser textos o números');
          this.p++;
          keys.push(kt.t === 'str' ? { k: 'str', v: kt.v, line } : { k: 'num', v: Number(kt.v), line });
          this.expectOp(':');
          pats.push(this.orPattern());
          if (!this.eatOp(',')) break;
        }
        this.expectOp('}');
        return { k: 'map', keys, pats };
      }
    }
    if (t.t === 'name') {
      if (t.v === 'None' || t.v === 'True' || t.v === 'False') {
        this.p++;
        return { k: 'lit', e: { k: 'const', v: t.v === 'None' ? null : t.v === 'True', line }, is: true };
      }
      if (isKeyword(t.v)) this.err(`'${t.v}' no puede usarse en un patrón`);
      this.p++;
      if (t.v === '_' ) return { k: 'any' };
      if (this.isOp('(')) this.err('los patrones de clase (Tipo(...)) no están disponibles en PyGrid');
      if (this.isOp('.')) {
        let e: Expr = { k: 'name', id: t.v, line };
        while (this.eatOp('.')) e = { k: 'attr', obj: e, name: this.ident(), line };
        return { k: 'val', e };
      }
      return { k: 'cap', name: t.v };
    }
    return this.err('patrón no válido' + this.near());
  }

  /** condición que comprueba el patrón; las capturas se añaden a binds */
  patTest(p: Pat, E: Expr, binds: [string, Expr][], line: number): Expr {
    const T: Expr = { k: 'const', v: true, line };
    const and = (a: Expr, b: Expr): Expr => (a.k === 'const' && a.v === true ? b : b.k === 'const' && b.v === true ? a : { k: 'bool', op: 'and', l: a, r: b, line });
    switch (p.k) {
      case 'any': return T;
      case 'cap':
        if (binds.some(([n]) => n === p.name)) this.err(`el nombre '${p.name}' aparece dos veces en el patrón`);
        binds.push([p.name, E]);
        return T;
      case 'lit': return { k: 'cmp', ops: [p.is ? 'is' : '=='], operands: [E, p.e], line };
      case 'val': return { k: 'cmp', ops: ['=='], operands: [E, p.e], line };
      case 'or': {
        let out: Expr | null = null;
        for (const a of p.alts) {
          const b: [string, Expr][] = [];
          const t = this.patTest(a, E, b, line);
          if (b.length) this.err('no se pueden capturar variables dentro de un patrón con |');
          out = out ? { k: 'bool', op: 'or', l: out, r: t, line } : t;
        }
        return out!;
      }
      case 'seq': {
        let out: Expr = { k: 'call', fn: { k: 'name', id: '__es_secuencia', line }, args: [E, { k: 'num', v: p.items.length, line }, { k: 'const', v: p.star !== undefined, line }], kwargs: [], line };
        p.items.forEach((it, i) => {
          out = and(out, this.patTest(it, { k: 'sub', obj: E, index: { k: 'num', v: i, line }, line }, binds, line));
        });
        if (p.star) {
          binds.push([p.star, { k: 'call', fn: { k: 'name', id: 'list', line }, args: [{ k: 'sub', obj: E, index: { k: 'slice', lo: { k: 'num', v: p.items.length, line }, hi: null, step: null, line }, line }], kwargs: [], line }]);
        }
        return out;
      }
      case 'map': {
        let out: Expr = { k: 'call', fn: { k: 'name', id: '__tiene_claves', line }, args: [E, { k: 'list', items: p.keys, line }], kwargs: [], line };
        p.keys.forEach((k, i) => {
          out = and(out, this.patTest(p.pats[i], { k: 'sub', obj: E, index: k, line }, binds, line));
        });
        return out;
      }
    }
  }

  ifStmt(): Stmt {
    const t = this.tok;
    this.p++; // if / elif
    const test = this.expr();
    this.expectOp(':');
    const body = this.block();
    let orelse: Stmt[] = [];
    if (this.isKw('elif')) orelse = [this.ifStmt()];
    else if (this.isKw('else')) { this.p++; this.expectOp(':'); orelse = this.block(); }
    return { k: 'if', test, body, orelse, line: t.line };
  }

  simpleLine(): Stmt[] {
    const out: Stmt[] = [this.simple()];
    while (this.eatOp(';')) {
      if (this.tok.t === 'nl') break;
      out.push(this.simple());
    }
    if (this.tok.t === 'nl') this.p++;
    else if (this.tok.t !== 'eof' && this.tok.t !== 'dedent') this.err('instrucción inválida' + this.near());
    return out;
  }

  simple(): Stmt {
    const t = this.tok;
    const line = t.line;
    if (t.t === 'name') {
      if (UNSUPPORTED[t.v]) this.err(UNSUPPORTED[t.v]);
      switch (t.v) {
        case 'pass': this.p++; return { k: 'pass', line };
        case 'break': this.p++; return { k: 'break', line };
        case 'continue': this.p++; return { k: 'continue', line };
        case 'return': {
          this.p++;
          const value = this.endOfSimple() ? null : this.exprList();
          return { k: 'return', value, line };
        }
        case 'global':
        case 'nonlocal': {
          this.p++;
          const names = [this.ident()];
          while (this.eatOp(',')) names.push(this.ident());
          return { k: t.v, names, line } as Stmt;
        }
        case 'raise': {
          this.p++;
          const exc = this.endOfSimple() ? null : this.expr();
          return { k: 'raise', exc, line };
        }
        case 'del': {
          this.p++;
          const targets = [this.expr()];
          while (this.eatOp(',')) targets.push(this.expr());
          return { k: 'del', targets, line };
        }
        case 'assert': {
          this.p++;
          const test = this.expr();
          const msg = this.eatOp(',') ? this.expr() : null;
          return { k: 'assert', test, msg, line };
        }
        case 'import': {
          this.p++;
          const names: { name: string; as: string | null }[] = [];
          do {
            const name = this.dotted();
            const as = this.eatKw('as') ? this.ident() : null;
            names.push({ name, as });
          } while (this.eatOp(','));
          return { k: 'import', names, line };
        }
        case 'from': {
          this.p++;
          const module = this.dotted();
          this.expectKw('import');
          const names: { name: string; as: string | null }[] = [];
          if (this.eatOp('*')) {
            names.push({ name: '*', as: null });
          } else {
            const paren = this.eatOp('(');
            do {
              if (paren && this.isOp(')')) break;
              const name = this.ident();
              const as = this.eatKw('as') ? this.ident() : null;
              names.push({ name, as });
            } while (this.eatOp(','));
            if (paren) this.expectOp(')');
          }
          return { k: 'from', module, names, line };
        }
      }
    }
    // expresión / asignación
    const first = this.exprList(true);
    if (this.tok.t === 'op') {
      const op = this.tok.v;
      if (op === '=') {
        const targets: Expr[] = [first];
        let value: Expr = first;
        while (this.eatOp('=')) {
          value = this.exprList(true);
          targets.push(value);
        }
        targets.pop();
        for (const tg of targets) this.checkTarget(tg);
        return { k: 'assign', targets, value, line };
      }
      if (['+=', '-=', '*=', '/=', '//=', '%=', '**='].includes(op)) {
        this.p++;
        this.checkTarget(first, true);
        const value = this.exprList();
        return { k: 'aug', target: first, op: op.slice(0, -1), value, line };
      }
      if (op === ':') {
        // anotación de tipo: x: int = 3
        if (first.k === 'name') {
          this.p++;
          this.expr();
          if (this.eatOp('=')) return { k: 'assign', targets: [first], value: this.exprList(), line };
          return { k: 'pass', line };
        }
      }
    }
    return { k: 'expr', e: first, line };
  }

  endOfSimple(): boolean {
    return this.tok.t === 'nl' || this.tok.t === 'eof' || this.isOp(';') || this.tok.t === 'dedent';
  }

  dotted(): string {
    let s = this.ident();
    while (this.eatOp('.')) s += '.' + this.ident();
    return s;
  }

  checkTarget(e: Expr, single = false): void {
    if (e.k === 'name' || e.k === 'sub' || e.k === 'attr') return;
    if (!single && (e.k === 'tuple' || e.k === 'list')) {
      for (const it of e.items) this.checkTarget(it.k === 'star' ? it.e : it);
      return;
    }
    const what = e.k === 'call' ? 'una llamada a función' : e.k === 'num' || e.k === 'str' ? 'un literal' : 'esta expresión';
    throw new PySyntaxError(`SyntaxError: no se puede asignar a ${what}`, e.line);
  }

  params(close: string): Param[] {
    const out: Param[] = [];
    let afterStar = false;
    let afterKw = false;
    while (!this.isOp(close)) {
      if (afterKw) this.err('**kwargs tiene que ser el último parámetro');
      if (this.eatOp('**')) {
        const name = this.ident();
        if (out.some((p) => p.name === name)) this.err(`parámetro '${name}' repetido`);
        out.push({ name, def: null, kind: 'kwargs' });
        afterKw = true;
        if (!this.eatOp(',')) break;
        continue;
      }
      if (this.eatOp('*')) {
        if (afterStar) this.err('sólo puede haber un *args');
        const name = this.ident();
        if (out.some((p) => p.name === name)) this.err(`parámetro '${name}' repetido`);
        out.push({ name, def: null, kind: 'args' });
        afterStar = true;
        if (!this.eatOp(',')) break;
        continue;
      }
      const name = this.ident();
      if (close === ')' && this.eatOp(':')) this.expr();
      let def: Expr | null = null;
      if (this.eatOp('=')) def = this.expr();
      else if (!afterStar && out.some((p) => p.def)) this.err('un parámetro sin valor por defecto no puede ir después de uno con valor');
      if (out.some((p) => p.name === name)) this.err(`parámetro '${name}' repetido`);
      out.push(afterStar ? { name, def, kind: 'kwonly' } : { name, def });
      if (!this.eatOp(',')) break;
    }
    return out;
  }

  targetList(): Expr {
    const line = this.tok.line;
    const first = this.bitOr();
    if (!this.isOp(',')) { this.checkTarget(first); return first; }
    const items = [first];
    while (this.eatOp(',')) {
      if (this.isKw('in')) break;
      items.push(this.bitOr());
    }
    const t: Expr = { k: 'tuple', items, line };
    this.checkTarget(t);
    return t;
  }

  // lista de expresiones separada por comas → tupla
  exprList(allowStar = false): Expr {
    const line = this.tok.line;
    const first = allowStar && this.isOp('*') ? this.starExpr() : this.expr();
    if (!this.isOp(',')) return first;
    const items = [first];
    while (this.eatOp(',')) {
      if (this.endOfSimple() || this.isOp('=') || this.isOp(':') || this.isOp(')')) break;
      items.push(allowStar && this.isOp('*') ? this.starExpr() : this.expr());
    }
    return { k: 'tuple', items, line };
  }

  starExpr(): Expr {
    const line = this.tok.line;
    this.expectOp('*');
    return { k: 'star', e: this.orExpr(), line };
  }

  expr(): Expr {
    const line = this.tok.line;
    if (this.isKw('lambda')) {
      this.p++;
      const params = this.params(':');
      this.expectOp(':');
      const body = this.expr();
      return { k: 'lambda', params, body, line };
    }
    const e = this.orExpr();
    if (this.isKw('if')) {
      // expresión condicional (no confundir con comprensiones, que se gestionan antes)
      this.p++;
      const test = this.orExpr();
      this.expectKw('else');
      const orelse = this.expr();
      return { k: 'ifexp', test, body: e, orelse, line };
    }
    return e;
  }

  orExpr(): Expr {
    let l = this.andExpr();
    while (this.isKw('or')) {
      const line = this.tok.line;
      this.p++;
      l = { k: 'bool', op: 'or', l, r: this.andExpr(), line };
    }
    return l;
  }

  andExpr(): Expr {
    let l = this.notExpr();
    while (this.isKw('and')) {
      const line = this.tok.line;
      this.p++;
      l = { k: 'bool', op: 'and', l, r: this.notExpr(), line };
    }
    return l;
  }

  notExpr(): Expr {
    if (this.isKw('not')) {
      const line = this.tok.line;
      this.p++;
      return { k: 'unary', op: 'not', e: this.notExpr(), line };
    }
    return this.comparison();
  }

  comparison(): Expr {
    const line = this.tok.line;
    const first = this.bitOr();
    const ops: string[] = [];
    const operands: Expr[] = [first];
    while (true) {
      const t = this.tok;
      let op: string | null = null;
      if (t.t === 'op' && ['<', '>', '==', '!=', '<=', '>='].includes(t.v)) { op = t.v; this.p++; }
      else if (this.isKw('in')) { op = 'in'; this.p++; }
      else if (this.isKw('not') && this.peek().t === 'name' && this.peek().v === 'in') { op = 'not in'; this.p += 2; }
      else if (this.isKw('is')) {
        this.p++;
        op = this.eatKw('not') ? 'is not' : 'is';
      } else if (t.t === 'op' && t.v === '=' && this.peek().t !== 'op') {
        // pista para '=' en condición: se detecta en el nivel de sentencia si procede
        break;
      }
      if (!op) break;
      ops.push(op);
      operands.push(this.bitOr());
    }
    if (!ops.length) return first;
    return { k: 'cmp', ops, operands, line };
  }

  bitOr(): Expr { return this.binLevel(['|'], () => this.bitXor()); }
  bitXor(): Expr { return this.binLevel(['^'], () => this.bitAnd()); }
  bitAnd(): Expr { return this.binLevel(['&'], () => this.shift()); }
  shift(): Expr { return this.binLevel(['<<', '>>'], () => this.arith()); }
  arith(): Expr { return this.binLevel(['+', '-'], () => this.term()); }
  term(): Expr { return this.binLevel(['*', '/', '//', '%'], () => this.factor()); }

  binLevel(ops: string[], next: () => Expr): Expr {
    let l = next();
    while (this.tok.t === 'op' && ops.includes(this.tok.v)) {
      const line = this.tok.line;
      const op = this.tok.v;
      this.p++;
      l = { k: 'bin', op, l, r: next(), line };
    }
    return l;
  }

  factor(): Expr {
    const t = this.tok;
    if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '~')) {
      this.p++;
      const e = this.factor();
      if (t.v === '-' && e.k === 'num') return { k: 'num', v: -e.v, line: t.line };
      return { k: 'unary', op: t.v, e, line: t.line };
    }
    return this.power();
  }

  power(): Expr {
    const base = this.primary();
    if (this.isOp('**')) {
      const line = this.tok.line;
      this.p++;
      return { k: 'bin', op: '**', l: base, r: this.factor(), line };
    }
    return base;
  }

  primary(): Expr {
    let e = this.atom();
    while (true) {
      const line = this.tok.line;
      if (this.eatOp('(')) {
        const args: Expr[] = [];
        const kwargs: { name: string; value: Expr }[] = [];
        while (!this.isOp(')')) {
          if (this.eatOp('**')) {
            kwargs.push({ name: '**', value: this.expr() });
          } else if (this.tok.t === 'name' && this.peek().t === 'op' && this.peek().v === '=') {
            const name = this.ident();
            this.p++;
            kwargs.push({ name, value: this.expr() });
          } else if (this.isOp('*')) {
            if (kwargs.length) this.err('*lista tiene que ir antes de los argumentos con nombre');
            args.push(this.starExpr());
          } else {
            if (kwargs.length) this.err('un argumento posicional no puede ir después de uno con nombre');
            const a = this.expr();
            if (this.isKw('for')) {
              args.push({ k: 'comp', kind: 'list', elt: a, gens: this.compGens(), line: a.line });
            } else args.push(a);
          }
          if (!this.eatOp(',')) break;
        }
        this.expectOp(')', "falta cerrar el paréntesis ')'" + this.near());
        e = { k: 'call', fn: e, args, kwargs, line };
      } else if (this.eatOp('[')) {
        const index = this.subscript();
        this.expectOp(']', "falta cerrar el corchete ']'" + this.near());
        e = { k: 'sub', obj: e, index, line };
      } else if (this.eatOp('.')) {
        const t = this.tok;
        if (t.t !== 'name') this.err('se esperaba un nombre tras el punto');
        this.p++;
        e = { k: 'attr', obj: e, name: t.v, line };
      } else break;
    }
    return e;
  }

  subscript(): Expr {
    const line = this.tok.line;
    const part = (): Expr | null => (this.isOp(':') || this.isOp(']') || this.isOp(',') ? null : this.expr());
    const one = (): Expr => {
      const lo = part();
      if (!this.isOp(':')) {
        if (!lo) this.err('índice vacío');
        return lo!;
      }
      this.p++;
      const hi = part();
      let step: Expr | null = null;
      if (this.eatOp(':')) step = part();
      return { k: 'slice', lo, hi, step, line };
    };
    const first = one();
    if (!this.isOp(',')) return first;
    const items = [first];
    while (this.eatOp(',')) { if (this.isOp(']')) break; items.push(one()); }
    return { k: 'tuple', items, line };
  }

  compGens(): CompGen[] {
    const gens: CompGen[] = [];
    while (this.eatKw('for')) {
      const target = this.targetList();
      this.expectKw('in');
      const iter = this.orExpr();
      const ifs: Expr[] = [];
      while (this.isKw('if')) { this.p++; ifs.push(this.orExprNoCond()); }
      gens.push({ target, iter, ifs });
    }
    return gens;
  }

  orExprNoCond(): Expr { return this.orExpr(); }

  atom(): Expr {
    const t = this.tok;
    const line = t.line;
    switch (t.t) {
      case 'num':
        this.p++;
        return { k: 'num', v: Number(t.v), line };
      case 'str':
      case 'fstr': {
        // concatenación implícita de literales
        const parts: (string | { e: Expr; spec: string; conv: string })[] = [];
        let anyF = false;
        while (this.tok.t === 'str' || this.tok.t === 'fstr') {
          const s = this.tok;
          this.p++;
          if (s.t === 'fstr') { anyF = true; parts.push(...parseFString(s.v, s.line)); }
          else parts.push(s.v);
        }
        if (!anyF) return { k: 'str', v: parts.join(''), line };
        return { k: 'fstr', parts, line };
      }
      case 'name': {
        if (t.v === 'True' || t.v === 'False') { this.p++; return { k: 'const', v: t.v === 'True', line }; }
        if (t.v === 'None') { this.p++; return { k: 'const', v: null, line }; }
        if (isKeyword(t.v)) {
          if (UNSUPPORTED[t.v]) this.err(UNSUPPORTED[t.v]);
          this.err(`'${t.v}' no puede usarse aquí`);
        }
        this.p++;
        return { k: 'name', id: t.v, line };
      }
      case 'op': {
        if (t.v === '(') {
          this.p++;
          if (this.eatOp(')')) return { k: 'tuple', items: [], line };
          const first = this.isOp('*') ? this.starExpr() : this.expr();
          if (this.isKw('for')) {
            const gens = this.compGens();
            this.expectOp(')');
            return { k: 'comp', kind: 'list', elt: first, gens, line };
          }
          if (this.eatOp(')')) return first;
          const items = [first];
          while (this.eatOp(',')) {
            if (this.isOp(')')) break;
            items.push(this.isOp('*') ? this.starExpr() : this.expr());
          }
          this.expectOp(')', "falta cerrar el paréntesis ')'" + this.near());
          return { k: 'tuple', items, line };
        }
        if (t.v === '[') {
          this.p++;
          if (this.eatOp(']')) return { k: 'list', items: [], line };
          const first = this.isOp('*') ? this.starExpr() : this.expr();
          if (this.isKw('for')) {
            const gens = this.compGens();
            this.expectOp(']');
            return { k: 'comp', kind: 'list', elt: first, gens, line };
          }
          const items = [first];
          while (this.eatOp(',')) {
            if (this.isOp(']')) break;
            items.push(this.isOp('*') ? this.starExpr() : this.expr());
          }
          this.expectOp(']', "falta cerrar el corchete ']'" + this.near());
          return { k: 'list', items, line };
        }
        if (t.v === '{') {
          this.p++;
          if (this.eatOp('}')) return { k: 'dict', keys: [], values: [], line };
          const first = this.expr();
          if (this.eatOp(':')) {
            const v0 = this.expr();
            if (this.isKw('for')) {
              const gens = this.compGens();
              this.expectOp('}');
              return { k: 'comp', kind: 'dict', elt: first, val: v0, gens, line };
            }
            const keys = [first];
            const values = [v0];
            while (this.eatOp(',')) {
              if (this.isOp('}')) break;
              keys.push(this.expr());
              this.expectOp(':');
              values.push(this.expr());
            }
            this.expectOp('}', "falta cerrar la llave '}'" + this.near());
            return { k: 'dict', keys, values, line };
          }
          if (this.isKw('for')) {
            const gens = this.compGens();
            this.expectOp('}');
            return { k: 'comp', kind: 'set', elt: first, gens, line };
          }
          const items = [first];
          while (this.eatOp(',')) {
            if (this.isOp('}')) break;
            items.push(this.expr());
          }
          this.expectOp('}', "falta cerrar la llave '}'" + this.near());
          return { k: 'set', items, line };
        }
        break;
      }
      case 'indent':
        this.err('IndentationError: sangría inesperada');
    }
    this.err('expresión inválida' + this.near());
  }
}

function isKeyword(v: string): boolean {
  return [
    'False', 'None', 'True', 'and', 'as', 'break', 'continue', 'def', 'del', 'elif', 'else', 'except',
    'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or',
    'pass', 'raise', 'return', 'try', 'while', 'class', 'with', 'yield', 'assert', 'async', 'await',
  ].includes(v);
}

function parseFString(s: string, line: number): (string | { e: Expr; spec: string; conv: string })[] {
  const out: (string | { e: Expr; spec: string; conv: string })[] = [];
  let i = 0;
  let lit = '';
  while (i < s.length) {
    const c = s[i];
    if (c === '{') {
      if (s[i + 1] === '{') { lit += '{'; i += 2; continue; }
      if (lit) { out.push(lit); lit = ''; }
      let depth = 1;
      let j = i + 1;
      let inStr: string | null = null;
      while (j < s.length && depth > 0) {
        const d = s[j];
        if (inStr) { if (d === inStr) inStr = null; }
        else if (d === '"' || d === "'") inStr = d;
        else if (d === '{' || d === '[' || d === '(') depth++;
        else if (d === '}' || d === ']' || d === ')') depth--;
        if (depth === 0) break;
        j++;
      }
      if (depth !== 0) throw new PySyntaxError("SyntaxError: f-string: falta '}'", line);
      let inner = s.slice(i + 1, j);
      let spec = '';
      let conv = '';
      // separar especificador de formato ':...' al nivel superior
      let d2 = 0;
      for (let k = 0; k < inner.length; k++) {
        const ch = inner[k];
        if ('([{'.includes(ch)) d2++;
        else if (')]}'.includes(ch)) d2--;
        else if (ch === ':' && d2 === 0) { spec = inner.slice(k + 1); inner = inner.slice(0, k); break; }
        else if (ch === '!' && d2 === 0 && inner[k + 1] !== '=') { conv = inner.slice(k + 1, k + 2); inner = inner.slice(0, k); break; }
      }
      if (inner.trim().endsWith('=')) {
        // f"{x=}"
        const exprSrc = inner.trim().slice(0, -1);
        out.push(inner.trim());
        const ex = parseExprOnly(exprSrc, line);
        out.push({ e: ex, spec, conv: conv || 'r' });
      } else {
        out.push({ e: parseExprOnly(inner, line), spec, conv });
      }
      i = j + 1;
      continue;
    }
    if (c === '}') {
      if (s[i + 1] === '}') { lit += '}'; i += 2; continue; }
      throw new PySyntaxError("SyntaxError: f-string: '}' suelta", line);
    }
    lit += c;
    i++;
  }
  if (lit) out.push(lit);
  return out;
}

function parseExprOnly(src: string, line: number): Expr {
  if (!src.trim()) throw new PySyntaxError('SyntaxError: f-string: expresión vacía', line);
  const toks = tokenize(src.trim()).map((t) => ({ ...t, line }));
  const p = new Parser(toks);
  const e = p.expr();
  if (p.tok.t !== 'nl' && p.tok.t !== 'eof') throw new PySyntaxError('SyntaxError: f-string: expresión inválida', line);
  return e;
}
