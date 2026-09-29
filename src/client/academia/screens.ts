// Pantallas de la Academia: mapa de rutas y retos (consola o mapa).
import { API, type ApiDoc } from '../../sim/api';
import { ALL_LEVELS, SECTIONS, levelById, sectionOf } from '../../sim/academia/content';
import { evaluate, mapGoal, type Evaluation, type Level, type MapLevel } from '../../sim/academia/engine';
import { explainError } from '../../sim/academia/errors';
import { addTime, exportCode, fmtTime, importCode, mergeProgress, points, totalSecs, totalStars, unlocked } from '../../sim/academia/progress';
import { reprJ } from '../../sim/lang/interop';
import { App } from '../app';
import { sound } from '../audio';
import { showLevelComplete } from '../ui/celebrate';
import { esc, page, toast, type Cleanup } from '../screens';
import { CodeEditor } from '../ui/editor';
import { AcademiaMapSession } from './session';
import { loadProgress, saveProgress } from './store';

const $ = <E extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as E;

const CONSOLE_API: ApiDoc[] = [
  { name: 'enviar', sig: 'enviar(valor)', cat: 'Base', desc: 'Envía tu resultado a la base. La base comprueba el último valor enviado.', returns: 'None', time: '0', energy: '0', example: 'enviar("hola")' },
  { name: 'print', sig: 'print(valor, …)', cat: 'Depuración', desc: 'Muestra valores en la consola para ver qué está pasando.', returns: 'None', time: '0', energy: '0', example: 'print("x vale", x)' },
  { name: 'input', sig: 'input(pregunta)', cat: 'Depuración', desc: 'Lee un dato de entrada (en los retos que lo usan). Siempre devuelve texto.', returns: 'str', time: '0', energy: '0' },
];
const MAP_API = [...CONSOLE_API.filter((a) => a.name !== 'enviar'), ...API.filter((a) => ['mover', 'mirar', 'posicion', 'esperar'].includes(a.name))];

const starsHtml = (n: number, max = 3) => `<span class="ac-st">${'★'.repeat(n)}<i>${'★'.repeat(max - n)}</i></span>`;

function modal(html: string, onMount?: (root: HTMLElement, close: () => void) => void): void {
  const root = document.getElementById('modal-root') ?? document.body;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="modal-bg"><div class="modal panel">${html}</div></div>`;
  const bg = wrap.firstElementChild as HTMLElement;
  root.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  onMount?.(bg, close);
}

function learnHtml(l: Level): string {
  return l.learn.map((x) => `<p>${esc(x.text)}</p>${x.code ? `<pre class="api-ex">${esc(x.code)}</pre>` : ''}`).join('');
}

function nextLevel(l: Level): Level | null {
  const s = sectionOf(l.id)!;
  const i = s.levels.indexOf(l);
  return s.levels[i + 1] ?? null;
}

function exportModal(): void {
  const p = loadProgress();
  const code = exportCode(p);
  modal(`<div class="k-lbl">Guardar progreso</div><h2>Tu código</h2>
    <p class="lead">Apúntalo (o haz una foto). Otro día, en cualquier navegador, pulsa «Tengo un código» y sigue donde lo dejaste.</p>
    <div class="ac-code-big sel">${esc(code)}</div>
    <p class="sm">${totalStars(p)} ★ · ${points(p)} puntos · ${fmtTime(totalSecs(p))}. El código no guarda tus programas, sólo tu avance.</p>
    <div class="foot"><button class="btn" id="cp">Copiar</button><button class="btn go" id="ok">Hecho</button></div>`, (r, close) => {
    $('#ok', r).onclick = close;
    $('#cp', r).onclick = () => navigator.clipboard?.writeText(code).then(() => toast('Código copiado', 'ok'), () => {});
  });
}

function importModal(after: () => void): void {
  modal(`<div class="k-lbl">Recuperar progreso</div><h2>Tengo un código</h2>
    <p class="lead">Escribe el código que guardaste. Las mayúsculas y los guiones dan igual.</p>
    <input type="text" id="ic" autocomplete="off" placeholder="XXXX-XXXX-XXXX-…" class="ac-code-in">
    <div class="foot"><button class="btn" id="no">Cancelar</button><button class="btn go" id="ok">Recuperar</button></div>`, (r, close) => {
    const inp = $<HTMLInputElement>('#ic', r);
    inp.focus();
    $('#no', r).onclick = close;
    const go = () => {
      const q = importCode(inp.value);
      if (!q) { toast('Ese código no es válido: revisa que esté completo', 'err'); return; }
      saveProgress(mergeProgress(loadProgress(), q));
      close();
      toast(`¡Bienvenido de nuevo! ${totalStars(q)} ★ recuperadas`, 'ok');
      after();
    };
    $('#ok', r).onclick = go;
    inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });
}

// ───────────────────────── mapa de rutas ─────────────────────────

export function mountAcademia(): Cleanup {
  const draw = () => {
    const p = loadProgress();
    const maxStars = ALL_LEVELS.length * 3;
    const el = page(`
      <section class="hero small ac-hero">
        <h1>Academia</h1>
        <p class="lead">Retos cortos para aprender Python desde cero. Cada reto se comprueba con <b>3 casos distintos</b>: tu programa tiene que funcionar en todos.</p>
        <div class="ac-stats">
          <div class="panel"><b>${totalStars(p)}</b><span>de ${maxStars} ★</span></div>
          <div class="panel"><b>${points(p)}</b><span>puntos</span></div>
          <div class="panel"><b>${fmtTime(totalSecs(p))}</b><span>practicando</span></div>
          <div class="ac-actions"><button class="btn go" id="exp">⇩ Guardar progreso (código)</button><button class="btn" id="imp">⇧ Tengo un código</button></div>
        </div>
        <p class="sm">Sin cuenta: tu avance se guarda en esta pestaña mientras esté abierta. Antes de cerrarla, pulsa «Guardar progreso» y apunta el código.</p>
      </section>
      <section class="ac-sections">
        ${SECTIONS.map((s) => {
          const done = s.levels.filter((l) => (p.stars[l.id] ?? 0) > 0).length;
          return `<div class="panel ac-sec ${s.soon ? 'soon' : ''}">
            <div class="ac-sec-h"><span class="ic">${s.icon}</span><div><div class="k-lbl">Sección ${s.n}${s.soon ? ' · próximamente' : ''}</div><h3>${esc(s.title)}</h3><p class="sm">${esc(s.subtitle)}</p></div>
              ${s.soon ? '' : `<div class="ac-sec-p"><b>${done}/${s.levels.length}</b><span>${fmtTime(p.secs[s.id] ?? 0)}</span></div>`}</div>
            ${s.soon ? '' : `<div class="ac-path">${s.levels.map((l, i) => {
              const st = p.stars[l.id] ?? 0;
              const open = unlocked(p, l.id);
              const tag = l.boss ? '👑' : String(i + 1);
              return `<a class="ac-node ${l.boss ? 'boss' : ''} ${st ? 'done' : ''} ${open ? '' : 'locked'} ${p.last === l.id ? 'last' : ''}" ${open ? `href="#/academia/${l.id}"` : ''} title="${esc(l.title)} · ${esc(l.concept)}">
                <span class="dot">${open ? tag : '🔒'}</span><span class="nm">${esc(l.title)}</span>${starsHtml(st)}</a>`;
            }).join('')}</div>`}
          </div>`;
        }).join('')}
      </section>`, { wide: true });
    $('#exp', el).onclick = exportModal;
    $('#imp', el).onclick = () => importModal(draw);
  };
  draw();
  return () => {};
}

// ───────────────────────── reto ─────────────────────────

let autorun = false;

export function mountAcademiaLevel(id: string, variant = 0): Cleanup {
  const level = levelById(id);
  const p0 = loadProgress();
  if (!level || !unlocked(p0, id)) { location.hash = '#/academia'; return () => {}; }
  p0.last = id;
  saveProgress(p0);
  // tiempo de práctica (sólo con la pestaña visible)
  const timer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const p = loadProgress();
    addTime(p, id, 5);
    saveProgress(p);
  }, 5000);
  const stop = level.kind === 'consola' ? consoleLevel(level) : mapLevel(level, variant);
  return () => { clearInterval(timer); stop(); };
}

function award(level: Level, ev: Evaluation, code: string): { before: number; now: number } {
  const p = loadProgress();
  const before = p.stars[level.id] ?? 0;
  p.stars[level.id] = Math.max(before, ev.stars);
  p.code[level.id] = code;
  saveProgress(p);
  return { before, now: p.stars[level.id] };
}

function resultsHtml(level: Level, ev: Evaluation, compact = false): string {
  const firstErr = ev.results.find((r) => r.error);
  const explain = firstErr?.error ? explainError(firstErr.error.type, firstErr.error.msg) : null;
  return `
    <div class="ac-score">
      <div>${starsHtml(ev.stars)}</div>
      <div class="sm">★ caso 1 · ★★ los 3 casos · ★★★ en ${level.par} líneas o menos <b>(llevas ${ev.lines})</b></div>
    </div>
    ${ev.reqFail ? `<div class="alert amber">${esc(ev.reqFail)}</div>` : ''}
    ${explain ? `<div class="ac-explain">💬 ${esc(explain)}</div>` : ''}
    ${compact ? `<div class="ac-cases-res">${ev.results.map((r, i) => `<div class="ac-case-c ${r.ok ? 'ok' : 'ko'}"><span class="mk">${r.ok ? '✓' : '✗'}</span> Caso ${i + 1}${r.ok ? '' : ` · ${esc(r.msg)}`}</div>`).join('')}</div>` : `<div class="ac-cases-res">${ev.results.map((r, i) => `
      <details class="ac-case ${r.ok ? 'ok' : 'ko'}" ${!r.ok && ev.results.slice(0, i).every((x) => x.ok) ? 'open' : ''}>
        <summary><span class="mk">${r.ok ? '✓' : '✗'}</span> Caso ${i + 1} · ${esc(r.msg)}</summary>
        <pre class="ac-term">${r.prints.length ? esc(r.prints.join('\n')) : '<span class="sm">(sin salida)</span>'}</pre>
      </details>`).join('')}</div>`}`;
}

/** ventana de celebración con el porqué de las estrellas */
function celebrate(level: Level, ev: Evaluation, best: number): void {
  const next = nextLevel(level);
  const allOk = ev.results.every((r) => r.ok);
  const criteria = [
    { ok: ev.results[0]?.ok ?? false, text: '★ Funciona en el caso 1' },
    { ok: allOk, text: `★★ Funciona en los ${ev.results.length} casos${allOk ? '' : ` (falla el caso ${ev.results.findIndex((r) => !r.ok) + 1})`}` },
    { ok: ev.stars === 3, text: `★★★ En ${level.par} líneas o menos (el tuyo tiene ${ev.lines})` },
  ];
  const message = ev.stars === 3
    ? (level.boss ? '¡Sección superada con la nota máxima!' : '¡Perfecto! Programa correcto, general y compacto.')
    : ev.stars === 2
      ? `¡Muy bien! Funciona en todos los casos. Para la 3ª estrella, intenta dejarlo en ${level.par} líneas.`
      : 'Funciona en el primer caso, pero no en todos: tu programa tiene que valer para cualquier dato, no sólo para el del caso 1.';
  showLevelComplete({
    title: level.title, stars: ev.stars, best, improved: ev.stars >= best, criteria, message, boss: level.boss && ev.stars > 0,
    next: next ? { href: `#/academia/${next.id}`, label: `Siguiente: ${next.title} →` } : { href: '#/academia', label: 'Volver a la Academia' },
  });
}

function caseInputs(level: Level): string {
  return level.variants.map((v, i) => {
    const vars = [
      ...Object.entries(v.preset ?? {}).map(([k, val]) => `${k} = ${reprJ(val)}`),
      ...(v.call ? [`# la base añade al final:\n${v.call}`] : []),
    ].join('\n');
    const exp = level.kind === 'consola' && v.expect !== undefined
      ? (i === 0 ? `<div class="exp">→ la base espera <code>${esc(reprJ(v.expect))}</code></div>` : '<div class="exp sm">→ resultado oculto</div>')
      : '';
    return `<div class="ac-case-in"><div class="k-lbl">Caso ${i + 1}</div>${vars ? `<pre>${esc(vars)}</pre>` : '<div class="sm">mapa distinto</div>'}${exp}</div>`;
  }).join('');
}

function consoleLevel(level: Level): Cleanup {
  const s = sectionOf(level.id)!;
  const idx = s.levels.indexOf(level) + 1;
  const p = loadProgress();
  let code = p.code[level.id] ?? level.starter;
  let hintI = 0;
  let lastErr: { line: number; msg: string } | null = null;
  const el = page(`
    <div class="ac-crumbs"><a href="#/academia">Academia</a> › ${esc(s.title)} › ${level.boss ? '👑 Jefe' : `Reto ${idx}`}</div>
    <div class="ac-level">
      <aside class="panel ac-mission">
        <div class="k-lbl">${level.boss ? 'Jefe final' : `Reto ${idx} de ${s.levels.length - 1}`} · ${esc(level.concept)}</div>
        <h2>${esc(level.title)} ${starsHtml(p.stars[level.id] ?? 0)}</h2>
        <p class="ac-story">${esc(level.story)}</p>
        <div class="rule"><b>Objetivo:</b> ${esc(level.goal)}</div>
        <details class="ac-learn" open><summary>📘 Aprende</summary>${learnHtml(level)}</details>
        ${Object.entries(level.modules ?? {}).map(([n, src]) => `<details class="ac-learn ac-mod" open><summary>📦 ${esc(n)} (ya escrito)</summary><pre class="api-ex">${esc(src)}</pre></details>`).join('')}
        <h4 class="ac-h4">Casos de prueba</h4>
        <div class="ac-cases">${caseInputs(level)}</div>
        <p class="sm">${level.variants.some((v) => v.call) ? 'La base añadirá al final de tu programa una llamada a tu función para comprobarla. Tú sólo tienes que definirla.' : 'Las variables de cada caso ya existen cuando empieza tu programa. Termina con <code>enviar(resultado)</code>.'}</p>
      </aside>
      <section class="panel ac-code">
        <div class="ac-bar"><button class="btn go" id="ac-run" title="Ctrl+Enter">▶ Ejecutar</button><button class="btn" id="ac-hint">💡 Pista</button><button class="btn" id="ac-reset">↺ Empezar de nuevo</button><span class="spacer"></span><span class="sm" id="ac-lines"></span></div>
        <div id="ac-ed" class="ac-ed"></div>
      </section>
      <section class="panel ac-out" id="ac-out"><div class="sm">Pulsa <b>▶ Ejecutar</b> para probar tu programa con los 3 casos.</div></section>
    </div>`, { wide: true });
  document.body.classList.add('ac-full');
  const ed = new CodeEditor($('#ac-ed', el), {
    files: () => ({ 'reto.py': code }),
    onChange: (_n, src) => {
      code = src;
      $('#ac-lines', el).textContent = `${src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length} líneas`;
      const q = loadProgress(); q.code[level.id] = src; saveProgress(q);
    },
    onRun: () => run(),
    onSave: () => toast('Se guarda solo mientras escribes', 'info'),
    runtimeError: () => lastErr,
    api: CONSOLE_API,
  });
  ed.open('reto.py', code);
  $('#ac-lines', el).textContent = `${code.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length} líneas`;
  const run = () => {
    sound.run();
    const ev = evaluate(level, code);
    const e = ev.results.find((r) => r.error)?.error;
    lastErr = e && e.line ? { line: e.line, msg: `${e.type}: ${e.msg}` } : null;
    ed.refreshLint();
    const { before, now } = award(level, ev, code);
    const next = nextLevel(level);
    const out = $('#ac-out', el);
    out.innerHTML = resultsHtml(level, ev) + (now > 0 ? `<div class="ac-next">${next ? `<a class="btn go" href="#/academia/${next.id}">Siguiente: ${esc(next.title)} →</a>` : ''}<a class="btn" href="#/academia">Mapa de la Academia</a></div>` : '');
    $('h2 .ac-st', el).outerHTML = starsHtml(now);
    if (ev.stars > 0) setTimeout(() => celebrate(level, ev, Math.max(before, now)), 250);
    else sound.fail();
  };
  $('#ac-run', el).onclick = run;
  $('#ac-hint', el).onclick = () => {
    const h = level.hints[hintI % level.hints.length];
    hintI++;
    modal(`<h2>Pista ${Math.min(hintI, level.hints.length)}/${level.hints.length}</h2><pre class="api-ex" style="font-size:13px">${esc(h)}</pre><div class="foot"><button class="btn go" id="hk">Entendido</button></div>`, (r, close) => { $('#hk', r).onclick = close; });
  };
  $('#ac-reset', el).onclick = () => {
    modal(`<h2>¿Empezar de nuevo?</h2><p class="lead">Se borra tu código de este reto y vuelve el de partida. Tus estrellas se quedan.</p><div class="foot"><button class="btn" id="no">Cancelar</button><button class="btn go" id="si">Empezar de nuevo</button></div>`, (r, close) => {
      $('#no', r).onclick = close;
      $('#si', r).onclick = () => { close(); code = level.starter; ed.forgetAll(); ed.open('reto.py', code); const q = loadProgress(); delete q.code[level.id]; saveProgress(q); };
    });
  };
  return () => { document.body.classList.remove('ac-full'); };
}

function mapLevel(level: MapLevel, variant: number): Cleanup {
  const s = sectionOf(level.id)!;
  const idx = s.levels.indexOf(level) + 1;
  const p = loadProgress();
  const code = p.code[level.id] ?? level.starter;
  const sess = new AcademiaMapSession(level, variant, code);
  let ev: Evaluation | null = null;
  let evVersion = 0;
  let lastSig = '';
  let hintI = 0;
  let hasRun = false;
  /** celebración pendiente hasta que el robot visible termine */
  let pending: { ev: Evaluation; best: number; t: number } | null = null;
  document.getElementById('app')!.innerHTML = '';
  const orig = sess.run.bind(sess);
  sess.run = (u, f) => {
    const src = sess.filesOf('p1')[f] ?? '';
    const q = loadProgress(); q.code[level.id] = src; saveProgress(q);
    if (hasRun) {
      // el mundo ya se ha movido: vuelve a empezar la variante y ejecuta otra vez
      autorun = true;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      return { ok: true };
    }
    const r = orig(u, f);
    if (r.ok) {
      hasRun = true;
      ev = evaluate(level, src);
      evVersion++;
      const { before, now } = award(level, ev, src);
      pending = { ev, best: Math.max(before, now), t: performance.now() };
      sound.run();
    }
    return r;
  };
  const app = new App(sess, {
    zoom: 1.5,
    hideSettings: true,
    onReady: (a) => {
      a.r.beacons = sess.beacons;
      const u = sess.game.unitsOf('p1').find((x) => x.type === level.unit)!;
      a.select(u.id, false);
      a.target = u.id;
      a.openFile('reto.py');
      if (autorun) {
        autorun = false;
        setTimeout(() => sess.run(u.id, 'reto.py'), 50);
        a.openEditor();
        return;
      }
      a.modal(`<div class="k-lbl">${level.boss ? 'Jefe final' : `Reto ${idx}`} · ${esc(level.concept)}</div><h2>${esc(level.title)}</h2><p class="lead">${esc(level.story)}</p>
        <div class="rule"><b>Objetivo:</b> ${esc(level.goal)}</div>${learnHtml(level)}
        <div class="foot"><a class="btn" href="#/academia">Academia</a><button class="btn go" id="lv-go">Al código</button></div>`, (r, close) => {
        $('#lv-go', r).onclick = () => { close(); a.openEditor(); };
      });
    },
    sidePanel: (a, el) => {
      const goal = mapGoal(level, sess.game, sess.beacons, sess.visited);
      const unit = sess.game.unitsOf('p1').find((x) => x.type === level.unit);
      if (pending && unit && (unit.status !== 'RUNNING' || performance.now() - pending.t > 20_000)) {
        const pd = pending;
        pending = null;
        if (pd.ev.stars > 0) setTimeout(() => celebrate(level, pd.ev, pd.best), 300);
        else sound.fail();
      }
      const st = loadProgress().stars[level.id] ?? 0;
      const sig = JSON.stringify([goal, evVersion, st]);
      if (sig === lastSig) return;
      lastSig = sig;
      const next = nextLevel(level);
      el.innerHTML = `<div class="lbl">🎓 ${esc(s.title)} · ${level.boss ? 'Jefe' : `reto ${idx}`}</div>
        <div class="txt"><b>${esc(level.title)}</b> ${starsHtml(st)}<br><span class="sm">${esc(level.goal)}</span></div>
        <div class="ac-vars">${level.variants.map((v, i) => `<a class="chip ${i === variant ? 'on' : ''}" href="#/academia/${level.id}?v=${i + 1}">Caso ${i + 1}</a>`).join('')}</div>
        <div class="cnt" style="text-align:left">Viendo el caso ${variant + 1}: ${esc(goal.progress)}</div>
        ${Object.keys(level.variants[variant].preset ?? {}).length || level.variants[variant].call ? `<pre class="api-ex">${esc([...Object.entries(level.variants[variant].preset ?? {}).map(([k, v]) => `${k} = ${reprJ(v)}`), ...(level.variants[variant].call ? [`# la base añade al final:\n${level.variants[variant].call}`] : [])].join('\n'))}</pre>` : ''}
        ${ev ? `<div class="ac-mini">${resultsHtml(level, ev, true)}</div>` : '<div class="sm" style="margin-top:6px">Al ejecutar, tu programa se prueba también en los otros casos.</div>'}
        <div class="btn-row" style="margin-top:8px"><button class="btn" id="lv-learn">📘 Aprende</button><button class="btn" id="lv-hint">💡 Pista</button></div>
        ${st > 0 && next ? `<a class="btn go" style="margin-top:8px;width:100%" href="#/academia/${next.id}">Siguiente: ${esc(next.title)} →</a>` : ''}
        <a class="link-btn" href="#/academia">← Academia</a>`;
      $('#lv-learn', el).onclick = () => a.modal(`<h2>${esc(level.concept)}</h2>${learnHtml(level)}<div class="foot"><button class="btn go" id="lk">Cerrar</button></div>`, (r, close) => { $('#lk', r).onclick = close; });
      $('#lv-hint', el).onclick = () => {
        const h = level.hints[hintI % level.hints.length];
        hintI++;
        a.modal(`<h2>Pista ${Math.min(hintI, level.hints.length)}/${level.hints.length}</h2><pre class="api-ex" style="font-size:13px">${esc(h)}</pre><div class="foot"><button class="btn go" id="hk">Entendido</button></div>`, (r, close) => { $('#hk', r).onclick = close; });
      };
    },
  });
  void MAP_API;
  return () => app.destroy();
}
