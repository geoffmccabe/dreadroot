// Tests the server tick loop (4A) + AoI filter (4C), and a full
// server→wire→client capstone. Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-server-tick.ts
import {
  TickLoop, integrateVelocity, TICK_MS, MAX_CATCHUP_MS, type ServerEntity,
} from '../src/features/netcode/server/tickLoop.ts';
import { filterAoI } from '../src/features/netcode/server/aoi.ts';
import { encodeSnapshot, decodeSnapshot, ORIGIN_L1, type Snapshot, type SnapshotEntity } from '../src/lib/snapshotBinary.ts';
import { diffSnapshots, entityKey } from '../src/features/netcode/snapshotDiff.ts';
import { RemoteWorld } from '../src/features/netcode/remoteEntities.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };
const close = (a: number, b: number, e = 0.001) => Math.abs(a - b) <= e;
const ent = (id: number, x: number, z: number, vx = 0): ServerEntity =>
  ({ registryOrigin: ORIGIN_L1, entityType: 1, id, x, y: 64, z, yaw: 0, stateBits: 0, vx, vy: 0, vz: 0 });

// 1. Fixed-step accumulator: prime, then exact + remainder steps.
const l1 = new TickLoop(integrateVelocity);
assert(l1.advance(1000) === 0, 'first advance primes (0 ticks)');
assert(l1.advance(1050) === 1, '50ms → 1 tick');
assert(l1.advance(1175) === 2, '125ms → 2 ticks (25 remainder)');
assert(l1.advance(1200) === 1, '25+25 → 1 tick');
assert(l1.tick === 4, `tick counter = 4 (got ${l1.tick})`);

// 2. Simulation: an entity moving +x at 10 b/s for 5 clean ticks → 2.5 blocks.
const l2 = new TickLoop(integrateVelocity);
l2.addEntity(ent(1, 0, 0, 10));
l2.advance(0);
for (let i = 1; i <= 5; i++) l2.advance(i * TICK_MS);
assert(l2.tick === 5, `integrate: 5 ticks (got ${l2.tick})`);
assert(close(l2.getEntities().get(entityKey(0, 1))!.x, 2.5), 'integrate: x=2.5 after 250ms');

// 3. Catch-up clamp: a huge gap runs at most MAX_CATCHUP_MS worth of ticks.
const l3 = new TickLoop(integrateVelocity);
l3.advance(0);
assert(l3.advance(100_000) === Math.floor(MAX_CATCHUP_MS / TICK_MS), 'catch-up clamps the spiral of death');

// 4. Input queue: applied on the next tick, then cleared (velocity persists).
const inputSim = (es: Map<number, ServerEntity>, ins: Map<string, { key: number; vx: number }>, dt: number) => {
  for (const inp of ins.values()) { const e = es.get(inp.key); if (e) e.vx = inp.vx; }
  integrateVelocity(es, ins, dt);
};
const l4 = new TickLoop<{ key: number; vx: number }>(inputSim);
l4.addEntity(ent(1, 0, 0, 0));
l4.advance(0);
l4.queueInput('clientA', { key: entityKey(0, 1), vx: 20 });
l4.advance(TICK_MS);
const e4 = l4.getEntities().get(entityKey(0, 1))!;
assert(close(e4.x, 1.0) && close(e4.vx, 20), 'input applied on next tick');
l4.advance(TICK_MS * 2); // no new input → velocity persists
assert(close(e4.x, 2.0), 'input consumed/cleared; velocity persists');

// 5. buildSnapshot carries header + strips server-private fields.
const snap = l4.buildSnapshot(7, 2);
assert(snap.tick === l4.tick && snap.worldId === 7 && snap.zoneId === 2, 'snapshot header');
assert(snap.entities.length === 1 && (snap.entities[0] as Record<string, unknown>).vx === undefined, 'snapshot strips vx');

// 6. AoI filter: horizontal radius.
const cloud: SnapshotEntity[] = [
  { registryOrigin: 0, entityType: 1, id: 1, x: 0, y: 64, z: 0, yaw: 0, stateBits: 0 },
  { registryOrigin: 0, entityType: 1, id: 2, x: 30, y: 64, z: 0, yaw: 0, stateBits: 0 },
  { registryOrigin: 0, entityType: 1, id: 3, x: 5, y: 64, z: 5, yaw: 0, stateBits: 0 },
];
const aoiOut: SnapshotEntity[] = [];
filterAoI(cloud, 0, 0, 10, aoiOut);
assert(aoiOut.length === 2 && !aoiOut.some(e => e.id === 2), 'AoI keeps near (1,3), drops far (2)');

// 7. CAPSTONE — server tick → snapshot → AoI → encode → decode → diff →
//    client ingest → interpolate. Far entity is filtered out end-to-end.
const server = new TickLoop(integrateVelocity);
server.addEntity(ent(1, 0, 0, 1));    // near the player
server.addEntity(ent(2, 100, 0, 0));  // far — outside AoI
server.advance(0);
const client = new RemoteWorld();
const filtered: SnapshotEntity[] = [];
let prev: Snapshot | null = null;
for (let i = 1; i <= 4; i++) {
  server.advance(i * TICK_MS);
  const full = server.buildSnapshot(1, 0);
  filterAoI(full.entities, 0, 0, 50, filtered);
  const decoded = decodeSnapshot(encodeSnapshot({ ...full, entities: filtered }));
  client.ingest(diffSnapshots(prev, decoded), i * TICK_MS);
  prev = decoded;
}
const sampleOut = new Map();
client.sample(4 * TICK_MS - 25, sampleOut);
assert(sampleOut.has(entityKey(0, 1)), 'capstone: near entity reaches the client');
assert(!sampleOut.has(entityKey(0, 2)), 'capstone: far entity filtered by AoI end-to-end');

if (failures === 0) {
  console.log('✅ server tick loop + AoI OK (accumulator / sim / input / clamp / AoI / full loop)');
  process.exit(0);
} else {
  console.error(`❌ ${failures} server-tick failure(s)`);
  process.exit(1);
}
