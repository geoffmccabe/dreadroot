// globeGround — elevation lookup on the Mini Earth, for anything that needs to sit ON the
// planet rather than render it.
//
// This is the small, synchronous seam that the rest of the game will eventually hang off. For
// P1 it is used to stand a Kaiju on the surface. In P2 the same function backs the tangent-patch
// height provider that `setDynamicHeightProvider` installs, at which point the existing player
// controller, weapons, coins and monsters all work on the sphere without knowing it is a sphere.
//
// Returns metres above sea level, or null if the tile covering that direction is not resident
// yet (in which case the caller should try again next frame rather than assume zero, since
// assuming zero puts things at sea level, which on this map can be far underground).

import {
  TILE, directionToFaceUv, uvToTileIndex, tileUvRange,
} from './cubeSphere';
import { getManifest, getTile, sampleTileBilinear } from './earthTiles';
import { detailMetres } from './globeDetail';
import { renderedElevation, patchIndexDiag } from './globePatchIndex';
import { PLANET_RADIUS } from './cubeSphere';

/**
 * Elevation in METRES for a unit direction from the planet centre.
 * Reads the finest resident level, walking up to coarser ones so a partly-streamed planet
 * still answers rather than returning null. Null only if nothing at all is loaded there.
 */
export function sampleGlobeElevation(x: number, y: number, z: number): number | null {
  const mf = getManifest();
  if (!mf) return null;

  const { face, u, v } = directionToFaceUv(x, y, z);

  for (let level = mf.maxLevel; level >= 0; level--) {
    const tx = uvToTileIndex(u, level);
    const ty = uvToTileIndex(v, level);
    const tile = getTile(face, level, tx, ty);
    if (!tile) continue;

    const [u0, u1] = tileUvRange(tx, level);
    const [v0, v1] = tileUvRange(ty, level);
    const fx = ((u - u0) / (u1 - u0)) * (TILE - 1);
    const fy = ((v - v0) / (v1 - v0)) * (TILE - 1);
    return sampleTileBilinear(tile, fx, fy);
  }
  return null;
}

/**
 * Fallback spacing for ground with no patch on screen yet.
 *
 * 0.382 = quarter-circumference / 2^12 / 64, i.e. one render patch's vertex spacing at the deepest
 * render depth. Only an estimate: see the note on sampleGlobeSurface below.
 */
export const FINEST_RENDER_SPACING = 0.382;

/**
 * Elevation in METRES of the surface you can SEE and STAND ON.
 *
 * ONE SOURCE OF TRUTH, and this is why. Everything that stands on the planet — the Kaiju, the AI
 * Kaiju, the crowd, the camera floor — is placed at this height, while the terrain you look at is
 * built by GlobeTerrain. Those were computed separately and disagreed:
 *
 *   the mesh was built from the deepest tile resident AT BUILD TIME, capped two levels above the
 *   patch depth, with detail band-limited to that patch's own vertex spacing;
 *
 *   this function walked to the deepest tile resident NOW at ANY level, with detail band-limited
 *   to a fixed constant.
 *
 * Inside a landmark region like the Grand Canyon, where real data goes down to 38 m samples, that
 * put the sampler several data levels ahead of the visible mesh. On a canyon rim the gap is well
 * over a hundred metres — which is a 300 m Kaiju standing in the ground up to its waist, and a
 * 1.8 m person buried out of sight entirely. Both were reported, and they are the same bug.
 *
 * So it now asks the patch index what was actually DRAWN here, and only falls back to an
 * independent estimate for ground that has no patch yet (high flight over unstreamed terrain).
 * The fallback cannot be right by construction, so it is counted in patchIndexDiag.estimated
 * rather than being silently trusted.
 */
export function sampleGlobeSurface(
  x: number, y: number, z: number, spacingUnits?: number,
): number | null {
  if (spacingUnits === undefined) {
    const drawn = renderedElevation(x, y, z);
    if (drawn != null) return drawn;
  }
  const base = sampleGlobeElevation(x, y, z);
  if (base == null) return null;
  if (spacingUnits === undefined) patchIndexDiag.estimated++;
  return base + detailMetres(x, y, z, PLANET_RADIUS, base, spacingUnits ?? FINEST_RENDER_SPACING);
}
