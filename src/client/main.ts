import './styles.css';
import { api } from './net/api';
import { mountAcademia, mountAcademiaLevel } from './academia/screens';
import { drawGallery } from './render/gallery';
import {
  mountAuth, mountGuide, mountHome, mountHost, mountPractice, mountStudentRoom, mountTeacher,
  mountTutorialLevel, mountTutorialMenu, type Cleanup,
} from './screens';

let cleanup: Cleanup = () => {};
let seq = 0;

async function route(): Promise<void> {
  const my = ++seq;
  try { cleanup(); } catch { /* nada */ }
  cleanup = () => {};
  document.querySelectorAll('.modal-bg').forEach((m) => m.remove());
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const q = new URLSearchParams(qs ?? '');
  let c: Cleanup | Promise<Cleanup>;
  switch (parts[0] ?? '') {
    case '': c = mountHome(); break;
    case 'entrar': c = mountAuth(q.get('next') ?? ''); break;
    case 'tutorial': c = parts[1] ? mountTutorialLevel(Number(parts[1])) : mountTutorialMenu(); break;
    case 'practica': c = mountPractice(); break;
    case 'guia': c = mountGuide(); break;
    case 'academia': c = parts[1] ? mountAcademiaLevel(parts[1], Math.max(0, Number(q.get('v') ?? 1) - 1)) : mountAcademia(); break;
    case 'profe': c = parts[1] ? mountHost(parts[1].toUpperCase()) : mountTeacher(); break;
    case 'sala': c = parts[1] ? mountStudentRoom(parts[1]) : mountHome(); break;
    default: location.hash = '#/'; return;
  }
  const fn = await c;
  if (my !== seq) { try { fn(); } catch { /* nada */ } return; }
  cleanup = fn;
  window.scrollTo(0, 0);
}

async function boot(): Promise<void> {
  if (new URLSearchParams(location.search).has('galeria')) {
    const c = document.createElement('canvas');
    c.style.cssText = 'width:100%;height:100%;display:block';
    document.getElementById('app')!.appendChild(c);
    const tick = (t: number) => { drawGallery(c, t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    return;
  }
  await api.init();
  window.addEventListener('hashchange', () => void route());
  await route();
}

void boot();
