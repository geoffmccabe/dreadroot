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
import { encodeHello, HELLO_VERSION } from '../helloBinary';
import { decodeInput } from '../inputBinary';
import { decodeFrame, type StateReport } from '../clientFrames';
import { ServerEnemySim, type ServerEnemyConfig } from './serverEnemySim';

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
  /** Override the session id. Tests pin it; production leaves it random. */
  sessionId?: number;
  /** Server-owned monsters. Omit or pass false to keep the instance
   *  players-only (which is what it was before stage 5). */
  enemies?: Partial<ServerEnemyConfig> | false;
  /** Accept client-reported positions. DEFAULT FALSE — see applyState for why
   *  this is dangerous. Local experiments only; never in production. */
  allowClientState?: boolean;
  /** Override the per-tick simulation (the real enemy AI plugs in here). The
   *  default applies queued player inputs via the shared stepPlayer. */
  simulate?: SimulateFn<QueuedInput>;
}

const DEFAULT_MAX_PLAYERS = 64;
/** Longest gap a client-reported position may account for, when enabled. */
const MAX_STATE_GAP_MS = 1000;
/** Headroom so legitimate movement is never throttled by the clamp above. */
const AOI_CENTRE_SLACK = 4;
/** How far away a kill may be claimed from. Generous: ranged weapons exist,
 *  and the point is to reject the absurd, not to police the plausible. */
const MAX_KILL_RANGE = 120;

export class GameInstanceCore {
  private loop: TickLoop<QueuedInput>;
  private lagComp = new LagCompensationBuffer();
  private players = new Map<string, { id: number; key: number }>();
  private centers = new Map<string, { x: number; z: number }>();
  private lastSeq = new Map<string, number>();
  private nextId = 1;
  private filtered: SnapshotEntity[] = [];
  private cfg: GameInstanceConfig;
  /** Identifies THIS RUN of the instance. A restart, eviction or code deploy
   *  produces a new value, which is how a client tells "the server restarted"
   *  apart from "that packet was out of order" — the difference between
   *  resyncing and hanging forever. */
  private readonly sessionId: number;
  /** Server-owned monsters, or null for a players-only instance. */
  private enemySim: ServerEnemySim | null = null;
  /** Reused player-position array; the monster sim runs every tick. */
  private playerPositions: Array<{ x: number; z: number }> = [];
  /** Wall clock from the most recent tick, for spawn generations. */
  private lastNowMs = 0;

  constructor(cfg: GameInstanceConfig) {
    this.cfg = cfg;
    this.loop = new TickLoop<QueuedInput>(cfg.simulate ?? this.defaultSimulate);
    // Not security-sensitive: it only has to CHANGE across restarts.
    this.sessionId = (cfg.sessionId ?? ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
    if (cfg.enemies !== false && cfg.enemies !== undefined) {
      this.enemySim = new ServerEnemySim(cfg.enemies);
    }
  }

  getSessionId(): number { return this.sessionId; }

  /**
   * The greeting for a freshly-joined client: who they are and which run of
   * the server they reached. Returns null for an unknown client.
   */
  buildHello(clientId: string): ArrayBuffer | null {
    const p = this.players.get(clientId);
    if (p === undefined) return null;
    return encodeHello({
      version: HELLO_VERSION,
      sessionId: this.sessionId,
      yourEntityId: p.id,
      tick: this.loop.tick,
      tickRate: Math.round(1000 / TICK_MS),
      registryOrigin: ORIGIN_L1,
    });
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
    // Drop any inputs they queued but never had applied, or the queue would
    // linger for the lifetime of the instance.
    this.loop.clearInputs(clientId);
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

  /** Presence: set a client's player to a reported position (client-trusted for
   *  now). The tick loop's broadcast + AoI machinery does the rest. */
  /**
   * Client-reported position (frame type 2).
   *
   * DISABLED BY DEFAULT since 4.351.0. It accepted whatever the client
   * claimed, with no validation of any kind, and each client's
   * area-of-interest centre follows its entity — so a modified client could
   * teleport to any coordinates and immediately receive every entity near
   * them. Sweeping coordinates that way locates every player in the world.
   * Demonstrated working against production before it was closed.
   *
   * It also bypassed every anti-cheat clamp in stepPlayer, making the speed
   * and teleport protection there decorative.
   *
   * Nothing legitimate uses it: the client sends INPUT frames, which the
   * server simulates. It survives only behind an explicit opt-in for local
   * experiments, and even then movement is clamped to what a player could
   * actually have travelled.
   */
  applyState(clientId: string, s: StateReport): void {
    if (this.cfg.allowClientState !== true) return;
    const p = this.players.get(clientId);
    if (!p) return;
    const e = this.loop.getEntities().get(p.key);
    if (!e) return;

    // Even when enabled, never accept a jump further than a player could
    // plausibly have moved since we last heard from them.
    const maxStep = (PLAYER_SPEED * MAX_STATE_GAP_MS) / 1000;
    const dx = s.x - e.x;
    const dz = s.z - e.z;
    if (dx * dx + dz * dz > maxStep * maxStep) return;

    e.x = s.x; e.y = s.y; e.z = s.z; e.yaw = s.yaw;
    this.lastSeq.set(clientId, s.seq);
  }

  /** Route a typed client frame (the DO calls this for every WS message). */
  applyClientMessage(clientId: string, frame: ArrayBuffer): void {
    const f = decodeFrame(frame);
    if (f.kind === 'input') {
      const p = this.players.get(clientId);
      if (p) this.loop.queueInput(clientId, { playerKey: p.key, cmd: f.cmd });
    } else if (f.kind === 'state') {
      this.applyState(clientId, f.state);
    } else if (f.kind === 'kill') {
      this.applyKillClaim(clientId, f.entityId);
    }
  }

  /**
   * "I killed monster N."
   *
   * Combat still runs on the client, so this is a CLAIM the server cannot
   * verify. What it CAN do is refuse the obviously false ones, which is worth
   * far more than nothing and is the first real server-side combat check:
   *   • the entity must exist and must be a monster (you cannot kill a player
   *     this way, nor delete something that was never there),
   *   • the claimer must be plausibly near it — a player across the map cannot
   *     clear the world from a distance.
   * Rejections are silent: telling an attacker exactly which rule they tripped
   * is free debugging for them.
   *
   * Real proof arrives when combat itself moves server-side, at which point
   * this message disappears rather than being trusted harder.
   */
  private applyKillClaim(clientId: string, entityId: number): boolean {
    if (this.enemySim === null) return false;
    const p = this.players.get(clientId);
    if (p === undefined) return false;

    const ents = this.loop.getEntities();
    const killer = ents.get(p.key);
    if (killer === undefined) return false;

    const key = entityKey(ORIGIN_L1, entityId);
    const target = ents.get(key);
    if (target === undefined) return false;
    if (target.entityType === ENTITY_PLAYER) return false;

    const dx = target.x - killer.x;
    const dz = target.z - killer.z;
    if (dx * dx + dz * dz > MAX_KILL_RANGE * MAX_KILL_RANGE) return false;

    const planId = this.enemySim.planIdForEntity(entityId);
    if (planId === null) return false;

    this.enemySim.kill(planId);
    ents.delete(key);
    return true;
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
    // Server-owned monsters. One authority decides what exists and where, so
    // every client sees the same creatures instead of inventing its own.
    if (this.enemySim !== null) {
      this.playerPositions.length = 0;
      for (const p of this.players.values()) {
        const pe = entities.get(p.key);
        if (pe !== undefined) this.playerPositions.push({ x: pe.x, z: pe.z });
      }
      this.enemySim.step(entities, this.playerPositions, TICK_MS, this.lastNowMs);
    }
  };

  /** The monster simulation, or null on a players-only instance. */
  getEnemySim(): ServerEnemySim | null { return this.enemySim; }

  /**
   * Advance the loop to `nowMs`. If any ticks ran, fill `out` with each client's
   * AoI-filtered, encoded snapshot (clientId → ArrayBuffer) and return true.
   */
  tick(nowMs: number, out: Map<string, ArrayBuffer>): boolean {
    out.clear();
    this.lastNowMs = nowMs;
    if (this.loop.advance(nowMs) === 0) return false;

    const ents = this.loop.getEntities();
    // Each client's AoI follows its player's authoritative position.
    for (const [clientId, p] of this.players) {
      const e = ents.get(p.key);
      const c = this.centers.get(clientId);
      if (e && c) {
        // Clamp how far the view centre can travel in one tick, regardless of
        // how the entity got there. Belt and braces: if anything ever moves a
        // player instantly again, it still cannot be used to scan the world.
        const maxStep = (PLAYER_SPEED * TICK_MS) / 1000 * AOI_CENTRE_SLACK;
        const dx = e.x - c.x, dz = e.z - c.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > maxStep * maxStep) {
          const inv = maxStep / Math.sqrt(d2);
          c.x += dx * inv; c.z += dz * inv;
        } else { c.x = e.x; c.z = e.z; }
      }
    }
    this.lagComp.record(this.loop.tick, ents);

    const full = this.loop.buildSnapshot(this.cfg.worldId, this.cfg.zoneId);
    for (const [clientId, c] of this.centers) {
      filterAoI(full.entities, c.x, c.z, this.cfg.aoiRadius, this.filtered);
      // Each client is told how far through ITS OWN input stream we are, so
      // reconciliation can drop the inputs already baked into this position
      // and replay only the rest. Computed here all along; never sent before.
      out.set(clientId, encodeSnapshot({
        ...full,
        ackSeq: this.lastSeq.get(clientId) ?? 0,
        entities: this.filtered,
      }));
    }
    return true;
  }

  /** Last input seq processed for a client (server→client reconciliation ack). */
  ackSeqFor(clientId: string): number { return this.lastSeq.get(clientId) ?? 0; }
  get tickNumber(): number { return this.loop.tick; }
  playerCount(): number { return this.players.size; }
  getLagComp(): LagCompensationBuffer { return this.lagComp; }
}
