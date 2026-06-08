/**
 * snapshotDiff — the "only send deltas" brain. Given the worker's previous
 * decoded snapshot and the current one, compute added / changed / removed
 * entities so the game thread applies minimal updates instead of replacing the
 * whole world each tick.
 *
 * PURE: no DOM / Worker / Three.js — unit-tested by check-netcode-pipeline.ts.
 * Decoded snapshot field values are deterministic from the wire quantization,
 * so exact comparison == comparing the on-wire representation.
 */
import type { Snapshot, SnapshotEntity } from '@/lib/snapshotBinary';

/** Stable key for an entity across snapshots: (registryOrigin, id). origin is a
 *  u8 and id a u32, so origin·2^32 + id stays well under 2^53 (safe integer). */
export function entityKey(origin: number, id: number): number {
  return origin * 4294967296 + (id >>> 0);
}

export interface SnapshotDiff {
  tick: number;
  baseTick: number;
  worldId: number;
  zoneId: number;
  added: SnapshotEntity[];
  changed: SnapshotEntity[];
  removed: number[]; // entity keys
}

function entitiesEqual(a: SnapshotEntity, b: SnapshotEntity): boolean {
  return a.entityType === b.entityType
    && a.x === b.x && a.y === b.y && a.z === b.z
    && a.yaw === b.yaw && a.stateBits === b.stateBits;
}

/**
 * Diff `curr` against `prev` (null = first snapshot → everything is "added").
 * Reuses a caller-provided map to avoid per-tick allocation if supplied.
 */
export function diffSnapshots(
  prev: Snapshot | null,
  curr: Snapshot,
  prevByKey?: Map<number, SnapshotEntity>,
): SnapshotDiff {
  const added: SnapshotEntity[] = [];
  const changed: SnapshotEntity[] = [];
  const removed: number[] = [];

  // Build (or reuse) prev lookup.
  const byKey = prevByKey ?? new Map<number, SnapshotEntity>();
  if (!prevByKey) {
    byKey.clear();
    if (prev) for (const e of prev.entities) byKey.set(entityKey(e.registryOrigin, e.id), e);
  }

  const seen = new Set<number>();
  for (const e of curr.entities) {
    const k = entityKey(e.registryOrigin, e.id);
    seen.add(k);
    const old = byKey.get(k);
    if (!old) added.push(e);
    else if (!entitiesEqual(old, e)) changed.push(e);
  }
  // Anything in prev not seen this tick is gone.
  for (const k of byKey.keys()) {
    if (!seen.has(k)) removed.push(k);
  }

  return {
    tick: curr.tick,
    baseTick: curr.baseTick,
    worldId: curr.worldId,
    zoneId: curr.zoneId,
    added,
    changed,
    removed,
  };
}
