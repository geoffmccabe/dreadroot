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

/** One cluster of monsters dropped during a wave. */
export interface MonsterDrop {
  type: number;            // monster catalog id (1-7 today; see siegeMonsterCatalog)
  count: number;           // how many spawn (spread around x,z)
  x: number;               // world X (ground position)
  z: number;               // world Z (ground position)
  dropHeight?: number;     // metres ABOVE ground to appear at; undefined → rise out of the ground over 1s
  delayMs?: number;        // ms into the wave before this drop appears (0 / undefined = at wave start)
  staggerMs?: number;      // if set, the `count` spawn ONE every this-many ms (only during this wave)
  boss?: BossMods;         // if set, apply boss modifiers to every monster in this drop
}

/** One of the 10 waves. All authoring fields are optional (nothing is required). */
export interface ChallengeWave {
  name?: string;
  image?: string;          // shown under the wave name on the announcement
  text?: string;           // smaller advice/clue/taunt text
  timeSec: number;         // wave time limit, 60-180s
  costDivi?: number;       // cost to play this wave (Divi)
  pctToPool?: number;      // % of the fee that feeds the prize pool
  drops: MonsterDrop[];    // up to 10
}

/** A full challenge: general info + exactly 10 waves. */
export interface Challenge {
  id?: string;
  name: string;
  creator: string;
  rewardDivi?: number;
  banner?: string;         // 4x1 webp banner URL
  spawn?: [number, number, number];  // where the player is teleported when the challenge starts
  waves: ChallengeWave[];  // length 10
}

export const WAVES_PER_CHALLENGE = 10;
