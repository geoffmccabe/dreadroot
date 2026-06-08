// Tests client prediction + server reconciliation (Track 4D). Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-prediction.ts
import { PredictedPlayer } from '../src/features/netcode/prediction.ts';
import { stepPlayer, type PlayerState, type PlayerInputCmd } from '../src/features/netcode/playerSim.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };
const close = (a: number, b: number, e = 1e-9) => Math.abs(a - b) <= e;
const SPEED = 6;
const cmd = (seq: number, moveX: number, dtMs = 50): PlayerInputCmd => ({ seq, moveX, moveZ: 0, yaw: 0, dtMs });
// each input moves moveX * SPEED * 0.05 = 0.3 blocks at moveX=1.

// 1. Prediction advances immediately.
const p = new PredictedPlayer({ x: 0, y: 64, z: 0, yaw: 0 }, SPEED);
for (let s = 1; s <= 5; s++) p.predict(cmd(s, 1));
assert(close(p.state.x, 1.5), `predicted 5 inputs → 1.5 (got ${p.state.x})`);
assert(p.pendingCount() === 5, 'all 5 inputs pending (no ack yet)');

// 2. Correct prediction → reconcile is seamless (position unchanged, inputs dropped).
p.reconcile({ x: 0.6, y: 64, z: 0, yaw: 0 }, 2); // server: after seq2, x=0.6
assert(close(p.state.x, 1.5), `seamless reconcile stays at 1.5 (got ${p.state.x})`);
assert(p.pendingCount() === 3, 'acked inputs (≤2) dropped, 3 remain');

// 3. Shared-sim invariant: server-side stepPlayer reproduces the client exactly.
const server: PlayerState = { x: 0, y: 64, z: 0, yaw: 0 };
for (let s = 1; s <= 5; s++) stepPlayer(server, cmd(s, 1), SPEED);
assert(close(server.x, p.state.x), 'server stepPlayer == client prediction');

// 4. Misprediction self-heals: server corrects the player lower than predicted.
const p2 = new PredictedPlayer({ x: 0, y: 64, z: 0, yaw: 0 }, SPEED);
for (let s = 1; s <= 4; s++) p2.predict(cmd(s, 1));
assert(close(p2.state.x, 1.2), `p2 predicted 1.2 (got ${p2.state.x})`);
// Server says it was wall-blocked at x=0.1 after seq2; replay seq3,4 (+0.6) → 0.7.
p2.reconcile({ x: 0.1, y: 64, z: 0, yaw: 0 }, 2);
assert(close(p2.state.x, 0.7), `misprediction corrected to 0.7 (got ${p2.state.x})`);

// 5. Full ack → no replay, snap exactly to authority.
p2.reconcile({ x: 0.7, y: 64, z: 0, yaw: 0 }, 4);
assert(p2.pendingCount() === 0 && close(p2.state.x, 0.7), 'full ack → snap, nothing pending');

// 6. yaw passes through.
const p3 = new PredictedPlayer({ x: 0, y: 0, z: 0, yaw: 0 }, SPEED);
p3.predict({ seq: 1, moveX: 0, moveZ: 0, yaw: 1.23, dtMs: 50 });
assert(close(p3.state.yaw, 1.23), 'yaw applied');

if (failures === 0) {
  console.log('✅ prediction OK (predict / seamless reconcile / shared-sim / misprediction heal)');
  process.exit(0);
} else {
  console.error(`❌ ${failures} prediction failure(s)`);
  process.exit(1);
}
