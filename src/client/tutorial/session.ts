// Sesión de un nivel del tutorial (local, sin guardar mundo).
// La biblioteca del jugador (mi_biblioteca.py y otros archivos) se guarda en sessionStorage:
// dura mientras no se cierre el navegador.
import { GameSession } from '../session';
import { LIB_FILE, LIB_FROM, LIB_TEMPLATE, buildTutorial, type Level } from './levels';

const LIB_KEY = 'grid.tutorial.biblioteca';

export function loadLibrary(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(LIB_KEY);
    const d = raw ? JSON.parse(raw) : null;
    if (d && typeof d === 'object') return d as Record<string, string>;
  } catch { /* sin almacenamiento */ }
  return {};
}

function storeLibrary(files: Record<string, string>): void {
  try { sessionStorage.setItem(LIB_KEY, JSON.stringify(files)); } catch { /* sin almacenamiento */ }
}

export class TutorialSession extends GameSession {
  readonly kind = 'tutorial' as const;
  beacons: [number, number][];
  visited = new Set<string>();
  lastCode = '';

  constructor(public level: Level, code: string | null) {
    super();
    const t = Date.now();
    const built = buildTutorial(level, t);
    this.game = built.game;
    this.beacons = built.beacons;
    this.gameTime = t;
    const files: Record<string, string> = { 'nivel.py': code ?? level.starter };
    if (level.n >= LIB_FROM) Object.assign(files, { [LIB_FILE]: LIB_TEMPLATE }, loadLibrary());
    this.game.player('p1')!.p.files = files;
    this.game.player('p1')!.p.name = 'Tú';
  }

  private persistLibrary(): void {
    const lib = { ...this.filesOf('p1') };
    delete lib['nivel.py'];
    storeLibrary(lib);
  }

  override saveFile(owner: string, name: string, src: string, snapshot = false): void {
    super.saveFile(owner, name, src, snapshot);
    if (name !== 'nivel.py') this.persistLibrary();
  }

  override deleteFile(owner: string, name: string): void {
    super.deleteFile(owner, name);
    this.persistLibrary();
  }

  override renameFile(owner: string, from: string, to: string): void {
    super.renameFile(owner, from, to);
    this.persistLibrary();
  }

  override run(unitId: string, file: string) {
    this.lastCode = this.filesOf('p1')[file] ?? '';
    return super.run(unitId, file);
  }
}
