/**
 * WHAT IS IN FRONT OF ME RIGHT NOW — the D-Flow parkour readout.
 *
 * WHY THIS EXISTS. The recorded attempt (stats.ts) only answers "what happened
 * when I last pressed jump", and the failure being chased is one where nothing
 * happens at all — where the five possible causes are indistinguishable from
 * the outside: no scanner, nothing measured, measured but classified as no
 * move, classified but refused, or never asked. Walking up to a wall and
 * watching these lines change tells them apart with no console and no keypress.
 *
 * It runs the SAME `planMove` the real attempt runs, so the panel can never
 * claim a move would work when the game would refuse it.
 *
 * WHY ITS OWN FILE. stats.ts is imported by runner.ts; if stats.ts imported
 * runner.ts back for `planMove` the two would form a cycle, and a cycle here
 * typechecks cleanly and then white-screens at runtime. This file sits above
 * both and imports downward only.
 */
import { getScanner } from './surroundings';
import { getPlayerFeet } from './playerFeet';
import { dropToGround } from './groundDrop';
import { planMove, REACH, MAX_RISE } from './runner';
import { parkourStats } from './stats';

/** How far ahead to look for the early-warning line, in metres. Far enough to
 *  see a wall before you are pressed against it. */
const LOOKAHEAD = 2.5;

function liveLines(): string[] {
  const L: string[] = [];
  const scanner = getScanner();
  if (!scanner) {
    L.push('  NO SCANNER installed for this world — parkour cannot run at all.');
    return L;
  }
  const f = getPlayerFeet();
  if (!f.known) {
    L.push('  Waiting for the first movement frame…');
    return L;
  }

  const drop = dropToGround(f.x, f.y, f.z);
  L.push(`  Feet ${f.x.toFixed(1)}, ${f.y.toFixed(1)}, ${f.z.toFixed(1)}   drop below: ${drop.toFixed(2)}m`);

  // Two ranges: what a jump would actually reach, and a look further ahead so
  // an obstacle shows up BEFORE you are pressed against it.
  for (const reach of [REACH, LOOKAHEAD]) {
    const tag = reach === REACH ? 'AT REACH ' : 'AHEAD 2.5m';
    const r = scanner.scan(f.x, f.y, f.z, f.fx, f.fz, reach, MAX_RISE);
    if (!r) { L.push(`  ${tag}: nothing ahead`); continue; }
    L.push(`  ${tag}: height ${r.height.toFixed(2)}m  depth ${Number.isFinite(r.depth) ? r.depth.toFixed(2) + 'm' : 'deep'}  dist ${r.distance.toFixed(2)}m`);
    L.push(`             top ${r.topY.toFixed(1)}  standable ${r.standable}  far-side ${r.farSideY === null ? 'UNKNOWN' : r.farSideY.toFixed(1)}`);
    // BOTH speeds, because the classifier picks a different move for each and
    // "it works walking but not running" is otherwise invisible.
    for (const [label, running] of [['walk', false], ['run (shift)', true]] as const) {
      const p = planMove(r, running, f.x, f.y, f.z, f.fx, f.fz, performance.now());
      L.push(`      ${label.padEnd(11)} -> ${p.move}${p.run ? '   WOULD GO' : `   NO: ${p.refusedBecause}`}`);
    }
  }
  return L;
}

/** The whole parkour block for the D-Flow panel: live state, then the last jump. */
export function parkourReport(): string {
  return [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'PARKOUR — live (walk at a block and watch)',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ...liveLines(),
    '',
    parkourStats.report(),
  ].join('\n');
}
