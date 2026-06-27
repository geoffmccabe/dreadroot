// siegePlayerState — a tiny module flag so siege monsters know the player is a ghost (dead) and
// should stop hunting and wander off. Set true when the player dies mid-challenge (ChallengeRunner
// .lose()) and cleared when a challenge (re)starts. Read every frame by MonsterEnemy's movement.
let dead = false;
export function setSiegePlayerDead(v: boolean) { dead = v; }
export function isSiegePlayerDead() { return dead; }

// Spawn pin — while non-null, the controller PINS the player's eye Y here and applies no gravity, so
// a challenge spawn holds at its authored height until the real ground at that height is ready (the
// baked mesh builds in the background; without this the player snaps onto whatever lower layer
// finishes first). Set by ChallengeRunner on spawn, cleared once it settles them or it times out.
let spawnPinY: number | null = null;
export function setSiegeSpawnPin(y: number | null) { spawnPinY = y; }
export function getSiegeSpawnPin() { return spawnPinY; }

// Pending teleport spawn — set by a Cmd-J jump (or a challenge "Worlds" card) just before the map
// switches. The controller consumes it on the map (world.id) change and drops the player at THIS
// camera-space position/facing instead of the world's own spawn.position. Without it, the
// controller's world-change reset overwrote the teleport target with the map's (often placeholder)
// spawn, so Cmd-J appeared to ignore the assigned spawn point. pos is a CAMERA (eye) position —
// applied directly, no eye-height offset (these are captured camera spots).
export interface PendingSpawn { pos: [number, number, number]; yaw?: number; pitch?: number }
let pendingSpawn: PendingSpawn | null = null;
export function setSiegePendingSpawn(s: PendingSpawn | null) { pendingSpawn = s; }
export function consumeSiegePendingSpawn(): PendingSpawn | null { const s = pendingSpawn; pendingSpawn = null; return s; }
