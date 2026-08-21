/**
 * Server-side monster simulation — the point of the whole project.
 *
 * Until now every browser invented its own monsters privately, so two players
 * standing in the same place saw entirely different creatures. Here ONE
 * authority decides what exists and where it is, and every client is told.
 *
 * Reuses `deterministicSpawn` unchanged. That module was deliberately written
 * pure — no THREE, no React, no clock, no browser — precisely so the server
 * could run the identical code. The server therefore derives the same
 * creatures a client would, with the same ids, and simply becomes the one
 * whose answer counts.
 *
 * DELIBERATE LIMITS, so this is not mistaken for finished:
 *
 *  • X and Z only. The server has no terrain or collision (plan v3 §1.2 E),
 *    so it cannot know the ground height or whether a wall is in the way.
 *    Clients keep owning Y and snap monsters to their own ground. Splitting
 *    it this way is what lets server-owned monsters ship before the whole
 *    world data layer moves across.
 *  • Movement is a simple deterministic chase-or-idle, NOT the real behaviour
 *    tree. The real AI still imports THREE, plays audio inside its decision
 *    path and calls unseeded randomness, so it cannot run here yet. Porting it
 *    is its own job.
 *
 * Pure and portable: relative imports only, no clock of its own.
 */
import type { ServerEntity } from './tickLoop';
import { entityKey } from '../snapshotDiff';
import { ORIGIN_L1 } from '../../../lib/snapshotBinary';
import { planChunkSpawns, epochFor, type PlannedSpawn } from '../../enemies/spawn/deterministicSpawn';

/** Entity type ids on the wire. 0 is the player. */
export const ENTITY_SHOMBIE = 1;

export interface ServerEnemyConfig {
  worldSeed: string | number;
  chunkSize: number;
  epochMs: number;
  /** Chunk ring around each player that gets populated. */
  minChunkDistance: number;
  maxChunkDistance: number;
  spawnChancePerMinute: number;
  maxPerChunk: number;
  /** Hard ceiling on live monsters, protecting the tick budget. */
  maxAlive: number;
  /** Blocks per second. */
  speed: number;
  /** Chase a player within this range; idle beyond it. */
  detectionRange: number;
  /** Y given to a freshly spawned monster. Clients override with real ground. */
  spawnY: number;
}

export const DEFAULT_ENEMY_CONFIG: ServerEnemyConfig = {
  worldSeed: 'dreadroot',
  chunkSize: 16,
  epochMs: 5 * 60 * 1000,
  minChunkDistance: 2,
  maxChunkDistance: 4,
  spawnChancePerMinute: 1,
  maxPerChunk: 1,
  maxAlive: 60,
  speed: 2,
  detectionRange: 24,
  spawnY: 64,
};

interface LiveEnemy {
  key: number;
  id: number;
  /** Planner id, e.g. shombie_t1_3_-7_e100_0. The shared NAME for this thing. */
  planId: string;
}

export class ServerEnemySim {
  private cfg: ServerEnemyConfig;
  private live = new Map<string, LiveEnemy>();   // planId -> live entity
  private killed = new Set<string>();            // planId, suppressed this epoch
  private epoch = -1;
  private nextId: number;
  private scratch: PlannedSpawn[] = [];

  /** Entity ids start high so they cannot collide with player ids. */
  constructor(cfg: Partial<ServerEnemyConfig> = {}, firstEntityId = 100000) {
    this.cfg = { ...DEFAULT_ENEMY_CONFIG, ...cfg };
    this.nextId = firstEntityId;
  }

  setConfig(cfg: Partial<ServerEnemyConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }

  aliveCount(): number { return this.live.size; }

  /** Mark a monster dead. Suppressed until the epoch rolls over. */
  kill(planId: string): boolean {
    const e = this.live.get(planId);
    this.killed.add(planId);
    if (e === undefined) return false;
    this.live.delete(planId);
    return true;
  }

  /** planId for a live entity id, so a kill claim can be resolved. */
  planIdForEntity(entityId: number): string | null {
    for (const [planId, e] of this.live) if (e.id === entityId) return planId;
    return null;
  }

  /**
   * Populate around the given player positions, then move everything one tick.
   * Mutates `entities` in place; allocates only when a monster is created.
   */
  step(
    entities: Map<number, ServerEntity>,
    players: Array<{ x: number; z: number }>,
    dtMs: number,
    nowMs: number,
  ): void {
    const epoch = epochFor(nowMs, this.cfg.epochMs);
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      // A new generation: forget kills so cleared ground repopulates. Live
      // monsters are left alone so they do not vanish under a player's nose.
      this.killed.clear();
    }

    this.spawnAround(entities, players, epoch);
    this.move(entities, players, dtMs);
  }

  private spawnAround(
    entities: Map<number, ServerEntity>,
    players: Array<{ x: number; z: number }>,
    epoch: number,
  ): void {
    if (this.live.size >= this.cfg.maxAlive) return;
    const { chunkSize, minChunkDistance: minD, maxChunkDistance: maxD } = this.cfg;

    // Population is per CHUNK, so two players standing together do not double
    // it — the same chunk yields the same creatures however many people look.
    const seenChunks = new Set<number>();

    for (let p = 0; p < players.length; p++) {
      const pcx = Math.floor(players[p].x / chunkSize);
      const pcz = Math.floor(players[p].z / chunkSize);

      for (let dx = -maxD; dx <= maxD; dx++) {
        for (let dz = -maxD; dz <= maxD; dz++) {
          const ring = Math.max(Math.abs(dx), Math.abs(dz));
          if (ring < minD || ring > maxD) continue;

          const cx = pcx + dx;
          const cz = pcz + dz;
          const ck = (cx & 0xffff) * 65536 + (cz & 0xffff);
          if (seenChunks.has(ck)) continue;
          seenChunks.add(ck);

          const ringChunks = ringChunkCount(minD, maxD);
          const perPopulated = (1 + Math.max(1, this.cfg.maxPerChunk)) / 2;
          const epochMinutes = this.cfg.epochMs / 60000;
          const density = Math.min(
            1,
            ((this.cfg.spawnChancePerMinute / 100) * epochMinutes) / (ringChunks * perPopulated),
          );

          const planned = planChunkSpawns(
            { worldSeed: this.cfg.worldSeed, chunkX: cx, chunkZ: cz, epoch, chunkSize },
            { enemyType: 'shombie', tier: 1, density, maxPerChunk: this.cfg.maxPerChunk },
            this.scratch,
          );

          for (let i = 0; i < planned.length; i++) {
            const s = planned[i];
            if (this.live.has(s.id) || this.killed.has(s.id)) continue;
            if (this.live.size >= this.cfg.maxAlive) return;

            const id = this.nextId++;
            const key = entityKey(ORIGIN_L1, id);
            entities.set(key, {
              registryOrigin: ORIGIN_L1,
              entityType: ENTITY_SHOMBIE,
              id,
              x: s.chunkX * chunkSize + s.offsetX,
              y: this.cfg.spawnY,
              z: s.chunkZ * chunkSize + s.offsetZ,
              yaw: 0,
              stateBits: 0,
              vx: 0, vy: 0, vz: 0,
            });
            this.live.set(s.id, { key, id, planId: s.id });
          }
        }
      }
    }
  }

  private move(
    entities: Map<number, ServerEntity>,
    players: Array<{ x: number; z: number }>,
    dtMs: number,
  ): void {
    const dt = dtMs / 1000;
    const detSq = this.cfg.detectionRange * this.cfg.detectionRange;

    for (const [planId, le] of this.live) {
      const e = entities.get(le.key);
      if (e === undefined) { this.live.delete(planId); continue; }

      // Nearest player, horizontally.
      let bestSq = Infinity, bx = 0, bz = 0;
      for (let i = 0; i < players.length; i++) {
        const dx = players[i].x - e.x;
        const dz = players[i].z - e.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestSq) { bestSq = d2; bx = dx; bz = dz; }
      }

      // Out of range, or already on top of them: hold still. stateBits bit 0
      // reports "chasing" so clients can pick an animation without guessing.
      if (bestSq > detSq || bestSq < 1e-6) { e.stateBits &= ~1; continue; }

      const d = Math.sqrt(bestSq);
      e.yaw = Math.atan2(bx, bz);
      e.stateBits |= 1;

      // Stop short so a monster does not stand inside the player.
      if (d <= STOP_DISTANCE) continue;

      // Clamp the step to the remaining gap. Without this a fast monster
      // overshoots the stopping distance in a single tick and ends up ON the
      // player, then jitters back and forth across them every tick. Only
      // visible at high speed, which is exactly why the test uses one.
      const step = Math.min(this.cfg.speed * dt, d - STOP_DISTANCE);
      const inv = 1 / d;
      e.x += bx * inv * step;
      e.z += bz * inv * step;
    }
  }
}

/** How close a monster gets before it stops advancing. */
const STOP_DISTANCE = 1.2;

/** Chunks in the square ring [minD, maxD]. */
function ringChunkCount(minD: number, maxD: number): number {
  const outer = (2 * maxD + 1) ** 2;
  const inner = minD > 0 ? (2 * (minD - 1) + 1) ** 2 : 0;
  return Math.max(0, outer - inner);
}
