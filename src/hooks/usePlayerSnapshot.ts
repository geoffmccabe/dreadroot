// Canonical local-player snapshot. One source of truth for "where is
// the player right now" that every enemy AI hook reads each frame.
//
// Today this is fed from the camera by FortressScene's per-frame loop.
// After the L2 Durable Object migration, the snapshot will be fed by
// reconciled-server state instead — same shape, same accessors, so no
// downstream code changes. That's the whole point of this indirection.
//
// Why a module singleton instead of context / hook / prop?
//   - Exactly ONE local player exists at any time.
//   - Enemy AI hooks need zero-allocation reads every frame.
//   - Prop drilling cameraRef through six enemy systems was already
//     painful; replacing it with another prop drill defeats the
//     purpose.
//
// The renderer paths intentionally keep reading camera.position
// directly — those are per-client LOD / culling concerns, not
// "where is the player" decisions, and they'll stay client-side
// forever.

export interface PlayerSnapshot {
  /** World position (m). */
  x: number;
  y: number;
  z: number;
  /** Yaw around Y (radians), facing in -Z at yaw=0. */
  yaw: number;
  /** Pitch (radians), looking down at pitch < 0. */
  pitch: number;
  /** Velocity (m/s). Useful for AI lead-targeting and
   *  client-side prediction reconciliation. */
  vx: number;
  vy: number;
  vz: number;
  /** True when the player's feet are on a solid block. */
  onGround: boolean;
  /** True when the player is inside a no-combat safe-zone chunk
   *  (fortress courtyard, etc.). Reserved for future use. */
  inSafeZone: boolean;
}

const _snapshot: PlayerSnapshot = {
  x: 0, y: 0, z: 0,
  yaw: 0, pitch: 0,
  vx: 0, vy: 0, vz: 0,
  onGround: true,
  inSafeZone: false,
};

/** Read-only accessor. Returns the same object every call — callers
 *  should treat all fields as snapshot-of-this-frame and not retain
 *  references that span frames. */
export function getLocalPlayerSnapshot(): Readonly<PlayerSnapshot> {
  return _snapshot;
}

/** Update the snapshot. Called once per frame by FortressScene's
 *  useFrame loop. After the L2 migration this will be called by
 *  whatever reconciles server state for the local player. */
export function updateLocalPlayerSnapshot(patch: Partial<PlayerSnapshot>): void {
  if (patch.x !== undefined) _snapshot.x = patch.x;
  if (patch.y !== undefined) _snapshot.y = patch.y;
  if (patch.z !== undefined) _snapshot.z = patch.z;
  if (patch.yaw !== undefined) _snapshot.yaw = patch.yaw;
  if (patch.pitch !== undefined) _snapshot.pitch = patch.pitch;
  if (patch.vx !== undefined) _snapshot.vx = patch.vx;
  if (patch.vy !== undefined) _snapshot.vy = patch.vy;
  if (patch.vz !== undefined) _snapshot.vz = patch.vz;
  if (patch.onGround !== undefined) _snapshot.onGround = patch.onGround;
  if (patch.inSafeZone !== undefined) _snapshot.inSafeZone = patch.inSafeZone;
}
