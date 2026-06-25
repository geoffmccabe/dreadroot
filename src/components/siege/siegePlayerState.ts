// siegePlayerState — a tiny module flag so siege monsters know the player is a ghost (dead) and
// should stop hunting and wander off. Set true when the player dies mid-challenge (ChallengeRunner
// .lose()) and cleared when a challenge (re)starts. Read every frame by MonsterEnemy's movement.
let dead = false;
export function setSiegePlayerDead(v: boolean) { dead = v; }
export function isSiegePlayerDead() { return dead; }
