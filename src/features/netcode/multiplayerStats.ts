/**
 * Multiplayer counters for the D-Flow report.
 *
 * Deliberately NOT in the diagnostics ring buffer. That buffer is a fixed
 * Float32Array stride, and scripts/perftest.ts hardcodes the stride (58) —
 * a past mismatch silently mis-strided every sample and produced corrupt
 * readings. Adding fields there would break the harness in exactly that way
 * again. These are plain current-value counters read at report time, so the
 * stride is untouched.
 *
 * Everything here is cheap to update: integer increments on paths that already
 * exist. Nothing is computed unless a report is generated.
 */

export interface MultiplayerSnapshot {
  // connection
  mode: string;                 // entity-feed mode: local | shadow | remote
  connected: boolean;
  sessionId: number | null;     // changes when the server restarts
  sessionRestarts: number;
  disconnects: number;
  myEntityId: number | null;

  // traffic
  snapshotsIn: number;
  snapshotsPerSec: number;
  inputsOut: number;
  bytesIn: number;
  kbPerSecIn: number;

  // what the server is telling us about
  serverMonsters: number;       // distinct server-owned monsters seen
  remotePlayers: number;        // other players currently tracked
  standInsAlive: number;        // local puppets driven by the server

  // quality
  lastRttMs: number;
  reconcileMeanBlocks: number;  // mean correction applied to our own position
  reconcileMaxBlocks: number;
  interpStarvations: number;    // frames we had no future sample to interpolate to
  staleFrames: number;          // snapshots discarded as older than what we hold

  // shared kills
  killsSent: number;
  killsReceived: number;
  killsRejected: number;
}

class MultiplayerStats {
  mode = 'local';
  connected = false;
  sessionId: number | null = null;
  sessionRestarts = 0;
  disconnects = 0;
  myEntityId: number | null = null;

  snapshotsIn = 0;
  inputsOut = 0;
  bytesIn = 0;

  serverMonsters = 0;
  remotePlayers = 0;
  standInsAlive = 0;

  lastRttMs = 0;
  private reconSum = 0;
  private reconN = 0;
  reconcileMax = 0;
  interpStarvations = 0;
  staleFrames = 0;

  killsSent = 0;
  killsReceived = 0;
  killsRejected = 0;

  private windowStart = 0;
  private windowSnapshots = 0;
  private windowBytes = 0;
  private lastRate = { snaps: 0, kb: 0 };

  /** One received snapshot of `bytes`. */
  onSnapshot(bytes: number): void {
    this.snapshotsIn++;
    this.bytesIn += bytes;
    const now = Date.now();
    if (this.windowStart === 0) this.windowStart = now;
    this.windowSnapshots++;
    this.windowBytes += bytes;
    const dt = now - this.windowStart;
    if (dt >= 1000) {
      this.lastRate = {
        snaps: (this.windowSnapshots * 1000) / dt,
        kb: (this.windowBytes * 1000) / dt / 1024,
      };
      this.windowStart = now;
      this.windowSnapshots = 0;
      this.windowBytes = 0;
    }
  }

  /** How far reconciliation moved our predicted position, in blocks. */
  onReconcile(correctionBlocks: number): void {
    this.reconSum += correctionBlocks;
    this.reconN++;
    if (correctionBlocks > this.reconcileMax) this.reconcileMax = correctionBlocks;
  }

  reset(): void {
    this.snapshotsIn = 0; this.inputsOut = 0; this.bytesIn = 0;
    this.reconSum = 0; this.reconN = 0; this.reconcileMax = 0;
    this.interpStarvations = 0; this.staleFrames = 0;
    this.killsSent = 0; this.killsReceived = 0; this.killsRejected = 0;
    this.sessionRestarts = 0; this.disconnects = 0;
    this.windowStart = 0; this.windowSnapshots = 0; this.windowBytes = 0;
  }

  snapshot(): MultiplayerSnapshot {
    return {
      mode: this.mode,
      connected: this.connected,
      sessionId: this.sessionId,
      sessionRestarts: this.sessionRestarts,
      disconnects: this.disconnects,
      myEntityId: this.myEntityId,
      snapshotsIn: this.snapshotsIn,
      snapshotsPerSec: +this.lastRate.snaps.toFixed(1),
      inputsOut: this.inputsOut,
      bytesIn: this.bytesIn,
      kbPerSecIn: +this.lastRate.kb.toFixed(1),
      serverMonsters: this.serverMonsters,
      remotePlayers: this.remotePlayers,
      standInsAlive: this.standInsAlive,
      lastRttMs: Math.round(this.lastRttMs),
      reconcileMeanBlocks: this.reconN ? +(this.reconSum / this.reconN).toFixed(4) : 0,
      reconcileMaxBlocks: +this.reconcileMax.toFixed(4),
      interpStarvations: this.interpStarvations,
      staleFrames: this.staleFrames,
      killsSent: this.killsSent,
      killsReceived: this.killsReceived,
      killsRejected: this.killsRejected,
    };
  }

  /** The section printed into the D-Flow report. */
  report(): string {
    const s = this.snapshot();
    const L: string[] = [];
    L.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    L.push('MULTIPLAYER');
    L.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (s.mode === 'local' && !s.connected) {
      L.push('  Not connected — the game is running entirely on local simulation.');
      L.push('  (__server.on() to connect; __feed / __shadow for the lower-level modes)');
      L.push(`  Other players (Supabase presence): ${s.remotePlayers}`);
      return L.join('\n');
    }
    L.push(`  Feed mode:      ${s.mode}${s.mode === 'remote' ? '  (server decides)' : s.mode === 'shadow' ? '  (server graded, decides nothing)' : ''}`);
    L.push(`  Connected:      ${s.connected}   session ${s.sessionId ?? '-'}   my entity ${s.myEntityId ?? '-'}`);
    L.push(`  Stability:      ${s.disconnects} disconnects, ${s.sessionRestarts} server restarts`);
    L.push(`  Downstream:     ${s.snapshotsPerSec}/s snapshots, ${s.kbPerSecIn} KB/s  (${s.snapshotsIn} total)`);
    L.push(`  Upstream:       ${s.inputsOut} inputs sent`);
    L.push(`  Round trip:     ${s.lastRttMs}ms`);
    L.push(`  Entities:       ${s.serverMonsters} server monsters, ${s.standInsAlive} stand-ins drawn, ${s.remotePlayers} other players`);
    L.push(`  Reconcile:      mean ${s.reconcileMeanBlocks} blocks, max ${s.reconcileMaxBlocks}  (near 0 = client and server agree)`);
    L.push(`  Interp starved: ${s.interpStarvations}   stale frames dropped: ${s.staleFrames}`);
    L.push(`  Shared kills:   ${s.killsSent} sent, ${s.killsReceived} received, ${s.killsRejected} rejected`);
    return L.join('\n');
  }
}

export const mpStats = new MultiplayerStats();

if (typeof window !== 'undefined') {
  (window as unknown as { __mp: unknown }).__mp = {
    stats: () => mpStats.snapshot(),
    report: () => mpStats.report(),
    reset: () => { mpStats.reset(); return 'multiplayer counters reset'; },
  };
}
