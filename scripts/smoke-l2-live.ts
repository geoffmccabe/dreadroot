// LIVE end-to-end smoke test against the deployed L2 (plan v3, stage 4).
// Opens a real WebSocket to the production Durable Object, verifies the
// greeting, streams inputs, and checks the server's authoritative position
// agrees with the client's prediction — the two run the SAME stepPlayer, so
// any real divergence is a defect in the network path, not a difference of
// opinion between simulations.
//
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/smoke-l2-live.ts
//
// Requires Node >= 22 (global WebSocket). Costs a few seconds of DO time.
import { encodeInputFrame } from '../src/features/netcode/clientFrames.ts';
import { decodeSnapshot } from '../src/lib/snapshotBinary.ts';
import { isHello, decodeHello } from '../src/features/netcode/helloBinary.ts';
import { PredictedPlayer } from '../src/features/netcode/prediction.ts';
import { PLAYER_SPEED } from '../src/features/netcode/playerSim.ts';

const URL_BASE = process.env.DO_URL ?? 'wss://server.dreadroot.com';
const INSTANCE = `smoke-${Date.now()}`;
const SENDS = 20;
const SEND_MS = 100;
/** Server tick. An input must never carry more time than one tick, or the
 *  server's dt cap swallows the excess and the client over-predicts. */
const TICK_MS = 50;
const INPUTS_PER_SEND = Math.round(SEND_MS / TICK_MS);

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } else console.log('  ✓ ' + m); };

const ws = new WebSocket(`${URL_BASE}/?instance=${INSTANCE}`);
ws.binaryType = 'arraybuffer';

let hello: ReturnType<typeof decodeHello> | null = null;
let snapshots = 0;
let sawSelf = 0;
let maxDiv = 0;
let sumDiv = 0;
let seq = 1;
let predicted: PredictedPlayer | null = null;
let sent = 0;

const done = (code: number) => { try { ws.close(); } catch {} process.exit(code); };

const timeout = setTimeout(() => {
  console.error('\n❌ timed out waiting for the server');
  done(1);
}, 20000);

ws.onopen = () => {
  console.log(`connected to ${URL_BASE} (instance ${INSTANCE})`);
};

ws.onerror = (e: unknown) => {
  console.error('❌ socket error:', e);
  clearTimeout(timeout);
  done(1);
};

ws.onmessage = (ev: MessageEvent) => {
  const buf = ev.data as ArrayBuffer;
  if (!(buf instanceof ArrayBuffer)) return;

  if (isHello(buf)) {
    hello = decodeHello(buf);
    console.log(`\ngreeting: entity=${hello.yourEntityId} session=${hello.sessionId} tickRate=${hello.tickRate} tick=${hello.tick}`);
    assert(hello.yourEntityId > 0, 'server told us OUR entity id');
    assert(hello.tickRate === 20, `server reports its tick rate (${hello.tickRate} Hz)`);
    predicted = new PredictedPlayer({ x: 0, y: 64, z: 0, yaw: 0 }, PLAYER_SPEED, TICK_MS);

    // Stream inputs: move steadily +X.
    const timer = setInterval(() => {
      if (sent >= SENDS) {
        clearInterval(timer);
        setTimeout(finish, 600);
        return;
      }
      for (let i = 0; i < INPUTS_PER_SEND; i++) {
        const cmd = { seq: seq++, moveX: 1, moveZ: 0, yaw: 0, dtMs: TICK_MS };
        predicted!.predict(cmd);
        ws.send(encodeInputFrame(cmd));
        sent++;
      }
    }, SEND_MS);
    return;
  }

  // Snapshot
  let snap;
  try { snap = decodeSnapshot(buf); } catch (e) { console.error('  ✗ undecodable snapshot:', e); failures++; return; }
  snapshots++;
  if (hello === null || predicted === null) return;

  const self = snap.entities.find((e) => e.id === hello!.yourEntityId && e.registryOrigin === hello!.registryOrigin);
  if (!self) return;
  sawSelf++;

  // TRUE divergence, not the prediction LEAD. The client is legitimately ahead
  // of the server by whatever is still in flight, so comparing the latest
  // prediction against authority measures latency, not correctness. Instead
  // reconcile against the acked position and check we barely move: if the two
  // simulations agree, reconciliation is a no-op.
  const beforeX = predicted.state.x, beforeZ = predicted.state.z;
  predicted.reconcile({ x: self.x, y: self.y, z: self.z, yaw: self.yaw }, snap.ackSeq);
  const dx = predicted.state.x - beforeX;
  const dz = predicted.state.z - beforeZ;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (snap.ackSeq > 0) { sumDiv += d; if (d > maxDiv) maxDiv = d; }
};

function finish(): void {
  clearTimeout(timeout);
  console.log(`\nsent ${sent} inputs; received ${snapshots} snapshots; saw ourselves in ${sawSelf}`);
  assert(hello !== null, 'received a greeting');
  assert(snapshots > 0, `received snapshots (${snapshots})`);
  assert(sawSelf > 0, `our own entity appeared in snapshots (${sawSelf})`);

  const mean = sawSelf > 0 ? sumDiv / sawSelf : Infinity;
  console.log(`correction applied by reconciliation: mean ${mean.toFixed(4)} blocks, max ${maxDiv.toFixed(4)}`);
  // The client and server run the SAME stepPlayer on the same inputs, so they
  // should agree closely. Allow a little slack for inputs still in flight when
  // a snapshot was built.
  // If client and server agree, reconciling to authority should barely move
  // the predicted position. A large correction means they genuinely disagree.
  assert(maxDiv < 0.35, `reconciliation is near-nil, i.e. the sims AGREE (max correction ${maxDiv.toFixed(4)} blocks < 0.35)`);

  if (failures > 0) { console.error(`\n❌ live L2 smoke: ${failures} failure(s)`); done(1); }
  console.log('\n✅ live L2 smoke OK (greeting / identity / input path / snapshot path / shared-sim agreement)');
  done(0);
}
