/**
 * TransformBuffer — time-based interpolation for entities we do not simulate.
 *
 * This is the standard technique every networked shooter uses: buffer
 * timestamped transforms as they arrive, then RENDER SLIGHTLY IN THE PAST and
 * interpolate between the two samples that bracket that render time. The delay
 * is the price of smoothness; ~100 ms covers two 10 Hz updates.
 *
 * It replaces per-frame exponential smoothing (`mesh.position.lerp(target,
 * 0.3)`), which has three defects this fixes:
 *   1. It is FRAME-RATE DEPENDENT — 0.3 per frame converges twice as fast at
 *      120 fps as at 60, so remote players literally move differently
 *      depending on the viewer's hardware.
 *   2. It never actually reaches the target, so motion always lags and a
 *      moving player is permanently behind where they really are.
 *   3. Angles were lerped numerically, so a player crossing the ±PI seam span
 *      the long way round. This lerps by the shortest arc.
 *
 * Deliberately SOURCE-AGNOSTIC. Today it is fed by Supabase presence
 * broadcasts; later it is fed by the server snapshot stream. The rendering
 * code that samples it does not change when the source does — the same seam
 * idea as the EntityFeed, applied to players.
 *
 * Zero-allocation on the hot path: sample slots are pre-allocated per entity
 * and reused, and `sample()` writes into a caller-owned object.
 */

/** Render this far in the past. Two 10 Hz updates plus headroom. */
export const DEFAULT_INTERP_DELAY_MS = 100;

/** Samples kept per entity. 12 @ 10 Hz = 1.2 s, well over the delay. */
const DEFAULT_MAX_SAMPLES = 12;

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Written into by `sample()`. Caller owns it, so nothing allocates per frame. */
export interface SampledTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Horizontal speed in blocks/second, derived from the two bracketing
   *  samples. Drives walk/idle animation far more reliably than measuring how
   *  far a smoothed mesh drifted this frame. */
  speed: number;
}

/** Shortest-arc angle interpolation (handles the ±PI wrap). */
export function lerpAngle(a: number, b: number, t: number): number {
  const TWO_PI = Math.PI * 2;
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d < -Math.PI) d += TWO_PI;
  return a + d * t;
}

class EntityTrack {
  samples: Sample[] = [];
  /** Write cursor for the ring. */
  count = 0;
  /** Declared explicitly rather than as a constructor parameter property:
   *  Node's type stripping cannot handle those (they need codegen, not just
   *  removing types), and the check scripts run under it. */
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  push(t: number, x: number, y: number, z: number, yaw: number): void {
    // Out-of-order or duplicate arrival: ignore rather than corrupt the
    // timeline. WebSockets are ordered, but Supabase broadcast is not
    // guaranteed to be.
    const newest = this.newest();
    if (newest !== null && t <= newest.t) return;

    if (this.samples.length < this.max) {
      this.samples.push({ t, x, y, z, yaw });
    } else {
      // Reuse the oldest slot in place (ring), never reallocate.
      const s = this.samples[this.count % this.max];
      s.t = t; s.x = x; s.y = y; s.z = z; s.yaw = yaw;
    }
    this.count++;
  }

  private newest(): Sample | null {
    if (this.samples.length === 0) return null;
    if (this.samples.length < this.max) return this.samples[this.samples.length - 1];
    return this.samples[(this.count - 1 + this.max) % this.max];
  }

  /** Samples in chronological order, written into the provided array. */
  private ordered(out: Sample[]): void {
    out.length = 0;
    if (this.samples.length < this.max) {
      for (let i = 0; i < this.samples.length; i++) out.push(this.samples[i]);
      return;
    }
    const start = this.count % this.max;
    for (let i = 0; i < this.max; i++) out.push(this.samples[(start + i) % this.max]);
  }

  sample(renderTime: number, out: SampledTransform, scratch: Sample[]): boolean {
    if (this.samples.length === 0) return false;
    this.ordered(scratch);

    const first = scratch[0];
    const last = scratch[scratch.length - 1];

    // Before our history: hold the oldest (a player who just appeared).
    if (renderTime <= first.t) {
      out.x = first.x; out.y = first.y; out.z = first.z; out.yaw = first.yaw; out.speed = 0;
      return true;
    }

    // Past our newest sample: the sender went quiet. HOLD, do not extrapolate.
    // Extrapolating guesses and then snaps back, which reads as rubber-banding;
    // holding reads as someone standing still, which is usually what happened.
    if (renderTime >= last.t) {
      out.x = last.x; out.y = last.y; out.z = last.z; out.yaw = last.yaw; out.speed = 0;
      return true;
    }

    // Find the bracketing pair.
    let i = 0;
    while (i < scratch.length - 2 && scratch[i + 1].t <= renderTime) i++;
    const a = scratch[i];
    const b = scratch[i + 1];

    const span = b.t - a.t;
    const f = span > 0 ? (renderTime - a.t) / span : 0;

    out.x = a.x + (b.x - a.x) * f;
    out.y = a.y + (b.y - a.y) * f;
    out.z = a.z + (b.z - a.z) * f;
    out.yaw = lerpAngle(a.yaw, b.yaw, f);

    if (span > 0) {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      out.speed = Math.sqrt(dx * dx + dz * dz) / (span / 1000);
    } else {
      out.speed = 0;
    }
    return true;
  }
}

export class TransformBuffer {
  private tracks = new Map<string, EntityTrack>();
  private delayMs: number;
  private readonly maxSamples: number;
  /** Reused ordering scratch — never allocated per sample() call. */
  private scratch: Sample[] = [];

  constructor(opts?: { delayMs?: number; maxSamples?: number }) {
    this.delayMs = opts?.delayMs ?? DEFAULT_INTERP_DELAY_MS;
    this.maxSamples = opts?.maxSamples ?? DEFAULT_MAX_SAMPLES;
  }

  getDelayMs(): number { return this.delayMs; }
  setDelayMs(ms: number): void { this.delayMs = Math.max(0, ms); }

  /** Record a transform as it arrived. `nowMs` should be arrival time. */
  push(id: string, x: number, y: number, z: number, yaw: number, nowMs: number): void {
    let track = this.tracks.get(id);
    if (track === undefined) {
      track = new EntityTrack(this.maxSamples);
      this.tracks.set(id, track);
    }
    track.push(nowMs, x, y, z, yaw);
  }

  /** Interpolate at (nowMs - delay). Returns false if this entity is unknown. */
  sample(id: string, nowMs: number, out: SampledTransform): boolean {
    const track = this.tracks.get(id);
    if (track === undefined) return false;
    return track.sample(nowMs - this.delayMs, out, this.scratch);
  }

  remove(id: string): void { this.tracks.delete(id); }
  clear(): void { this.tracks.clear(); }
  size(): number { return this.tracks.size; }
}

/**
 * The buffer for OTHER PLAYERS. A singleton because the source changes but the
 * consumer does not: Supabase broadcasts feed it today, the server snapshot
 * stream feeds it later, and MultiplayerPlayers keeps sampling it either way.
 */
export const remotePlayerBuffer = new TransformBuffer();
