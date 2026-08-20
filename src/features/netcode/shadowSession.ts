/**
 * Stage 4 — the dress rehearsal.
 *
 * Connects to the live Durable Object, drives the real input/snapshot path,
 * and GRADES it. The server decides nothing: the game keeps running entirely
 * on local simulation and the player sees no difference whatsoever. All this
 * does is find out whether the pipe works before anything depends on it.
 *
 * What it actually measures, and why that is the useful question:
 *
 *   The client predicts each input with `stepPlayer`, and the server applies
 *   the SAME `stepPlayer` to the same input. They are literally the same
 *   module. So if the network path is healthy, the server's authoritative
 *   position and the client's prediction should agree almost exactly.
 *   ANY meaningful divergence is therefore a real defect in the pipe —
 *   dropped inputs, reordering, the last-write-wins input queue eating
 *   commands, or an id mismatch — rather than a difference of opinion between
 *   two simulations.
 *
 *   That is exactly the contract stage 6 (server-authoritative movement)
 *   depends on, so proving it over a real network now is what makes that
 *   phase safe to attempt later.
 *
 * NOT measured here: how well the server's player model matches the REAL
 * movement code. It does not — playerSim has no gravity, collision or jump
 * (see plan v3 §1.2 B). That is a known gap, not a discovery, and comparing
 * against it would produce a large meaningless number.
 *
 * Off by default. Console only, no UI:
 *   __shadow.start()    connect and begin grading
 *   __shadow.report()   the scoreboard
 *   __shadow.stop()
 */
import { netcodeClient } from './netcodeClient';
import { encodeInputFrame } from './clientFrames';
import { PredictedPlayer } from './prediction';
import { PLAYER_SPEED, type PlayerInputCmd } from './playerSim';
import { entityKey } from './snapshotDiff';
import type { NetEvent } from './protocol';
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';

/** Where the deployed L2 lives. */
export const DEFAULT_L2_URL = 'wss://server.dreadroot.com';

/** Input send rate. Matches the batching decision in plan v3 §4.1a: send at
 *  10 Hz, but each send carries a whole tick's worth of inputs rather than one
 *  oversized one. An input may never represent more time than a single server
 *  tick, or the server's dt cap silently swallows the excess. */
const SEND_HZ = 10;
const SEND_MS = 1000 / SEND_HZ;
/** Server tick interval; one input per tick's worth of elapsed time. */
const TICK_MS = 50;
const INPUTS_PER_SEND = Math.max(1, Math.round(SEND_MS / TICK_MS));

export interface ShadowReport {
  running: boolean;
  connected: boolean;
  /** Which run of the server we reached; changes on restart/deploy. */
  sessionId: number | null;
  /** Entity the server says is ours. Null until greeted. */
  myEntityId: number | null;
  sessionRestarts: number;
  inputsSent: number;
  snapshotsReceived: number;
  /** Snapshots that contained our own entity (the ones we can grade). */
  gradedSamples: number;
  /** Snapshots where our entity was ABSENT — a real defect if it persists. */
  missingSelf: number;
  meanDivergence: number;
  maxDivergence: number;
  /** Divergence over the last sample, for live watching. */
  lastDivergence: number;
  disconnects: number;
  errors: string[];
  secondsRunning: number;
}

export class ShadowSession {
  private running = false;
  private connected = false;
  private sessionId: number | null = null;
  private myEntityId: number | null = null;
  private myKey: number | null = null;
  private registryOrigin = 0;

  private predicted: PredictedPlayer | null = null;
  private seq = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private offDiff: (() => void) | null = null;
  private offStatus: (() => void) | null = null;
  private startedAt = 0;

  // scoreboard
  private inputsSent = 0;
  private snapshots = 0;
  private graded = 0;
  private missingSelf = 0;
  private divSum = 0;
  private divMax = 0;
  private divLast = 0;
  private disconnects = 0;
  private restarts = 0;
  private errors: string[] = [];

  /** Supplies the direction the real player is moving, so the graded inputs
   *  reflect actual play rather than a synthetic pattern. */
  private moveSource: (() => { moveX: number; moveZ: number; yaw: number }) | null = null;
  private lastX = 0;
  private lastZ = 0;
  private haveLast = false;

  setMoveSource(fn: () => { moveX: number; moveZ: number; yaw: number }): void {
    this.moveSource = fn;
  }

  /**
   * Default movement input: the direction the player ACTUALLY moved since the
   * previous send, as a unit vector. Derived from the shared player snapshot
   * rather than by reaching into the controls, so this observes the real game
   * without touching it — which is the whole point of a dress rehearsal.
   */
  private readMove(): { moveX: number; moveZ: number; yaw: number } {
    if (this.moveSource) return this.moveSource();
    const snap = getLocalPlayerSnapshot();
    let moveX = 0, moveZ = 0;
    if (this.haveLast) {
      const dx = snap.x - this.lastX;
      const dz = snap.z - this.lastZ;
      const len = Math.sqrt(dx * dx + dz * dz);
      // Below a few centimetres is standing still, not creeping.
      if (len > 0.02) { moveX = dx / len; moveZ = dz / len; }
    }
    this.lastX = snap.x; this.lastZ = snap.z; this.haveLast = true;
    return { moveX, moveZ, yaw: snap.yaw };
  }

  isRunning(): boolean { return this.running; }

  start(url: string = DEFAULT_L2_URL, token = ''): string {
    if (this.running) return 'shadow session already running';
    this.resetStats();
    this.running = true;
    this.startedAt = Date.now();

    this.offStatus = netcodeClient.onStatus((ev: NetEvent) => this.onStatus(ev));
    this.offDiff = netcodeClient.onDiff((d) => this.onDiff(d));

    netcodeClient.connectToInstance('shadow', token, 'websocket', `${url}/?instance=shadow`);

    this.timer = setInterval(() => this.sendTick(), SEND_MS);
    return `shadow session started against ${url} — the server decides nothing; run __shadow.report()`;
  }

  stop(): string {
    if (!this.running) return 'shadow session not running';
    this.running = false;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.offDiff?.(); this.offDiff = null;
    this.offStatus?.(); this.offStatus = null;
    netcodeClient.disconnect();
    this.connected = false;
    return 'shadow session stopped';
  }

  private resetStats(): void {
    this.inputsSent = 0; this.snapshots = 0; this.graded = 0; this.missingSelf = 0;
    this.divSum = 0; this.divMax = 0; this.divLast = 0;
    this.disconnects = 0; this.restarts = 0; this.errors = [];
    this.sessionId = null; this.myEntityId = null; this.myKey = null;
    this.predicted = null; this.seq = 1;
    this.haveLast = false;
  }

  private onStatus(ev: NetEvent): void {
    switch (ev.kind) {
      case 'connected':
        this.connected = true;
        break;
      case 'hello': {
        if (this.sessionId !== null && this.sessionId !== ev.sessionId) {
          // The server restarted underneath us. Everything we were grading is
          // gone; start again rather than reporting nonsense.
          this.restarts++;
          this.predicted = null;
        }
        this.sessionId = ev.sessionId;
        this.myEntityId = ev.yourEntityId;
        this.registryOrigin = ev.registryOrigin;
        this.myKey = entityKey(ev.registryOrigin, ev.yourEntityId);
        break;
      }
      case 'disconnected':
        this.connected = false;
        this.disconnects++;
        break;
      case 'error':
        if (this.errors.length < 20) this.errors.push(ev.message);
        break;
    }
  }

  private sendTick(): void {
    if (!this.running || !this.connected || this.myEntityId === null) return;

    const m = this.readMove();

    // Predict locally with the SAME function AND the same dt cap the server
    // applies, or the two drift apart by construction.
    if (this.predicted === null) {
      this.predicted = new PredictedPlayer({ x: 0, y: 64, z: 0, yaw: 0 }, PLAYER_SPEED, TICK_MS);
    }

    for (let i = 0; i < INPUTS_PER_SEND; i++) {
      const cmd: PlayerInputCmd = {
        seq: this.seq++,
        moveX: m.moveX,
        moveZ: m.moveZ,
        yaw: m.yaw,
        dtMs: TICK_MS,
      };
      this.predicted.predict(cmd);
      netcodeClient.sendInput(encodeInputFrame(cmd));
      this.inputsSent++;
    }
  }

  private onDiff(d: { added: Array<{ registryOrigin: number; id: number; x: number; y: number; z: number }>; changed: Array<{ registryOrigin: number; id: number; x: number; y: number; z: number }> }): void {
    if (!this.running) return;
    this.snapshots++;
    if (this.myKey === null || this.predicted === null) return;

    // Find OUR entity in this tick.
    let self: { x: number; y: number; z: number } | null = null;
    for (let i = 0; i < d.changed.length; i++) {
      const e = d.changed[i];
      if (entityKey(e.registryOrigin, e.id) === this.myKey) { self = e; break; }
    }
    if (self === null) {
      for (let i = 0; i < d.added.length; i++) {
        const e = d.added[i];
        if (entityKey(e.registryOrigin, e.id) === this.myKey) { self = e; break; }
      }
    }
    if (self === null) {
      // Absent from a tick is normal when we did not move (nothing CHANGED),
      // so this is only a defect if it persists while inputs are flowing.
      this.missingSelf++;
      return;
    }

    const p = this.predicted.state;
    const dx = self.x - p.x;
    const dz = self.z - p.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    this.divLast = dist;
    this.divSum += dist;
    this.graded++;
    if (dist > this.divMax) this.divMax = dist;
  }

  report(): ShadowReport {
    return {
      running: this.running,
      connected: this.connected,
      sessionId: this.sessionId,
      myEntityId: this.myEntityId,
      sessionRestarts: this.restarts,
      inputsSent: this.inputsSent,
      snapshotsReceived: this.snapshots,
      gradedSamples: this.graded,
      missingSelf: this.missingSelf,
      meanDivergence: this.graded > 0 ? this.divSum / this.graded : 0,
      maxDivergence: this.divMax,
      lastDivergence: this.divLast,
      disconnects: this.disconnects,
      errors: this.errors.slice(),
      secondsRunning: this.running ? Math.round((Date.now() - this.startedAt) / 1000) : 0,
    };
  }
}

export const shadowSession = new ShadowSession();

if (typeof window !== 'undefined') {
  (window as unknown as { __shadow: unknown }).__shadow = {
    start: (url?: string, token?: string) => shadowSession.start(url, token),
    stop: () => shadowSession.stop(),
    report: () => shadowSession.report(),
    session: shadowSession,
  };
}
