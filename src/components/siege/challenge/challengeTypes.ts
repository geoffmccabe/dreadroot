// Challenge Creator — data model (Phase 1). A Challenge is ALWAYS 10 waves. A wave runs for a
// time limit and spawns "drops" (clusters of a monster type at a map position). The runner ends a
// wave early when every monster from it is dead, and carries unkilled monsters into the next wave.
// Authoring UI, persistence, leaderboards and the Divi economy are later phases — this is just the
// shape the runner plays.

/** Boss size/stat multipliers, as PERCENT of normal (100 = unchanged, 200 = double). */
export interface BossMods {
  sizePct: number;
  speedPct: number;
  healthPct: number;
  damagePct: number;
}

/** Per-spawn colour overrides applied on top of the monster's textures (preview + in-game). */
export interface ColorMods {
  sat: number;       // saturation %, 0 = grey, 100 = normal, 200 = double-saturated
  hue: number;       // hue rotation in DEGREES (0-360)
  tint: string;      // overlay colour (hex)
  tintAmt: number;   // tint strength %, 0 = none, 100 = full overlay
  blend?: string;    // tint BLEND mode (normal / multiply / screen / overlay / … see colorMods.ts); default normal
}

/** One cluster of monsters dropped during a wave. */
export interface MonsterDrop {
  type: number;            // monster catalog id (1-7 today; see siegeMonsterCatalog)
  count: number;           // how many spawn (spread around x,z)
  x: number;               // world X (ground position)
  z: number;               // world Z (ground position)
  dropHeight?: number;     // metres ABOVE ground to appear at; undefined → rise out of the ground over 1s
  afterSec?: number;       // SECONDS since the previous spawn in this wave (0 = with it / at wave start)
  staggerMs?: number;      // if set, the `count` spawn ONE every this-many ms (only during this wave)
  boss?: BossMods;         // if set, apply boss modifiers to every monster in this drop
  color?: ColorMods;       // if set, recolour this drop's monsters (else the monster's natural look)
  ballColor?: string;      // Elemental Golem (type 15) only: hex tint for its thrown boulders (default rock grey)
  // SUPERADMIN "special": a hard-coded, world/map-specific set piece (easter egg etc.) chosen from the
  // Specials registry. When set, this drop is NOT a normal monster spawn — the runner invokes the
  // hard-coded behaviour keyed by `code` instead (see ChallengeRunner). `type/count/x/z` are ignored.
  special?: { code: number; name: string };
  // How this drop's monsters are placed (see ChallengeRunner.buildMobs). Omitted = legacy scatter
  // around the arena. random/grid/circle centre on the PLAYER's live position when the spawn fires;
  // coords places them at an absolute world point (x,z), chosen on the minimap.
  pattern?: SpawnPattern;
}

export type SpawnMode = 'random' | 'grid' | 'circle' | 'coords';
export interface SpawnPattern {
  mode: SpawnMode;
  minDist?: number;   // random: inner radius from the player (default ~ a few m)
  maxDist?: number;   // random: outer radius (default = challenge scatterRadius)
  spacing?: number;   // grid: metres between monsters
  radius?: number;    // circle: ring radius around the player
}

/** One of the 10 waves. All authoring fields are optional (nothing is required). */
export interface ChallengeWave {
  name?: string;
  image?: string;          // shown under the wave name on the announcement
  text?: string;           // smaller advice/clue/taunt text
  timeSec: number;         // wave time limit, 60-180s
  drops: MonsterDrop[];    // up to 10
}

/** A full challenge: general info + exactly 10 waves. */
export interface Challenge {
  id?: string;
  name: string;
  creator: string;
  game?: string;           // which game this challenge belongs to (dreadroot / siege-worlds / pinkland / …).
                           // A challenge only ever runs in its own game; the Browser + region spawner are
                           // scoped to the active game. Defaults to the active game at creation.
  rewardDivi?: number;
  costDivi?: number;       // cost to play the WHOLE challenge (Divi) — challenge-level, not per-wave
  pctToPool?: number;      // % of the fee that feeds the prize pool — challenge-level
  banner?: string;         // 4x1 webp banner URL
  mapId?: string;          // which WORLD/map the challenge plays in (CHALLENGE_WORLDS). Empty/undefined
                           // = the open world (no map switch). Else the runner jumps to that baked map.
  region?: string;         // superadmin: if set, this is the base Open-World spawner for that region
  spawn?: [number, number, number];  // where the player is teleported when the challenge starts
  // If set, monster positions are SEEDED (deterministic, learnable) within this radius (m) of the
  // spawn point instead of using each drop's x,z. Staggered monsters each get their own point;
  // hordes cluster at one point. (For the test challenge; the creator places exact points later.)
  scatterRadius?: number;
  waves: ChallengeWave[];  // length 10
}

export const WAVES_PER_CHALLENGE = 10;
