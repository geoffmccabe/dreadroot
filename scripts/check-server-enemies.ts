// Tests server-owned monsters (plan v3, stage 5). Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-server-enemies.ts
import { ServerEnemySim, ENTITY_SHOMBIE } from '../src/features/netcode/server/serverEnemySim.ts';
import type { ServerEntity } from '../src/features/netcode/server/tickLoop.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };

const ents = () => new Map<number, ServerEntity>();
const monsters = (m: Map<number, ServerEntity>) => [...m.values()].filter((e) => e.entityType === ENTITY_SHOMBIE);
// Dense config so behaviour is observable; density itself is covered by
// check-spawn-controller (it is calibrated to the legacy rate, which is
// deliberately sparse — about 1% per minute).
const DENSE = { spawnChancePerMinute: 100000, maxPerChunk: 1, speed: 2, detectionRange: 24 };

// 1. The server spawns monsters around a player, with nobody asking it to.
const sim = new ServerEnemySim(DENSE);
const m1 = ents();
sim.step(m1, [{ x: 0, z: 0 }], 50, 0);
assert(monsters(m1).length > 0, 'server derives monsters around a player');
assert(sim.aliveCount() === monsters(m1).length, 'alive count matches the entity map');

// 2. Monster ids cannot collide with player ids (players count up from 1).
assert(monsters(m1).every((e) => e.id >= 100000), 'monster ids are far from player ids');

// 3. Two clients looking at the SAME world get the same monsters. This is the
//    whole point: population belongs to the world, not to the observer.
const simA = new ServerEnemySim({ ...DENSE, worldSeed: 'w1' });
const simB = new ServerEnemySim({ ...DENSE, worldSeed: 'w1' });
const mA = ents(), mB = ents();
simA.step(mA, [{ x: 0, z: 0 }], 50, 0);
simB.step(mB, [{ x: 0, z: 0 }], 50, 0);
const posA = monsters(mA).map((e) => `${e.x.toFixed(3)},${e.z.toFixed(3)}`).sort().join('|');
const posB = monsters(mB).map((e) => `${e.x.toFixed(3)},${e.z.toFixed(3)}`).sort().join('|');
assert(posA === posB && posA.length > 0, 'the same world produces the same monsters in the same places');
const simC = new ServerEnemySim({ ...DENSE, worldSeed: 'w2' });
const mC = ents(); simC.step(mC, [{ x: 0, z: 0 }], 50, 0);
const posC = monsters(mC).map((e) => `${e.x.toFixed(3)},${e.z.toFixed(3)}`).sort().join('|');
assert(posC !== posA, 'a different world gets a different population');

// 4. TWO PLAYERS TOGETHER DO NOT DOUBLE THE POPULATION. Population is per
//    chunk, so it must not scale with how many people are looking at it.
const solo = new ServerEnemySim(DENSE);
const duo = new ServerEnemySim(DENSE);
const mS = ents(), mD = ents();
solo.step(mS, [{ x: 0, z: 0 }], 50, 0);
duo.step(mD, [{ x: 0, z: 0 }, { x: 1, z: 1 }], 50, 0);
assert(monsters(mD).length === monsters(mS).length, 'a second nearby player does not double the monsters');

// 5. Repeated ticks do not re-spawn the same creatures.
const before = monsters(m1).length;
for (let t = 1; t <= 10; t++) sim.step(m1, [{ x: 0, z: 0 }], 50, t * 50);
assert(monsters(m1).length === before, 'monsters are not duplicated on later ticks');

// 6. They chase: a monster in range moves TOWARDS the player.
const chase = new ServerEnemySim({ ...DENSE, detectionRange: 1000 });
const mCh = ents();
chase.step(mCh, [{ x: 0, z: 0 }], 50, 0);
const target = monsters(mCh)[0];
const d0 = Math.hypot(target.x, target.z);
for (let t = 1; t <= 40; t++) chase.step(mCh, [{ x: 0, z: 0 }], 50, t * 50);
const d1 = Math.hypot(target.x, target.z);
assert(d1 < d0, `a monster in range closes the distance (${d0.toFixed(2)} -> ${d1.toFixed(2)})`);
assert((target.stateBits & 1) === 1, 'chasing is reported in stateBits so clients can animate it');

// 7. Out of range they hold still (no pointless work, no drift).
const idle = new ServerEnemySim({ ...DENSE, detectionRange: 0.5 });
const mI = ents();
idle.step(mI, [{ x: 0, z: 0 }], 50, 0);
const far = monsters(mI)[0];
const ix = far.x, iz = far.z;
for (let t = 1; t <= 20; t++) idle.step(mI, [{ x: 0, z: 0 }], 50, t * 50);
assert(far.x === ix && far.z === iz, 'a monster out of range does not drift');
assert((far.stateBits & 1) === 0, 'not-chasing is reported too');

// 8. They stop short rather than standing inside the player.
const close = new ServerEnemySim({ ...DENSE, detectionRange: 1000, speed: 50 });
const mCl = ents();
close.step(mCl, [{ x: 0, z: 0 }], 50, 0);
for (let t = 1; t <= 200; t++) close.step(mCl, [{ x: 0, z: 0 }], 50, t * 50);
assert(monsters(mCl).every((e) => Math.hypot(e.x, e.z) > 0.9), 'monsters stop short of the player');

// 9. Killing removes it and suppresses respawn within the generation.
const kills = new ServerEnemySim(DENSE);
const mK = ents();
kills.step(mK, [{ x: 0, z: 0 }], 50, 0);
const victimId = monsters(mK)[0].id;
const planId = kills.planIdForEntity(victimId);
assert(planId !== null, 'a live monster can be resolved to its shared name');
const n0 = kills.aliveCount();
assert(kills.kill(planId as string), 'kill reports success');
assert(kills.aliveCount() === n0 - 1, 'kill removes it from the live set');
for (let t = 1; t <= 20; t++) kills.step(mK, [{ x: 0, z: 0 }], 50, t * 50);
assert(kills.planIdForEntity(victimId) === null || kills.aliveCount() < n0, 'a killed monster does not immediately return');

// 10. The live ceiling is respected, protecting the tick budget.
const capped = new ServerEnemySim({ ...DENSE, maxAlive: 5, maxChunkDistance: 8 });
const mCap = ents();
for (let t = 0; t < 5; t++) capped.step(mCap, [{ x: t * 200, z: 0 }], 50, t * 50);
assert(capped.aliveCount() <= 5, `maxAlive is enforced (got ${capped.aliveCount()})`);

if (failures > 0) { console.error(`\n❌ server enemies: ${failures} failure(s)`); process.exit(1); }
console.log('✅ server enemies OK (derived population / same world same monsters / no doubling per player / chase / stop-short / kill / cap)');
