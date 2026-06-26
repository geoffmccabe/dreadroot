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
