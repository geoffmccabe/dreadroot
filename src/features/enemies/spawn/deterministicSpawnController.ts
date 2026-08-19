/**
 * Runtime driver for deterministic spawning.
 *
 * `deterministicSpawn.ts` is the pure "what SHOULD be in this chunk" maths.
 * This is the stateful part that decides what to actually spawn right now:
 * it walks the chunks near the player, asks the planner what belongs there,
 * and reports anything not already spawned and not already killed.
 *
 * DEFAULT OFF. Switching this on changes how the world populates — from a
 * random drip near whoever is playing, to fixed populations that belong to
 * places — and that is a gameplay feel change, not a bug fix. It ships behind
 * a switch so the feel can be judged before it becomes the default:
 *
 *     __spawn.enable()    // everyone-sees-the-same-monsters mode
 *     __spawn.disable()   // back to the current behaviour
 *     __spawn.status()
 *
 * Kills are tracked per epoch so a creature killed does not instantly
 * reappear. Right now that set is local; stage 3c broadcasts it, which is the
 * point at which one player's kill actually removes the monster for everyone.
 */
import { planChunkSpawns, epochFor, DEFAULT_EPOCH_MS, type ChunkSpawnRule, type PlannedSpawn } from './deterministicSpawn';

/** A rule plus the ring of chunks it applies to. Distances are PER RULE: two
 *  creature types legitimately spawn at different ranges, and an earlier
 *  version of this used the first rule's distances for every rule, which
 *  silently applied one creature's range to all of them. */
export type DeterministicRule = Omit<ChunkSpawnRule, 'density'> & {
  minChunkDistance: number;
  maxChunkDistance: number;
  /** The SAME tuning number the legacy spawner uses, passed through untouched.
   *  Density is derived from it here (see densityFor) so the two systems are
   *  calibrated against one another rather than by guesswork. */
  spawnChancePerMinute: number;
};

export interface DeterministicTickInput {
  playerChunkX: number;
  playerChunkZ: number;
  chunkSize: number;
  rules: DeterministicRule[];
}

export class DeterministicSpawnController {
  private enabled = false;
  private worldSeed: string | number = 'dreadroot';
  private epochMs = DEFAULT_EPOCH_MS;

  /** Ids already handed to the game this epoch. */
  private spawned = new Set<string>();
  /** Ids killed this epoch — suppressed until the epoch rolls over. */
  private killed = new Set<string>();
  private epoch = -1;

  /** Reused across chunks so the hot path allocates nothing. */
  private planScratch: PlannedSpawn[] = [];

  /** Global feel knob. 1 = calibrated to match the legacy spawn rate. */
  private densityMultiplier = 1;

  setDensityMultiplier(m: number): void {
    this.densityMultiplier = Math.max(0, m);
    this.reset();
  }
  getDensityMultiplier(): number { return this.densityMultiplier; }

  /**
   * Convert the legacy per-minute chance into a per-chunk, per-epoch density.
   *
   * The legacy spawner rolls ONCE PER SECOND for the whole rule, so over one
   * epoch it expects:
   *     (chance/100) / 60 * epochSeconds       spawns
   * The deterministic planner instead rolls ONCE PER CHUNK, so to expect the
   * same number of creatures the per-chunk probability must be that total
   * divided by the number of chunks in the rule's ring.
   *
   * Getting this wrong is not subtle: naively reusing `chance/100` as the
   * per-chunk density produced roughly FOURTEEN TIMES the legacy population,
   * because it rolled that chance separately in each of ~72 chunks.
   */
  private densityFor(rule: DeterministicRule, ringChunks: number): number {
    if (ringChunks <= 0) return 0;
    const epochMinutes = this.epochMs / 60000;
    const expectedPerEpoch = (rule.spawnChancePerMinute / 100) * epochMinutes;
    return Math.min(1, (expectedPerEpoch / ringChunks) * this.densityMultiplier);
  }

  /** Chunks in the ring [min, max] of a square spiral. */
  private static ringChunkCount(minD: number, maxD: number): number {
    const outer = (2 * maxD + 1) ** 2;
    const inner = minD > 0 ? (2 * (minD - 1) + 1) ** 2 : 0;
    return Math.max(0, outer - inner);
  }

  isEnabled(): boolean { return this.enabled; }

  enable(): void { this.enabled = true; this.reset(); }
  disable(): void { this.enabled = false; this.reset(); }

  setWorldSeed(seed: string | number): void {
    if (seed === this.worldSeed) return;
    this.worldSeed = seed;
    this.reset();
  }

  setEpochMs(ms: number): void {
    this.epochMs = Math.max(1000, ms);
    this.reset();
  }

  /** A creature died. Suppress it until the epoch rolls over. */
  markKilled(id: string): void {
    this.killed.add(id);
  }

  reset(): void {
    this.spawned.clear();
    this.killed.clear();
    this.epoch = -1;
  }

  status(): { enabled: boolean; epoch: number; worldSeed: string | number; spawned: number; killed: number; densityMultiplier: number } {
    return {
      enabled: this.enabled,
      epoch: this.epoch,
      worldSeed: this.worldSeed,
      spawned: this.spawned.size,
      killed: this.killed.size,
      densityMultiplier: this.densityMultiplier,
    };
  }

  /**
   * Report every creature that should exist near the player but does not yet.
   * `emit` is called once per new creature; the caller does the spawning.
   */
  tick(input: DeterministicTickInput, nowMs: number, emit: (s: PlannedSpawn) => void): void {
    if (!this.enabled) return;

    // A new generation wipes the bookkeeping, so cleared areas repopulate and
    // the killed set cannot grow without bound.
    const epoch = epochFor(nowMs, this.epochMs);
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.spawned.clear();
      this.killed.clear();
    }

    const { playerChunkX, playerChunkZ, chunkSize, rules } = input;
    if (rules.length === 0) return;

    // Scan out to the WIDEST rule, then apply each rule's own ring inside.
    let scan = 0;
    for (let r = 0; r < rules.length; r++) {
      if (rules[r].maxChunkDistance > scan) scan = rules[r].maxChunkDistance;
    }

    for (let dx = -scan; dx <= scan; dx++) {
      for (let dz = -scan; dz <= scan; dz++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dz));

        const chunkX = playerChunkX + dx;
        const chunkZ = playerChunkZ + dz;

        for (let r = 0; r < rules.length; r++) {
          const rule = rules[r];
          // Each rule keeps its OWN range.
          if (ring < rule.minChunkDistance || ring > rule.maxChunkDistance) continue;

          const planned = planChunkSpawns(
            { worldSeed: this.worldSeed, chunkX, chunkZ, epoch, chunkSize },
            {
              enemyType: rule.enemyType,
              tier: rule.tier,
              maxPerChunk: rule.maxPerChunk,
              density: this.densityFor(
                rule,
                DeterministicSpawnController.ringChunkCount(rule.minChunkDistance, rule.maxChunkDistance),
              ),
            },
            this.planScratch,
          );
          for (let i = 0; i < planned.length; i++) {
            const s = planned[i];
            if (this.spawned.has(s.id) || this.killed.has(s.id)) continue;
            this.spawned.add(s.id);
            emit(s);
          }
        }
      }
    }
  }
}

export const deterministicSpawnController = new DeterministicSpawnController();

// Debug handle, matching window.frameLoop / window.__d / window.__feed.
if (typeof window !== 'undefined') {
  (window as unknown as { __spawn: unknown }).__spawn = {
    enable: () => { deterministicSpawnController.enable(); return 'deterministic spawning ON — all players derive the same monsters'; },
    disable: () => { deterministicSpawnController.disable(); return 'deterministic spawning OFF — legacy random spawning'; },
    status: () => deterministicSpawnController.status(),
    /** Tune the feel live: 1 = matches legacy rate, 2 = twice as busy. */
    density: (m: number) => { deterministicSpawnController.setDensityMultiplier(m); return `density multiplier = ${m}`; },
    controller: deterministicSpawnController,
  };
}
