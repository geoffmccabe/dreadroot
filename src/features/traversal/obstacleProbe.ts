/**
 * "What is in front of me, and can I get over it?" — the one question every
 * traversal move asks.
 *
 * WHY THIS IS AN INTERFACE AND NOT A FUNCTION. DreadRoot is voxel: the answer
 * comes from reading a column of blocks, which is cheap and exact. Siege Worlds
 * is not: its world is arbitrary meshes and terrain, so the same question needs
 * raycasts, surface normals, and a tolerance for ledges that are not flat or
 * axis-aligned. Those are genuinely different implementations of one idea.
 *
 * So the MEASUREMENT is abstracted and the moves are written once against it.
 * Climb, vault, jump-over and slide-under are not separate systems — they share
 * this one probe and differ only in which clip plays. Adding a move costs a
 * threshold and a clip; adding a WORLD costs one implementation of this
 * interface and nothing else.
 *
 * The voxel version ships first because it is the easy one. The mesh version
 * for Siege Worlds is deliberately still to come, and this seam is what stops
 * that being a rewrite.
 */

export interface ObstacleReading {
  /** Height of the obstacle's top surface ABOVE the player's feet, in metres.
   *  One DreadRoot block is one metre. */
  height: number;
  /** Clear space above the obstacle's top. Below the player's own height this
   *  is a gap to slide/crawl through, not a ledge to climb. */
  headroom: number;
  /** How deep the obstacle is along the direction of travel, in metres. A thin
   *  obstacle can be vaulted; a deep one has to be climbed onto. Infinity when
   *  the far side is beyond what the probe looked at. */
  depth: number;
  /** World Y of the surface the player would end up standing on. */
  topY: number;
  /** Distance from the player to the obstacle's near face, in metres. */
  distance: number;
  /** True when the top is a surface the player could actually stand on, rather
   *  than the underside of something. */
  standable: boolean;
  /** Ground height on the FAR side, for moves that go over rather than onto.
   *  Null when the far side was not reachable within the probe's look-ahead —
   *  vaulting into an unknown drop is how a character ends up in a pit. */
  farSideY: number | null;
}

export interface ObstacleProbe {
  /** A name for diagnostics — which world model answered. */
  readonly kind: 'voxel' | 'mesh';
  /**
   * Look ahead from a position along a direction.
   * @param x,y,z   the player's FEET.
   * @param fx,fz   normalised forward direction (XZ).
   * @param reach   how far ahead to look, metres.
   * @param maxRise the tallest obstacle worth reporting, metres.
   * @returns the obstacle, or null for clear ground.
   */
  probe(
    x: number, y: number, z: number,
    fx: number, fz: number,
    reach: number, maxRise: number,
  ): ObstacleReading | null;
}

let active: ObstacleProbe | null = null;

/** Installed by whichever world is running. */
export function setObstacleProbe(p: ObstacleProbe | null): void { active = p; }

/** Null when the running world has no probe yet — traversal then simply does
 *  nothing, rather than guessing at geometry it cannot see. */
export function getObstacleProbe(): ObstacleProbe | null { return active; }
