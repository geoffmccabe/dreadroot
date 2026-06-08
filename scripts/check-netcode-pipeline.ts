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

if (failures === 0) {
  console.log('✅ netcode decode→diff pipeline OK (add / change / remove / idempotence)');
  process.exit(0);
} else {
  console.error(`❌ ${failures} netcode pipeline failure(s)`);
  process.exit(1);
}
