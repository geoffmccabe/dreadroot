/**
 * Coin drops — types. See docs/COIN_DROPS.md.
 *
 * Deliberately small + flat so the module ports to DreadRoot by copying the
 * `coinDrops/` folder. Visual/behavior knobs live in CoinDropBehaviorConfig
 * (config.ts) so future additions (glow, lifespan, transparency, alternate
 * float behaviors) are one field, not a refactor.
 */

/** One admin-authored drop rule on a monster tier (stored in the def's coin_drops JSONB). */
export interface CoinDropConfig {
  /** token_themes.id — which coin type drops (crypto or points). */
  coin: string;
  /** % chance (0–100) this entry fires on a kill. */
  chance: number;
  /** Min/max coins awarded when it fires. */
  min: number;
  max: number;
  /** Where the coins come from. 'game_pool' = minted; a user id = that user's wallet (future). */
  source?: 'game_pool' | string;
}

/** A floating coin instance in the world (a world_coin_drops row). */
export interface CoinDropInstance {
  id: string;
  world_id: string;
  token_theme_id: string;
  amount: number;
  /** How many floating sprites represent this drop (1–10, normalized — see config). */
  float_count: number;
  killer_user_id: string | null;
  position_x: number;
  position_y: number;
  position_z: number;
  dropped_at: string;
  picked_up: boolean;
}

/**
 * Modular visual + behavior knobs for the floating coins. Global defaults today
 * (config.ts); intended to become per-coin / admin-tunable later. Add a field
 * here to add a capability — nothing else needs to change shape.
 */
export interface CoinDropBehaviorConfig {
  // Spawn
  spawnScatterRadius: number;   // initial random pop spread (blocks)
  spawnUpVelocity: number;      // initial upward pop (blocks/s)
  gravity: number;              // fall accel (blocks/s^2) until settled
  settleHeight: number;         // hover height above the drop point (blocks)
  // Idle motion
  bobAmplitude: number;         // vertical bob (blocks)
  bobFrequencyHz: number;       // bobs per second
  spinSpeed: number;            // spin (rad/s)
  // Look
  scale: number;                // sprite size (blocks)
  scaleJitter: number;          // 0..1 random size variation
  baseOpacity: number;          // 0..1
  glowAdditive: boolean;        // additive blending for a glow
  // Magnet + collect
  magnetRange: number;          // start flying to the player within this (blocks)
  magnetSpeed: number;          // attraction speed (blocks/s, accelerates)
  collectRange: number;         // auto-collect within this (blocks)
  // Lifetime
  lifespanMsMin: number;        // despawn window (ms) — randomized per drop
  lifespanMsMax: number;
  fadeOutMs: number;            // fade before despawn (ms)
}
