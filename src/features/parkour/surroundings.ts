/**
 * "What is around me?" — the one measurement every parkour move reads.
 *
 * WHY THIS IS AN INTERFACE AND NOT A FUNCTION. DreadRoot is voxel: the answer
 * comes from reading a column of blocks, which is cheap and exact. Siege Worlds
 * is not — its world is arbitrary meshes and terrain, so the same question needs
 * raycasts, surface normals, and a tolerance for ledges that are neither flat
 * nor axis-aligned. Genuinely different implementations of one idea.
 *
 * So the MEASUREMENT is abstracted and the moves are written once against it.
 * Adding a move costs a threshold and a clip; adding a WORLD costs one
 * implementation of this interface and nothing else.
 */

export interface Surroundings {
  /** Height of the obstacle's top surface ABOVE the player's feet, in metres.
   *  One DreadRoot block is one metre. */
  height: number;
  /** Clear space ABOVE the obstacle's top. Below the player's own height this
   *  is a gap to slide/crawl through, not a ledge to climb. */
  headroom: number;
  /** How deep the obstacle is along the direction of travel, in metres. A thin
   *  obstacle can be vaulted; a deep one has to be climbed onto. Infinity when
   *  the far side is beyond what the scanner looked at. */
  depth: number;
  /** World Y of the surface the player would end up standing on. */
  topY: number;
  /** Distance from the player to the obstacle's near face, in metres. */
  distance: number;
  /** True when the top is a surface the player could actually stand on, rather
   *  than the underside of something. */
  standable: boolean;
  /** Ground height on the FAR side, for moves that go over rather than onto.
   *  Null when the far side was not reachable within the scanner's look-ahead —
   *  vaulting into an unknown drop is how a character ends up in a pit. */
  farSideY: number | null;
  /** Open height BENEATH an overhead obstacle — a bar or beam you pass under.
   *  This is a different measurement from `headroom`, which is the space above.
   *  NULL means "not measured", which is the honest answer from the voxel
   *  scanner today: it walks up from the feet and stops at the first standable
   *  surface, so it never sees the gap underneath a beam. Phase 2 fills it. */
  clearanceBelow: number | null;
  /** How far the ground falls away just ahead, in metres. 0 = flat. Drives the
   *  drop-and-roll move. Not measured by the voxel scanner yet — Phase 2. */
  dropAhead: number;
  /** Angle between the direction of travel and the obstacle's face normal, in
   *  degrees. 0 = running straight at it. Drives side vaults and wall flips.
   *  Not measured yet — Phase 2. */
  approachAngleDeg: number;
}

export interface Scanner {
  /** A name for diagnostics — which world model answered. */
  readonly kind: 'voxel' | 'mesh';
  /**
   * Look ahead from a position along a direction.
   * @param x,y,z   the player's FEET.
   * @param fx,fz   normalised forward direction (XZ).
   * @param reach   how far ahead to look, metres.
   * @param maxRise the tallest obstacle worth reporting, metres.
   * @returns the surroundings, or null for clear ground.
   */
  scan(
    x: number, y: number, z: number,
    fx: number, fz: number,
    reach: number, maxRise: number,
  ): Surroundings | null;
}

let active: Scanner | null = null;

/** Installed by whichever world is running. */
export function setScanner(s: Scanner | null): void { active = s; }

/** Null when the running world has no scanner yet — parkour then simply does
 *  nothing, rather than guessing at geometry it cannot see. */
export function getScanner(): Scanner | null { return active; }

/** Fields the voxel scanner does not measure yet, so every producer — including
 *  the lineup's synthetic test obstacles — agrees on one shape. */
export const UNMEASURED = {
  clearanceBelow: null,
  dropAhead: 0,
  approachAngleDeg: 0,
} as const;
