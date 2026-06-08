// Tests the input wire format + the pure GameInstanceCore (the logic the
// Durable Object wraps). Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-game-instance.ts
import { GameInstanceCore } from '../src/features/netcode/server/gameInstanceCore.ts';
import { encodeInput, decodeInput, INPUT_BYTES } from '../src/features/netcode/inputBinary.ts';
import { decodeSnapshot } from '../src/lib/snapshotBinary.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };
const close = (a: number, b: number, e = 1e-6) => Math.abs(a - b) <= e;
const input = (seq: number, moveX: number, moveZ = 0, yaw = 0, dtMs = 50) =>
  encodeInput({ seq, moveX, moveZ, yaw, dtMs });

// 1. Input round-trip.
const enc = encodeInput({ seq: 12345, moveX: 0.7071, moveZ: -0.5, yaw: Math.PI, dtMs: 50 });
assert(enc.byteLength === INPUT_BYTES, `input is ${INPUT_BYTES} bytes (got ${enc.byteLength})`);
const dec = decodeInput(enc);
assert(dec.seq === 12345, 'input seq');
assert(close(dec.moveX, 0.7071, 2e-4) && close(dec.moveZ, -0.5, 2e-4), 'input move quantization');
assert(close(dec.yaw, Math.PI, 1e-3) && dec.dtMs === 50, 'input yaw/dt');

// 2. Spawn + self-visibility.
const core = new GameInstanceCore({ worldId: 1, zoneId: 0, aoiRadius: 80 });
const pid = core.addPlayer('A');
const out = new Map<string, ArrayBuffer>();
assert(core.tick(0, out) === false, 'first tick primes (no output)');
assert(core.tick(50, out) === true && out.has('A'), 'A receives a snapshot');
assert(decodeSnapshot(out.get('A')!).entities.some(e => e.id === pid), 'player sees itself');

// 3. Input drives authoritative movement; ack tracks the last processed seq.
let now = 50;
for (let seq = 1; seq <= 5; seq++) { core.applyInput('A', input(seq, 1)); now += 50; core.tick(now, out); }
const me = decodeSnapshot(out.get('A')!).entities.find(e => e.id === pid)!;
assert(close(me.x, 1.5, 0.05), `input moved player to ~1.5 (got ${me.x})`); // 5×1×6×0.05
assert(core.ackSeqFor('A') === 5, `ack seq = 5 (got ${core.ackSeqFor('A')})`);

// 4. Disconnect removes the entity.
core.removePlayer('A');
core.tick(now + 50, out);
assert(core.playerCount() === 0, 'removePlayer drops the player');

// 5. AoI end-to-end: two players, small radius, move one out of range.
const core2 = new GameInstanceCore({ worldId: 1, zoneId: 0, aoiRadius: 5 });
const aId = core2.addPlayer('A');
const bId = core2.addPlayer('B');
let t = 0;
core2.tick(t, out); // prime
for (let seq = 1; seq <= 40; seq++) { core2.applyInput('B', input(seq, 1)); t += 50; core2.tick(t, out); }
// B has moved ~12 blocks (40×0.3); A stayed at origin → out of each other's 5-block AoI.
const forA = decodeSnapshot(out.get('A')!);
const forB = decodeSnapshot(out.get('B')!);
assert(forA.entities.some(e => e.id === aId) && !forA.entities.some(e => e.id === bId), 'AoI: A sees self, not far B');
assert(forB.entities.some(e => e.id === bId) && !forB.entities.some(e => e.id === aId), 'AoI: B sees self, not far A');

// 6. Anti-cheat: oversized move vector + teleport-sized dt are clamped to normal
//    speed server-side (honest input is unaffected — test #3 still moved ~1.5).
const hard = new GameInstanceCore({ worldId: 1, zoneId: 0, aoiRadius: 80 });
const hid = hard.addPlayer('H')!;
let hnow = 0;
hard.tick(hnow, out); // prime
for (let seq = 1; seq <= 5; seq++) {
  hard.applyInput('H', input(seq, 3, 0, 0, 60000)); // move ×3 + 60s dt = cheat attempt
  hnow += 50;
  hard.tick(hnow, out);
}
const cheated = decodeSnapshot(out.get('H')!).entities.find(e => e.id === hid)!;
assert(close(cheated.x, 1.5, 0.05), `anti-cheat clamps speed/teleport to ~1.5 (got ${cheated.x})`);

// 7. Connection cap: a full instance refuses new players.
const capped = new GameInstanceCore({ worldId: 1, zoneId: 0, aoiRadius: 80, maxPlayers: 2 });
assert(capped.addPlayer('a') !== null && capped.addPlayer('b') !== null, 'cap: first 2 players admitted');
assert(capped.addPlayer('c') === null, 'cap: 3rd player rejected (world full)');

if (failures === 0) {
  console.log('✅ game instance core OK (input / spawn / movement / ack / disconnect / AoI / anti-cheat / cap)');
  process.exit(0);
} else {
  console.error(`❌ ${failures} game-instance failure(s)`);
  process.exit(1);
}
