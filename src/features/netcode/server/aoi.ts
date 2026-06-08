/**
 * aoi (Track 4C) — Area-of-Interest filter. Each client only receives the
 * entities within its AoI radius, so a 1000-entity world still sends each player
 * a small snapshot. Pure: the DO calls this per client per tick between
 * buildSnapshot() and encodeSnapshot().
 *
 * Horizontal (x/z) distance only — vertical extent doesn't matter for interest
 * in a voxel world with islands. Reads coord limits from nothing hard-coded;
 * the radius is supplied by the caller (config-driven, forward-compat).
 */
// Relative (not `@/`) so this server layer resolves in the Cloudflare worker
// bundle too, with no path-alias config.
import type { SnapshotEntity } from '../../../lib/snapshotBinary';

/**
 * Filter `entities` to those within `radius` blocks (horizontal) of (cx, cz),
 * writing into `out` (reused across calls/ticks → no per-call allocation).
 * Returns `out`.
 */
export function filterAoI(
  entities: readonly SnapshotEntity[],
  cx: number,
  cz: number,
  radius: number,
  out: SnapshotEntity[],
): SnapshotEntity[] {
  out.length = 0;
  const r2 = radius * radius;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const dx = e.x - cx, dz = e.z - cz;
    if (dx * dx + dz * dz <= r2) out.push(e);
  }
  return out;
}
