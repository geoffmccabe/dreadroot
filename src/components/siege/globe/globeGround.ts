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
import * as THREE from 'three';
import { detailMetres } from './globeDetail';
import { cityBaseMetres } from './cityGround';
import { renderedElevation, patchIndexDiag } from './globePatchIndex';
import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';

// Scratch for sampleGlobeNormal, allocated once — it runs per dead body per frame.
const _up = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _WORLD_Y = new THREE.Vector3(0, 1, 0);
const _WORLD_X = new THREE.Vector3(1, 0, 0);

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
    // A CITY OVERRIDES THE BATHYMETRY. See cityGround: Dubai has no detail tiles at all and the
    // coarse data puts it 87 m under water, so without this the Kaiju spawns on the seabed.
    return cityBaseMetres(x, y, z, sampleTileBilinear(tile, fx, fy));
  }
  // Even with no tile loaded, a city still knows it is on land.
  return cityBaseMetres(x, y, z, null);
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
/**
 * The outward NORMAL of the terrain at a direction — which way is "up the slope".
 *
 * Anything that has to lie flat against the ground needs this, not the radial direction: on a
 * mountainside those differ by the angle of the slope, which is the whole point. A dead Kaiju
 * aligned to the radial direction stands to attention on a 40-degree face; aligned to the normal it
 * lies along the hill, which is what Geoff means by "if the terrain is at an angle, they lay at an
 * angle like a ragdoll should".
 *
 * Central differences across two tangent directions. `epsUnits` defaults to the finest render
 * spacing, so the slope is the slope of the surface actually drawn.
 */
export function sampleGlobeNormal(
  dir: THREE.Vector3, out: THREE.Vector3, epsUnits = FINEST_RENDER_SPACING,
): THREE.Vector3 {
  _up.copy(dir).normalize();
  _t1.crossVectors(_up, _WORLD_Y);
  if (_t1.lengthSq() < 1e-9) _t1.crossVectors(_up, _WORLD_X);
  _t1.normalize();
  _t2.crossVectors(_up, _t1).normalize();

  const at = (t: THREE.Vector3, s: number): number | null => {
    _probe.copy(_up).addScaledVector(t, s / PLANET_RADIUS).normalize();
    return sampleGlobeSurface(_probe.x, _probe.y, _probe.z);
  };
  const a1 = at(_t1, epsUnits), b1 = at(_t1, -epsUnits);
  const a2 = at(_t2, epsUnits), b2 = at(_t2, -epsUnits);
  // No usable slope (unstreamed tiles): straight up is right on the flat and harmless elsewhere.
  if (a1 == null || b1 == null || a2 == null || b2 == null) return out.copy(_up);

  // Heights are in METRES and the offsets in units, so convert before taking the gradient or the
  // slope comes out a hundred times too steep and every corpse stands on its head.
  const d1 = ((a1 - b1) / METRES_PER_UNIT) / (2 * epsUnits);
  const d2 = ((a2 - b2) / METRES_PER_UNIT) / (2 * epsUnits);
  out.copy(_up).addScaledVector(_t1, -d1).addScaledVector(_t2, -d2);
  return out.lengthSq() > 1e-12 ? out.normalize() : out.copy(_up);
}

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
