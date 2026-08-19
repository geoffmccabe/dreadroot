/**
 * Deterministic chunk spawning — the "everyone sees the same monsters" core.
 *
 * Today each client rolls `Math.random()` every second and drops a monster
 * somewhere near ITS OWN player, with an id built from `Date.now()` plus a
 * random suffix. Two players therefore do not merely see monsters in different
 * places, they see DIFFERENT monsters whose ids can never be matched up. That
 * is why a kill cannot currently be shared: there is no agreed name for the
 * thing that died.
 *
 * Here the population of a chunk is DERIVED rather than rolled:
 *
 *     (world seed, chunk x, chunk z, epoch, type, tier) -> exact monster list
 *
 * Every client computes the same list independently, with no coordination and
 * no server, and — critically — the same STABLE IDS. Stable ids are what make
 * stage 3c (shared kills) possible at all.
 *
 * Pure: no THREE, no React, no clock, no I/O. The caller passes the epoch in.
 * That keeps it Node-testable and, later, runnable unchanged on the server.
 *
 * KNOWN LIMIT, deliberate: the epoch comes from wall-clock time, so two
 * clients whose clocks disagree will briefly disagree at an epoch boundary.
 * With a multi-minute epoch that window is a fraction of a percent of the
 * time, and it disappears entirely once the server owns the clock.
 */
import { seededFrom } from '@/lib/seededRandom';

/** How long one spawn generation lasts. Long enough that clock skew between
 *  clients is negligible against it; short enough that a cleared area
 *  eventually repopulates. */
export const DEFAULT_EPOCH_MS = 5 * 60 * 1000;

export interface PlannedSpawn {
  /** Stable across every client. The shared name for this creature. */
  id: string;
  enemyType: string;
  tier: number;
  chunkX: number;
  chunkZ: number;
  /** Offset within the chunk, in blocks, [0, chunkSize). */
  offsetX: number;
  offsetZ: number;
}

export interface ChunkSpawnRule {
  enemyType: string;
  tier: number;
  /** Probability that this chunk hosts this type/tier at all, per epoch. */
  density: number;
  /** Upper bound on how many, when it does. */
  maxPerChunk: number;
}

export interface PlanOptions {
  worldSeed: string | number;
  chunkX: number;
  chunkZ: number;
  epoch: number;
  chunkSize: number;
}

/** Which spawn generation a moment belongs to. Shared by all clients. */
export function epochFor(nowMs: number, epochMs: number = DEFAULT_EPOCH_MS): number {
  return Math.floor(nowMs / epochMs);
}

/**
 * The exact monsters that should exist in one chunk, for one rule, this epoch.
 * Deterministic: identical inputs always produce an identical array.
 */
export function planChunkSpawns(
  opts: PlanOptions,
  rule: ChunkSpawnRule,
  out: PlannedSpawn[] = [],
): PlannedSpawn[] {
  out.length = 0;
  if (rule.density <= 0 || rule.maxPerChunk <= 0) return out;

  // One generator per (world, chunk, epoch, type, tier). Including the type
  // and tier means adding a new creature cannot shift where the existing ones
  // spawn — otherwise every content change would rearrange the whole world.
  const rng = seededFrom(
    opts.worldSeed,
    opts.chunkX,
    opts.chunkZ,
    opts.epoch,
    rule.enemyType,
    rule.tier,
  );

  if (!rng.chance(rule.density)) return out;

  const count = rng.nextInt(1, rule.maxPerChunk);
  for (let i = 0; i < count; i++) {
    out.push({
      id: spawnId(opts, rule, i),
      enemyType: rule.enemyType,
      tier: rule.tier,
      chunkX: opts.chunkX,
      chunkZ: opts.chunkZ,
      offsetX: rng.nextRange(0, opts.chunkSize),
      offsetZ: rng.nextRange(0, opts.chunkSize),
    });
  }
  return out;
}

/**
 * The agreed name for one planned creature. Readable on purpose: these show up
 * in kill messages and logs, and being able to see which chunk and epoch a
 * monster came from is worth more than a few saved bytes.
 */
export function spawnId(opts: PlanOptions, rule: ChunkSpawnRule, index: number): string {
  return `${rule.enemyType}_t${rule.tier}_${opts.chunkX}_${opts.chunkZ}_e${opts.epoch}_${index}`;
}

/** True for an id produced by this planner (vs a legacy random id). Lets the
 *  two spawn systems coexist while the deterministic one is opt-in. */
export function isDeterministicId(id: string): boolean {
  return /_t\d+_-?\d+_-?\d+_e\d+_\d+$/.test(id);
}
