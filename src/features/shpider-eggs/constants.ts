// Shpider Egg tuning. One place for the whole feel.

/** Forward throw speed (m/s along camera look projected to ground). */
export const EGG_THROW_SPEED = 18;

/** Upward kick on throw. */
export const EGG_THROW_UP = 7;

/** World gravity. Same as grenades for consistent arcs. */
export const EGG_GRAVITY = 18;

/** Per-bounce energy retention. */
export const EGG_BOUNCE_DAMP = 0.4;

/** Friction multiplier per second while rolling. */
export const EGG_ROLL_FRICTION_PER_SEC = 0.6;

/** Visual radius (m). 0.25m sphere per spec → 0.125 radius. */
export const EGG_VISUAL_RADIUS = 0.125;

/** Speed below which the egg is considered "at rest". */
export const EGG_REST_SPEED = 0.4;

/** Seconds the egg must stay at rest before hatching. Gives bounces
 *  and rolls time to settle so the hatch happens at the final spot. */
export const EGG_REST_HATCH_SEC = 0.25;

/** Max eggs in flight at once. */
export const MAX_LIVE_EGGS = 16;
