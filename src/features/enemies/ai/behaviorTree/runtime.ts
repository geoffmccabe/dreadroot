/**
 * runtime — the lean per-tick interpreter. Walks a compiled tree and returns the
 * action the creature chose this tick (or null = idle). Pure function calls over
 * pre-bound refs; no allocation, no string lookups → safe for ~1000 creatures
 * when combined with the caller's LOD throttling.
 */
import type { BTContext, BTOutput, BTStatus } from './types';
import type { CompiledNode } from './compile';

function tick(node: CompiledNode, ctx: BTContext): BTStatus {
  switch (node.kind) {
    case 'sequence': {
      // All must succeed, in order; stop at the first failure.
      for (let i = 0; i < node.children.length; i++) {
        if (tick(node.children[i], ctx) === 'failure') return 'failure';
      }
      return 'success';
    }
    case 'selector': {
      // Priority: the first child that succeeds wins.
      for (let i = 0; i < node.children.length; i++) {
        if (tick(node.children[i], ctx) === 'success') return 'success';
      }
      return 'failure';
    }
    case 'utility': {
      // Highest-scoring child wins, then runs (= BehaviorBrain's argmax). Ties
      // resolve to the first (earlier child = higher authored priority).
      let best: CompiledNode | null = null;
      let bestScore = -Infinity;
      for (let i = 0; i < node.children.length; i++) {
        const c = node.children[i];
        if (c.kind !== 'behavior') continue;
        const s = c.score(c.params, ctx);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      return best ? tick(best, ctx) : 'failure';
    }
    case 'invert':
      return tick(node.child, ctx) === 'success' ? 'failure' : 'success';
    case 'condition':
      return node.fn(node.params, ctx) ? 'success' : 'failure';
    case 'action':
      return node.fn(node.params, ctx);
    case 'behavior':
      return node.run(node.params, ctx);
  }
}

/**
 * Evaluate the tree once. Returns the action leaf that fired (it set ctx.output),
 * or null if nothing chose to act. The caller maps the result onto its own
 * behavior pipeline (move/attack/idle).
 */
export function runTree(root: CompiledNode, ctx: BTContext): BTOutput | null {
  ctx.output = null;
  tick(root, ctx);
  return ctx.output;
}
