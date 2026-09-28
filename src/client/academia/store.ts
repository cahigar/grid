// Progreso de la Academia en sessionStorage (dura mientras la pestaña esté abierta).
import { emptyProgress, type Progress } from '../../sim/academia/progress';

const KEY = 'grid.academia.v1';

export function loadProgress(): Progress {
  try {
    const raw = sessionStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Progress) : null;
    if (p && p.v === 1) return { ...emptyProgress(), ...p };
  } catch { /* sin almacenamiento */ }
  return emptyProgress();
}

export function saveProgress(p: Progress): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch { /* sin almacenamiento */ }
}
