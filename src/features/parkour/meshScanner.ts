/**
 * The Siege Worlds answer to "what is in front of me" — NOT BUILT YET.
 *
 * This file exists so the shape of the harder problem is written down while it
 * is fresh, and so nothing in the traversal system quietly assumes a voxel
 * world. It deliberately reports "no obstacle" rather than guessing: a wrong
 * measurement puts a character through geometry, which is worse than no
 * parkour at all.
 *
 * ── WHY THIS ONE IS HARD, and what it will need ──────────────────────────────
 *
 * The voxel probe reads a column of one-metre cubes on a lattice. None of that
 * holds here. Siege Worlds is arbitrary meshes and heightmap terrain, so:
 *
 *  1. LEDGES ARE NOT FLAT OR AXIS-ALIGNED. The probe must cast forward to find
 *     a face, then cast DOWN from above it to find the top surface, and reject
 *     surfaces whose normal is too steep to stand on. A voxel top is standable
 *     by definition; a mesh top is a slope until proven otherwise.
 *
 *  2. HEIGHTS ARE CONTINUOUS. This is the real cost. In DreadRoot an obstacle
 *     is 1 or 2 blocks and the clips were authored for exactly those, so they
 *     fit as-is. Here a ledge can be 1.13m, and a clip authored for 1.2m will
 *     float or clip through. That is what MOTION WARPING solves: scale the
 *     clip's root motion so the hands and feet land on the real surface. It is
 *     the hardest part of any traversal system and it cannot be skipped in a
 *     mesh world the way it can here.
 *
 *  3. IK ON TOP OF WARPING. Even warped, hands should plant on the actual
 *     ledge. Two-bone IK on the arms during the mantle, driven from the probe's
 *     contact point.
 *
 *  4. IT CANNOT READ A GRID. There is no collision grid of blocks to consult,
 *     so this must raycast against the real scene — which means it must also
 *     care about cost, and probably only run when the player is moving toward
 *     something and not every frame.
 *
 * The MOVE TABLE (moves.ts) is already world-agnostic: it takes a
 * measurement, not blocks. So when this lands, the moves come with it — except
 * the thresholds there assume clips fit their measured height, which is the
 * voxel-only assumption that warping replaces.
 */
import type { Scanner, Surroundings } from './surroundings';

export class MeshScanner implements Scanner {
  readonly kind = 'mesh' as const;

  scan(): Surroundings | null {
    // Reports "clear" until really implemented. Traversal then does nothing in
    // Siege Worlds, which is exactly the behaviour it has today.
    return null;
  }
}
