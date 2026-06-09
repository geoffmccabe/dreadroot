/**
 * compile — turn an authored BTNode (JSON) into a CompiledNode tree where every
 * condition/action NAME is bound to its registry function ONCE. The hot per-tick
 * runtime then walks function refs, never re-parsing JSON or doing string
 * lookups. Unknown leaf names fail loudly here (at load), not silently at tick.
 *
 * Compiled trees are cached by the caller (per creature+game), so this runs once.
 */
import type { BTNode, BTRegistry, ConditionFn, ActionFn, ScoreFn } from './types';

export type CompiledNode =
  | { kind: 'sequence'; children: CompiledNode[] }
  | { kind: 'selector'; children: CompiledNode[] }
  | { kind: 'utility'; children: CompiledNode[] }
  | { kind: 'invert'; child: CompiledNode }
  | { kind: 'condition'; check: string; fn: ConditionFn; params: Record<string, unknown> }
  | { kind: 'action'; action: string; fn: ActionFn; params: Record<string, unknown> }
  | { kind: 'behavior'; behavior: string; score: ScoreFn; run: ActionFn; params: Record<string, unknown> };

export class BTCompileError extends Error {}

export function compileTree(node: BTNode, reg: BTRegistry): CompiledNode {
  switch (node.type) {
    case 'sequence':
      return { kind: 'sequence', children: node.children.map((c) => compileTree(c, reg)) };
    case 'selector':
      return { kind: 'selector', children: node.children.map((c) => compileTree(c, reg)) };
    case 'utility': {
      const children = node.children.map((c) => compileTree(c, reg));
      for (const c of children) {
        if (c.kind !== 'behavior') {
          throw new BTCompileError('utility children must be `behavior` leaves (they need a score)');
        }
      }
      return { kind: 'utility', children };
    }
    case 'behavior': {
      const leaf = reg.behaviors?.[node.behavior];
      if (!leaf) throw new BTCompileError(`unknown behavior "${node.behavior}"`);
      return { kind: 'behavior', behavior: node.behavior, score: leaf.score, run: leaf.run, params: node.params ?? {} };
    }
    case 'invert':
      return { kind: 'invert', child: compileTree(node.child, reg) };
    case 'condition': {
      const fn = reg.conditions[node.check];
      if (!fn) throw new BTCompileError(`unknown condition "${node.check}"`);
      return { kind: 'condition', check: node.check, fn, params: node.params ?? {} };
    }
    case 'action': {
      const fn = reg.actions[node.action];
      if (!fn) throw new BTCompileError(`unknown action "${node.action}"`);
      return { kind: 'action', action: node.action, fn, params: node.params ?? {} };
    }
    default:
      throw new BTCompileError(`unknown node type "${(node as { type: string }).type}"`);
  }
}
