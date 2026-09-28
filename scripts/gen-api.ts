// Genera docs/API.md a partir de src/sim/api.ts (fuente única).
import { writeFileSync } from 'node:fs';
import { API } from '../src/sim/api';

const cats = [...new Set(API.map((a) => a.cat))];
let md = '# G.R.I.D. — Primitivas del jugador\n\n> Generado automáticamente desde `src/sim/api.ts` (`npm run docs`).\n> El juego sólo ofrece primitivas básicas: el jugador construye sus propias abstracciones.\n\n';
for (const c of cats) {
  md += `## ${c}\n\n| Primitiva | Devuelve | Tiempo | Energía |\n|---|---|---|---|\n`;
  for (const a of API.filter((x) => x.cat === c)) md += `| \`${a.sig}\` | ${a.returns} | ${a.time} | ${a.energy} |\n`;
  md += '\n';
  for (const a of API.filter((x) => x.cat === c)) {
    md += `### \`${a.sig}\`\n\n${a.desc}\n\n`;
    if (a.example) md += '```python\n' + a.example + '\n```\n\n';
  }
}
md += `## Python disponible (PyGrid)\n\ndef (con valores por defecto, recursión y closures), lambda, if/elif/else, while, for, break, continue, pass, return, global, nonlocal, try/except/finally, raise, assert, listas, tuplas, diccionarios, sets, slicing, comprensiones, f-strings, desempaquetado, \`import\` / \`from … import …\` de tus módulos, y los módulos \`math\`, \`random\` (determinista) y \`heapq\`.\n\nNo disponible (a propósito): clases, generadores, \`with\`, \`open\`, \`eval\`, \`exec\`, \`input\`, red y sistema de archivos.\n\nLímites: 20 000 instrucciones entre dos acciones (si se superan, la unidad pausa 1 s «CPU saturada»), 200 llamadas anidadas, 100 000 elementos por lista/texto.\n`;
writeFileSync('docs/API.md', md);
console.log('docs/API.md generado:', API.length, 'primitivas');
