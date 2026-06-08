/**
 * remoteEntities (Track 4E) — the client receive→render layer. Turns the netcode
 * worker's delta stream into smoothly-rendered remote entities:
 *   1. reconstruct the authoritative world state by applying each diff, then
 *   2. interpolate every entity ~INTERP_DELAY_MS in the PAST, sampling between
 *      the two buffered snapshots that bracket the render time — so jitter and
 *      the 50ms gap between 20 Hz ticks never show.
 *
 * PURE: no DOM / Three.js / Date.now (the caller passes time, so it's
 * deterministic and unit-testable). The render layer reads `sample()` each
 * frame and copies positions onto its meshes.
 */
import type { SnapshotEntity } from '@/lib/snapshotBinary';
import { entityKey } from './snapshotDiff';

/** Render entities ~2 ticks (at 20 Hz) behind the latest snapshot. */
export const INTERP_DELAY_MS = 100;

export interface RemoteEntity {
  registryOrigin: number;
  entityType: number;
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  stateBits: number;
}

interface DiffLike {
  added: SnapshotEntity[];
  changed: SnapshotEntity[];
  removed: number[];
}

/** Shortest-path angle interpolation (handles the 2π wrap). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function copyEntity(e: SnapshotEntity | RemoteEntity): RemoteEntity {
  return {
    registryOrigin: e.registryOrigin, entityType: e.entityType, id: e.id,
    x: e.x, y: e.y, z: e.z, yaw: e.yaw, stateBits: e.stateBits,
  };
}

export class RemoteWorld {
  /** Latest authoritative state (key → entity), rebuilt from the diff stream. */
  private current = new Map<number, RemoteEntity>();
  /** Time-ordered snapshots for interpolation (oldest → newest). */
  private buffer: Array<{ time: number; ents: Map<number, RemoteEntity> }> = [];
  /** Must hold > INTERP_DELAY_MS of history to bracket the render time. 8 ticks
   *  @20 Hz = 400 ms ≫ the 100 ms delay; raise this if INTERP_DELAY_MS grows. */
  private readonly maxBuffer = 8;

  /** Apply a decoded diff received at local time `timeMs`, and buffer the
   *  resulting full state for interpolation. */
  ingest(diff: DiffLike, timeMs: number): void {
    for (const e of diff.added) this.current.set(entityKey(e.registryOrigin, e.id), copyEntity(e));
    for (const e of diff.changed) this.current.set(entityKey(e.registryOrigin, e.id), copyEntity(e));
    for (const k of diff.removed) this.current.delete(k);

    const ents = new Map<number, RemoteEntity>();
    for (const [k, e] of this.current) ents.set(k, copyEntity(e));
    this.buffer.push({ time: timeMs, ents });
    while (this.buffer.length > this.maxBuffer) this.buffer.shift();
  }

  /** The newest tick's raw state — for the LOCAL player (no interpolation; it's
   *  predicted, not interpolated). */
  latest(): ReadonlyMap<number, RemoteEntity> {
    return this.buffer.length ? this.buffer[this.buffer.length - 1].ents : this.current;
  }

  /** Scratch: keys written this sample() call (reused → no per-frame alloc). */
  private _written = new Set<number>();

  /**
   * Interpolated state at `renderTimeMs` (caller passes `now - INTERP_DELAY_MS`)
   * into `out`. This is called EVERY RENDER FRAME, so it MUTATES the existing
   * `out` entities in place (no per-frame object allocation — only a new object
   * for an entity that just appeared) and deletes ones that left. Entities that
   * appeared snap to the newer value; entities that left are removed.
   */
  sample(renderTimeMs: number, out: Map<number, RemoteEntity>): void {
    const buf = this.buffer;
    if (buf.length === 0) { out.clear(); return; }

    // Pick the bracketing pair (older ≤ render < newer). The before/after/
    // single-snapshot cases collapse to older === newer (no interpolation).
    let older: { ents: Map<number, RemoteEntity> };
    let newer: { ents: Map<number, RemoteEntity> };
    let t = 0;
    if (renderTimeMs <= buf[0].time) {
      older = newer = buf[0];
    } else if (renderTimeMs >= buf[buf.length - 1].time) {
      older = newer = buf[buf.length - 1]; // starved → hold newest
    } else {
      let i = 0;
      while (i < buf.length - 1 && buf[i + 1].time <= renderTimeMs) i++;
      older = buf[i]; newer = buf[i + 1];
      const span = newer.time - older.time;
      t = span > 0 ? (renderTimeMs - older.time) / span : 0;
    }
    const interp = older !== newer;

    this._written.clear();
    for (const [k, eb] of newer.ents) {
      const ea = interp ? older.ents.get(k) : undefined;
      let e = out.get(k);
      if (!e) { e = { registryOrigin: 0, entityType: 0, id: 0, x: 0, y: 0, z: 0, yaw: 0, stateBits: 0 }; out.set(k, e); }
      e.registryOrigin = eb.registryOrigin; e.entityType = eb.entityType; e.id = eb.id; e.stateBits = eb.stateBits;
      if (ea) {
        e.x = ea.x + (eb.x - ea.x) * t;
        e.y = ea.y + (eb.y - ea.y) * t;
        e.z = ea.z + (eb.z - ea.z) * t;
        e.yaw = lerpAngle(ea.yaw, eb.yaw, t);
      } else {
        e.x = eb.x; e.y = eb.y; e.z = eb.z; e.yaw = eb.yaw;
      }
      this._written.add(k);
    }
    // Drop entities that left (in `out` but not this frame's snapshot).
    for (const k of out.keys()) if (!this._written.has(k)) out.delete(k);
  }

  clear(): void {
    this.current.clear();
    this.buffer.length = 0;
  }
}
