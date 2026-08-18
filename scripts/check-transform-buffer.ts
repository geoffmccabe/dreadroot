// Tests time-based interpolation for remote entities (plan v3, stage 3). Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-transform-buffer.ts
import { TransformBuffer, lerpAngle, type SampledTransform } from '../src/features/netcode/transformBuffer.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };
const close = (a: number, b: number, e = 1e-6) => Math.abs(a - b) <= e;
const out: SampledTransform = { x: 0, y: 0, z: 0, yaw: 0, speed: 0 };

// 1. Shortest-arc angle interpolation: the bug the old code had.
assert(close(lerpAngle(0, Math.PI / 2, 0.5), Math.PI / 4), 'simple angle lerp');
// From +170° to -170° is 20° the SHORT way, not 340° the long way.
const a = (170 * Math.PI) / 180, b = (-170 * Math.PI) / 180;
const mid = lerpAngle(a, b, 0.5);
// Halfway should be at ±180°, i.e. |mid| ≈ PI — NOT near 0 (the long way).
assert(Math.abs(Math.abs(mid) - Math.PI) < 1e-6, `wrap goes the short way (got ${mid})`);

// 2. Unknown entity reports false rather than lying with stale data.
const buf = new TransformBuffer({ delayMs: 100 });
assert(buf.sample('nobody', 1000, out) === false, 'unknown id returns false');

// 3. Straight-line motion interpolates to the exact midpoint.
//    Samples at t=0 (x=0) and t=100 (x=10). At render time 50 → x=5.
buf.push('p1', 0, 64, 0, 0, 1000);
buf.push('p1', 10, 64, 0, 0, 1100);
assert(buf.sample('p1', 1150, out) === true, 'known id samples');   // renderTime = 1050
assert(close(out.x, 5), `midpoint interpolation → x=5 (got ${out.x})`);
assert(close(out.y, 64), 'y carried through');

// 4. Speed is derived from the samples, in blocks/second.
//    10 blocks over 100 ms = 100 blocks/s.
assert(close(out.speed, 100), `speed from samples (got ${out.speed})`);

// 5. Frame-rate independence: the SAME render time yields the SAME answer, no
//    matter how many times we sample. Exponential smoothing could not do this.
const first = out.x;
buf.sample('p1', 1150, out);
buf.sample('p1', 1150, out);
assert(close(out.x, first), 'sampling is pure — repeated calls do not drift');

// 6. Starved (sender went quiet): HOLD the newest, never extrapolate.
buf.sample('p1', 5000, out);
assert(close(out.x, 10), `starved holds newest x=10 (got ${out.x})`);
assert(close(out.speed, 0), 'held entity reports zero speed (idle animation)');

// 7. Before our history: hold the oldest rather than snapping from origin.
buf.sample('p1', 900, out);
assert(close(out.x, 0), 'pre-history holds oldest');

// 8. Out-of-order / duplicate arrivals are ignored, not applied backwards.
buf.push('p1', 999, 64, 999, 0, 1050);   // older than newest (1100) → dropped
buf.sample('p1', 5000, out);
assert(close(out.x, 10) && close(out.z, 0), 'stale out-of-order sample ignored');

// 9. The ring reuses slots and keeps interpolating correctly past capacity.
const ring = new TransformBuffer({ delayMs: 0, maxSamples: 4 });
for (let i = 0; i <= 10; i++) ring.push('r', i, 0, 0, 0, i * 100);
// Newest is t=1000,x=10; oldest retained should be t=700,x=7.
ring.sample('r', 750, out);
assert(close(out.x, 7.5), `ring interpolates after wrap (got ${out.x})`);
ring.sample('r', 650, out);
assert(close(out.x, 7), 'ring holds its oldest retained sample');

// 10. Housekeeping.
assert(buf.size() === 1 && ring.size() === 1, 'one track each');
buf.remove('p1');
assert(buf.size() === 0 && buf.sample('p1', 1150, out) === false, 'remove drops the track');

if (failures > 0) { console.error(`\n❌ transform buffer: ${failures} failure(s)`); process.exit(1); }
console.log('✅ transform buffer OK (shortest-arc yaw / midpoint interp / derived speed / hold-not-extrapolate / ring reuse)');
