// Sesión de un reto de mapa de la Academia (una variante visible, sin guardar mundo).
import { buildMapVariant, type MapLevel } from '../../sim/academia/engine';
import { GameSession } from '../session';

export class AcademiaMapSession extends GameSession {
  readonly kind = 'tutorial' as const;
  beacons: [number, number][];
  visited = new Set<string>();
  lastCode = '';

  constructor(public level: MapLevel, public variant: number, code: string) {
    super();
    const t = Date.now();
    const built = buildMapVariant(level, level.variants[variant], t);
    this.game = built.game;
    this.beacons = built.beacons;
    this.gameTime = t;
    this.game.player('p1')!.p.files = { 'reto.py': code };
  }

  override run(unitId: string, file: string) {
    this.lastCode = this.filesOf('p1')[file] ?? '';
    this.visited.clear();
    return super.run(unitId, file);
  }
}
