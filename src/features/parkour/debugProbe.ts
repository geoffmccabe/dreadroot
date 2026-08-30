/**
 * A window handle on what the parkour system can actually see.
 *
 * WHY. Parkour lives inside the render loop, has no DOM, and fails silently in
 * five different ways that look identical from outside the game: no scanner
 * installed, the scanner found nothing, it found something too tall, the far
 * side was unmeasurable, or the move never got asked for because the key check
 * ate it. Telling those apart by asking Geoff to test again is the slowest loop
 * we have, and it is how "it climbs the air" survived this long.
 *
 * So: `__parkour()` in the console answers all five at once, and a headless
 * check can read the same thing without a human watching the screen.
 *
 * This is the first piece of the Phase 2 debug work, pulled forward because the
 * system is reporting "nothing happens at all" and no amount of reading the
 * code settles what the scanner is measuring in a live world.
 */
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { getScanner } from './surroundings';
import { chooseMove } from './moves';
import { parkourStats } from './stats';
import { getPlayerFeet } from './playerFeet';
import { dropToGround } from './groundDrop';

/** Reach and rise used by the real attempt — kept in step with runner.ts. */
const REACH = 1.1;
const MAX_RISE = 3.5;

export function installParkourDebug(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>).__parkour = (reach = REACH) => {
    const scanner = getScanner();
    if (!scanner) return { error: 'no scanner installed for this world' };
    const feet = getPlayerFeet();
    if (!feet.known) return { error: 'player position not published yet — move once' };
    const reading = scanner.scan(feet.x, feet.y, feet.z, feet.fx, feet.fz, reach, MAX_RISE);
    // A fan around the player, so "nothing ahead" can be told apart from "the
    // grid is empty" — the two report identically from a single forward scan.
    const fan: Record<string, unknown> = {};
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = scanner.scan(feet.x, feet.y, feet.z, Math.sin(a), Math.cos(a), reach, MAX_RISE);
      if (r) fan[`${Math.round((a * 180) / Math.PI)}deg`] = { h: +r.height.toFixed(2), depth: r.depth, top: r.topY };
    }
    // What the collision grid holds near the player, read the same way the
    // scanner reads it. An empty answer here means the scanner is blameless.
    const near = worldCollisionGrid.getNearbyFiltered(feet.x, feet.z, 4, feet.y - 2, feet.y + 4);
    const boxes = [];
    for (let i = 0; i < Math.min(near, 6); i++) {
      const b = worldCollisionGrid.nearbyResult[i];
      boxes.push({ min: [+b.min.x.toFixed(1), +b.min.y.toFixed(1), +b.min.z.toFixed(1)],
                   max: [+b.max.x.toFixed(1), +b.max.y.toFixed(1), +b.max.z.toFixed(1)] });
    }
    return {
      gridBoxesWithin4m: near,
      sampleBoxes: boxes,
      fan,
      scanner: scanner.kind,
      feet: { x: +feet.x.toFixed(2), y: +feet.y.toFixed(2), z: +feet.z.toFixed(2) },
      forward: { x: +feet.fx.toFixed(2), z: +feet.fz.toFixed(2) },
      reach,
      reading,
      walking: reading ? chooseMove(reading, false) : null,
      running: reading ? chooseMove(reading, true) : null,
      dropBelowFeet: dropToGround(feet.x, feet.y, feet.z),
      lastAttempt: parkourStats.report(),
    };
  };
}
