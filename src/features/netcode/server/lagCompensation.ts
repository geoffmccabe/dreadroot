/**
 * lagCompensation (Track 4F) — fair hit registration despite latency. The L2
 * records every tick's entity positions; when a client reports a shot fired at
 * the tick it PERCEIVED (its render tick, ~interp-delay + RTT behind the server),
 * the server rewinds the targets to exactly those positions and validates the
 * hit there — so you hit what you aimed at, not where the target has since moved.
 *
 * PURE: no DOM / Three.js / time source. The wall-occlusion check (fired through
 * a solid voxel) is a SEPARATE pass via voxelTrace (anti-cheat 6D) layered on
 * top; this module owns the rewind + the target-shape test.
 */

export interface PosSample { x: number; y: number; z: number; }

/** Ring of recent per-tick position snapshots for rewinding. */
export class LagCompensationBuffer {
  private history: Array<{ tick: number; pos: Map<number, PosSample> }> = [];
  private readonly maxTicks: number;

  /** @param maxTicks how far back rewinds can reach (20 ≈ 1 s at 20 Hz — covers
   *  worst-case interp-delay + RTT). */
  constructor(maxTicks = 20) { this.maxTicks = maxTicks; }

  /** Snapshot entity positions at `tick` (called once per server tick). */
  record(tick: number, entities: Map<number, { x: number; y: number; z: number }>): void {
    const pos = new Map<number, PosSample>();
    for (const [k, e] of entities) pos.set(k, { x: e.x, y: e.y, z: e.z });
    this.history.push({ tick, pos });
    while (this.history.length > this.maxTicks) this.history.shift();
  }

  /** Positions at `tick` (clamped to the buffer; interpolated between recorded
   *  ticks for sub-tick accuracy) into `out`. Called per shot (infrequent). */
  rewind(tick: number, out: Map<number, PosSample>): void {
    out.clear();
    const h = this.history;
    if (h.length === 0) return;
    if (tick <= h[0].tick) { for (const [k, p] of h[0].pos) out.set(k, { ...p }); return; }
    const newest = h[h.length - 1];
    if (tick >= newest.tick) { for (const [k, p] of newest.pos) out.set(k, { ...p }); return; }

    let i = 0;
    while (i < h.length - 1 && h[i + 1].tick <= tick) i++;
    const a = h[i], b = h[i + 1];
    const span = b.tick - a.tick;
    const t = span > 0 ? (tick - a.tick) / span : 0;
    for (const [k, pb] of b.pos) {
      const pa = a.pos.get(k);
      if (!pa) { out.set(k, { ...pb }); continue; }
      out.set(k, { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, z: pa.z + (pb.z - pa.z) * t });
    }
  }

  /** Oldest / newest ticks currently rewindable (for clamping client claims). */
  range(): { oldest: number; newest: number } | null {
    if (this.history.length === 0) return null;
    return { oldest: this.history[0].tick, newest: this.history[this.history.length - 1].tick };
  }
}

/**
 * Ray vs sphere — does a shot from (ox,oy,oz) along (dx,dy,dz) strike a target
 * sphere at (cx,cy,cz) of `radius`? Forward hits only (t ≥ 0). The direction
 * need not be normalized. (Targets approximated as spheres here; cylinder
 * hitboxes are a follow-up reusing the combat hitbox shapes.)
 */
export function rayHitsSphere(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  radius: number,
): boolean {
  const ocx = ox - cx, ocy = oy - cy, ocz = oz - cz;
  const a = dx * dx + dy * dy + dz * dz;
  if (a === 0) return false;
  const b = 2 * (ocx * dx + ocy * dy + ocz * dz);
  const c = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const sq = Math.sqrt(disc);
  // A forward intersection exists if the far root is ahead of the origin.
  return (-b + sq) / (2 * a) >= 0;
}
