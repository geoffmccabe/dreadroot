/**
 * What the traversal system is seeing — for D-Flow.
 *
 * WHY THIS EXISTS. When a mantle does not trigger there is nothing on screen to
 * say why, and the possible causes all look identical from the outside: the
 * probe found nothing, it found something too tall, the headroom was too low,
 * the far side was unmeasurable, or the rig simply has no climb clip. Without a
 * readout the only way to tell them apart is for me to guess and Geoff to test
 * again, which is the slowest loop there is.
 *
 * Records the LAST attempt rather than a running average: traversal is a
 * discrete event and "what happened the last time I jumped at that wall" is the
 * actual question being asked.
 */
import type { ObstacleReading } from './obstacleProbe';
import type { TraversalMove } from './traversalMoves';

interface Attempt {
  at: number;
  probeKind: string;
  reading: ObstacleReading | null;
  move: TraversalMove | null;
  started: boolean;
  /** Why nothing happened, when nothing happened. */
  refusedBecause: string | null;
}

class TraversalStats {
  private last: Attempt | null = null;
  private attempts = 0;
  private started = 0;
  private byMove = new Map<string, number>();

  record(a: Omit<Attempt, 'at'>): void {
    this.last = { ...a, at: performance.now() };
    this.attempts++;
    if (a.started) {
      this.started++;
      if (a.move) this.byMove.set(a.move, (this.byMove.get(a.move) ?? 0) + 1);
    }
  }

  report(): string {
    const L: string[] = [];
    L.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    L.push('TRAVERSAL (parkour)');
    L.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (this.last === null) {
      L.push('  No attempt yet. Walk INTO a ledge and press jump —');
      L.push('  it only probes on a jump while moving forward.');
      return L.join('\n');
    }
    const a = this.last;
    L.push(`  Attempts: ${this.attempts}   started: ${this.started}`);
    if (this.byMove.size > 0) {
      L.push(`  Moves: ${[...this.byMove].map(([m, n]) => `${m} x${n}`).join(', ')}`);
    }
    L.push(`  Probe: ${a.probeKind}`);
    L.push(`  Last attempt ${((performance.now() - a.at) / 1000).toFixed(1)}s ago:`);
    if (!a.reading) {
      L.push('    nothing ahead — clear ground within reach');
    } else {
      const r = a.reading;
      L.push(`    height ${r.height.toFixed(2)}m  depth ${Number.isFinite(r.depth) ? r.depth.toFixed(2) + 'm' : 'deep'}`);
      L.push(`    headroom ${r.headroom.toFixed(2)}m  distance ${r.distance.toFixed(2)}m`);
      L.push(`    standable ${r.standable}  far-side ground ${r.farSideY === null ? 'UNKNOWN' : r.farSideY.toFixed(1)}`);
    }
    L.push(`    chose: ${a.move ?? '—'}   ${a.started ? 'STARTED' : `no move: ${a.refusedBecause ?? 'n/a'}`}`);
    return L.join('\n');
  }
}

export const traversalStats = new TraversalStats();
