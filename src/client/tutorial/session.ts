// Sesión de un nivel del tutorial (local, sin guardar mundo).
import { GameSession } from '../session';
import { buildTutorial, type Level } from './levels';

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
    this.game.player('p1')!.p.files = { 'nivel.py': code ?? level.starter };
    this.game.player('p1')!.p.name = 'Tú';
  }

  override run(unitId: string, file: string) {
    this.lastCode = this.filesOf('p1')[file] ?? '';
    return super.run(unitId, file);
  }
}
