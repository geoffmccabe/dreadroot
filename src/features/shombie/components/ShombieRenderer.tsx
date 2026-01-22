import React, { useRef, useImperativeHandle, forwardRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { SHOMBIE_BODY_PARTS, PARTS_PER_SHOMBIE, type ShombieInstance } from '../types';
import { 
  DEFAULT_SHOMBIE_COLOR, 
  MAX_TOTAL_SHOMBIES, 
  TIER_COLORS,
  HEAD_FIRE_SIZE,
  HEAD_FIRE_HEIGHT,
  SHOMBIE_EMERGENCE_DURATION_MS,
} from '../constants';
import particleFire from 'three-particle-fire';

// Initialize the particle fire library with THREE
particleFire.install({ THREE });

// Pre-allocated objects
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpColor = new THREE.Color();
const tmpEuler = new THREE.Euler();

// Shared geometry for body parts
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);

// Max instances = max shombies * parts per shombie
const MAX_INSTANCES = MAX_TOTAL_SHOMBIES * PARTS_PER_SHOMBIE;

// Emergence depth (how far underground they start)
const EMERGENCE_DEPTH = 2.0;

// Texture cache
const textureCache = new Map<string, THREE.Texture>();
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

// Convert hex color to THREE.Color
function hexToColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

// Get tier color as hex
function getTierPrimaryColor(tier: number): string {
  return TIER_COLORS[tier]?.[0] || '#FFFF00';
}

// Get tier colors array
function getTierColors(tier: number): string[] {
  return TIER_COLORS[tier] || ['#FFFF00'];
}

function getOrCreateMaterial(textureUrl: string | null): THREE.MeshStandardMaterial {
  const cacheKey = textureUrl || 'default';
  
  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey)!;
  }

  const mat = new THREE.MeshStandardMaterial({
    color: textureUrl ? 0xffffff : DEFAULT_SHOMBIE_COLOR,
    roughness: 0.7,
    metalness: 0.1,
  });

  if (textureUrl) {
    const loader = new THREE.TextureLoader();
    loader.load(textureUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      mat.map = texture;
      mat.needsUpdate = true;
    });
  }

  materialCache.set(cacheKey, mat);
  return mat;
}

interface HeadFire {
  shombieId: string;
  points: THREE.Points;
  material: ReturnType<typeof particleFire.Material>;
  tier: number;
}

export interface ShombieRendererHandle {
  update: (cameraPosition: THREE.Vector3, deltaTime: number) => void;
  getHeadPosition: (shombieId: string) => THREE.Vector3 | null;
}

interface ShombieRendererProps {
  shombies: ShombieInstance[];
}

/**
 * Renders shombies as block-based humanoids with shambling animation
 * and tier-colored head fires
 */
export const ShombieRenderer = forwardRef<ShombieRendererHandle, ShombieRendererProps>(
  ({ shombies }, ref) => {
    const meshRefsMap = useRef<Map<string, THREE.InstancedMesh>>(new Map());
    const groupRef = useRef<THREE.Group>(null);
    const headFiresRef = useRef<Map<string, HeadFire>>(new Map());
    const cameraRef = useRef<THREE.Camera | null>(null);

    // Group shombies by texture
    const textureUrls = useMemo(() => {
      const urls = new Set<string>();
      for (const shombie of shombies) {
        urls.add(shombie.definition.texture_url || 'default');
      }
      return Array.from(urls);
    }, [shombies]);

    const materials = useMemo(() => {
      const mats = new Map<string, THREE.MeshStandardMaterial>();
      for (const url of textureUrls) {
        const actualUrl = url === 'default' ? null : url;
        mats.set(url, getOrCreateMaterial(actualUrl));
      }
      return mats;
    }, [textureUrls]);

    // Clean up fires when shombies are removed
    useEffect(() => {
      const activeIds = new Set(shombies.filter(s => s.isActive).map(s => s.id));
      
      for (const [id, headFire] of headFiresRef.current.entries()) {
        if (!activeIds.has(id)) {
          // Remove fire from scene
          if (groupRef.current) {
            groupRef.current.remove(headFire.points);
          }
          // Dispose of geometry and material
          headFire.points.geometry.dispose();
          if (headFire.material.dispose) headFire.material.dispose();
          headFiresRef.current.delete(id);
        }
      }
    }, [shombies]);

    // Update fires every frame - store delta for material updates
    const clockRef = useRef(new THREE.Clock());
    useFrame(({ camera }) => {
      cameraRef.current = camera;
      const delta = clockRef.current.getDelta();
      
      for (const headFire of headFiresRef.current.values()) {
        // Update material animation
        headFire.material.update(delta);
      }
    });

    useImperativeHandle(ref, () => ({
      update: (cameraPosition: THREE.Vector3, deltaTime: number) => {
        // Group by texture
        const shombiesByTexture = new Map<string, ShombieInstance[]>();
        
        for (const shombie of shombies) {
          if (!shombie.isActive) continue;
          const url = shombie.definition.texture_url || 'default';
          if (!shombiesByTexture.has(url)) {
            shombiesByTexture.set(url, []);
          }
          shombiesByTexture.get(url)!.push(shombie);
        }

        // Track head positions for fire updates
        const headPositions = new Map<string, THREE.Vector3>();

        // Update each instanced mesh
        for (const [textureUrl, textureShombies] of shombiesByTexture) {
          const mesh = meshRefsMap.current.get(textureUrl);
          if (!mesh) continue;

          let instanceIndex = 0;

          for (const shombie of textureShombies) {
            // Update emergence progress (0 to 1 over EMERGENCE_DURATION_MS)
            const timeSinceSpawn = Date.now() - shombie.spawnedAt;
            shombie.emergenceProgress = Math.min(1, timeSinceSpawn / SHOMBIE_EMERGENCE_DURATION_MS);
            
            // Calculate emergence offset (starts underground, rises to surface)
            const emergenceOffset = (1 - shombie.emergenceProgress) * -EMERGENCE_DEPTH;
            
            // Update animation phase for shambling
            shombie.animationPhase += deltaTime * 4 * (shombie.velocity.length() > 0.1 ? 1.5 : 0.5);
            
            const phase = shombie.animationPhase;
            const wobble = Math.sin(phase) * 0.1;
            
            // Set rotation quaternion for this shombie
            tmpEuler.set(0, shombie.rotation, 0);
            tmpQuaternion.setFromEuler(tmpEuler);

            // Get tier color for this shombie
            const tierColor = hexToColor(getTierPrimaryColor(shombie.definition.tier));
            
            // Apply scale variation to all parts
            const scale = shombie.scale;

            for (let partIdx = 0; partIdx < PARTS_PER_SHOMBIE; partIdx++) {
              const part = SHOMBIE_BODY_PARTS[partIdx];
              
              // Calculate world position with animation offsets (scaled)
              let offsetX = part.offsetX * scale;
              let offsetY = part.offsetY * scale;
              let offsetZ = part.offsetZ * scale;
              
              // Apply shambling animation per part
              if (part.name === 'head') {
                offsetY += Math.sin(phase * 2) * 0.02 * scale;
                offsetX += wobble * scale;
              } else if (part.name === 'leftArm') {
                offsetZ -= 0.3 * scale;
                offsetY += Math.sin(phase) * 0.05 * scale;
              } else if (part.name === 'rightArm') {
                offsetZ -= 0.3 * scale;
                offsetY += Math.sin(phase + Math.PI) * 0.05 * scale;
              } else if (part.name === 'leftLeg') {
                offsetZ += Math.sin(phase) * 0.15 * scale;
              } else if (part.name === 'rightLeg') {
                offsetZ += Math.sin(phase + Math.PI) * 0.15 * scale;
              } else if (part.name === 'torso') {
                offsetX += wobble * 0.5 * scale;
              }

              // Rotate offset by shombie rotation
              const rotatedX = offsetX * Math.cos(shombie.rotation) - offsetZ * Math.sin(shombie.rotation);
              const rotatedZ = offsetX * Math.sin(shombie.rotation) + offsetZ * Math.cos(shombie.rotation);
              
              tmpPosition.set(
                shombie.position.x + rotatedX,
                shombie.position.y + offsetY + emergenceOffset,
                shombie.position.z + rotatedZ
              );
              
              // Store head position for fire placement
              if (part.name === 'head') {
                headPositions.set(shombie.id, tmpPosition.clone());
              }
              
              // Scale all parts by the shombie's scale factor
              tmpScale.set(part.scaleX * scale, part.scaleY * scale, part.scaleZ * scale);
              tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
              mesh.setMatrixAt(instanceIndex, tmpMatrix);

              // Apply tier color with health-based brightness
              const healthPercent = shombie.currentHealth / shombie.maxHealth;
              const brightness = 0.5 + healthPercent * 0.5;
              tmpColor.copy(tierColor).multiplyScalar(brightness);
              mesh.setColorAt(instanceIndex, tmpColor);

              instanceIndex++;
            }
          }

          mesh.count = instanceIndex;
          if (instanceIndex > 0) {
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) {
              mesh.instanceColor.needsUpdate = true;
            }
          }
        }

        // Clear unused meshes
        for (const [url, mesh] of meshRefsMap.current) {
          if (!shombiesByTexture.has(url)) {
            mesh.count = 0;
          }
        }

        // Update head fires
        for (const shombie of shombies) {
          if (!shombie.isActive) continue;
          
          const headPos = headPositions.get(shombie.id);
          if (!headPos) continue;

          let headFire = headFiresRef.current.get(shombie.id);
          
          // Create fire if it doesn't exist
          if (!headFire && groupRef.current && cameraRef.current) {
            const tierColors = getTierColors(shombie.definition.tier);
            const primaryColor = new THREE.Color(tierColors[0] || '#FFFF00');
            
            // Create fire geometry and material using three-particle-fire API
            const fireGeometry = new particleFire.Geometry(HEAD_FIRE_SIZE, HEAD_FIRE_HEIGHT, 100);
            const fireMaterial = new particleFire.Material({ color: primaryColor.getHex() });
            
            // Set perspective for proper rendering
            const camera = cameraRef.current as THREE.PerspectiveCamera;
            if (camera.fov) {
              fireMaterial.setPerspective(camera.fov, window.innerHeight);
            }
            
            const firePoints = new THREE.Points(fireGeometry, fireMaterial);
            
            groupRef.current.add(firePoints);
            headFire = { shombieId: shombie.id, points: firePoints, material: fireMaterial, tier: shombie.definition.tier };
            headFiresRef.current.set(shombie.id, headFire);
          }
          
          // Update fire position (on top of head)
          if (headFire) {
            headFire.points.position.set(
              headPos.x,
              headPos.y + 0.3, // Above the head
              headPos.z
            );
          }
        }
      },
      
      getHeadPosition: (shombieId: string) => {
        const shombie = shombies.find(s => s.id === shombieId && s.isActive);
        if (!shombie) return null;
        
        const headPart = SHOMBIE_BODY_PARTS[0]; // Head is first part
        const phase = shombie.animationPhase;
        const wobble = Math.sin(phase) * 0.1;
        
        let offsetX = headPart.offsetX + wobble;
        let offsetY = headPart.offsetY + Math.sin(phase * 2) * 0.02;
        let offsetZ = headPart.offsetZ;
        
        const rotatedX = offsetX * Math.cos(shombie.rotation) - offsetZ * Math.sin(shombie.rotation);
        const rotatedZ = offsetX * Math.sin(shombie.rotation) + offsetZ * Math.cos(shombie.rotation);
        
        return new THREE.Vector3(
          shombie.position.x + rotatedX,
          shombie.position.y + offsetY,
          shombie.position.z + rotatedZ
        );
      },
    }), [shombies]);

    const setMeshRef = (url: string) => (mesh: THREE.InstancedMesh | null) => {
      if (mesh) {
        meshRefsMap.current.set(url, mesh);
      } else {
        meshRefsMap.current.delete(url);
      }
    };

    return (
      <group ref={groupRef}>
        {textureUrls.map((url) => (
          <instancedMesh
            key={url}
            ref={setMeshRef(url)}
            args={[boxGeometry, materials.get(url)!, MAX_INSTANCES]}
            frustumCulled={false}
            castShadow
            receiveShadow
          />
        ))}
      </group>
    );
  }
);

ShombieRenderer.displayName = 'ShombieRenderer';
