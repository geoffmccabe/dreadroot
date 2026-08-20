/**
 * netcode transport — the swappable connection backend. This is the ONLY place
 * in the codebase that touches a real WebSocket / pub-sub API (architecture
 * rule: the worker is the sole importer of connection APIs; game code only sees
 * decoded diffs).
 *
 * Two impls:
 *  • SyntheticTransport — an in-worker fake snapshot stream (20 Hz), so the
 *    whole decode→diff pipeline runs today with no Durable Object.
 *  • WebSocketTransport — the real DO connection. Functional but unused until
 *    the DO exists (swap-in is a one-line change in the worker).
 */
import { encodeSnapshot, ORIGIN_L1, type Snapshot } from '@/lib/snapshotBinary';

export interface NetTransport {
  onOpen?: () => void;
  onMessage?: (data: ArrayBuffer) => void;
  onClose?: (reason?: string) => void;
  connect(): void;
  send(data: ArrayBuffer): void;
  close(): void;
}

const SYNTHETIC_HZ = 20;

/**
 * Deterministic fake snapshot for a given tick — a handful of entities orbiting
 * the origin, plus one that blinks in/out every ~second to exercise add/remove
 * in the diff. Exported so the test harness drives the exact same stream.
 */
export function makeSyntheticSnapshot(tick: number): Snapshot {
  const t = tick / SYNTHETIC_HZ;
  const entities = [];
  // 3 steady orbiters (ids 1..3).
  for (let i = 1; i <= 3; i++) {
    const a = t * (0.5 + i * 0.1) + i;
    entities.push({
      registryOrigin: ORIGIN_L1,
      entityType: i, // pretend: 1=shombie, 2=shroomer, 3=shpider
      id: i,
      x: Math.cos(a) * (4 + i),
      y: 64,
      z: Math.sin(a) * (4 + i),
      yaw: a,
      stateBits: tick & 0xff,
    });
  }
  // A blinker (id 99) present only on even seconds.
  if (Math.floor(t) % 2 === 0) {
    entities.push({
      registryOrigin: ORIGIN_L1, entityType: 1, id: 99,
      x: 0, y: 64, z: 0, yaw: 0, stateBits: 0,
    });
  }
  return { tick, baseTick: tick, worldId: 1, zoneId: 0, ackSeq: 0, entities };
}

export class SyntheticTransport implements NetTransport {
  onOpen?: () => void;
  onMessage?: (data: ArrayBuffer) => void;
  onClose?: (reason?: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;

  connect(): void {
    this.onOpen?.();
    this.timer = setInterval(() => {
      const snap = makeSyntheticSnapshot(this.tick++);
      this.onMessage?.(encodeSnapshot(snap));
    }, 1000 / SYNTHETIC_HZ);
  }
  // Inputs are ignored by the synthetic backend.
  send(_data: ArrayBuffer): void { /* no-op */ }
  close(): void {
    if (this.timer != null) { clearInterval(this.timer); this.timer = null; }
    this.onClose?.('closed');
  }
}

/** Real DO connection. Functional, but no DO endpoint exists yet. */
export class WebSocketTransport implements NetTransport {
  onOpen?: () => void;
  onMessage?: (data: ArrayBuffer) => void;
  onClose?: (reason?: string) => void;
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  connect(): void {
    const sep = this.url.includes('?') ? '&' : '?';
    this.ws = new WebSocket(`${this.url}${sep}token=${encodeURIComponent(this.token)}`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => this.onOpen?.();
    this.ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) this.onMessage?.(ev.data);
    };
    this.ws.onclose = (ev) => this.onClose?.(ev.reason || 'closed');
    this.ws.onerror = () => this.onClose?.('error');
  }
  send(data: ArrayBuffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }
  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
