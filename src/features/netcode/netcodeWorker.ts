/**
 * netcodeWorker — runs in a dedicated Web Worker. Owns the connection, decodes
 * each binary snapshot off the main thread, diffs it against the previous tick,
 * and posts ONLY the delta (added/changed/removed) to the game thread.
 *
 * Spawned by netcodeClient.ts. The game thread never imports this file directly
 * and never sees raw bytes or a connection object.
 */
import { decodeSnapshot, type Snapshot, type SnapshotEntity } from '@/lib/snapshotBinary';
import { diffSnapshots, entityKey } from './snapshotDiff';
import type { NetCommand, NetEvent } from './protocol';
import { SyntheticTransport, WebSocketTransport, type NetTransport } from './transport';
import { isHello, decodeHello } from './helloBinary';

// `self` is the worker global; cast for postMessage/onmessage without pulling
// the webworker lib (which conflicts with the app's DOM lib).
const ctx = self as unknown as {
  postMessage: (m: NetEvent) => void;
  onmessage: ((e: { data: NetCommand }) => void) | null;
};

let transport: NetTransport | null = null;
let last: Snapshot | null = null;
const prevByKey = new Map<number, SnapshotEntity>();
/** Which run of the server we are talking to. Changes on restart/deploy. */
let sessionId: number | null = null;

/** Route an incoming frame by its magic. */
function handleMessage(buf: ArrayBuffer): void {
  if (isHello(buf)) { handleHello(buf); return; }
  handleSnapshot(buf);
}

function handleHello(buf: ArrayBuffer): void {
  try {
    const h = decodeHello(buf);
    // A NEW session means the server restarted. Its tick counter is back near
    // zero, so the stale-tick guard below would otherwise discard every
    // snapshot from here on, permanently and silently. Drop the baseline so
    // the fresh stream is accepted.
    if (sessionId !== null && sessionId !== h.sessionId) {
      last = null;
      prevByKey.clear();
    }
    sessionId = h.sessionId;
    ctx.postMessage({
      kind: 'hello',
      sessionId: h.sessionId,
      yourEntityId: h.yourEntityId,
      tick: h.tick,
      tickRate: h.tickRate,
      registryOrigin: h.registryOrigin,
    });
  } catch (e) {
    ctx.postMessage({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

function handleSnapshot(buf: ArrayBuffer): void {
  let snap: Snapshot;
  try {
    snap = decodeSnapshot(buf);
  } catch (e) {
    ctx.postMessage({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    return;
  }
  // Drop stale / duplicate ticks (out-of-order delivery): diffing a snapshot
  // older than our baseline would emit a backwards diff. (`last` is reset to
  // null on connect, so a fresh stream starting at tick 0 is accepted.)
  if (last && snap.tick <= last.tick) return;
  // Rebuild the prev lookup from last tick (reused map → no per-tick alloc).
  prevByKey.clear();
  if (last) for (const e of last.entities) prevByKey.set(entityKey(e.registryOrigin, e.id), e);
  const d = diffSnapshots(last, snap, prevByKey);
  last = snap;
  ctx.postMessage({
    kind: 'diff',
    tick: d.tick, baseTick: d.baseTick, worldId: d.worldId, zoneId: d.zoneId,
    ackSeq: snap.ackSeq,
    added: d.added, changed: d.changed, removed: d.removed,
  });
}

ctx.onmessage = (e) => {
  const cmd = e.data;
  switch (cmd.kind) {
    case 'connect': {
      transport?.close();
      last = null;
      sessionId = null;
      transport = cmd.transport === 'websocket'
        ? new WebSocketTransport(cmd.url ?? '', cmd.token)
        : new SyntheticTransport();
      transport.onOpen = () => ctx.postMessage({ kind: 'connected', instanceId: cmd.instanceId });
      transport.onMessage = handleMessage;
      transport.onClose = (reason) => ctx.postMessage({ kind: 'disconnected', reason });
      transport.connect();
      break;
    }
    case 'disconnect':
      transport?.close();
      transport = null;
      last = null;
      sessionId = null;
      break;
    case 'sendInput':
      transport?.send(cmd.payload);
      break;
  }
};
