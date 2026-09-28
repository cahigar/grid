// PyGrid — tokenizador de un subconjunto de Python 3 (con INDENT/DEDENT).

export type TokType = 'name' | 'num' | 'str' | 'fstr' | 'op' | 'nl' | 'indent' | 'dedent' | 'eof';

export interface Token {
  t: TokType;
  v: string;
  line: number;
  col: number;
}

export class PySyntaxError extends Error {
  constructor(msg: string, public line: number, public col = 0) {
    super(msg);
  }
}

export const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'break', 'continue', 'def', 'del', 'elif', 'else',
  'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'class', 'with', 'yield', 'assert', 'async', 'await',
]);

const OPS3 = ['**=', '//=', '>>=', '<<=', '...'];
const OPS2 = ['**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '->', '<<', '>>', '&=', '|=', '^='];
const OPS1 = '+-*/%<>=()[]{},:.;@&|^~';

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  const indents = [0];
  let depth = 0; // profundidad de paréntesis
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let atLineStart = true;
  src = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const n = src.length;

  const push = (t: TokType, v: string, col: number) => toks.push({ t, v, line, col });

  while (i < n) {
    if (atLineStart && depth === 0) {
      // medir indentación
      let col = 0;
      let j = i;
      while (j < n && src[j] === ' ') { col++; j++; }
      if (j >= n) { i = j; break; }
      if (src[j] === '\n' || src[j] === '#') {
        // línea vacía o comentario
        while (j < n && src[j] !== '\n') j++;
        i = j + 1; line++; lineStart = i;
        continue;
      }
      if (src[j] === '\\' && src[j + 1] === '\n') { i = j + 2; line++; lineStart = i; continue; }
      const cur = indents[indents.length - 1];
      if (col > cur) {
        indents.push(col);
        push('indent', '', col);
      } else if (col < cur) {
        while (indents.length && col < indents[indents.length - 1]) {
          indents.pop();
          push('dedent', '', col);
        }
        if (indents[indents.length - 1] !== col) {
          throw new PySyntaxError('IndentationError: la sangría no coincide con ningún nivel anterior', line, col);
        }
      }
      i = j;
      atLineStart = false;
    }
    const c = src[i];
    const col = i - lineStart;
    if (c === '\n') {
      if (depth === 0) { push('nl', '', col); atLineStart = true; }
      i++; line++; lineStart = i;
      continue;
    }
    if (c === ' ') { i++; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; line++; lineStart = i; continue; }

    // números
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < n && /[0-9_]/.test(src[j])) j++;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] ?? '')) { j++; while (j < n && /[0-9_]/.test(src[j])) j++; }
      else if (src[j] === '.' && !/[a-zA-Z_]/.test(src[j + 1] ?? '')) j++;
      if (/[eE]/.test(src[j] ?? '') && /[-+0-9]/.test(src[j + 1] ?? '')) {
        j++; if (/[-+]/.test(src[j])) j++;
        while (j < n && /[0-9]/.test(src[j])) j++;
      }
      push('num', src.slice(i, j).replace(/_/g, ''), col);
      i = j;
      continue;
    }

    // nombres (y prefijos de string f"", r"")
    if (/[A-Za-z_À-ɏ]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_À-ɏ]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const q = src[j];
      if ((q === '"' || q === "'") && /^(f|F|r|R|fr|rf|Fr|fR|Rf|rF|FR|RF|b|B|u|U)$/.test(word)) {
        const isF = /f/i.test(word);
        const raw = /r/i.test(word);
        i = j;
        const s = readString(raw);
        push(isF ? 'fstr' : 'str', s, col);
        continue;
      }
      push('name', word, col);
      i = j;
      continue;
    }

    if (c === '"' || c === "'") {
      push('str', readString(false), col);
      continue;
    }

    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (OPS3.includes(three)) { push('op', three, col); i += 3; continue; }
    if (OPS2.includes(two)) { push('op', two, col); i += 2; continue; }
    if (OPS1.includes(c)) {
      if ('([{'.includes(c)) depth++;
      if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
      push('op', c, col);
      i++;
      continue;
    }
    if (c === '!') throw new PySyntaxError("SyntaxError: '!' no es válido (¿querías '!=' o 'not'?)", line, col);
    throw new PySyntaxError(`SyntaxError: carácter no válido '${c}'`, line, col);
  }

  function readString(raw: boolean): string {
    const q = src[i];
    const triple = src.slice(i, i + 3) === q + q + q;
    const startLine = line;
    i += triple ? 3 : 1;
    let out = '';
    while (true) {
      if (i >= n) throw new PySyntaxError('SyntaxError: cadena de texto sin cerrar', startLine);
      const ch = src[i];
      if (triple) {
        if (src.slice(i, i + 3) === q + q + q) { i += 3; break; }
      } else if (ch === q) { i++; break; }
      if (ch === '\n') {
        if (!triple) throw new PySyntaxError('SyntaxError: cadena de texto sin cerrar', startLine);
        line++; lineStart = i + 1;
      }
      if (ch === '\\' && !raw) {
        const e = src[i + 1];
        const map: Record<string, string> = { n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"', r: '\r', '0': '\0' };
        if (e === '\n') { i += 2; line++; lineStart = i; continue; }
        if (e in map) { out += map[e]; i += 2; continue; }
        out += '\\'; i++; continue;
      }
      out += ch;
      i++;
    }
    return out;
  }

  if (toks.length && toks[toks.length - 1].t !== 'nl') push('nl', '', 0);
  while (indents.length > 1) { indents.pop(); push('dedent', '', 0); }
  push('eof', '', 0);
  return toks;
}
