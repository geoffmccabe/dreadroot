/**
 * Shtickman behavior tree — Phase 1.2 of the master plan.
 *
 * The shtickman's mad-shake / patrol behavior on the SHARED behavior-tree engine,
 * so it joins the shpider + the 5 combat creatures on one runtime. Like the
 * shpider it's a SELECTOR-shaped tree whose conditions read flags/timers off the
 * instance (the "blackboard") and whose actions delegate to the existing patrol
 * functions in ../lib/patrolAI — so behavior is identical to the legacy FSM.
 *
 * Tree (priority):
 *   isStillMad         → shakeMad           (jitter, stop)
 *   else: pickTarget, then
 *     reachedTree      → arriveAndWait      (stop)
 *     else             → patrolWalk         (re-path + follow + move + gravity)
 * Mad EXPIRY (restore the captured pose) runs as a pre-step so an expired
 * shtickman both restores and walks the same tick, exactly as the loop did.
 */
import {
  compileTree, runTree,
  type BTContext, type BTNode, type BTRegistry, type CompiledNode,
} from '@/features/enemies/ai/behaviorTree';
import type { ShtickmanInstance } from '../types';
import {
  type ShtickmanStepDeps,
  madExpiryCleanup, shakeMad, maybePickTarget, reachedTree, arriveAndWait, patrolWalk,
  stepShtickmanLegacy,
} from '../lib/patrolAI';

interface ShtickmanBTContext extends BTContext {
  s: ShtickmanInstance;
  deps: ShtickmanStepDeps;
}

const registry: BTRegistry = {
  conditions: {
    // After the mad-expiry pre-step, a still-set madUntil means "still mad".
    isStillMad: (_p, ctx) => (ctx as ShtickmanBTContext).s.madUntil !== undefined,
    reachedTree: (_p, ctx) => reachedTree((ctx as ShtickmanBTContext).s),
  },
  actions: {
    shakeMad: (_p, ctx) => {
      shakeMad((ctx as ShtickmanBTContext).s);
      return 'success';
    },
    pickTarget: (_p, ctx) => {
      const c = ctx as ShtickmanBTContext;
      maybePickTarget(c.s, c.deps);
      return 'success';
    },
    arriveAndWait: (_p, ctx) => {
      const c = ctx as ShtickmanBTContext;
      arriveAndWait(c.s, c.deps);
      return 'success';
    },
    patrolWalk: (_p, ctx) => {
      const c = ctx as ShtickmanBTContext;
      patrolWalk(c.s, c.deps);
      return 'success';
    },
  },
};

const SHTICKMAN_TREE: BTNode = {
  type: 'selector',
  children: [
    {
      type: 'sequence',
      children: [
        { type: 'condition', check: 'isStillMad' },
        { type: 'action', action: 'shakeMad' },
      ],
    },
    {
      type: 'sequence',
      children: [
        { type: 'action', action: 'pickTarget' },
        {
          type: 'selector',
          children: [
            {
              type: 'sequence',
              children: [
                { type: 'condition', check: 'reachedTree' },
                { type: 'action', action: 'arriveAndWait' },
              ],
            },
            { type: 'action', action: 'patrolWalk' },
          ],
        },
      ],
    },
  ],
};

const compiled: CompiledNode = compileTree(SHTICKMAN_TREE, registry);

// Reused per-tick context — shtickmen step sequentially, so one is enough.
const ctx: ShtickmanBTContext = {
  now: 0,
  blackboard: {},
  output: null,
  s: null as unknown as ShtickmanInstance,
  deps: null as unknown as ShtickmanStepDeps,
};

/** BT-driven shtickman step. Mad-expiry cleanup runs first (pre-step), then the
 *  tree picks shake vs the patrol pipeline. */
export function stepShtickmanBT(s: ShtickmanInstance, deps: ShtickmanStepDeps): void {
  madExpiryCleanup(s, deps);
  ctx.s = s;
  ctx.deps = deps;
  ctx.now = deps.now;
  runTree(compiled, ctx);
}

/** Flip to false for instant rollback to the legacy FSM (identical behavior). */
export const SHTICKMAN_BT_ENABLED = true;

/** Drop-in per-shtickman step dispatcher used by the system hook. */
export function stepShtickmanAI(s: ShtickmanInstance, deps: ShtickmanStepDeps): void {
  if (SHTICKMAN_BT_ENABLED) stepShtickmanBT(s, deps);
  else stepShtickmanLegacy(s, deps);
}
