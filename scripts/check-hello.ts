// Tests the server greeting + restart resync (plan v3, stage 4). Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-hello.ts
import { encodeHello, decodeHello, isHello, HELLO_BYTES, HELLO_VERSION, HELLO_MAGIC } from '../src/features/netcode/helloBinary.ts';
import { GameInstanceCore } from '../src/features/netcode/server/gameInstanceCore.ts';
import { encodeSnapshot } from '../src/lib/snapshotBinary.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };

// 1. Round-trip.
const h = { version: HELLO_VERSION, sessionId: 0xdeadbeef, yourEntityId: 7, tick: 1234, tickRate: 20, registryOrigin: 0 };
const buf = encodeHello(h);
assert(buf.byteLength === HELLO_BYTES, `hello is ${HELLO_BYTES} bytes`);
const back = decodeHello(buf);
assert(back.sessionId === 0xdeadbeef, 'sessionId round-trips (full 32-bit range)');
assert(back.yourEntityId === 7 && back.tick === 1234 && back.tickRate === 20, 'fields round-trip');

// 2. A hello is DISTINGUISHABLE from a snapshot. This is what lets one socket
//    carry both without a wrapper.
assert(isHello(buf) === true, 'hello is recognised');
const snap = encodeSnapshot({
  tick: 1, baseTick: 1, worldId: 1, zoneId: 0, ackSeq: 0,
  entities: [{ registryOrigin: 0, entityType: 0, id: 1, x: 0, y: 64, z: 0, yaw: 0, stateBits: 0 }],
});
assert(isHello(snap) === false, 'a snapshot is NOT mistaken for a hello');
assert(isHello(new ArrayBuffer(0)) === false, 'empty buffer is not a hello');
assert(isHello(new ArrayBuffer(2)) === false, 'runt buffer is not a hello');

// 3. Corrupt / hostile input is rejected, not misread.
let threw = false;
try { decodeHello(new ArrayBuffer(HELLO_BYTES)); } catch { threw = true; }
assert(threw, 'zeroed buffer rejected (bad magic)');
threw = false;
try { decodeHello(buf.slice(0, 8)); } catch { threw = true; }
assert(threw, 'truncated hello rejected');
threw = false;
const badVer = encodeHello({ ...h, version: 99 });
try { decodeHello(badVer); } catch { threw = true; }
assert(threw, 'version mismatch rejected loudly (not silently misparsed)');

// 4. The server greets a real joined client with ITS OWN entity id.
const core = new GameInstanceCore({ worldId: 1, zoneId: 0, aoiRadius: 80, sessionId: 4242 });
const idA = core.addPlayer('cA');
const idB = core.addPlayer('cB');
assert(idA !== null && idB !== null && idA !== idB, 'two clients get distinct entity ids');
const helloA = core.buildHello('cA');
const helloB = core.buildHello('cB');
assert(helloA !== null && helloB !== null, 'both clients get a greeting');
const dA = decodeHello(helloA as ArrayBuffer);
const dB = decodeHello(helloB as ArrayBuffer);
assert(dA.yourEntityId === idA, 'client A is told ITS OWN id');
assert(dB.yourEntityId === idB, 'client B is told ITS OWN id');
assert(dA.sessionId === 4242 && dB.sessionId === 4242, 'both see the same session');
assert(dA.tickRate === 20, 'tick rate advertised');
assert(core.buildHello('nobody') === null, 'unknown client gets no greeting');

// 5. A RESTART produces a different session id. This is the signal that stops
//    a client silently discarding every snapshot after a deploy.
const restarted = new GameInstanceCore({ worldId: 1, zoneId: 0, aoiRadius: 80 });
restarted.addPlayer('cA');
const d2 = decodeHello(restarted.buildHello('cA') as ArrayBuffer);
assert(d2.sessionId !== 4242, 'a restarted instance has a different session id');

// 6. Session ids are actually varied across restarts (not a constant).
const ids = new Set<number>();
for (let i = 0; i < 50; i++) {
  const c = new GameInstanceCore({ worldId: 1, zoneId: 0, aoiRadius: 80 });
  ids.add(c.getSessionId());
}
assert(ids.size > 40, `session ids vary across restarts (got ${ids.size}/50 distinct)`);

if (failures > 0) { console.error(`\n❌ hello: ${failures} failure(s)`); process.exit(1); }
console.log('✅ hello OK (round-trip / distinct from snapshot / hostile input rejected / correct per-client id / restart changes session)');
