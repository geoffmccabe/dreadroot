/**
 * playerSim — the SHARED, pure local-player movement step. The client predicts
 * with it (Track 4D) and the L2 simulates the authoritative player with the
 * exact same function — they MUST match bit-for-bit or every input mispredicts.
 * This is the single source of truth for "what an input does to a player".
 *
 * PURE: no DOM / Three.js / time source. Collision against the voxel world is
 * applied by the caller (server: authoritative grid; client: predicted grid) —
 * kept out of here so the math stays identical on both sides.
 */

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** One client input command. `seq` lets the server ack it and the client drop
 *  replayed inputs; `dtMs` is the exact step so replay reproduces prediction. */
export interface PlayerInputCmd {
  seq: number;
  moveX: number; // intended horizontal direction, expected unit-ish (-1..1)
  moveZ: number;
  yaw: number;
  dtMs: number;
}

/** Default ground speed (blocks/sec). Server-authoritative; the real per-tier
 *  value is supplied by the caller later (anti-cheat: clamp to the tier max). */
export const PLAYER_SPEED = 6;

/**
 * Advance `s` by one input. Mutates in place (called in hot replay loops, so no
 * allocation). `speed` is the authority's per-tier cap.
 *
 * Anti-cheat clamps (shared, so honest clients are unaffected — their inputs are
 * already in range — while a hacked client gets capped by the server):
 *  • the move vector is clamped to unit length → no oversized-vector speed-hack,
 *    and diagonals don't move faster than cardinals.
 *  • `maxDtMs` caps the time-step → no teleport-via-huge-dt. The SERVER passes
 *    its tick interval; the client passes Infinity (it predicts with real frame
 *    time, then reconciles to the server's capped result).
 */
export function stepPlayer(
  s: PlayerState, cmd: PlayerInputCmd, speed: number = PLAYER_SPEED, maxDtMs: number = Infinity,
): void {
  const dt = Math.min(Math.max(cmd.dtMs, 0), maxDtMs) / 1000;
  let mx = cmd.moveX, mz = cmd.moveZ;
  const mag = Math.sqrt(mx * mx + mz * mz);
  if (mag > 1) { mx /= mag; mz /= mag; }
  s.x += mx * speed * dt;
  s.z += mz * speed * dt;
  s.yaw = cmd.yaw;
}
