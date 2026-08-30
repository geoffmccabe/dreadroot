/**
 * Where the player's FEET are, published once a frame by the movement loop.
 *
 * Everything in this folder measures from the feet, not the camera — a probe
 * run from the eye reads a wall one and a half metres too high. The controller
 * is the only thing that knows the difference (it holds the eye height for the
 * character currently loaded), so it publishes the answer rather than every
 * consumer re-deriving it and drifting.
 *
 * A plain module-level record, not React state: this changes every frame and a
 * re-render per frame is exactly what the performance rules forbid.
 */
export interface PlayerFeet {
  x: number; y: number; z: number;
  /** Normalised forward direction in XZ. */
  fx: number; fz: number;
  /** False until the movement loop has run at least once. */
  known: boolean;
}

const feet: PlayerFeet = { x: 0, y: 0, z: 0, fx: 0, fz: -1, known: false };

export function publishPlayerFeet(x: number, y: number, z: number, fx: number, fz: number): void {
  feet.x = x; feet.y = y; feet.z = z; feet.fx = fx; feet.fz = fz; feet.known = true;
}

export function getPlayerFeet(): Readonly<PlayerFeet> { return feet; }
