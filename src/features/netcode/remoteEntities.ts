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

  /**
   * Interpolated state at `renderTimeMs` (caller passes `now - INTERP_DELAY_MS`)
   * into `out` (cleared + refilled, reused across frames). Entities that
   * appeared snap to the newer value; entities that left are absent.
   */
  sample(renderTimeMs: number, out: Map<number, RemoteEntity>): void {
    out.clear();
    const buf = this.buffer;
    if (buf.length === 0) return;
    if (renderTimeMs <= buf[0].time) {
      for (const [k, e] of buf[0].ents) out.set(k, copyEntity(e));
      return;
    }
    if (renderTimeMs >= buf[buf.length - 1].time) {
      // Starved (no future snapshot yet) → hold the newest.
      for (const [k, e] of buf[buf.length - 1].ents) out.set(k, copyEntity(e));
      return;
    }
    // Bracketing pair a (≤ render) … b (> render).
    let i = 0;
    while (i < buf.length - 1 && buf[i + 1].time <= renderTimeMs) i++;
    const a = buf[i], b = buf[i + 1];
    const span = b.time - a.time;
    const t = span > 0 ? (renderTimeMs - a.time) / span : 0;
    for (const [k, eb] of b.ents) {
      const ea = a.ents.get(k);
      if (!ea) { out.set(k, copyEntity(eb)); continue; } // appeared between a,b
      out.set(k, {
        registryOrigin: eb.registryOrigin, entityType: eb.entityType, id: eb.id,
        x: ea.x + (eb.x - ea.x) * t,
        y: ea.y + (eb.y - ea.y) * t,
        z: ea.z + (eb.z - ea.z) * t,
        yaw: lerpAngle(ea.yaw, eb.yaw, t),
        stateBits: eb.stateBits,
      });
    }
    // Entities in `a` but not `b` have left → intentionally omitted.
  }

  clear(): void {
    this.current.clear();
    this.buffer.length = 0;
  }
}
