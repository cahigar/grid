// Editor de código integrado (CodeMirror 6) con autocompletado de primitivas y diagnóstico PyGrid.
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { python, localCompletionSource } from '@codemirror/lang-python';
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView, crosshairCursor, drawSelection, highlightActiveLine, highlightActiveLineGutter, hoverTooltip, keymap,
  lineNumbers, rectangularSelection,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { API } from '../../sim/api';
import { checkSyntax } from '../../sim/lang/compiler';

const theme = EditorView.theme(
  {
    '&': { color: '#dbe7e4', backgroundColor: 'transparent', height: '100%', fontSize: '13.5px' },
    '.cm-content': { fontFamily: '"JetBrains Mono", ui-monospace, monospace', caretColor: '#2fd4c0', padding: '10px 0' },
    '.cm-scroller': { fontFamily: '"JetBrains Mono", ui-monospace, monospace', lineHeight: '1.55' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#2fd4c0', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(47,212,192,0.22) !important' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#4f6b69', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#9fd9d0' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.035)' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(242,169,59,0.25)', outline: 'none' },
    '.cm-tooltip': { backgroundColor: '#12211f', border: '1px solid rgba(47,212,192,0.35)', borderRadius: '8px', color: '#dbe7e4' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'rgba(47,212,192,0.25)', color: '#fff' },
    '.cm-completionDetail': { color: '#8fb3ad', fontStyle: 'normal', marginLeft: '8px' },
    '.cm-completionInfo': { maxWidth: '340px', padding: '8px 10px', lineHeight: '1.45' },
    '.cm-diagnostic-error': { borderLeft: '3px solid #ff6b5a' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #ff6b5a' },
    '.cm-panels': { backgroundColor: '#0f1c1b', color: '#dbe7e4' },
    '.cm-runtime-line': { backgroundColor: 'rgba(255,107,90,0.14)' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: '#f2a93b', fontWeight: '600' },
  { tag: [t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: '#f2a93b', fontWeight: '600' },
  { tag: t.comment, color: '#5f7d78', fontStyle: 'italic' },
  { tag: t.string, color: '#a9dc76' },
  { tag: t.number, color: '#ffb480' },
  { tag: [t.bool, t.null], color: '#ffb480' },
  { tag: t.function(t.variableName), color: '#5fe8ff' },
  { tag: t.definition(t.variableName), color: '#e9f3f1' },
  { tag: t.function(t.definition(t.variableName)), color: '#2fd4c0', fontWeight: '600' },
  { tag: t.propertyName, color: '#9fd9d0' },
  { tag: t.operator, color: '#c3d6d2' },
  { tag: t.variableName, color: '#e9f3f1' },
  { tag: t.special(t.string), color: '#c8e6a0' },
]);

const BUILTIN_DOCS: [string, string][] = [
  ['print', 'print(valor, ...) · escribe en el log'], ['len', 'len(x) · longitud'], ['range', 'range(n) / range(a, b, paso)'],
  ['abs', 'abs(x)'], ['min', 'min(a, b) / min(lista, key=…)'], ['max', 'max(a, b) / max(lista, key=…)'], ['sum', 'sum(lista)'],
  ['sorted', 'sorted(lista, key=…, reverse=False)'], ['enumerate', 'enumerate(lista)'], ['zip', 'zip(a, b)'], ['list', 'list(x)'],
  ['dict', 'dict()'], ['set', 'set()'], ['tuple', 'tuple(x)'], ['int', 'int(x)'], ['float', 'float(x)'], ['str', 'str(x)'],
  ['round', 'round(x, decimales)'], ['any', 'any(lista)'], ['all', 'all(lista)'], ['isinstance', 'isinstance(x, tipo)'],
  ['nombre', 'nombre() · nombre de la unidad'],
];
const KEYWORDS = ['def', 'return', 'while', 'for', 'in', 'if', 'elif', 'else', 'break', 'continue', 'import', 'from', 'True', 'False', 'None', 'and', 'or', 'not', 'try', 'except', 'global', 'lambda', 'pass'];

export interface EditorHost {
  files: () => Record<string, string>;
  onChange: (name: string, src: string) => void;
  onRun: () => void;
  onSave: () => void;
  runtimeError: (file: string) => { line: number; msg: string } | null;
}

export class CodeEditor {
  view: EditorView;
  current = '';
  private states = new Map<string, EditorState>();

  constructor(parent: HTMLElement, private host: EditorHost) {
    this.view = new EditorView({ parent });
  }

  private extensions(): Extension[] {
    const host = this.host;
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      python(),
      syntaxHighlighting(highlight),
      theme,
      autocompletion({ override: [this.complete.bind(this), localCompletionSource], icons: false }),
      lintGutter(),
      linter((view) => this.lint(view), { delay: 350 }),
      hoverTooltip((view, pos) => {
        const w = view.state.wordAt(pos);
        if (!w) return null;
        const word = view.state.sliceDoc(w.from, w.to);
        const api = API.find((a) => a.name === word);
        if (!api) return null;
        return {
          pos: w.from, end: w.to, above: true,
          create: () => {
            const dom = document.createElement('div');
            dom.className = 'cm-api-tip';
            dom.innerHTML = apiHtml(api);
            return { dom };
          },
        };
      }),
      keymap.of([
        { key: 'Mod-Enter', run: () => { host.onRun(); return true; } },
        { key: 'Mod-s', run: () => { host.onSave(); return true; }, preventDefault: true },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) host.onChange(this.current, u.state.doc.toString());
      }),
    ];
  }

  open(name: string, src: string): void {
    if (this.current) this.states.set(this.current, this.view.state);
    this.current = name;
    let st = this.states.get(name);
    if (!st || st.doc.toString() !== src) {
      st = EditorState.create({ doc: src, extensions: this.extensions() });
    }
    this.view.setState(st);
  }

  setDoc(src: string): void {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: src } });
  }

  forget(name: string): void {
    this.states.delete(name);
  }

  goToLine(line: number): void {
    const doc = this.view.state.doc;
    const l = doc.line(Math.max(1, Math.min(doc.lines, line)));
    this.view.dispatch({ selection: { anchor: l.from, head: l.to }, scrollIntoView: true });
    this.view.focus();
  }

  refreshLint(): void {
    // fuerza un nuevo diagnóstico (p. ej. tras un error en ejecución)
    this.view.dispatch({});
  }

  private lint(view: EditorView): Diagnostic[] {
    const src = view.state.doc.toString();
    const out: Diagnostic[] = [];
    const e = checkSyntax(src);
    const doc = view.state.doc;
    if (e) {
      const line = doc.line(Math.max(1, Math.min(doc.lines, e.line)));
      out.push({ from: line.from, to: Math.max(line.from, line.to), severity: 'error', message: e.msg });
    }
    const rt = this.host.runtimeError(this.current);
    if (rt && rt.line <= doc.lines) {
      const line = doc.line(Math.max(1, rt.line));
      out.push({ from: line.from, to: Math.max(line.from, line.to), severity: 'error', message: 'En ejecución: ' + rt.msg });
    }
    return out;
  }

  private complete(ctx: CompletionContext): CompletionResult | null {
    // atributos de Recurso tras un punto
    const dot = ctx.matchBefore(/[A-Za-z_][\w]*\.\w*/);
    if (dot) {
      const after = dot.text.slice(dot.text.indexOf('.') + 1);
      const from = dot.to - after.length;
      const obj = dot.text.slice(0, dot.text.indexOf('.'));
      const mods = this.moduleDefs();
      if (mods[obj]) return { from, options: mods[obj].map((d) => ({ label: d, type: 'function', detail: `${obj}.py` })) };
      if (['math', 'random', 'heapq'].includes(obj)) {
        const std: Record<string, string[]> = {
          math: ['sqrt', 'floor', 'ceil', 'pi', 'inf', 'hypot', 'dist', 'atan2', 'sin', 'cos', 'log'],
          random: ['random', 'randint', 'choice', 'shuffle', 'uniform'],
          heapq: ['heappush', 'heappop', 'heapify'],
        };
        return { from, options: std[obj].map((d) => ({ label: d, type: 'function' })) };
      }
      const fields: Completion[] = ['tipo', 'x', 'y', 'cantidad', 'calidad'].map((f) => ({ label: f, type: 'property', detail: 'Recurso' }));
      const methods: Completion[] = ['append', 'pop', 'get', 'keys', 'values', 'items', 'sort', 'remove', 'insert', 'index', 'count', 'add', 'split', 'join', 'upper', 'lower']
        .map((m) => ({ label: m, type: 'method', boost: -5 }));
      return { from, options: [...fields, ...methods] };
    }
    const word = ctx.matchBefore(/\w+/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    // import de módulos propios
    const line = ctx.state.doc.lineAt(ctx.pos).text;
    if (/^\s*(from|import)\s+\w*$/.test(line.slice(0, ctx.pos - ctx.state.doc.lineAt(ctx.pos).from))) {
      const mods = Object.keys(this.host.files()).filter((f) => f !== this.current).map((f) => f.replace(/\.py$/, ''));
      return { from: word.from, options: [...mods, 'math', 'random', 'heapq'].map((m) => ({ label: m, type: 'namespace' })) };
    }
    const options: Completion[] = [
      ...API.map((a) => ({
        label: a.name, type: a.cat === 'Memoria' ? 'variable' : 'function', detail: a.sig, boost: 10,
        info: () => { const d = document.createElement('div'); d.innerHTML = apiHtml(a); return d; },
        apply: a.cat === 'Memoria' ? a.name : undefined,
      })),
      ...BUILTIN_DOCS.map(([n, d]) => ({ label: n, type: 'function', detail: d, boost: 2 })),
      ...KEYWORDS.map((k) => ({ label: k, type: 'keyword', boost: -2 })),
      ...Object.entries(this.moduleDefs()).flatMap(([mod, defs]) => defs.map((d) => ({ label: d, type: 'function', detail: `de ${mod}.py`, boost: 6 }))),
    ];
    return { from: word.from, options, validFor: /^\w*$/ };
  }

  private moduleDefs(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [name, src] of Object.entries(this.host.files())) {
      const defs = [...src.matchAll(/^def\s+([A-Za-z_]\w*)\s*\(/gm)].map((m) => m[1]);
      out[name.replace(/\.py$/, '')] = defs;
    }
    return out;
  }
}

export function apiHtml(a: (typeof API)[number]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<div class="api-sig">${esc(a.sig)}</div>
  <div class="api-desc">${esc(a.desc)}</div>
  <div class="api-meta"><span>↩ ${esc(a.returns)}</span><span>⏱ ${esc(a.time)}</span><span>ϟ ${esc(a.energy)}</span></div>
  ${a.example ? `<pre class="api-ex">${esc(a.example)}</pre>` : ''}`;
}
