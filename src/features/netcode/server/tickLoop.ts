/**
 * tickLoop (Track 4A) — the L2's authoritative fixed-step heartbeat, as PURE
 * logic so it's unit-testable today and the Cloudflare Durable Object just
 * drives it from a timer later. The DO calls `advance(now)` on a schedule; this
 * runs as many 20 Hz steps as real time elapsed (fixed-step accumulator), each
 * step applying queued client inputs + the pluggable `simulate` function, then
 * bumps the tick. `buildSnapshot()` produces the full world snapshot to filter
 * per-client (AoI) and encode (snapshotBinary).
 *
 * PURE: no DOM / Three.js / Date.now / timers — the caller passes time, so the
 * loop is deterministic and testable. The real enemy AI/physics plugs in as the
 * `simulate` fn later (it satisfies the same signature).
 */
// Relative imports (not `@/`) so this server layer resolves in the Cloudflare
// worker bundle too, with no path-alias config.
import type { Snapshot, SnapshotEntity } from '../../../lib/snapshotBinary';
import { entityKey } from '../snapshotDiff';

export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ; // 50
/** Cap accumulated time so a long pause (idle DO resuming) doesn't run a spiral
 *  of catch-up ticks. */
export const MAX_CATCHUP_MS = 250; // ≤ 5 steps in one advance()
/** Inputs a single client may have buffered. 8 ticks = 400 ms of intent. */
export const MAX_QUEUED_INPUTS = 8;

/** Authoritative server entity: the wire fields + server-private velocity the
 *  default sim integrates. (The real AI sim carries richer per-type state.) */
export interface ServerEntity extends SnapshotEntity {
  vx: number;
  vy: number;
  vz: number;
}

export type SimulateFn<I> = (
  entities: Map<number, ServerEntity>,
  inputs: Map<string, I>,
  dtMs: number,
  tick: number,
) => void;

/** Default sim: integrate velocity. Real DO swaps in the enemy-AI sim. */
export function integrateVelocity(entities: Map<number, ServerEntity>, _i: unknown, dtMs: number): void {
  const dt = dtMs / 1000;
  for (const e of entities.values()) {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.z += e.vz * dt;
  }
}

export class TickLoop<I = unknown> {
  tick = 0;
  private accumulator = 0;
  private lastTime: number | null = null;
  private entities = new Map<number, ServerEntity>();
  private inputs = new Map<string, I>();
  /** Per-client FIFO of not-yet-applied inputs. */
  private pending = new Map<string, I[]>();
  private simulate: SimulateFn<I>;

  constructor(simulate: SimulateFn<I>) {
    this.simulate = simulate;
  }

  addEntity(e: ServerEntity): void {
    this.entities.set(entityKey(e.registryOrigin, e.id), e);
  }
  removeEntity(origin: number, id: number): void {
    this.entities.delete(entityKey(origin, id));
  }
  getEntities(): Map<number, ServerEntity> {
    return this.entities;
  }

  /**
   * Queue a client's input. Inputs are applied ONE PER TICK, in arrival order.
   *
   * This used to be last-write-wins (`inputs.set(clientId, input)`), which
   * silently discarded every input but the most recent one to arrive between
   * two ticks. That is invisible when a client sends exactly one input per
   * tick, but plan v3 §4.1a REQUIRES batching — sending several inputs per
   * message is how we stay under the per-object message-rate ceiling at 100
   * players — and under batching it threw away half of every batch.
   *
   * Caught by the live dress rehearsal: after fixing the dt cap, the server
   * still tracked only ~half the client's movement, because each 2-input
   * batch lost one.
   *
   * Bounded: a client that floods cannot buffer unlimited movement to spend
   * later. Beyond the cap the OLDEST input is dropped, so the queue always
   * reflects recent intent.
   */
  queueInput(clientId: string, input: I): void {
    let q = this.pending.get(clientId);
    if (q === undefined) { q = []; this.pending.set(clientId, q); }
    q.push(input);
    if (q.length > MAX_QUEUED_INPUTS) q.shift();
  }

  /** Forget a departed client's queued inputs. Without this their queue would
   *  linger for the lifetime of the instance. */
  clearInputs(clientId: string): void {
    this.pending.delete(clientId);
  }

  /** Queued-but-unapplied input count, for tests and diagnostics. */
  queuedCount(clientId: string): number {
    return this.pending.get(clientId)?.length ?? 0;
  }

  /**
   * Advance the fixed-step loop to wall-clock `nowMs`. Runs 0+ 50 ms steps;
   * each applies the queued inputs + `simulate`, then clears inputs and bumps
   * the tick. Returns the number of ticks stepped.
   */
  advance(nowMs: number): number {
    if (this.lastTime === null) { this.lastTime = nowMs; return 0; }
    this.accumulator += nowMs - this.lastTime;
    this.lastTime = nowMs;
    if (this.accumulator > MAX_CATCHUP_MS) this.accumulator = MAX_CATCHUP_MS;

    let stepped = 0;
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      // Take exactly ONE queued input per client for this tick. Each input
      // represents one tick's worth of time, so applying more than one per
      // tick would let a client move faster than the simulation allows.
      this.inputs.clear();
      for (const [clientId, q] of this.pending) {
        const next = q.shift();
        if (next !== undefined) this.inputs.set(clientId, next);
      }
      this.simulate(this.entities, this.inputs, TICK_MS, this.tick);
      this.tick++;
      stepped++;
    }
    return stepped;
  }

  /** Full snapshot of the current authoritative state (wire fields only). */
  buildSnapshot(worldId: number, zoneId: number, out?: SnapshotEntity[], ackSeq = 0): Snapshot {
    const entities = out ?? [];
    entities.length = 0;
    for (const e of this.entities.values()) {
      entities.push({
        registryOrigin: e.registryOrigin, entityType: e.entityType, id: e.id,
        x: e.x, y: e.y, z: e.z, yaw: e.yaw, stateBits: e.stateBits,
      });
    }
    return { tick: this.tick, baseTick: this.tick, worldId, zoneId, ackSeq, entities };
  }
}
