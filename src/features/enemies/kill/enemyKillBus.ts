/**
 * Shared kills — "you killed it, so it is dead for me too".
 *
 * Only meaningful for creatures with a DETERMINISTIC id (see
 * spawn/deterministicSpawn.ts). A legacy random id like
 * `shombie_1712345678901_a1b2` exists in exactly one browser, so announcing it
 * would be noise at best and would kill an unrelated creature at worst. Those
 * are filtered out rather than trusted.
 *
 * Transport-agnostic on purpose. Today the Supabase presence channel carries
 * these messages; later the game server does, and at that point kills stop
 * being announcements to be trusted and become facts handed down by the
 * server. Nothing outside this module has to change for that.
 *
 * SECURITY, stated plainly: while this rides on peer broadcast, a kill is a
 * CLAIM. A modified client could announce anything and make creatures vanish
 * for everyone. That is acceptable now because nothing of value depends on it
 * — the reward path still goes through record_kill on the server, which this
 * does not touch — but it is exactly why authority has to move to the server
 * before monsters are worth anything.
 */
import { isDeterministicId } from '../spawn/deterministicSpawn';
import { deterministicSpawnController } from '../spawn/deterministicSpawnController';

/** Removes one creature by id. Returns true if it owned and removed it. */
export type KillRemover = (id: string) => boolean;

/** Remembered ids, so a kill echoing back cannot start a loop. */
const RECENT_LIMIT = 512;

export class EnemyKillBus {
  private removers: KillRemover[] = [];
  private outgoing: Array<(id: string) => void> = [];
  private recent = new Set<string>();
  private recentOrder: string[] = [];

  /** A creature system registers how to remove one of its own. */
  registerRemover(fn: KillRemover): () => void {
    this.removers.push(fn);
    return () => {
      const i = this.removers.indexOf(fn);
      if (i >= 0) this.removers.splice(i, 1);
    };
  }

  /** The network layer subscribes here to actually send kills. */
  onOutgoing(fn: (id: string) => void): () => void {
    this.outgoing.push(fn);
    return () => {
      const i = this.outgoing.indexOf(fn);
      if (i >= 0) this.outgoing.splice(i, 1);
    };
  }

  /**
   * A creature died in THIS client. Suppress its respawn locally and announce
   * it. Silently ignores non-deterministic ids, which are local-only.
   */
  publishLocalKill(id: string): void {
    if (!isDeterministicId(id)) return;
    if (this.seen(id)) return;
    this.remember(id);
    deterministicSpawnController.markKilled(id);
    for (let i = 0; i < this.outgoing.length; i++) this.outgoing[i](id);
  }

  /**
   * A kill arrived from another player. Suppress the respawn and remove the
   * creature locally. Never re-announces — that is what would loop.
   */
  applyRemoteKill(id: string): boolean {
    if (typeof id !== 'string' || !isDeterministicId(id)) return false;
    if (this.seen(id)) return false;
    this.remember(id);
    deterministicSpawnController.markKilled(id);

    let removed = false;
    for (let i = 0; i < this.removers.length; i++) {
      if (this.removers[i](id)) removed = true;
    }
    return removed;
  }

  private seen(id: string): boolean {
    return this.recent.has(id);
  }

  private remember(id: string): void {
    this.recent.add(id);
    this.recentOrder.push(id);
    if (this.recentOrder.length > RECENT_LIMIT) {
      const oldest = this.recentOrder.shift();
      if (oldest !== undefined) this.recent.delete(oldest);
    }
  }

  reset(): void {
    this.recent.clear();
    this.recentOrder.length = 0;
  }

  stats(): { removers: number; senders: number; remembered: number } {
    return {
      removers: this.removers.length,
      senders: this.outgoing.length,
      remembered: this.recent.size,
    };
  }
}

export const enemyKillBus = new EnemyKillBus();
