// Ejecución de los retos de consola de la Academia (sin mundo): print, enviar() e input().
import { toPy, type J } from '../lang/interop';
import { err, pyRepr, pyStr, type Value } from '../lang/values';
import { VM, type Host } from '../lang/vm';

export interface ConsoleRun {
  prints: string[];
  sent: Value[];
  error: { type: string; msg: string; line: number } | null;
  instr: number;
}

/** límite total de instrucciones por ejecución (evita bucles infinitos) */
export const CONSOLE_BUDGET = 400_000;

export function runConsole(code: string, preset: Record<string, J> = {}, inputs: string[] = [], modules: Record<string, string> = {}): ConsoleRun {
  const prints: string[] = [];
  const sent: Value[] = [];
  const queue = [...inputs];
  const globals: Record<string, Value> = {};
  for (const [k, v] of Object.entries(preset)) globals[k] = toPy(v);
  const host: Host = {
    print: (text) => { if (prints.length < 500) prints.push(text); },
    globals,
    functions: {
      enviar: (args) => {
        if (args.length !== 1) err('TypeError', 'enviar(valor) necesita exactamente un valor');
        sent.push(args[0]);
        prints.length < 500 && prints.push(`📡 enviado: ${pyRepr(args[0])}`);
        return null;
      },
      input: (args) => {
        if (args.length) prints.push(pyStr(args[0]));
        if (!queue.length) err('ValueError', 'input(): no quedan más datos de entrada');
        const v = queue.shift()!;
        prints.push(`⌨ ${v}`);
        return v;
      },
    },
  };
  const mods = Object.fromEntries(Object.entries(modules).map(([k, v]) => [k.replace(/\.py$/, ''), v]));
  const vm = new VM({ main: code, modules: mods }, host, 7);
  try {
    vm.start();
  } catch (e) {
    const r = vm.fatal(e);
    return { prints, sent, error: r.s === 'error' ? { type: r.type, msg: r.msg, line: r.line } : null, instr: 0 };
  }
  let used = 0;
  for (;;) {
    const r = vm.run(20_000);
    used = vm.instrTotal;
    if (r.s === 'done') return { prints, sent, error: null, instr: used };
    if (r.s === 'error') return { prints, sent, error: { type: r.type, msg: r.msg, line: r.line }, instr: used };
    if (r.s === 'action') { vm.resume(null); continue; }
    if (used > CONSOLE_BUDGET) {
      return { prints, sent, error: { type: 'TiempoAgotado', msg: 'el programa no termina: ¿hay un bucle infinito?', line: vm.lastLine }, instr: used };
    }
  }
}
