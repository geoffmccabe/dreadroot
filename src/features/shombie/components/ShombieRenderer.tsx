import { useRef, useImperativeHandle, forwardRef, useMemo, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { SHOMBIE_BODY_PARTS, PARTS_PER_SHOMBIE, type ShombieInstance, type PartTwitch, type HeadMovementType } from '../types';
import { 
  MAX_TOTAL_SHOMBIES, 
  TIER_COLORS,
  SHOMBIE_EMERGENCE_DURATION_MS,
  SHOMBIE_LEG_ANIMATION_MULTIPLIER,
  SHOMBIE_HITBOX_RADIUS,
  SHOMBIE_HITBOX_HEIGHT,
  DEFAULT_SHOMBIE_TEXTURE_URL,
  HEAD_FIRE_SIZE,
  HEAD_FIRE_HEIGHT,
  HEAD_FIRE_PARTICLE_COUNT,
  HEAD_SLIDE_AMPLITUDE,
  HEAD_SLIDE_SPEED,
  HEAD_BOB_AMPLITUDE,
  HEAD_CIRCLE_RADIUS,
  ARM_SWING_AMPLITUDE,
  ARM_SWING_UP_DOWN,
  ELBOW_BEND_MAX,
  KNOCKDOWN_DURATION_MS,
} from '../constants';
import particleFire from 'three-particle-fire';

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

// Texture cache - keyed by URL
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();

// Load and cache a texture
function getOrLoadTexture(url: string): THREE.Texture | null {
  if (!url) return null;
  
  if (textureCache.has(url)) {
    return textureCache.get(url)!;
  }
  
  // Start loading
  textureLoader.load(url, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    textureCache.set(url, texture);
  }, undefined, (err) => {
    console.warn('[ShombieRenderer] Failed to load texture:', url, err);
  });
  
  return null; // Not loaded yet
}

// Get tier color hex string
function getTierColorHex(tier: number): string {
  return TIER_COLORS[tier]?.[0] || '#FFFF00';
}

// Get tier colors array
function getTierColors(tier: number): string[] {
  return TIER_COLORS[tier] || ['#FFFF00'];
}

// Convert hex to number
function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// Head fire tracking
interface HeadFire {
  shombieId: string;
  points: THREE.Points;
  material: any;
  geometry: any;
}

// Particle fire install flag
let particleFireInstalled = false;

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
 * Enhanced with more aggressive random vibrations
 */
function applyTwitch(
  twitch: PartTwitch,
  time: number,
  scale: number
): { dx: number; dy: number; dz: number; dScaleX: number; dScaleY: number; dScaleZ: number; rotation: number } {
  const t = time * twitch.frequency + twitch.phaseOffset;
  const amp = twitch.amplitude * scale;
  
  let dx = 0, dy = 0, dz = 0;
  let dScaleX = 1, dScaleY = 1, dScaleZ = 1;
  let rotation = 0;
  
  // Add secondary fast vibration layer for extra jitteriness
  const fastT = time * twitch.frequency * 3.5 + twitch.phaseOffset * 2;
  const fastAmp = amp * 0.4;
  
  // Add tertiary ultra-fast micro-vibration
  const microT = time * twitch.frequency * 8 + twitch.phaseOffset * 3;
  const microAmp = amp * 0.15;
  
  switch (twitch.twitchType) {
    case 'vertical':
      dy = Math.sin(t) * amp + Math.sin(fastT * 2.3) * fastAmp + Math.sin(microT * 3.7) * microAmp;
      dx = Math.sin(fastT * 1.7) * fastAmp * 0.3 + Math.cos(microT * 4.1) * microAmp;
      break;
    case 'horizontal':
      dx = Math.sin(t) * amp + Math.cos(fastT * 1.9) * fastAmp + Math.sin(microT * 5.3) * microAmp;
      dz = Math.sin(fastT * 2.1) * fastAmp * 0.5 + Math.cos(microT * 3.9) * microAmp;
      break;
    case 'rotate':
      rotation = Math.sin(t) * amp * 0.5 + Math.sin(fastT * 2.7) * fastAmp * 0.3;
      dx = Math.sin(fastT * 2.5) * fastAmp * 0.3 + Math.sin(microT * 6) * microAmp;
      dy = Math.cos(fastT * 1.8) * fastAmp * 0.2 + Math.cos(microT * 5) * microAmp;
      break;
    case 'scale':
      const scalePulse = 1 + Math.sin(t) * amp * 0.3;
      const fastPulse = 1 + Math.sin(fastT * 2) * fastAmp * 0.15;
      const microPulse = 1 + Math.sin(microT * 4) * microAmp * 0.1;
      dScaleX = scalePulse * fastPulse * microPulse;
      dScaleY = scalePulse * (1 + Math.sin(fastT * 1.5) * fastAmp * 0.1) * microPulse;
      dScaleZ = scalePulse * fastPulse * microPulse;
      break;
    case 'shake':
      // Rapid erratic movements - most aggressive
      dx = Math.sin(t * 3) * amp * 0.5 + Math.sin(fastT * 4.1) * fastAmp + Math.sin(microT * 7) * microAmp * 1.5;
      dy = Math.cos(t * 2.7) * amp * 0.3 + Math.cos(fastT * 3.3) * fastAmp * 0.7 + Math.cos(microT * 6.3) * microAmp;
      dz = Math.sin(t * 2.3) * amp * 0.4 + Math.sin(fastT * 2.9) * fastAmp * 0.8 + Math.sin(microT * 8) * microAmp * 1.2;
      rotation = Math.sin(fastT * 5) * amp * 0.2 + Math.sin(microT * 9) * microAmp * 0.5;
      break;
  }
  
  return { dx, dy, dz, dScaleX, dScaleY, dScaleZ, rotation };
}

/**
 * Renders shombies as block-based humanoids with twitchy animation
 * and tier-colored head fires using three-particle-fire
 */
export const ShombieRenderer = forwardRef<ShombieRendererHandle, ShombieRendererProps>(
  ({ shombies }, ref) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const groupRef = useRef<THREE.Group>(null);
    const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
    const headFiresRef = useRef<Map<string, HeadFire>>(new Map());
    const { scene, camera } = useThree();

    // Lazy init particleFire - only when first needed
    const ensureParticleFireInstalled = useCallback(() => {
      if (!particleFireInstalled) {
        try {
          particleFire.install({ THREE });
          particleFireInstalled = true;
        } catch (e) {
          // Already installed or error
        }
      }
    }, []);

    // Track loaded textures per tier
    const tierTexturesRef = useRef<Map<number, THREE.Texture | null>>(new Map());
    
    // Create material - textures applied per-instance via instanceColor (no texture atlas needed)
    // We'll use white material and let the texture be applied dynamically
    const material = useMemo(() => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff, // White base
        roughness: 0.8,
        metalness: 0.1,
      });
      materialRef.current = mat;
      return mat;
    }, []);
    
    // Update material texture based on first active shombie's definition
    // (all shombies use same texture if uploaded, or fallback to default)
    useEffect(() => {
      if (shombies.length === 0) return;
      
      // Find first shombie with a texture_url
      const shombieWithTexture = shombies.find(s => s.isActive && s.definition.texture_url);
      const textureUrl = shombieWithTexture?.definition.texture_url || DEFAULT_SHOMBIE_TEXTURE_URL;
      
      const texture = getOrLoadTexture(textureUrl);
      if (texture && materialRef.current) {
        materialRef.current.map = texture;
        materialRef.current.needsUpdate = true;
      } else if (!texture) {
        // Retry when texture loads
        const checkInterval = setInterval(() => {
          const loadedTexture = getOrLoadTexture(textureUrl);
          if (loadedTexture && materialRef.current) {
            materialRef.current.map = loadedTexture;
            materialRef.current.needsUpdate = true;
            clearInterval(checkInterval);
          }
        }, 100);
        
        return () => clearInterval(checkInterval);
      }
    }, [shombies]);

    // Create head fire for a shombie using three-particle-fire
    const createHeadFire = useCallback((shombieId: string, tier: number): HeadFire | null => {
      ensureParticleFireInstalled();
      
      try {
        const tierColorHex = getTierColorHex(tier);
        
        const fireGeometry = new particleFire.Geometry(
          HEAD_FIRE_SIZE / 2, // radius
          HEAD_FIRE_HEIGHT,
          60 // particle count
        );
        const fireMaterial = new particleFire.Material({ 
          color: hexToNumber(tierColorHex) 
        });
        
        // Configure material like bullet impacts
        (fireMaterial as THREE.Material).blending = THREE.AdditiveBlending;
        (fireMaterial as THREE.ShaderMaterial).depthWrite = false;
        (fireMaterial as THREE.Material).transparent = true;
        
        const cam = camera as THREE.PerspectiveCamera;
        if (cam.fov) {
          fireMaterial.setPerspective(cam.fov, window.innerHeight);
        }
        
        const firePoints = new THREE.Points(fireGeometry, fireMaterial);
        firePoints.renderOrder = 999;
        scene.add(firePoints);
        
        return { 
          shombieId, 
          points: firePoints, 
          material: fireMaterial,
          geometry: fireGeometry,
        };
      } catch (e) {
        console.warn('[ShombieRenderer] Failed to create head fire:', e);
        return null;
      }
    }, [camera, scene, ensureParticleFireInstalled]);

    // Clean up fires when shombies are removed
    useEffect(() => {
      const activeIds = new Set(shombies.filter(s => s.isActive).map(s => s.id));
      
      for (const [id, headFire] of headFiresRef.current.entries()) {
        if (!activeIds.has(id)) {
          // Remove fire from scene
          scene.remove(headFire.points);
          headFire.geometry.dispose();
          headFire.material.dispose();
          headFiresRef.current.delete(id);
        }
      }
    }, [shombies, scene]);

    // Cleanup all fires on unmount
    useEffect(() => {
      return () => {
        for (const headFire of headFiresRef.current.values()) {
          scene.remove(headFire.points);
          headFire.geometry.dispose();
          headFire.material.dispose();
        }
        headFiresRef.current.clear();
      };
    }, [scene]);

    // Update fires every frame
    useFrame((_, delta) => {
      for (const headFire of headFiresRef.current.values()) {
        try {
          headFire.material.update(delta);
        } catch (e) {
          // Ignore update errors
        }
      }
    });

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
          
          // Head movement based on type (1/3 slide, 1/3 bob, 1/3 circle)
          let headOffsetX = 0;
          let headOffsetY = 0;
          const headPhase = phase * HEAD_SLIDE_SPEED;
          
          switch (shombie.headMovementType) {
            case 'slide':
              // Shoulder to shoulder slide (0.4m)
              headOffsetX = Math.sin(headPhase) * HEAD_SLIDE_AMPLITUDE;
              break;
            case 'bob':
              // Up and down bob (0.3m)
              headOffsetY = Math.sin(headPhase) * HEAD_BOB_AMPLITUDE;
              break;
            case 'circle':
              // Circular motion parallel to ground (0.25m diameter)
              headOffsetX = Math.sin(headPhase) * HEAD_CIRCLE_RADIUS;
              headOffsetY = 0; // Parallel to ground, so no Y change from circle
              // Add a forward/back motion instead for the circle effect
              break;
          }
          
          // Circle motion uses Z offset instead of Y for parallel to ground
          const headOffsetZ = shombie.headMovementType === 'circle' 
            ? Math.cos(headPhase) * HEAD_CIRCLE_RADIUS 
            : 0;
          
          // Set rotation quaternion for this shombie
          // If knocked down, rotate to lie flat on back
          if (shombie.isKnockedDown) {
            // Calculate rotation to face knockdown direction and tilt backward
            const knockdownAngle = shombie.knockdownDirection 
              ? Math.atan2(shombie.knockdownDirection.x, shombie.knockdownDirection.z)
              : shombie.rotation;
            
            // Smoothly interpolate tilt based on knockdown progress
            const tiltProgress = Math.min(1, shombie.knockdownProgress * 2); // Tilt faster than slide
            const tiltAngle = tiltProgress * (Math.PI / 2); // 90 degrees back
            
            tmpEuler.set(-tiltAngle, knockdownAngle, 0); // Tilt backward
            tmpQuaternion.setFromEuler(tmpEuler);
          } else {
            tmpEuler.set(0, shombie.rotation, 0);
            tmpQuaternion.setFromEuler(tmpEuler);
          }

          // Don't apply tint - use textures as-is (user uploaded custom textures)
          // Just apply a slight health-based brightness variation
          const healthPercent = shombie.currentHealth / shombie.maxHealth;
          const brightness = 0.7 + healthPercent * 0.3;
          tmpColor.setRGB(brightness, brightness, brightness);
          
          // Apply scale variation to all parts
          const scale = shombie.scale;

          for (let partIdx = 0; partIdx < PARTS_PER_SHOMBIE; partIdx++) {
            const part = SHOMBIE_BODY_PARTS[partIdx];
            
            // Get this part's twitchiness
            const twitch = shombie.partTwitches[part.name];
            const twitchResult = twitch 
              ? applyTwitch(twitch, now, scale) 
              : { dx: 0, dy: 0, dz: 0, dScaleX: 1, dScaleY: 1, dScaleZ: 1, rotation: 0 };
            
            // Calculate world position with animation offsets (scaled)
            let offsetX = part.offsetX * scale + twitchResult.dx;
            let offsetY = part.offsetY * scale + twitchResult.dy;
            let offsetZ = part.offsetZ * scale + twitchResult.dz;
            
            // Apply walking animation per part
            if (part.name === 'head') {
              // Apply head movement based on type
              offsetX += headOffsetX * scale;
              offsetY += headOffsetY * scale;
              offsetZ += headOffsetZ * scale;
              // Small additional bob for all types
              offsetY += Math.sin(phase * 2) * 0.02 * scale;
            } else if (part.name.includes('UpperArm')) {
              // Arms swing dramatically forward/back - zombie pose reaching forward
              const armPhase = part.name.includes('left') ? phase : phase + Math.PI;
              const armSwing = Math.sin(armPhase);
              
              // Forward/back swing (increased amplitude)
              offsetZ -= 0.2 * scale; // Base forward position
              offsetZ += armSwing * ARM_SWING_AMPLITUDE * scale;
              
              // Up/down motion during swing
              offsetY += Math.abs(armSwing) * ARM_SWING_UP_DOWN * scale;
              
              // Slight inward rotation when forward
              offsetX += armSwing * 0.05 * scale * (part.name.includes('left') ? 1 : -1);
            } else if (part.name.includes('LowerArm')) {
              // Elbow bending: 180 to 90+ degrees as arm swings
              const armPhase = part.name.includes('left') ? phase : phase + Math.PI;
              const armSwing = Math.sin(armPhase);
              const bendAmount = (1 + armSwing) * 0.5; // 0 to 1
              const elbowBend = bendAmount * ELBOW_BEND_MAX;
              
              // Lower arm follows upper arm swing
              offsetZ -= 0.2 * scale + armSwing * ARM_SWING_AMPLITUDE * 0.8 * scale;
              
              // Bent position: arm folds back
              offsetZ += elbowBend * scale * 0.4;
              offsetY -= elbowBend * scale * 0.35;
              
              // Additional jitter
              offsetY += Math.sin(armPhase * 1.2) * 0.03 * scale;
            } else if (part.name.includes('UpperLeg')) {
              const legPhase = part.name.includes('left') ? phase : phase + Math.PI;
              offsetZ += Math.sin(legPhase) * 0.15 * scale;
            } else if (part.name.includes('LowerLeg')) {
              // Knee bending: when leg is back, knee bends more
              const legPhase = part.name.includes('left') ? phase : phase + Math.PI;
              const legBackAmount = Math.max(0, -Math.sin(legPhase));
              const kneeBend = legBackAmount * ELBOW_BEND_MAX;
              
              offsetZ += Math.sin(legPhase) * 0.1 * scale;
              offsetY -= kneeBend * scale * 0.4;
              offsetZ += kneeBend * scale * 0.2;
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

            // Apply brightness-only coloring (no tier tint - use texture as-is)
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

        // Update head fires - create if missing, update position
        for (const shombie of shombies) {
          if (!shombie.isActive) continue;
          
          // Only show fire after emergence is complete
          if (shombie.emergenceProgress < 1) continue;
          
          const headPos = headPositions.get(shombie.id);
          if (!headPos) continue;

          let headFire = headFiresRef.current.get(shombie.id);
          
          // Create fire if it doesn't exist
          if (!headFire) {
            headFire = createHeadFire(shombie.id, shombie.definition.tier);
            if (headFire) {
              headFiresRef.current.set(shombie.id, headFire);
            }
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
        const headPhase = phase * HEAD_SLIDE_SPEED;
        
        // Calculate head offset based on movement type
        let headOffsetX = 0;
        let headOffsetY = 0;
        let headOffsetZ = 0;
        
        switch (shombie.headMovementType) {
          case 'slide':
            headOffsetX = Math.sin(headPhase) * HEAD_SLIDE_AMPLITUDE;
            break;
          case 'bob':
            headOffsetY = Math.sin(headPhase) * HEAD_BOB_AMPLITUDE;
            break;
          case 'circle':
            headOffsetX = Math.sin(headPhase) * HEAD_CIRCLE_RADIUS;
            headOffsetZ = Math.cos(headPhase) * HEAD_CIRCLE_RADIUS;
            break;
        }
        
        let offsetX = headPart.offsetX * shombie.scale + headOffsetX * shombie.scale;
        let offsetY = headPart.offsetY * shombie.scale + headOffsetY * shombie.scale + Math.sin(phase * 2) * 0.02 * shombie.scale;
        let offsetZ = headPart.offsetZ * shombie.scale + headOffsetZ * shombie.scale;
        
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
    }), [shombies, createHeadFire]);

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