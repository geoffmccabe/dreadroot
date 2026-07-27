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
 * Elevation in METRES including procedural amplification: the surface as RENDERED.
 *
 * Anything that stands on the ground must use this, not sampleGlobeElevation. The measured data
 * alone is up to a few hundred metres away from the visible surface once detail is added, which
 * would leave a Kaiju hovering or buried. `spacingUnits` matches the finest render depth so the
 * ground agrees with the most detailed mesh the player can be standing on.
 */
export function sampleGlobeSurface(x: number, y: number, z: number, spacingUnits = 3): number | null {
  const base = sampleGlobeElevation(x, y, z);
  if (base == null) return null;
  return base + detailMetres(x, y, z, PLANET_RADIUS, base, spacingUnits);
}
