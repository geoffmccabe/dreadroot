/**
 * Behavior-tree model (Slice 1) — the data shape a creature's AI is described in,
 * the same JSON the visual editor will draw and the AI generator will write.
 *
 * ENGINE-LEVEL + PORTABLE: no game-specific names, no React/Three/DB imports.
 * The game injects the actual condition/action implementations via a BTRegistry,
 * so this exact module serves DreadRoot and Pinkland unchanged — only the tree
 * DATA differs per creature/game.
 *
 * Reactive model: the tree is re-evaluated from the root every AI tick (no
 * cross-tick "running" memory). A tick asks one question — "what should this
 * creature do right now?" — and the first ACTION leaf that's reached answers it
 * by writing ctx.output. That priority-of-guarded-actions shape reproduces our
 * current "attack if you can, else chase, else wander".
 */

export type BTStatus = 'success' | 'failure';

/** Authored tree node (as stored in the DB / drawn in the editor). */
export type BTNode =
  | { type: 'sequence'; children: BTNode[] }   // all children must succeed, in order
  | { type: 'selector'; children: BTNode[] }   // first child that succeeds wins (priority)
  | { type: 'invert'; child: BTNode }          // flip success/failure
  | { type: 'condition'; check: string; params?: Record<string, unknown> } // a gate
  | { type: 'action'; action: string; params?: Record<string, unknown> };  // a leaf "do"

/** What the creature decided this tick (the action leaf that fired). The game
 *  maps this onto its own BehaviorResult (idle/move/attack) in Slice 2. */
export interface BTOutput {
  action: string;
  params: Record<string, unknown>;
}

/**
 * Per-tick context. The game builds one (reused across ticks — no per-tick
 * allocation) and fills in whatever its conditions/actions need (the enemy, the
 * target, the grid) on top of these required fields.
 */
export interface BTContext {
  /** monotonic time in ms (for cooldown-style conditions). */
  now: number;
  /** per-enemy scratch the conditions/actions may read/write (e.g. last-attack). */
  blackboard: Record<string, unknown>;
  /** set by the action leaf that fires; null = no action chose to act (idle). */
  output: BTOutput | null;
  /** game-specific fields (enemy ref, target, grid, …) live here too. */
  [key: string]: unknown;
}

export type ConditionFn = (params: Record<string, unknown>, ctx: BTContext) => boolean;
export type ActionFn = (params: Record<string, unknown>, ctx: BTContext) => BTStatus;

/** The game's library of available conditions + actions (the leaf vocabulary).
 *  The editor lists these; the compiler binds tree node names to them. */
export interface BTRegistry {
  conditions: Record<string, ConditionFn>;
  actions: Record<string, ActionFn>;
}
