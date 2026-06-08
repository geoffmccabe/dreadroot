// Tests lag compensation (Track 4F): position rewind + hit validation. Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-lagcomp.ts
import { LagCompensationBuffer, rayHitsSphere } from '../src/features/netcode/server/lagCompensation.ts';
import { entityKey } from '../src/features/netcode/snapshotDiff.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };
const close = (a: number, b: number, e = 1e-9) => Math.abs(a - b) <= e;
const k = entityKey(0, 1);
const out = new Map();

// Record an entity moving +x at 1 block/tick over ticks 0..10 (x == tick).
const buf = new LagCompensationBuffer(20);
for (let tick = 0; tick <= 10; tick++) buf.record(tick, new Map([[k, { x: tick, y: 64, z: 0 }]]));

buf.rewind(5, out);
assert(close(out.get(k).x, 5), `rewind tick5 → x=5 (got ${out.get(k)?.x})`);
buf.rewind(5.5, out);
assert(close(out.get(k).x, 5.5), `rewind tick5.5 → x=5.5 interpolated (got ${out.get(k)?.x})`);
buf.rewind(-3, out);
assert(close(out.get(k).x, 0), 'rewind before oldest → clamp to oldest');
buf.rewind(99, out);
assert(close(out.get(k).x, 10), 'rewind after newest → clamp to newest');
const r = buf.range()!;
assert(r.oldest === 0 && r.newest === 10, `range 0..10 (got ${r.oldest}..${r.newest})`);

// Buffer cap: only the last maxTicks survive.
const small = new LagCompensationBuffer(3);
for (let t = 0; t < 10; t++) small.record(t, new Map([[k, { x: t, y: 0, z: 0 }]]));
const sr = small.range()!;
assert(sr.oldest === 7 && sr.newest === 9, `cap keeps last 3 (got ${sr.oldest}..${sr.newest})`);

// Ray vs sphere basics.
assert(rayHitsSphere(0, 64, 0, 1, 0, 0, 5, 64, 0, 0.5), 'ray hits sphere dead ahead');
assert(!rayHitsSphere(0, 64, 0, 1, 0, 0, 5, 64, 10, 0.5), 'ray misses off-axis sphere');
assert(!rayHitsSphere(0, 64, 0, -1, 0, 0, 5, 64, 0, 0.5), 'ray pointing away misses');

// CAPSTONE: a target moving in +z. Server is at tick 10 (target at z=10), but the
// client fired at tick 5 (target at z=5). Rewinding makes the fair hit land,
// while checking the CURRENT position would wrongly miss.
const buf2 = new LagCompensationBuffer(20);
for (let t = 0; t <= 10; t++) buf2.record(t, new Map([[k, { x: 5, y: 64, z: t }]]));
const shot = { ox: 0, oy: 64, oz: 5, dx: 1, dy: 0, dz: 0 }; // aimed where the client SAW it (z=5)

buf2.rewind(5, out);
const past = out.get(k);
assert(rayHitsSphere(shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz, past.x, past.y, past.z, 0.6),
  'lag-comp: rewound target IS hit');

buf2.rewind(10, out); // current position
const nowPos = out.get(k);
assert(!rayHitsSphere(shot.ox, shot.oy, shot.oz, shot.dx, shot.dy, shot.dz, nowPos.x, nowPos.y, nowPos.z, 0.6),
  'without rewind the same shot MISSES (target has moved)');

if (failures === 0) {
  console.log('✅ lag compensation OK (rewind / interp / clamp / cap / ray-sphere / fair-hit capstone)');
  process.exit(0);
} else {
  console.error(`❌ ${failures} lag-comp failure(s)`);
  process.exit(1);
}
