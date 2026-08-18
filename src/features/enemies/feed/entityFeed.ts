/**
 * EntityFeed — the seam between DECIDING where a monster is and DRAWING it.
 *
 * Today every client simulates its own monsters, so two players see different
 * creatures. The end state is a server that owns them. This module is the
 * swappable joint between those two worlds, so the switch is a mode flag
 * rather than a rewrite.
 *
 * Modes:
 *  • 'local'  (default) — the local AI is authoritative. This module does
 *    NOTHING: no recording, no writes, no allocation. Behaviour is byte-for-
 *    byte what it was before the seam existed. This is the shipping mode
 *    until the server is proven.
 *  • 'shadow' — the local AI stays authoritative and keeps driving the game,
 *    but remote state is ingested alongside it and compared. Nobody's game
 *    changes; we just learn how far apart the two simulations are. This is
 *    the dress rehearsal (plan v3, stage 4).
 *  • 'remote' — the feed is authoritative. The local AI is skipped for any
 *    entity the feed knows about, and its transform is written straight onto
 *    the instance (plan v3, stage 5).
 *
 * Zero-allocation by design, matching the rest of the AI hot path: states are
 * pre-allocated per entity and mutated in place, never recreated.
 */

export type FeedMode = 'local' | 'shadow' | 'remote';

/** Authoritative transform + gameplay state for one entity. Presentation state
 *  (twitches, fires, tumble spin) is deliberately NOT here: it stays local and
 *  is derived per client, because it must never cost bandwidth. */
export interface FeedState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  /** Server tick this came from; 0 for locally-published state. */
  tick: number;
  /** performance.now() when last written, for staleness checks. */
  at: number;
}

/** Rolling comparison between the local sim and the remote feed (shadow mode).
 *  This is the number that decides when it is safe to flip to 'remote'. */
export interface DivergenceStats {
  /** Entities compared since the last reset. */
  samples: number;
  /** Largest horizontal distance seen between local and remote, in blocks. */
  maxDistance: number;
  /** Mean horizontal distance, in blocks. */
  meanDistance: number;
  /** Entities the feed had no remote state for. */
  missing: number;
}

const EPSILON_SQ = 1e-6;

export class EntityFeed {
  private mode: FeedMode = 'local';
  private states = new Map<string, FeedState>();

  // Divergence accumulators (shadow mode only).
  private divSamples = 0;
  private divSum = 0;
  private divMax = 0;
  private divMissing = 0;

  getMode(): FeedMode {
    return this.mode;
  }

  /** Switching modes clears stale state so a stale position can never be
   *  mistaken for authority after a reconnect or a mode flip. */
  setMode(mode: FeedMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.states.clear();
    this.resetDivergence();
  }

  /** True when the feed, not the local AI, decides where entities are. */
  isRemote(): boolean {
    return this.mode === 'remote';
  }

  /** True when anything at all should be recorded. False in 'local', which is
   *  what keeps the seam free when it is switched off. */
  isRecording(): boolean {
    return this.mode !== 'local';
  }

  /** Write authoritative state received from the server. */
  ingest(id: string, x: number, y: number, z: number, yaw: number, health: number, tick: number): void {
    let s = this.states.get(id);
    if (s === undefined) {
      s = { x, y, z, yaw, health, tick, at: 0 };
      this.states.set(id, s);
    } else {
      s.x = x; s.y = y; s.z = z; s.yaw = yaw; s.health = health; s.tick = tick;
    }
    s.at = performance.now();
  }

  get(id: string): FeedState | undefined {
    return this.states.get(id);
  }

  /** Drop an entity (despawned, or left our area of interest). */
  remove(id: string): void {
    this.states.delete(id);
  }

  clear(): void {
    this.states.clear();
  }

  size(): number {
    return this.states.size;
  }

  /**
   * Shadow mode: compare where the local sim put an entity against where the
   * server says it is. Accumulates only; never mutates the entity.
   */
  compare(id: string, x: number, _y: number, z: number): void {
    const s = this.states.get(id);
    if (s === undefined) {
      this.divMissing++;
      return;
    }
    const dx = s.x - x;
    const dz = s.z - z;
    const dSq = dx * dx + dz * dz;
    const d = dSq < EPSILON_SQ ? 0 : Math.sqrt(dSq);
    this.divSamples++;
    this.divSum += d;
    if (d > this.divMax) this.divMax = d;
  }

  getDivergence(): DivergenceStats {
    return {
      samples: this.divSamples,
      maxDistance: this.divMax,
      meanDistance: this.divSamples > 0 ? this.divSum / this.divSamples : 0,
      missing: this.divMissing,
    };
  }

  resetDivergence(): void {
    this.divSamples = 0;
    this.divSum = 0;
    this.divMax = 0;
    this.divMissing = 0;
  }
}

/** Process-wide feed. One shared world, one feed. */
export const entityFeed = new EntityFeed();

// Debug handle, matching the existing `window.frameLoop` / `window.__d`
// convention. Lets the seam be demonstrated without any UI:
//   __feed.setMode('remote')   → monsters stop being simulated locally
//   __feed.setMode('local')    → back to normal
//   __feed.getDivergence()     → shadow-mode scoreboard
//
// NOTE: before real server authority ships this must be gated to admins.
// It is harmless today (a client that ignores the feed only misleads itself,
// it cannot change server truth), but it should not stay open once the server
// is the source of truth for anything of value.
if (typeof window !== 'undefined') {
  (window as unknown as { __feed: EntityFeed }).__feed = entityFeed;
}
