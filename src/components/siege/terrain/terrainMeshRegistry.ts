// terrainMeshRegistry — the live set of heightmap cell meshes currently in the scene.
// HeightmapTerrain registers/unregisters each cell mesh as it streams in/out; the brush
// controller raycasts against this set to find the ground point under the crosshair.
import type * as THREE from 'three';

const meshes = new Set<THREE.Object3D>();

export function registerTerrainMesh(m: THREE.Object3D) { meshes.add(m); }
export function unregisterTerrainMesh(m: THREE.Object3D) { meshes.delete(m); }
export function terrainMeshes(): THREE.Object3D[] { return Array.from(meshes); }
