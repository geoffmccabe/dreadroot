/**
 * gameInstanceCore — the entire authoritative game-instance logic, with NO
 * Cloudflare / WebSocket / timer dependency, so it's fully unit-testable. The
 * Durable Object is a thin adapter that just feeds it WebSocket events and a
 * clock, and ships the per-client buffers it returns.
 *
 *   onConnect    → addPlayer(clientId)        spawns the player entity
 *   onMessage    → applyInput(clientId, bytes) decodes + queues the input
 *   timer (50ms) → tick(now, out)             advances + builds per-client AoI
 *                                             snapshots to send
 *   onClose      → removePlayer(clientId)
 *
 * PURE / portable (relative imports only).
 */
import { TickLoop, TICK_MS, type ServerEntity, type SimulateFn } from './tickLoop';
import { filterAoI } from './aoi';
import { LagCompensationBuffer } from './lagCompensation';
import { encodeSnapshot, ORIGIN_L1, type SnapshotEntity } from '../../../lib/snapshotBinary';
import { entityKey } from '../snapshotDiff';
import { stepPlayer, PLAYER_SPEED, type PlayerInputCmd } from '../playerSim';
import { decodeInput } from '../inputBinary';

/** Entity-type discriminator for players in the snapshot (enemies use their own
 *  small ids; kept here until a shared registry exists). */
export const ENTITY_PLAYER = 0;
const PLAYER_SPAWN = { x: 0, y: 64, z: 0 };

interface QueuedInput { playerKey: number; cmd: PlayerInputCmd; }

export interface GameInstanceConfig {
  worldId: number;
  zoneId: number;
  aoiRadius: number;
  /** Max concurrent players in one instance (abuse cap). Default 64. */
  maxPlayers?: number;
  /** Override the per-tick simulation (the real enemy AI plugs in here). The
   *  default applies queued player inputs via the shared stepPlayer. */
  simulate?: SimulateFn<QueuedInput>;
}

const DEFAULT_MAX_PLAYERS = 64;

export class GameInstanceCore {
  private loop: TickLoop<QueuedInput>;
  private lagComp = new LagCompensationBuffer();
  private players = new Map<string, { id: number; key: number }>();
  private centers = new Map<string, { x: number; z: number }>();
  private lastSeq = new Map<string, number>();
  private nextId = 1;
  private filtered: SnapshotEntity[] = [];
  private cfg: GameInstanceConfig;

  constructor(cfg: GameInstanceConfig) {
    this.cfg = cfg;
    this.loop = new TickLoop<QueuedInput>(cfg.simulate ?? this.defaultSimulate);
  }

  /** Spawn a player entity for a newly-connected client. Returns its entity id,
   *  or null if the instance is at its player cap (caller should reject). */
  addPlayer(clientId: string): number | null {
    if (this.players.size >= (this.cfg.maxPlayers ?? DEFAULT_MAX_PLAYERS)) return null;
    const id = this.nextId++;
    const key = entityKey(ORIGIN_L1, id);
    this.players.set(clientId, { id, key });
    this.centers.set(clientId, { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z });
    this.loop.addEntity({
      registryOrigin: ORIGIN_L1, entityType: ENTITY_PLAYER, id,
      x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, z: PLAYER_SPAWN.z, yaw: 0, stateBits: 0,
      vx: 0, vy: 0, vz: 0,
    });
    return id;
  }

  removePlayer(clientId: string): void {
    const p = this.players.get(clientId);
    if (!p) return;
    this.loop.removeEntity(ORIGIN_L1, p.id);
    this.players.delete(clientId);
    this.centers.delete(clientId);
    this.lastSeq.delete(clientId);
  }

  /** Decode + queue a raw input frame for the next tick. Unknown clients are
   *  ignored (defensive against a stray message after disconnect). */
  applyInput(clientId: string, frame: ArrayBuffer): void {
    const p = this.players.get(clientId);
    if (!p) return;
    this.loop.queueInput(clientId, { playerKey: p.key, cmd: decodeInput(frame) });
  }

  private defaultSimulate: SimulateFn<QueuedInput> = (entities, inputs) => {
    for (const [clientId, inp] of inputs) {
      const e = entities.get(inp.playerKey);
      if (e) {
        // Authoritative move with anti-cheat caps: unit move vector + dt clamped
        // to one tick (stepPlayer enforces both). A hacked client can't speed-
        // hack or teleport; honest input is unchanged.
        stepPlayer(e, inp.cmd, PLAYER_SPEED, TICK_MS);
        this.lastSeq.set(clientId, inp.cmd.seq); // last input we processed (for ack)
      }
    }
    // The real enemy-AI simulation plugs in here (or via cfg.simulate).
  };

  /**
   * Advance the loop to `nowMs`. If any ticks ran, fill `out` with each client's
   * AoI-filtered, encoded snapshot (clientId → ArrayBuffer) and return true.
   */
  tick(nowMs: number, out: Map<string, ArrayBuffer>): boolean {
    out.clear();
    if (this.loop.advance(nowMs) === 0) return false;

    const ents = this.loop.getEntities();
    // Each client's AoI follows its player's authoritative position.
    for (const [clientId, p] of this.players) {
      const e = ents.get(p.key);
      const c = this.centers.get(clientId);
      if (e && c) { c.x = e.x; c.z = e.z; }
    }
    this.lagComp.record(this.loop.tick, ents);

    const full = this.loop.buildSnapshot(this.cfg.worldId, this.cfg.zoneId);
    for (const [clientId, c] of this.centers) {
      filterAoI(full.entities, c.x, c.z, this.cfg.aoiRadius, this.filtered);
      out.set(clientId, encodeSnapshot({ ...full, entities: this.filtered }));
    }
    return true;
  }

  /** Last input seq processed for a client (server→client reconciliation ack). */
  ackSeqFor(clientId: string): number { return this.lastSeq.get(clientId) ?? 0; }
  get tickNumber(): number { return this.loop.tick; }
  playerCount(): number { return this.players.size; }
  getLagComp(): LagCompensationBuffer { return this.lagComp; }
}
