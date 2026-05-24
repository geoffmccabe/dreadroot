/** Module-level constants for the Shpider system. */

// Body parts per shpider, used for instanced rendering allocations.
export const LEGS_PER_SHPIDER = 8;
export const SEGMENTS_PER_LEG = 3;
export const LEG_SEGMENTS_TOTAL = LEGS_PER_SHPIDER * SEGMENTS_PER_LEG; // 24
export const PARTS_PER_SHPIDER = 1 + 1 + LEG_SEGMENTS_TOTAL; // body + head + 24 legs = 26

// Leg segment dimensions (block units, before scaling by shpider scale).
export const LEG_SEGMENT_THICKNESS = 0.15;
export const LEG_SEGMENT_LENGTH = 0.5;

// Hop physics — falling tail of the parabola only kicks in if the
// shpider is in the air. While hopping, gravity is implicit in the
// Y(t) = lerp + arcHeight * sin(pi*t) formula.
export const HOP_GRAVITY = 18.0; // blocks/sec^2, used when free-falling

// Distance per chunk for spawn-rate decay (matches Shombie's halving).
export const SPAWN_CHECK_INTERVAL_MS = 2000;
export const MAX_SHPIDERS_PER_CHUNK = 4;
export const CHUNK_SIZE = 16;

// Hitbox cylinder used by the bullet ray-cylinder hit-test. Multiplied
// by body_size × scale at hit time so big tiers get proportionally
// bigger hitboxes.
export const SHPIDER_HITBOX_RADIUS_FACTOR = 0.85; // × bodySize × scale
export const SHPIDER_HITBOX_HEIGHT_FACTOR = 1.5;  // × bodySize × scale (covers body + head)

// Anti-overlap radius used when choosing crawl + hop targets. Min
// distance from any other living shpider so they don't pile up.
export const SHPIDER_MIN_TARGET_SPACING = 1.2;
