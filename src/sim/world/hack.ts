// Mutaciones de código que aplica el dron hacker.
export type HackMode = 'invertir' | 'numero' | 'borrar';
export const HACK_MODES: HackMode[] = ['invertir', 'numero', 'borrar'];

export interface Mutation {
  src: string;
  line: number;
  before: string;
  after: string;
}

interface Tok {
  line: number;
  start: number; // índice absoluto
  end: number;
  kind: 'str' | 'num';
  text: string;
}

/** Recorre el código localizando literales de texto y números fuera de comentarios. */
function scan(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '"' || c === "'") {
      const triple = src.slice(i, i + 3) === c + c + c;
      const q = triple ? c + c + c : c;
      const start = i;
      i += q.length;
      while (i < src.length && src.slice(i, i + q.length) !== q) {
        if (src[i] === '\\') i++;
        if (src[i] === '\n') { if (!triple) break; line++; }
        i++;
      }
      i += q.length;
      if (!triple) out.push({ line, start, end: i, kind: 'str', text: src.slice(start, i) });
      continue;
    }
    if (/[0-9]/.test(c) && !/[A-Za-z_0-9.]/.test(src[i - 1] ?? '')) {
      const start = i;
      while (i < src.length && /[0-9]/.test(src[i])) i++;
      if (src[i] === '.' || /[A-Za-z_]/.test(src[i] ?? '')) { while (i < src.length && /[A-Za-z0-9_.]/.test(src[i])) i++; continue; }
      out.push({ line, start, end: i, kind: 'num', text: src.slice(start, i) });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) { while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++; continue; }
    i++;
  }
  return out;
}

const SWAP: Record<string, string> = { N: 'S', S: 'N', E: 'O', O: 'E' };

function lineText(src: string, line: number): string {
  return src.split('\n')[line - 1] ?? '';
}

export function mutate(src: string, mode: HackMode, rnd: () => number): Mutation | null {
  if (mode === 'invertir') {
    const cands = scan(src).filter((t) => t.kind === 'str' && /^(['"])[NSEOnseo]\1$/.test(t.text));
    if (!cands.length) return null;
    const t = cands[Math.floor(rnd() * cands.length)];
    const q = t.text[0];
    const letter = t.text[1].toUpperCase();
    const rep = q + SWAP[letter] + q;
    const out = src.slice(0, t.start) + rep + src.slice(t.end);
    return { src: out, line: t.line, before: lineText(src, t.line).trim(), after: lineText(out, t.line).trim() };
  }
  if (mode === 'numero') {
    const cands = scan(src).filter((t) => t.kind === 'num');
    if (!cands.length) return null;
    const t = cands[Math.floor(rnd() * cands.length)];
    const n = Number(t.text);
    const m = n === 0 ? 1 : rnd() < 0.5 ? n - 1 : n + 1;
    const out = src.slice(0, t.start) + String(m) + src.slice(t.end);
    return { src: out, line: t.line, before: lineText(src, t.line).trim(), after: lineText(out, t.line).trim() };
  }
  // borrar: un carácter visible de una línea de código
  const lines = src.split('\n');
  const cands = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.trim() && !l.trim().startsWith('#'));
  if (!cands.length) return null;
  const { l, i } = cands[Math.floor(rnd() * cands.length)];
  const idxs = [...l].map((ch, k) => (ch.trim() ? k : -1)).filter((k) => k >= 0);
  const k = idxs[Math.floor(rnd() * idxs.length)];
  const nl = l.slice(0, k) + l.slice(k + 1);
  lines[i] = nl;
  return { src: lines.join('\n'), line: i + 1, before: l.trim(), after: nl.trim() };
}
