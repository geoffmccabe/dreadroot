import * as THREE from 'three';
import type { PlacedBlock } from '@/types/blocks';

/**
 * Result of block placement calculation
 */
export interface PlacementResult {
  /** Whether placement is valid */
  isValid: boolean;
  /** Grid position where block should be placed (integer coordinates) */
  position: THREE.Vector3 | null;
  /** Reason for invalid placement */
  reason?: 'fortress' | 'waterfall' | 'overlap' | 'no-surface';
  /** Render position (grid position + 0.5 offset for centering) */
  renderPosition?: THREE.Vector3;
}

/**
 * Configuration for block placement system
 */
interface PlacementConfig {
  /** Camera to raycast from */
  camera: THREE.Camera;
  /** List of existing placed blocks to check for overlap */
  existingBlocks: PlacedBlock[];
  /** Maximum raycast distance in blocks (default: 5) */
  maxDistance?: number;
  /** Fortress center position for distance validation */
  fortressCenter?: THREE.Vector3;
  /** Minimum distance from fortress (default: 30) */
  fortressMinDistance?: number;
  /** Waterfall Z position (default: -6) */
  waterfallZ?: number;
  /** Waterfall blocking width (default: 4) */
  waterfallBlockingWidth?: number;
}

/**
 * Fortress wall configurations for raycasting
 */
const FORTRESS_WALLS = [
  // Front left pillar
  { position: [-11, 10, -8], size: [18, 20, 2] },
  // Front right pillar  
  { position: [11, 10, -8], size: [18, 20, 2] },
  // Left wall
  { position: [-19, 10, -23.5], size: [2, 20, 33] },
  // Right wall  
  { position: [19, 10, -23.5], size: [2, 20, 33] },
  // Back wall
  { position: [0, 10, -40], size: [40, 20, 2] },
  // Courtyard floor
  { position: [0, 0.01, -23.5], size: [36, 0.1, 28] }
];

/**
 * Creates raycasting targets (ground, fortress walls, existing blocks)
 * These are temporary invisible meshes used only for raycasting
 */
function createRaycastTargets(existingBlocks: PlacedBlock[]): THREE.Object3D[] {
  const targets: THREE.Object3D[] = [];
  const invisibleMaterial = new THREE.MeshBasicMaterial({ 
    visible: false,
    side: THREE.DoubleSide 
  });
  
  // Add ground plane
  const groundGeometry = new THREE.PlaneGeometry(200, 200);
  const groundMesh = new THREE.Mesh(groundGeometry, invisibleMaterial.clone());
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.set(0, 0, 0);
  groundMesh.name = 'ground';
  targets.push(groundMesh);
  
  // Add fortress walls
  FORTRESS_WALLS.forEach((wall, index) => {
    const wallMesh = new THREE.Mesh(
      new THREE.BoxGeometry(wall.size[0], wall.size[1], wall.size[2]),
      invisibleMaterial.clone()
    );
    wallMesh.position.set(wall.position[0], wall.position[1], wall.position[2]);
    wallMesh.name = `fortress-wall-${index}`;
    targets.push(wallMesh);
  });
  
  // Add existing blocks (position at center, not corner)
  existingBlocks.forEach((block, index) => {
    const blockMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      invisibleMaterial.clone()
    );
    // Blocks are stored at grid coords but rendered with +0.5 offset for centering
    blockMesh.position.set(
      block.position_x + 0.5, 
      block.position_y + 0.5, 
      block.position_z + 0.5
    );
    blockMesh.name = `block-${index}`;
    targets.push(blockMesh);
  });
  
  return targets;
}

/**
 * Disposes of temporary raycasting targets
 */
function disposeRaycastTargets(targets: THREE.Object3D[]): void {
  targets.forEach(target => {
    const mesh = target as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(mat => mat.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  });
}

/**
 * Validates if a position is valid for block placement
 */
function validatePlacement(
  position: THREE.Vector3,
  existingBlocks: PlacedBlock[],
  config: Required<Omit<PlacementConfig, 'camera' | 'existingBlocks' | 'maxDistance'>>
): { isValid: boolean; reason?: PlacementResult['reason'] } {
  const { fortressCenter, fortressMinDistance, waterfallZ, waterfallBlockingWidth } = config;
  
  // Check distance from fortress
  const distanceToFortress = position.distanceTo(fortressCenter);
  if (distanceToFortress < fortressMinDistance) {
    return { isValid: false, reason: 'fortress' };
  }
  
  // Check if blocking waterfall
  if (Math.abs(position.x) < waterfallBlockingWidth / 2 && position.z > waterfallZ) {
    return { isValid: false, reason: 'waterfall' };
  }
  
  // Check for block overlap (tolerance 0.9 to account for floating point precision)
  const hasOverlap = existingBlocks.some(block => 
    Math.abs(block.position_x - position.x) < 0.9 && 
    Math.abs(block.position_y - position.y) < 0.9 && 
    Math.abs(block.position_z - position.z) < 0.9
  );
  
  if (hasOverlap) {
    return { isValid: false, reason: 'overlap' };
  }
  
  return { isValid: true };
}

/**
 * Main block placement calculation system
 * 
 * This function performs raycasting from the camera to find valid block placement positions.
 * It handles:
 * - Raycasting against ground, fortress walls, and existing blocks
 * - Surface normal detection for proper placement
 * - Validation against fortress, waterfall, and overlap rules
 * - Grid snapping to integer coordinates
 * 
 * Coordinate System:
 * - Storage uses integer grid coordinates (0, 1, 2, ...)
 * - Rendering adds 0.5 offset for centering blocks on grid
 * 
 * @param config - Placement configuration
 * @returns PlacementResult with validity, position, and reason
 */
export function calculateBlockPlacement(config: PlacementConfig): PlacementResult {
  const {
    camera,
    existingBlocks,
    maxDistance = 5,
    fortressCenter = new THREE.Vector3(0, 0, -20),
    fortressMinDistance = 30,
    waterfallZ = -6,
    waterfallBlockingWidth = 4,
  } = config;
  
  // Create raycaster from screen center (where hand cursor is displayed)
  // NDC coordinates: (0, 0) = center of screen
  const raycaster = new THREE.Raycaster();
  const screenCenter = new THREE.Vector2(0, 0);
  raycaster.setFromCamera(screenCenter, camera);
  
  // Set far distance for raycast to find where cursor is actually pointing
  raycaster.far = 1000;
  
  // Create temporary raycasting targets
  const targets = createRaycastTargets(existingBlocks);
  
  try {
    // Perform raycasting (get ALL intersections first, then validate distance)
    const allIntersects = raycaster.intersectObjects(targets, true);
    const intersects = allIntersects.filter(i => i.distance <= maxDistance);
    
    // If no intersection within maxDistance, check if there's ANY intersection beyond
    if (intersects.length === 0) {
      // Check if cursor is pointing at something beyond maxDistance
      if (allIntersects.length > 0) {
        // There's a surface beyond maxDistance - clamp to maxDistance
        const direction = raycaster.ray.direction.clone();
        const fallbackPosition = camera.position.clone().add(direction.multiplyScalar(maxDistance));
        
        // Snap to voxel grid
        fallbackPosition.x = Math.round(fallbackPosition.x);
        fallbackPosition.y = Math.max(0, Math.round(fallbackPosition.y));
        fallbackPosition.z = Math.round(fallbackPosition.z);
        
        // Validate fallback placement
        const validation = validatePlacement(fallbackPosition, existingBlocks, {
          fortressCenter,
          fortressMinDistance,
          waterfallZ,
          waterfallBlockingWidth,
        });
        
        const renderPosition = new THREE.Vector3(
          fallbackPosition.x + 0.5,
          fallbackPosition.y + 0.5,
          fallbackPosition.z + 0.5
        );
        
        return {
          isValid: false, // Invalid because beyond maxDistance
          position: fallbackPosition,
          reason: 'no-surface',
          renderPosition,
        };
      }
      
      // No intersection at all - place at maxDistance where cursor is pointing
      const direction = raycaster.ray.direction.clone();
      const fallbackPosition = camera.position.clone().add(direction.multiplyScalar(maxDistance));
      
      // Snap to voxel grid
      fallbackPosition.x = Math.round(fallbackPosition.x);
      fallbackPosition.y = Math.max(0, Math.round(fallbackPosition.y));
      fallbackPosition.z = Math.round(fallbackPosition.z);
      
      // Validate fallback placement
      const validation = validatePlacement(fallbackPosition, existingBlocks, {
        fortressCenter,
        fortressMinDistance,
        waterfallZ,
        waterfallBlockingWidth,
      });
      
      const renderPosition = new THREE.Vector3(
        fallbackPosition.x + 0.5,
        fallbackPosition.y + 0.5,
        fallbackPosition.z + 0.5
      );
      
      return {
        isValid: validation.isValid,
        position: fallbackPosition,
        reason: validation.reason,
        renderPosition,
      };
    }
    
    const intersection = intersects[0];
    const hitPoint = intersection.point;
    const normal = intersection.face?.normal;
    
    if (!normal) {
      return { isValid: false, position: null, reason: 'no-surface' };
    }
    
    // Calculate placement position adjacent to hit surface
    const placePosition = hitPoint.clone().add(normal.clone().multiplyScalar(0.5));
    
    // Snap to voxel grid (integer coordinates)
    placePosition.x = Math.round(placePosition.x);
    placePosition.y = Math.max(0, Math.round(placePosition.y)); // Keep above ground
    placePosition.z = Math.round(placePosition.z);
    
    // Validate placement
    const validation = validatePlacement(placePosition, existingBlocks, {
      fortressCenter,
      fortressMinDistance,
      waterfallZ,
      waterfallBlockingWidth,
    });
    
    // Calculate render position (grid position + 0.5 offset)
    const renderPosition = new THREE.Vector3(
      placePosition.x + 0.5,
      placePosition.y + 0.5,
      placePosition.z + 0.5
    );
    
    return {
      isValid: validation.isValid,
      position: placePosition,
      reason: validation.reason,
      renderPosition,
    };
  } finally {
    // Always clean up temporary objects
    disposeRaycastTargets(targets);
  }
}
