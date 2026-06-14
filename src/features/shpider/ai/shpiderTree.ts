/**
 * Shpider behavior tree — Phase 1.1 of the master plan.
 *
 * The shpider's timed idle→crawl→hop predator FSM, expressed on the SHARED
 * behavior-tree engine so every creature runs on one runtime. Key validation:
 * the engine needed NO changes — a timed FSM is just a SELECTOR-shaped tree
 * whose phase/timers live on the instance (the "blackboard"). The combat
 * creatures use a UTILITY-shaped tree; the shpider uses a SELECTOR-shaped one.
 * Both are the same engine.
 *
 * The DECISION structure lives here (the tree). The EXECUTION is the existing,
 * proven phase functions in ../lib/hopAI (unchanged) — so behavior is identical
 * to the legacy FSM. This is pure re-orchestration, not a rewrite.
 *
 * PORTABILITY NOTE (for Phase 3 / server): this module is decision-structure +
 * thin action wrappers. The wrapped phase functions still touch THREE + world
 * queries (movement/execution), which the server will run authoritatively; the
 * audio side effects (hop/landing sounds) are the only client-only bits and are
 * already isolated inside hopAI.
 */
import {
  compileTree, runTree,
  type BTContext, type BTNode, type BTRegistry, type CompiledNode,
} from '@/features/enemies/ai/behaviorTree';
import { isPointInFSZ } from '@/features/enemies/ai/fortressSafeZone';
import type { ShpiderInstance } from '../types';
import {
  type StepDeps,
  applyKnockback, gravityStep,
  escapeFSZ, decideIdleAction, continueCrawl, continueHop,
  stepShpiderHopAI,
} from '../lib/hopAI';

/** Per-tick context: the engine fields plus the shpider + its frame deps. */
interface ShpiderBTContext extends BTContext {
  s: ShpiderInstance;
  deps: StepDeps;
}

/** Conditions read the phase/timers off the instance; actions delegate to the
 *  shared phase functions. Actions always 'succeed' (they handled the phase). */
const registry: BTRegistry = {
  conditions: {
    isIdle: (_p, ctx) => (ctx as ShpiderBTContext).s.hop.phase === 'idle',
    isCrawling: (_p, ctx) => (ctx as ShpiderBTContext).s.hop.phase === 'crawling',
    isHopping: (_p, ctx) => (ctx as ShpiderBTContext).s.hop.phase === 'hopping',
    inFSZ: (_p, ctx) => {
      const s = (ctx as ShpiderBTContext).s;
      return isPointInFSZ(s.position.x, 0, s.position.z);
    },
  },
  actions: {
    escapeFSZ: (_p, ctx) => {
      const c = ctx as ShpiderBTContext;
      escapeFSZ(c.s, c.deps);
      return 'success';
    },
    decideIdle: (_p, ctx) => {
      const c = ctx as ShpiderBTContext;
      decideIdleAction(c.s, c.deps);
      return 'success';
    },
    continueCrawl: (_p, ctx) => {
      const c = ctx as ShpiderBTContext;
      continueCrawl(c.s, c.deps);
      return 'success';
    },
    continueHop: (_p, ctx) => {
      const c = ctx as ShpiderBTContext;
      continueHop(c.s, c.deps);
      return 'success';
    },
  },
};

/**
 * Priority selector — mirrors the legacy FSM's phase dispatch EXACTLY:
 *   idle & inside FSZ → escape;  idle → decide;  crawling → crawl;  hopping → hop.
 * The first matching branch runs and the selector returns, so at most one phase
 * action fires per tick (same as the FSM's early-returns).
 */
const SHPIDER_TREE: BTNode = {
  type: 'selector',
  children: [
    {
      type: 'sequence',
      children: [
        { type: 'condition', check: 'isIdle' },
        { type: 'condition', check: 'inFSZ' },
        { type: 'action', action: 'escapeFSZ' },
      ],
    },
    {
      type: 'sequence',
      children: [
        { type: 'condition', check: 'isIdle' },
        { type: 'action', action: 'decideIdle' },
      ],
    },
    {
      type: 'sequence',
      children: [
        { type: 'condition', check: 'isCrawling' },
        { type: 'action', action: 'continueCrawl' },
      ],
    },
    {
      type: 'sequence',
      children: [
        { type: 'condition', check: 'isHopping' },
        { type: 'action', action: 'continueHop' },
      ],
    },
  ],
};

/** Compiled once (binds names → fns; stateless, shared across all shpiders). */
const compiled: CompiledNode = compileTree(SHPIDER_TREE, registry);

/** Reused per-tick context — shpiders step sequentially, so one is enough
 *  (no per-frame allocation, matching the engine's hot-path discipline). */
const ctx: ShpiderBTContext = {
  now: 0,
  blackboard: {},
  output: null,
  s: null as unknown as ShpiderInstance,
  deps: null as unknown as StepDeps,
};

/**
 * BT-driven shpider step. Physics pre-pass (knockback + gravity) runs first —
 * identical to the legacy path, and not a "decision" — then the tree picks the
 * phase action.
 */
export function stepShpiderBT(s: ShpiderInstance, deps: StepDeps): void {
  applyKnockback(s, deps.dt);
  if (gravityStep(s, deps)) return; // airborne — skip phase logic this tick
  ctx.s = s;
  ctx.deps = deps;
  ctx.now = deps.now;
  runTree(compiled, ctx);
}

/**
 * Flip to false to fall back to the legacy FSM orchestrator (instant rollback —
 * both paths call the same phase functions, so behavior is identical). Shipped
 * ON: the shpider now runs on the shared behavior-tree engine.
 */
export const SHPIDER_BT_ENABLED = true;

/** Drop-in step dispatcher used by the renderer. */
export function stepShpiderAI(s: ShpiderInstance, deps: StepDeps): void {
  if (SHPIDER_BT_ENABLED) stepShpiderBT(s, deps);
  else stepShpiderHopAI(s, deps);
}
