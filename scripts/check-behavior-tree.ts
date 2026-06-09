// Tests the behavior-tree engine (Slice 1): compile + the reactive runtime. Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-behavior-tree.ts
import { compileTree, runTree, BTCompileError } from '../src/features/enemies/ai/behaviorTree/index.ts';
import type { BTNode, BTRegistry, BTContext } from '../src/features/enemies/ai/behaviorTree/index.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };

// A creature's tree: attack if in range, else chase if aggro'd, else wander.
const tree: BTNode = {
  type: 'selector',
  children: [
    { type: 'sequence', children: [
      { type: 'condition', check: 'inAttackRange' },
      { type: 'action', action: 'attack' },
    ]},
    { type: 'sequence', children: [
      { type: 'condition', check: 'inAggroRange' },
      { type: 'action', action: 'chase' },
    ]},
    { type: 'action', action: 'wander' },
  ],
};

const reg: BTRegistry = {
  conditions: {
    inAttackRange: (_p, ctx) => (ctx.dist as number) <= 1.5,
    inAggroRange: (_p, ctx) => (ctx.dist as number) <= 100,
  },
  actions: {
    attack: (_p, ctx) => { ctx.output = { action: 'attack', params: {} }; return 'success'; },
    chase: (_p, ctx) => { ctx.output = { action: 'chase', params: {} }; return 'success'; },
    wander: (_p, ctx) => { ctx.output = { action: 'wander', params: {} }; return 'success'; },
  },
};

const compiled = compileTree(tree, reg);
const decide = (dist: number) => {
  const ctx: BTContext = { now: 0, blackboard: {}, output: null, dist };
  return runTree(compiled, ctx)?.action;
};

// Priority of guarded actions (= current attack/chase/wander behavior).
assert(decide(1.0) === 'attack', `in attack range → attack (got ${decide(1.0)})`);
assert(decide(50) === 'chase', `in aggro, not attack range → chase (got ${decide(50)})`);
assert(decide(500) === 'wander', `out of range → wander (got ${decide(500)})`);

// Selector: first success wins; later branches don't run.
let chaseRan = false;
const reg2: BTRegistry = {
  conditions: { always: () => true },
  actions: {
    a: (_p, ctx) => { ctx.output = { action: 'a', params: {} }; return 'success'; },
    b: (_p, ctx) => { chaseRan = true; ctx.output = { action: 'b', params: {} }; return 'success'; },
  },
};
const sel = compileTree({ type: 'selector', children: [
  { type: 'action', action: 'a' }, { type: 'action', action: 'b' },
] }, reg2);
const ctx2: BTContext = { now: 0, blackboard: {}, output: null };
assert(runTree(sel, ctx2)?.action === 'a' && !chaseRan, 'selector stops at first success');

// Sequence: a failing condition blocks the action after it.
const seq = compileTree({ type: 'sequence', children: [
  { type: 'condition', check: 'never' }, { type: 'action', action: 'a' },
] }, { conditions: { never: () => false }, actions: reg2.actions });
const ctx3: BTContext = { now: 0, blackboard: {}, output: null };
assert(runTree(seq, ctx3) === null, 'failed condition blocks the sequence action');

// Invert: flips a condition.
const inv = compileTree({ type: 'sequence', children: [
  { type: 'invert', child: { type: 'condition', check: 'never' } },
  { type: 'action', action: 'a' },
] }, { conditions: { never: () => false }, actions: reg2.actions });
const ctx4: BTContext = { now: 0, blackboard: {}, output: null };
assert(runTree(inv, ctx4)?.action === 'a', 'invert of false → action runs');

// Compile fails loudly on an unknown leaf (catches authoring typos at load).
let threw = false;
try { compileTree({ type: 'action', action: 'doesNotExist' }, reg2); }
catch (e) { threw = e instanceof BTCompileError; }
assert(threw, 'unknown action → BTCompileError at compile');

// Utility node: reproduces BehaviorBrain (argmax of scores → run the winner).
const utilReg: BTRegistry = {
  conditions: {},
  actions: {},
  behaviors: {
    attack: { score: (_p, ctx) => (ctx.dist as number) <= 1.5 ? 0.95 : 0,
              run: (_p, ctx) => { ctx.output = { action: 'attack', params: {} }; return 'success'; } },
    chase:  { score: (_p, ctx) => (ctx.dist as number) <= 32 ? 0.7 : 0.1,
              run: (_p, ctx) => { ctx.output = { action: 'chase', params: {} }; return 'success'; } },
    wander: { score: () => 0.5,
              run: (_p, ctx) => { ctx.output = { action: 'wander', params: {} }; return 'success'; } },
  },
};
const utilTree = compileTree({ type: 'utility', children: [
  { type: 'behavior', behavior: 'attack' },
  { type: 'behavior', behavior: 'chase' },
  { type: 'behavior', behavior: 'wander' },
] }, utilReg);
const decideU = (dist: number) => {
  const ctx: BTContext = { now: 0, blackboard: {}, output: null, dist };
  return runTree(utilTree, ctx)?.action;
};
assert(decideU(1.0) === 'attack', `utility: closest+ready → attack (got ${decideU(1.0)})`);
assert(decideU(20) === 'chase', `utility: aggro (0.7) beats wander (0.5) → chase (got ${decideU(20)})`);
assert(decideU(500) === 'wander', `utility: far → wander 0.5 beats chase 0.1 (got ${decideU(500)})`);

// Compile rejects a non-scored utility child.
let utilThrew = false;
try { compileTree({ type: 'utility', children: [{ type: 'action', action: 'x' }] },
  { conditions: {}, actions: { x: () => 'success' } }); }
catch (e) { utilThrew = e instanceof BTCompileError; }
assert(utilThrew, 'utility child must be a behavior leaf');

// ── Bridge: the default utility tree reproduces BehaviorBrain exactly ──
const { behaviorRegistry, defaultTree, makeCreatureCtx, runCreatureTree } =
  await import('../src/features/enemies/ai/behaviorTreeBridge.ts');

const events: string[] = [];
const mkMod = (id: string, score: (d: number) => number) => ({
  id, name: id,
  evaluate: (bctx: { distToPlayer: number }) => score(bctx.distToPlayer),
  tick: () => ({ kind: 'move' as const, tx: id.length, ty: 0, tz: 0 }),
  enter: () => events.push(`enter:${id}`),
  exit: () => events.push(`exit:${id}`),
});
const modules = [
  mkMod('attack', (d) => (d <= 1.5 ? 0.95 : 0)),
  mkMod('chase', (d) => (d <= 32 ? 0.7 : 0.1)),
  mkMod('wander', () => 0.5),
];
// Reference = BehaviorBrain's argmax, inline.
const refPick = (d: number) => {
  let best = modules[0], bs = -1;
  for (const m of modules) { const s = m.evaluate({ distToPlayer: d }); if (s > bs) { bs = s; best = m; } }
  return best.id;
};
const bReg = behaviorRegistry(modules as never);
const cTree = compileTree(defaultTree(modules as never), bReg);
const cctx = makeCreatureCtx(modules as never);
const pick = (d: number) => { runCreatureTree(cTree, cctx, { distToPlayer: d } as never, 16); return cctx.currentBehaviorId; };

let allMatch = true;
for (const d of [0.5, 1.5, 2, 10, 31, 32, 40, 100, 500]) {
  if (pick(d) !== refPick(d)) { allMatch = false; console.error(`  ✗ d=${d}: bridge ${pick(d)} vs brain ${refPick(d)}`); }
}
assert(allMatch, 'bridge default tree == BehaviorBrain argmax across the distance sweep');

// enter/exit fire only on transitions.
events.length = 0;
const cctx2 = makeCreatureCtx(modules as never);
runCreatureTree(cTree, cctx2, { distToPlayer: 0.5 } as never, 16); // enter attack
runCreatureTree(cTree, cctx2, { distToPlayer: 0.5 } as never, 16); // same → no transition
runCreatureTree(cTree, cctx2, { distToPlayer: 10 } as never, 16);  // exit attack, enter chase
assert(events.join(',') === 'enter:attack,exit:attack,enter:chase', `enter/exit on transitions only (got ${events.join(',')})`);

// Returns the winning behavior's own tick result.
const res = runCreatureTree(cTree, cctx2, { distToPlayer: 0.5 } as never, 16);
assert(res.kind === 'move' && res.tx === 'attack'.length, 'returns the winning behavior result');

if (failures === 0) {
  console.log('✅ behavior-tree engine + bridge OK (utility==BehaviorBrain, enter/exit, results)');
  process.exit(0);
} else {
  console.error(`❌ ${failures} behavior-tree failure(s)`);
  process.exit(1);
}
