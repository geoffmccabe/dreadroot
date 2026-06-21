// siegeGround — the unified "what's the ground height here" for Siege entities (monsters,
// spawns, drops). Prefers the BVH MESH surface (city streets, SWW rocks/buildings) below a
// per-entity ceiling, falling back to the heightfield/terrain. This is why monsters now
// stand ON the city streets instead of falling through to the flat terrain underneath.
import { meshGroundHeight } from './meshColliderSystem';
import { sampleHeight } from './terrainHeight';

/**
 * Ground Y at (x,z). `ceilingY` = the entity's head/step reach — the mesh surface chosen is
 * the highest one BELOW it, so a monster stands on the street it's on, not a roof above.
 * Returns null only if neither mesh nor terrain is present.
 */
export function groundAt(x: number, z: number, ceilingY: number): number | null {
  const m = meshGroundHeight(x, z, ceilingY);
  if (m != null) return m;
  return sampleHeight(x, z);
}
