// End-to-end test for the netcode decode→diff pipeline (the pure core the
// worker wraps), driven by the SAME synthetic stream the worker uses. Run:
//   node --experimental-strip-types scripts/check-netcode-pipeline.ts
import { encodeSnapshot, decodeSnapshot, type Snapshot } from '../src/lib/snapshotBinary.ts';
import { makeSyntheticSnapshot } from '../src/features/netcode/transport.ts';
import { diffSnapshots, entityKey } from '../src/features/netcode/snapshotDiff.ts';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
};
// Mirror the worker: encode the synthetic snapshot, decode it back (so we diff
// the on-wire/quantized values, exactly like the client will).
const wire = (tick: number): Snapshot => decodeSnapshot(encodeSnapshot(makeSyntheticSnapshot(tick)));

// Tick 0: first snapshot → everything is "added", nothing changed/removed.
const s0 = wire(0);
const d0 = diffSnapshots(null, s0);
assert(d0.added.length === s0.entities.length, `tick0 all added (got ${d0.added.length}/${s0.entities.length})`);
assert(d0.changed.length === 0 && d0.removed.length === 0, 'tick0 no change/remove');

// Tick 0→1: the 3 orbiters moved (changed); the origin "blinker" didn't move
// and is still present (no add/remove).
const s1 = wire(1);
const d1 = diffSnapshots(s0, s1);
assert(d1.added.length === 0, `tick1 no add (got ${d1.added.length})`);
assert(d1.changed.length === 3, `tick1 3 orbiters changed (got ${d1.changed.length})`);
assert(d1.removed.length === 0, `tick1 no remove (got ${d1.removed.length})`);

// Blinker leaves at the second boundary: tick19 (present) → tick20 (absent).
const blinkKey = entityKey(0, 99);
const s19 = wire(19), s20 = wire(20);
assert(s19.entities.some(e => e.id === 99), 'blinker present at tick19');
assert(!s20.entities.some(e => e.id === 99), 'blinker absent at tick20');
assert(diffSnapshots(s19, s20).removed.includes(blinkKey), 'blinker → removed when it blinks out');

// And returns: tick39 (absent) → tick40 (present) → added.
const s39 = wire(39), s40 = wire(40);
assert(diffSnapshots(s39, s40).added.some(e => e.id === 99), 'blinker → added when it returns');

// Idempotence: diffing identical ticks yields an empty diff.
const same = diffSnapshots(s0, wire(0));
assert(same.added.length === 0 && same.changed.length === 0 && same.removed.length === 0, 'identical → empty diff');

// Header passthrough.
assert(d1.tick === 1 && d1.worldId === 1, 'diff carries tick/world');

// ── Interpolation (RemoteWorld) ─────────────────────────────────────────────
const { RemoteWorld } = await import('../src/features/netcode/remoteEntities.ts');
const close = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
const TICK_MS = 50; // 20 Hz

const world = new RemoteWorld();
let prev: Snapshot | null = null;
for (let tk = 0; tk <= 5; tk++) {
  const snap = wire(tk);
  world.ingest(diffSnapshots(prev, snap), tk * TICK_MS);
  prev = snap;
}

const k1 = entityKey(0, 1);
const e1a = wire(1).entities.find((e) => e.id === 1)!; // tick1 (time 50)
const e1b = wire(2).entities.find((e) => e.id === 1)!; // tick2 (time 100)
const out = new Map();

// Sample halfway (75ms) → linear midpoint of tick1/tick2.
world.sample(75, out);
const mid = out.get(k1);
assert(!!mid, 'interp: entity present');
assert(close(mid.x, e1a.x + (e1b.x - e1a.x) * 0.5, 0.02), `interp x halfway (${mid?.x})`);
assert(close(mid.z, e1a.z + (e1b.z - e1a.z) * 0.5, 0.02), `interp z halfway (${mid?.z})`);

// Sample exactly on a tick boundary → matches that tick.
world.sample(50, out);
assert(close(out.get(k1).x, e1a.x, 0.02), 'sample at tick1 == tick1');

// Starvation (render past the newest snapshot) → holds the newest, no crash.
const e1newest = wire(5).entities.find((e) => e.id === 1)!;
world.sample(10_000, out);
assert(close(out.get(k1).x, e1newest.x, 0.02), 'starved → holds newest');

// Removal: ingest across the blink-out, then sampling after it left omits it.
const w2 = new RemoteWorld();
let p2: Snapshot | null = null;
for (let tk = 18; tk <= 22; tk++) { const s = wire(tk); w2.ingest(diffSnapshots(p2, s), tk * TICK_MS); p2 = s; }
w2.sample(22 * TICK_MS - 5, out); // just before newest, blinker already gone
assert(!out.has(entityKey(0, 99)), 'left entity omitted from interpolation');

if (failures === 0) {
  console.log('✅ netcode decode→diff pipeline OK (add / change / remove / idempotence)');
  process.exit(0);
} else {
  console.error(`❌ ${failures} netcode pipeline failure(s)`);
  process.exit(1);
}
