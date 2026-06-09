/**
 * Behavior-tree engine (portable, game-agnostic). The visual editor reads/writes
 * BTNode JSON; the game registers its conditions/actions in a BTRegistry;
 * compileTree binds them once; runTree evaluates a creature's tree each tick.
 */
export type {
  BTNode, BTStatus, BTOutput, BTContext, BTRegistry, ConditionFn, ActionFn,
  ScoreFn, BehaviorLeaf,
} from './types';
export { compileTree, BTCompileError, type CompiledNode } from './compile';
export { runTree } from './runtime';
