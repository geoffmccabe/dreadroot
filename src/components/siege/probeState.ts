// Shared laser-probe state: LaserProbe (in-canvas) writes it each frame; CoordsHud's
// C-copy reads it so the copied report includes what the laser is pointing at, and the
// VoxelizeTool reads `mesh`/`instanceId` so V can voxelize whatever the laser is on.
import type * as THREE from 'three';

export const probeState = {
  on: false,
  hasHit: false,
  hit: null as string | null,      // "model / sub-mesh [instance N]"
  hx: 0, hy: 0, hz: 0,             // hit point (engine coords)
  mesh: null as THREE.InstancedMesh | THREE.Mesh | null, // pointed-at mesh (for V voxelize)
  instanceId: -1,                  // instance index within the mesh, or -1 for a plain mesh
  tris: 0,                         // triangle count of the pointed-at mesh's geometry
  dist: 0,                         // distance (m) from camera to the hit
  camX: 0, camY: 0, camZ: 0,       // the REAL camera position the laser raycasts from
  dirX: 0, dirZ: -1,               // the REAL forward direction (for facing readout)
  dbgMeshes: 0,                    // # scene meshes the last raycast considered
  dbgHits: 0,                      // # hits the last raycast returned (debug)
};
