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

  /** Queue a client's input for the NEXT tick (latest wins within a tick). */
  queueInput(clientId: string, input: I): void {
    this.inputs.set(clientId, input);
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
      this.simulate(this.entities, this.inputs, TICK_MS, this.tick);
      this.inputs.clear();
      this.tick++;
      stepped++;
    }
    return stepped;
  }

  /** Full snapshot of the current authoritative state (wire fields only). */
  buildSnapshot(worldId: number, zoneId: number, out?: SnapshotEntity[]): Snapshot {
    const entities = out ?? [];
    entities.length = 0;
    for (const e of this.entities.values()) {
      entities.push({
        registryOrigin: e.registryOrigin, entityType: e.entityType, id: e.id,
        x: e.x, y: e.y, z: e.z, yaw: e.yaw, stateBits: e.stateBits,
      });
    }
    return { tick: this.tick, baseTick: this.tick, worldId, zoneId, entities };
  }
}
