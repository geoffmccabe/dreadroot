import { useRef, useImperativeHandle, forwardRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { SHOMBIE_BODY_PARTS, PARTS_PER_SHOMBIE, type ShombieInstance, type PartTwitch } from '../types';
import { 
  MAX_TOTAL_SHOMBIES, 
  TIER_COLORS,
  SHOMBIE_EMERGENCE_DURATION_MS,
  SHOMBIE_LEG_ANIMATION_MULTIPLIER,
  SHOMBIE_HITBOX_RADIUS,
  SHOMBIE_HITBOX_HEIGHT,
  DEFAULT_SHOMBIE_TEXTURE_URL,
} from '../constants';

// HEAD FIRE DISABLED - particleFire.install() crashes at module load
// TODO: Re-enable using the same pattern as FortressImpacts (lazy init inside component)
const HEAD_FIRE_ENABLED = false;

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
const textureLoader = new THREE.TextureLoader();
let fortressTexture: THREE.Texture | null = null;

// Load fortress texture
textureLoader.load(DEFAULT_SHOMBIE_TEXTURE_URL, (texture) => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  fortressTexture = texture;
});

// Get tier color as hex
function getTierPrimaryColor(tier: number): string {
  return TIER_COLORS[tier]?.[0] || '#FFFF00';
}

export interface ShombieRendererHandle {
  update: (cameraPosition: THREE.Vector3, deltaTime: number) => void;
  getHeadPosition: (shombieId: string) => THREE.Vector3 | null;
  getHitbox: (shombieId: string) => { center: THREE.Vector3; radius: number; height: number } | null;
}

interface ShombieRendererProps {
  shombies: ShombieInstance[];
}

/**
 * Apply twitchiness to a body part offset
 */
function applyTwitch(
  twitch: PartTwitch,
  time: number,
  scale: number
): { dx: number; dy: number; dz: number; dScaleX: number; dScaleY: number; dScaleZ: number } {
  const t = time * twitch.frequency + twitch.phaseOffset;
  const amp = twitch.amplitude * scale;
  
  let dx = 0, dy = 0, dz = 0;
  let dScaleX = 1, dScaleY = 1, dScaleZ = 1;
  
  switch (twitch.twitchType) {
    case 'vertical':
      dy = Math.sin(t) * amp;
      break;
    case 'horizontal':
      dx = Math.sin(t) * amp;
      break;
    case 'rotate':
      // Apply as slight position shift simulating rotation
      dx = Math.sin(t) * amp * 0.5;
      dz = Math.cos(t) * amp * 0.5;
      break;
    case 'scale':
      const scalePulse = 1 + Math.sin(t) * amp * 0.3;
      dScaleX = scalePulse;
      dScaleY = scalePulse;
      dScaleZ = scalePulse;
      break;
    case 'shake':
      // Rapid small movements
      dx = Math.sin(t * 3) * amp * 0.5;
      dy = Math.cos(t * 2.7) * amp * 0.3;
      dz = Math.sin(t * 2.3) * amp * 0.4;
      break;
  }
  
  return { dx, dy, dz, dScaleX, dScaleY, dScaleZ };
}

/**
 * Renders shombies as block-based humanoids with twitchy animation
 * and tier-colored head fires (same effect as bullet impacts)
 */
export const ShombieRenderer = forwardRef<ShombieRendererHandle, ShombieRendererProps>(
  ({ shombies }, ref) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const groupRef = useRef<THREE.Group>(null);
    const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);

    // Create material with fortress texture and tier tint
    const material = useMemo(() => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffff00, // Yellow tint for T1
        roughness: 0.8,
        metalness: 0.1,
      });
      
      // Apply texture when loaded
      if (fortressTexture) {
        mat.map = fortressTexture;
        mat.needsUpdate = true;
      } else {
        // Retry when texture loads
        const checkTexture = setInterval(() => {
          if (fortressTexture) {
            mat.map = fortressTexture;
            mat.needsUpdate = true;
            clearInterval(checkTexture);
          }
        }, 100);
      }
      
      materialRef.current = mat;
      return mat;
    }, []);

    useImperativeHandle(ref, () => ({
      update: (cameraPosition: THREE.Vector3, deltaTime: number) => {
        const mesh = meshRef.current;
        if (!mesh) return;

        const now = performance.now() / 1000; // Time in seconds for twitching
        const headPositions = new Map<string, THREE.Vector3>();

        let instanceIndex = 0;

        for (const shombie of shombies) {
          if (!shombie.isActive) continue;

          // Update emergence progress (0 to 1 over EMERGENCE_DURATION_MS)
          const timeSinceSpawn = Date.now() - shombie.spawnedAt;
          shombie.emergenceProgress = Math.min(1, timeSinceSpawn / SHOMBIE_EMERGENCE_DURATION_MS);
          
          // Calculate emergence offset (starts underground, rises to surface)
          const emergenceOffset = (1 - shombie.emergenceProgress) * -EMERGENCE_DEPTH;
          
          // Walking animation - double leg rate when moving
          const isMoving = shombie.isChasing && shombie.velocity.length() > 0.1;
          const legMultiplier = isMoving ? SHOMBIE_LEG_ANIMATION_MULTIPLIER : 0.5;
          shombie.animationPhase += deltaTime * 4 * legMultiplier;
          
          const phase = shombie.animationPhase;
          const wobble = Math.sin(phase) * 0.1;
          
          // Set rotation quaternion for this shombie
          tmpEuler.set(0, shombie.rotation, 0);
          tmpQuaternion.setFromEuler(tmpEuler);

          // Get tier color for this shombie
          const tierColorHex = getTierPrimaryColor(shombie.definition.tier);
          const tierColor = new THREE.Color(tierColorHex);
          
          // Apply scale variation to all parts
          const scale = shombie.scale;

          for (let partIdx = 0; partIdx < PARTS_PER_SHOMBIE; partIdx++) {
            const part = SHOMBIE_BODY_PARTS[partIdx];
            
            // Get this part's twitchiness
            const twitch = shombie.partTwitches[part.name];
            const twitchResult = twitch 
              ? applyTwitch(twitch, now, scale) 
              : { dx: 0, dy: 0, dz: 0, dScaleX: 1, dScaleY: 1, dScaleZ: 1 };
            
            // Calculate world position with animation offsets (scaled)
            let offsetX = part.offsetX * scale + twitchResult.dx;
            let offsetY = part.offsetY * scale + twitchResult.dy;
            let offsetZ = part.offsetZ * scale + twitchResult.dz;
            
            // Apply walking animation per part
            if (part.name === 'head') {
              offsetY += Math.sin(phase * 2) * 0.02 * scale;
              offsetX += wobble * scale;
            } else if (part.name.includes('UpperArm')) {
              // Arms swing forward in zombie pose
              offsetZ -= 0.3 * scale;
              const armPhase = part.name.includes('left') ? phase : phase + Math.PI;
              offsetY += Math.sin(armPhase) * 0.05 * scale;
            } else if (part.name.includes('LowerArm')) {
              // Follow upper arm with bend
              offsetZ -= 0.25 * scale;
              const armPhase = part.name.includes('left') ? phase : phase + Math.PI;
              offsetY += Math.sin(armPhase * 1.2) * 0.03 * scale;
            } else if (part.name.includes('UpperLeg')) {
              const legPhase = part.name.includes('left') ? phase : phase + Math.PI;
              offsetZ += Math.sin(legPhase) * 0.15 * scale;
            } else if (part.name.includes('LowerLeg')) {
              // Follow upper leg with knee bend
              const legPhase = part.name.includes('left') ? phase : phase + Math.PI;
              offsetZ += Math.sin(legPhase) * 0.1 * scale;
              // Knee bends more when leg is back
              offsetY += Math.abs(Math.sin(legPhase)) * -0.05 * scale;
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
            
            // Scale all parts by the shombie's scale factor plus twitchiness
            tmpScale.set(
              part.scaleX * scale * twitchResult.dScaleX,
              part.scaleY * scale * twitchResult.dScaleY,
              part.scaleZ * scale * twitchResult.dScaleZ
            );
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

        // HEAD FIRE DISABLED - TODO: re-enable with lazy init pattern from FortressImpacts
      },
      
      getHeadPosition: (shombieId: string) => {
        const shombie = shombies.find(s => s.id === shombieId && s.isActive);
        if (!shombie) return null;
        
        const headPart = SHOMBIE_BODY_PARTS[0]; // Head is first part
        const phase = shombie.animationPhase;
        const wobble = Math.sin(phase) * 0.1;
        
        let offsetX = headPart.offsetX * shombie.scale + wobble * shombie.scale;
        let offsetY = headPart.offsetY * shombie.scale + Math.sin(phase * 2) * 0.02 * shombie.scale;
        let offsetZ = headPart.offsetZ * shombie.scale;
        
        const rotatedX = offsetX * Math.cos(shombie.rotation) - offsetZ * Math.sin(shombie.rotation);
        const rotatedZ = offsetX * Math.sin(shombie.rotation) + offsetZ * Math.cos(shombie.rotation);
        
        return new THREE.Vector3(
          shombie.position.x + rotatedX,
          shombie.position.y + offsetY,
          shombie.position.z + rotatedZ
        );
      },
      
      getHitbox: (shombieId: string) => {
        const shombie = shombies.find(s => s.id === shombieId && s.isActive);
        if (!shombie) return null;
        
        return {
          center: new THREE.Vector3(
            shombie.position.x,
            shombie.position.y + SHOMBIE_HITBOX_HEIGHT / 2,
            shombie.position.z
          ),
          radius: SHOMBIE_HITBOX_RADIUS * shombie.scale,
          height: SHOMBIE_HITBOX_HEIGHT * shombie.scale,
        };
      },
    }), [shombies]);

    return (
      <group ref={groupRef}>
        <instancedMesh
          ref={meshRef}
          args={[boxGeometry, material, MAX_INSTANCES]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
      </group>
    );
  }
);

ShombieRenderer.displayName = 'ShombieRenderer';
