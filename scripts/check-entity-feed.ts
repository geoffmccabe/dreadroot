// Tests the EntityFeed seam (plan v3, stage 2). Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-entity-feed.ts
//
// The seam decides WHO is authoritative for a monster's transform. The single
// most important property is that mode 'local' is inert: it must record
// nothing and report nothing, so shipping with the seam in place is
// behaviourally identical to not having it.
import { EntityFeed } from '../src/features/enemies/feed/entityFeed.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };
const close = (a: number, b: number, e = 1e-9) => Math.abs(a - b) <= e;

// 1. Default mode is 'local' and the seam is inert.
const f = new EntityFeed();
assert(f.getMode() === 'local', 'defaults to local');
assert(f.isRemote() === false, 'local is not remote');
assert(f.isRecording() === false, 'local records nothing');

// 2. Local mode still answers get() with nothing, so a caller that forgets to
//    check the mode cannot accidentally drive an entity from stale state.
assert(f.get('shombie_1') === undefined, 'no state before any ingest');

// 3. Remote mode carries authoritative transforms.
f.setMode('remote');
assert(f.isRemote() === true, 'remote mode reports remote');
assert(f.isRecording() === true, 'remote mode records');
f.ingest('shombie_1', 10, 64, -5, 1.5, 80, 42);
const s = f.get('shombie_1');
assert(s !== undefined, 'ingested state is retrievable');
assert(s !== undefined && close(s.x, 10) && close(s.y, 64) && close(s.z, -5), 'position round-trips');
assert(s !== undefined && close(s.yaw, 1.5), 'yaw round-trips');
assert(s !== undefined && s.health === 80, 'health round-trips');
assert(s !== undefined && s.tick === 42, 'tick round-trips');
assert(f.size() === 1, 'one entity tracked');

// 4. Re-ingesting the same id MUTATES IN PLACE (zero-allocation contract).
const before = f.get('shombie_1');
f.ingest('shombie_1', 11, 64, -5, 1.6, 70, 43);
const after = f.get('shombie_1');
assert(before === after, 'state object is reused, not reallocated');
assert(after !== undefined && close(after.x, 11) && after.health === 70, 'in-place update took effect');

// 5. Switching modes CLEARS state, so a stale position can never be mistaken
//    for authority after a reconnect or a flip back to local.
f.setMode('local');
assert(f.size() === 0, 'mode switch clears state');
assert(f.get('shombie_1') === undefined, 'stale state is gone after mode switch');

// 6. Shadow mode measures divergence without touching anything.
const g = new EntityFeed();
g.setMode('shadow');
g.ingest('a', 0, 64, 0, 0, 100, 1);
g.ingest('b', 3, 64, 4, 0, 100, 1);   // 5 blocks from (0,64,0) horizontally
g.compare('a', 0, 64, 0);             // perfect agreement
g.compare('b', 0, 64, 0);             // 5 blocks apart
let d = g.getDivergence();
assert(d.samples === 2, 'two comparisons recorded');
assert(close(d.maxDistance, 5), `max divergence 5 (got ${d.maxDistance})`);
assert(close(d.meanDistance, 2.5), `mean divergence 2.5 (got ${d.meanDistance})`);
assert(d.missing === 0, 'nothing missing yet');

// 7. Comparing an entity the server never sent is counted, not crashed on.
g.compare('ghost', 1, 64, 1);
d = g.getDivergence();
assert(d.missing === 1, 'unknown entity counted as missing');
assert(d.samples === 2, 'missing entity does not pollute the distance stats');

// 8. Divergence is horizontal only (Y is deliberately ignored: monsters sit on
//    the ground and vertical disagreement is dominated by ground sampling).
const h = new EntityFeed();
h.setMode('shadow');
h.ingest('c', 0, 200, 0, 0, 100, 1);
h.compare('c', 0, 64, 0);
assert(close(h.getDivergence().maxDistance, 0), 'vertical difference ignored');

// 9. Reset clears the accumulators but keeps the tracked entities.
g.resetDivergence();
d = g.getDivergence();
assert(d.samples === 0 && d.missing === 0 && d.maxDistance === 0, 'divergence reset');
assert(g.size() === 2, 'reset does not drop tracked entities');

// 10. remove() drops a single entity (despawn / left area of interest).
g.remove('a');
assert(g.size() === 1 && g.get('a') === undefined, 'remove drops one entity');

if (failures > 0) { console.error(`\n❌ entity feed: ${failures} failure(s)`); process.exit(1); }
console.log('✅ entity feed OK (local inert / remote authority / in-place reuse / mode-switch clears / shadow divergence)');
