// Injectable ground-height sampler for falling coins. Voxel worlds (DreadRoot) land coins via
// worldCollisionGrid.hasVoxel(). Mesh-terrain worlds (Siege Worlds) have no voxels there, so they
// register their terrain-height function and coins settle on the surface instead of falling through
// it and despawning underground. Keeps the coinDrops module portable — no hard siege import.
let sampler: ((x: number, z: number) => number | null) | null = null;

/** A scene registers its terrain height function (or null to clear, e.g. back to a voxel world). */
export function setCoinGroundSampler(fn: ((x: number, z: number) => number | null) | null): void {
  sampler = fn;
}

/** Ground height at (x,z), or null if no mesh terrain here (→ fall back to voxel/safety-floor). */
export function sampleCoinGround(x: number, z: number): number | null {
  return sampler ? sampler(x, z) : null;
}
