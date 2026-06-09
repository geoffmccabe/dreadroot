/**
 * behaviorTreeBridge — glues the pure behavior-tree engine to the game's
 * existing behaviors. A creature's DEFAULT tree is a single `utility` node over
 * all its behaviors, which reproduces BehaviorBrain EXACTLY (argmax of
 * evaluate-scores, run the winner, with the same enter/exit transitions). So
 * switching a creature to tree-driven AI is zero behavior change — and that tree
 * can later be cracked open into explicit branches for the editor/AI vision.
 *
 * Game types are imported as TYPES ONLY → erased at runtime, so this stays free
 * of THREE/heavy deps and is unit-testable in Node like the engine.
 */
import { runTree, type BTContext, type BTNode, type BTRegistry, type BehaviorLeaf, type CompiledNode } from './behaviorTree';
import type { BehaviorModule, BehaviorContext, BehaviorResult } from './types';

const IDLE: BehaviorResult = { kind: 'idle' };

/** Per-creature BT context — created once, reused every tick (no allocation). */
export interface CreatureBTContext extends BTContext {
  bctx: BehaviorContext;
  deltaMs: number;
  behaviorResult: BehaviorResult;
  currentBehaviorId: string | null; // for enter/exit transitions
  modules: BehaviorModule[];        // to find the outgoing behavior on a switch
}

/**
 * Build a BTRegistry whose `behaviors` wrap the given modules: score = evaluate,
 * run = tick, with BehaviorBrain's exact enter/exit-on-transition semantics.
 */
export function behaviorRegistry(modules: BehaviorModule[]): BTRegistry {
  const behaviors: Record<string, BehaviorLeaf> = {};
  for (const m of modules) {
    behaviors[m.id] = {
      score: (_p, ctx) => m.evaluate((ctx as CreatureBTContext).bctx),
      run: (_p, ctx) => {
        const c = ctx as CreatureBTContext;
        if (c.currentBehaviorId !== m.id) {
          if (c.currentBehaviorId) {
            c.modules.find((x) => x.id === c.currentBehaviorId)?.exit?.(c.bctx);
          }
          m.enter?.(c.bctx);
          c.currentBehaviorId = m.id;
        }
        c.behaviorResult = m.tick(c.bctx, c.deltaMs);
        c.output = { action: m.id, params: {} };
        return 'success';
      },
    };
  }
  return { conditions: {}, actions: {}, behaviors };
}

/** Default tree for a creature: a utility node over all its behaviors. */
export function defaultTree(modules: BehaviorModule[]): BTNode {
  return { type: 'utility', children: modules.map((m) => ({ type: 'behavior', behavior: m.id })) };
}

/** Make the reusable per-creature context (hold onto it across ticks). */
export function makeCreatureCtx(modules: BehaviorModule[]): CreatureBTContext {
  return {
    now: 0,
    blackboard: {},
    output: null,
    bctx: null as unknown as BehaviorContext,
    deltaMs: 0,
    behaviorResult: IDLE,
    currentBehaviorId: null,
    modules,
  };
}

/**
 * Evaluate a creature's compiled tree this tick → the BehaviorResult to execute.
 * Drop-in replacement for BehaviorBrain.tick (returns idle if nothing fired).
 */
export function runCreatureTree(
  root: CompiledNode, ctx: CreatureBTContext, bctx: BehaviorContext, deltaMs: number,
): BehaviorResult {
  ctx.bctx = bctx;
  ctx.deltaMs = deltaMs;
  ctx.behaviorResult = IDLE;
  runTree(root, ctx);
  return ctx.behaviorResult;
}

/**
 * Mirror of BehaviorBrain.forceExit — on creature death/despawn, run the
 * currently-selected behavior's exit() cleanup and clear the selection. Slice 3
 * MUST call this wherever it used to call BehaviorBrain.forceExit, or exit-on-
 * death side effects (e.g. stopping a looping sound) would be lost.
 */
export function forceExitCreatureTree(ctx: CreatureBTContext, bctx: BehaviorContext): void {
  if (ctx.currentBehaviorId) {
    ctx.bctx = bctx;
    ctx.modules.find((x) => x.id === ctx.currentBehaviorId)?.exit?.(bctx);
    ctx.currentBehaviorId = null;
  }
}
