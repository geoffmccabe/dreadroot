// parkourGraphs — turns a ParkourAction into a runnable AnimFSM graph: a short run-up → the
// height-matched parkour clip (carried forward, and up/down, by root motion) → recover back to a run.
// Root-motion numbers (drift = m/s forward, lift = m/s vertical) are FIRST-PASS guesses to be tuned
// by eye, since the exact distance a clip should travel can't be read from data. The clips keep their
// vertical hip motion (the up-and-over arc), so we mostly add forward drift + a vertical nudge.
import { AnimGraph, AnimStateDef } from './animFSM';
import { LocomotionClipSet, PARKOUR } from './locomotionClips';
import { ParkourAction } from './obstacleDetector';

const RUN = 3.2;          // approach / recover forward speed (m/s)
const APPROACH = 0.9;     // seconds of run-up before the move
const RECOVER = 0.8;      // seconds of run-out after

// fall back to a sibling clip if a slot is empty, so a graph never carries a null clip name
const pick = (...c: (string | null | undefined)[]) => c.find((x): x is string => !!x) ?? '';

export function parkourGraph(action: ParkourAction, loco: LocomotionClipSet, variant = 0): AnimGraph | null {
  const run = pick(loco.runF, loco.walkF, loco.idle);
  const approach = { clip: run, loop: true, drift: RUN, duration: APPROACH, fade: 0.2, next: 'move' };
  const recover  = { clip: run, loop: true, drift: RUN, duration: RECOVER, fade: 0.25 };
  const wrap = (move: Partial<AnimStateDef> & { clip: string }): AnimGraph => ({
    initial: 'approach',
    states: { approach, move: { fade: 0.12, next: 'recover', ...move }, recover },
  });

  switch (action) {
    case 'vaultLow':
      return wrap({ clip: pick(PARKOUR.vaultLow[variant % PARKOUR.vaultLow.length], PARKOUR.vaultLow[0]), drift: 2.8 });
    case 'vaultHigh':
      return wrap({ clip: PARKOUR.vaultHigh, drift: 3.4 });
    case 'slideUnder':
      return wrap({ clip: PARKOUR.slideUnder, drift: 3.0 });
    case 'dropRoll':
      // off a ledge: carry forward AND down (lift negative) while the roll plays
      return wrap({ clip: PARKOUR.dropRoll, drift: 2.2, lift: -1.6 });
    case 'wallRun':
      return wrap({ clip: PARKOUR.wallRun, drift: 2.4, lift: 1.0 });
    case 'stepUp':
      // no dedicated clip — just a small hop mid-run
      return wrap({ clip: run, drift: RUN, lift: 0.8, duration: 0.4 });
    case 'blocked':
      // can't pass — stop into idle (caller would normally turn away)
      return { initial: 'stop', states: { stop: { clip: pick(loco.idle), loop: true, fade: 0.25 } } };
    default:
      return null;
  }
}
