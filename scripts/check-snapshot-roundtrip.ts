// Round-trip test for the L2 snapshot wire format. Run:
//   node --experimental-strip-types scripts/check-snapshot-roundtrip.ts
import {
  encodeSnapshot,
  decodeSnapshot,
  POS_SCALE,
  ORIGIN_L1,
  type Snapshot,
} from '../src/lib/snapshotBinary.ts';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
};
const close = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

const snap: Snapshot = {
  tick: 123456,
  baseTick: 123456,
  ackSeq: 4242,
  worldId: 7,
  zoneId: 3,
  entities: [
    { registryOrigin: ORIGIN_L1, entityType: 0, id: 1, x: 0, y: 64, z: 0, yaw: 0, stateBits: 0 },
    { registryOrigin: ORIGIN_L1, entityType: 1, id: 4242, x: 123.4375, y: -12.5, z: -9999.0625, yaw: Math.PI, stateBits: 0xABCD },
    // Far-from-origin coord that would overflow int16 — proves the int32 format
    // (Track 7 forward-compat).
    { registryOrigin: ORIGIN_L1, entityType: 2, id: 0xFFFFFFFF, x: 90000.25, y: 0, z: -90000.75, yaw: Math.PI * 1.75, stateBits: 1 },
    { registryOrigin: 1, entityType: 3, id: 9, x: -0.0625, y: 5.5, z: 0.125, yaw: Math.PI * 2 - 0.001, stateBits: 0xFFFF },
  ],
};

const buf = encodeSnapshot(snap);
// v2 header is 26 bytes (22 + the 4-byte per-client input ack).
assert(buf.byteLength === 26 + snap.entities.length * 22, `byte length (got ${buf.byteLength})`);

const out = decodeSnapshot(buf);
assert(out.tick === snap.tick, 'tick');
assert(out.baseTick === snap.baseTick, 'baseTick');
assert(out.ackSeq === 4242, `ackSeq round-trips (got ${out.ackSeq})`);
assert(out.worldId === snap.worldId, 'worldId');
assert(out.zoneId === snap.zoneId, 'zoneId');
assert(out.entities.length === snap.entities.length, 'entity count');

const posEps = 0.5 / POS_SCALE; // ±half a quantization step
const yawEps = 0.001;           // ~u16 angle resolution
for (let i = 0; i < snap.entities.length; i++) {
  const a = snap.entities[i], b = out.entities[i];
  assert(a.registryOrigin === b.registryOrigin, `e${i} origin`);
  assert(a.entityType === b.entityType, `e${i} type`);
  assert((a.id >>> 0) === b.id, `e${i} id (got ${b.id})`);
  assert(close(a.x, b.x, posEps), `e${i} x (${a.x} vs ${b.x})`);
  assert(close(a.y, b.y, posEps), `e${i} y (${a.y} vs ${b.y})`);
  assert(close(a.z, b.z, posEps), `e${i} z (${a.z} vs ${b.z})`);
  // yaw wraps; compare on the circle.
  const dy = Math.abs(((a.yaw - b.yaw + Math.PI) % (Math.PI * 2)) - Math.PI);
  assert(dy <= yawEps, `e${i} yaw (${a.yaw} vs ${b.yaw})`);
  assert(a.stateBits === b.stateBits, `e${i} stateBits`);
}

// Bad magic must throw.
let threw = false;
try { decodeSnapshot(new ArrayBuffer(26)); } catch { threw = true; }
assert(threw, 'bad-magic throws');

if (failures === 0) {
  console.log(`✅ snapshotBinary round-trip OK (${snap.entities.length} entities, ${buf.byteLength} bytes)`);
  process.exit(0);
} else {
  console.error(`❌ ${failures} snapshot round-trip failure(s)`);
  process.exit(1);
}
