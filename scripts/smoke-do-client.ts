// Live smoke test against a running `wrangler dev` DO. Connects a real WebSocket,
// streams inputs, and checks the authoritative player moves. Run while
// `wrangler dev` is up:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/smoke-do-client.ts
import { encodeInputFrame } from '../src/features/netcode/clientFrames.ts';
import { decodeSnapshot } from '../src/lib/snapshotBinary.ts';

const URL = process.env.DO_URL ?? 'ws://localhost:8787/?instance=smoke';
const ws = new WebSocket(URL);
ws.binaryType = 'arraybuffer';

let seq = 0;
let snaps = 0;
let firstX: number | null = null;
let lastX = 0;
let inputTimer: ReturnType<typeof setInterval>;

ws.onopen = () => {
  console.log('connected →', URL);
  inputTimer = setInterval(() => {
    seq++;
    ws.send(encodeInputFrame({ seq, moveX: 1, moveZ: 0, yaw: 0, dtMs: 50 }));
  }, 50);
};

ws.onmessage = (ev: MessageEvent) => {
  const snap = decodeSnapshot(ev.data as ArrayBuffer);
  const me = snap.entities[0];
  if (me) { if (firstX === null) firstX = me.x; lastX = me.x; }
  snaps++;
  if (snaps <= 3 || snaps % 5 === 0) {
    console.log(`tick ${snap.tick}: ${snap.entities.length} entit(ies), player x=${me ? me.x.toFixed(3) : 'n/a'}`);
  }
  if (snaps >= 20) {
    clearInterval(inputTimer);
    const moved = firstX === null ? 0 : lastX - firstX;
    console.log(`\n${snaps} snapshots received. Player Δx = ${moved.toFixed(3)} (inputs push +x).`);
    console.log(moved > 0.1
      ? '✅ LIVE DO smoke test PASSED — connect + 20Hz tick + AoI snapshot + input-driven movement'
      : '❌ player did not move — input handling issue');
    ws.close();
    process.exit(moved > 0.1 ? 0 : 1);
  }
};

ws.onerror = (e: Event) => { console.error('WS error:', (e as ErrorEvent).message ?? e); process.exit(1); };
setTimeout(() => { console.error('timeout: too few snapshots — is `wrangler dev` running on :8787?'); process.exit(1); }, 8000);
