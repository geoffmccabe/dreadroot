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

export interface DeterministicTickInput {
  playerChunkX: number;
  playerChunkZ: number;
  minChunkDistance: number;
  maxChunkDistance: number;
  chunkSize: number;
  rules: ChunkSpawnRule[];
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

  status(): { enabled: boolean; epoch: number; worldSeed: string | number; spawned: number; killed: number } {
    return {
      enabled: this.enabled,
      epoch: this.epoch,
      worldSeed: this.worldSeed,
      spawned: this.spawned.size,
      killed: this.killed.size,
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

    const { playerChunkX, playerChunkZ, minChunkDistance, maxChunkDistance, chunkSize, rules } = input;

    for (let dx = -maxChunkDistance; dx <= maxChunkDistance; dx++) {
      for (let dz = -maxChunkDistance; dz <= maxChunkDistance; dz++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        if (ring < minChunkDistance || ring > maxChunkDistance) continue;

        const chunkX = playerChunkX + dx;
        const chunkZ = playerChunkZ + dz;

        for (let r = 0; r < rules.length; r++) {
          const planned = planChunkSpawns(
            { worldSeed: this.worldSeed, chunkX, chunkZ, epoch, chunkSize },
            rules[r],
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
    controller: deterministicSpawnController,
  };
}
