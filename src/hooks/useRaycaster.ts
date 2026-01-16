import { useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { diagnostics } from '@/lib/diagnosticsLogger';

export interface RaycastMeshResult {
  object: THREE.Object3D;
  instanceId?: number;
  distance: number;
  point: THREE.Vector3;
}

export interface RaycastPlaneResult {
  point: THREE.Vector3;
  distance: number;
}

/**
 * Unified raycasting hook with coordinate system awareness
 * 
 * Coordinate System Rules:
 * - Storage: Integer grid coordinates (e.g., 5, 10, -3)
 * - Rendering: Grid + 0.5 offset for cube centers (e.g., 5.5, 10.5, -2.5)
 * - Raycasting: Works in render coordinates, snap back to grid for storage
 */
export const useRaycaster = () => {
  const { camera } = useThree();
  
  // Persistent raycaster - NEVER recreated, avoiding GC pressure
  const raycaster = useRef(new THREE.Raycaster());
  
  // Persistent direction vector - reused every call
  const direction = useRef(new THREE.Vector3());
  
  // Pre-allocated result object - reused to avoid GC
  const resultRef = useRef<RaycastMeshResult>({
    object: null as any,
    instanceId: undefined,
    distance: 0,
    point: new THREE.Vector3()
  });

  /**
   * Raycast against actual rendered meshes (optimized by Three.js)
   * Used for: hover detection, player interaction, instanced blocks
   * 
   * WARNING: Returns a shared object - do not store the result!
   * 
   * @param meshes Array of meshes to raycast against
   * @param maxDistance Maximum raycast distance
   * @returns First intersection with instanceId if applicable
   */
  const raycastMeshes = (
    meshes: THREE.Object3D[],
    maxDistance: number = 100
  ): RaycastMeshResult | null => {
    diagnostics.e3++;
    
    // Update direction from camera without creating new objects
    direction.current.set(0, 0, -1);
    direction.current.applyQuaternion(camera.quaternion);
    direction.current.normalize();
    
    // Update raycaster
    raycaster.current.set(camera.position, direction.current);
    raycaster.current.far = maxDistance;
    
    // Intersect all meshes at once (GPU-optimized for instanced meshes)
    const intersections = raycaster.current.intersectObjects(meshes, false);
    
    if (intersections.length === 0) return null;
    
    const first = intersections[0];
    // Return a new object since callers may store/compare the result
    // This is acceptable for click-based raycasting (infrequent)
    return {
      object: first.object,
      instanceId: first.instanceId,
      distance: first.distance,
      point: first.point.clone()
    };
  };

  /**
   * Raycast against a plane (e.g., ground plane for Block Rain)
   * 
   * @param plane The plane to intersect
   * @returns Intersection point and distance, or null if no intersection
   */
  const raycastPlane = (plane: THREE.Plane): RaycastPlaneResult | null => {
    // Update direction from camera
    direction.current.set(0, 0, -1);
    direction.current.applyQuaternion(camera.quaternion);
    direction.current.normalize();
    
    // Update raycaster
    raycaster.current.set(camera.position, direction.current);
    
    // Intersect with plane
    const point = new THREE.Vector3();
    const intersection = raycaster.current.ray.intersectPlane(plane, point);
    
    if (!intersection) return null;
    
    return {
      point: intersection,
      distance: camera.position.distanceTo(intersection)
    };
  };

  /**
   * Snap render coordinates to grid coordinates for storage
   * Render: 5.5 -> Storage: 5
   */
  const snapToGrid = (renderCoord: number): number => {
    return Math.floor(renderCoord);
  };

  /**
   * Convert grid coordinates to render coordinates
   * Storage: 5 -> Render: 5.5 (center of cube)
   */
  const gridToRender = (gridCoord: number): number => {
    return gridCoord + 0.5;
  };

  return {
    raycastMeshes,
    raycastPlane,
    snapToGrid,
    gridToRender
  };
};
