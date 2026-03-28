import { useRef, useImperativeHandle, forwardRef, useMemo, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { SHOMBIE_BODY_PARTS, PARTS_PER_SHOMBIE, type ShombieInstance, type PartTwitch, type HeadMovementType, type ShombieBodyFire } from '../types';
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
  KNOCKDOWN_TILT_DURATION_MS,
  KNOCKDOWN_SLIDE_DURATION_MS,
  KNOCKDOWN_TOTAL_DURATION_MS,
  BODY_FIRE_SIZE,
  BODY_FIRE_HEIGHT,
} from '../constants';
import particleFire from 'three-particle-fire';
import { getGlobalAtlasTexture, isAtlasReady } from '@/hooks/useTextureAtlas';
import { getShombieUVs, slotIndexToUVs } from '@/lib/atlasLookup';
import { createAtlasStandardMaterial, createUvOffsetAttribute, setInstanceUvOffset } from '@/lib/atlasMaterial';

// Pre-allocated objects
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpColor = new THREE.Color();
const tmpEuler = new THREE.Euler();
const _scratchFlamePos = new THREE.Vector3();

// Shared geometry for body parts
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);

// Max instances = max shombies * parts per shombie
const MAX_INSTANCES = MAX_TOTAL_SHOMBIES * PARTS_PER_SHOMBIE;

// Emergence depth (how far underground they start)
const EMERGENCE_DEPTH = 2.0;

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

// Head fire tracking (legacy - fires on head for all shombies)
interface HeadFire {
  shombieId: string;
  points: THREE.Points;
  material: any;
  geometry: any;
}

// Body fire tracking (pinned to body parts when hit)
interface BodyFire {
  shombieId: string;
  partName: string;
  startTime: number;
  duration: number;
  points: THREE.Points;
  material: any;
  geometry: any;
}

// Particle fire install flag
let particleFireInstalled = false;

// Universal flame renderer handle type (external)
interface UniversalFlameRendererHandle {
  spawnFlame: (config: {
    type: 'point' | 'hex' | 'plume';
    position: THREE.Vector3;
    colors: string[];
    size?: number;
    height?: number;
    duration?: number;
    particleCount?: number;
    attachTo?: string;
  }) => string;
  updateAttachedPosition: (attachId: string, position: THREE.Vector3) => void;
  removeFlame: (flameId: string) => void;
  removeAttached: (attachId: string) => void;
}

export interface ShombieRendererHandle {
  update: (cameraPosition: THREE.Vector3, deltaTime: number) => void;
  getHeadPosition: (shombieId: string) => THREE.Vector3 | null;
  getHitbox: (shombieId: string) => { center: THREE.Vector3; radius: number; height: number } | null;
}

interface ShombieRendererProps {
  shombies: ShombieInstance[];
  universalFlameRef?: React.MutableRefObject<UniversalFlameRendererHandle | null>;
}

/**
 * Apply twitchiness to a body part offset
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

  const fastT = time * twitch.frequency * 3.5 + twitch.phaseOffset * 2;
  const fastAmp = amp * 0.4;

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
      dx = Math.sin(t * 3) * amp * 0.5 + Math.sin(fastT * 4.1) * fastAmp + Math.sin(microT * 7) * microAmp * 1.5;
      dy = Math.cos(t * 2.7) * amp * 0.3 + Math.cos(fastT * 3.3) * fastAmp * 0.7 + Math.cos(microT * 6.3) * microAmp;
      dz = Math.sin(t * 2.3) * amp * 0.4 + Math.sin(fastT * 2.9) * fastAmp * 0.8 + Math.sin(microT * 8) * microAmp * 1.2;
      rotation = Math.sin(fastT * 5) * amp * 0.2 + Math.sin(microT * 9) * microAmp * 0.5;
      break;
  }

  return { dx, dy, dz, dScaleX, dScaleY, dScaleZ, rotation };
}

/**
 * Renders shombies as block-based humanoids with atlas textures
 */
export const ShombieRenderer = forwardRef<ShombieRendererHandle, ShombieRendererProps>(
  ({ shombies, universalFlameRef }, ref) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const groupRef = useRef<THREE.Group>(null);
    const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
    const uvOffsetAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
    const headFiresRef = useRef<Map<string, HeadFire>>(new Map());
    const bodyFiresRef = useRef<BodyFire[]>([]);
    const partPositionsRef = useRef<Map<string, Map<string, THREE.Vector3>>>(new Map());
    const universalHeadFlamesRef = useRef<Map<string, string>>(new Map());
    // Track body fire attachIds for position updates: Map<attachId, { flameId, shombieId, partName, startTime, duration }>
    const universalBodyFlamesRef = useRef<Map<string, { flameId: string; shombieId: string; partName: string; startTime: number; duration: number }>>(new Map());
    const { scene, camera } = useThree();

    // Track animation state for animated textures
    const animationStateRef = useRef<Map<number, { baseSlotIndex: number; frameCount: number; frameDelayMs: number }>>(new Map());

    // Lazy init particleFire
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

    // Create atlas material
    const material = useMemo(() => {
      const atlasTexture = getGlobalAtlasTexture();
      if (!atlasTexture || !isAtlasReady()) {
        // Fallback material
        const mat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.8,
          metalness: 0.1,
        });
        materialRef.current = mat;
        return mat;
      }

      const mat = createAtlasStandardMaterial(atlasTexture, {
        roughness: 0.8,
        metalness: 0.1,
      });
      materialRef.current = mat;
      return mat;
    }, []);

    // Update material when atlas becomes ready
    useEffect(() => {
      const checkAtlas = () => {
        if (isAtlasReady() && meshRef.current) {
          const atlasTexture = getGlobalAtlasTexture();
          if (atlasTexture && materialRef.current && !materialRef.current.map) {
            const newMat = createAtlasStandardMaterial(atlasTexture, {
              roughness: 0.8,
              metalness: 0.1,
            });
            materialRef.current = newMat;
            meshRef.current.material = newMat;
          }
        }
      };

      const interval = setInterval(checkAtlas, 100);
      return () => clearInterval(interval);
    }, []);

    // Setup UV offset attribute when mesh is ready
    useEffect(() => {
      const mesh = meshRef.current;
      if (!mesh) return;

      if (!uvOffsetAttrRef.current) {
        uvOffsetAttrRef.current = createUvOffsetAttribute(mesh, MAX_INSTANCES);
      }
    }, []);

    // Create head fire for a shombie
    const createHeadFire = useCallback((shombieId: string, tier: number, headPos: THREE.Vector3): HeadFire | null => {
      const tierColors = getTierColors(tier);

      if (universalFlameRef?.current) {
        const flameId = universalFlameRef.current.spawnFlame({
          type: 'point',
          position: headPos.clone().add(new THREE.Vector3(0, 0.3, 0)),
          colors: tierColors,
          size: HEAD_FIRE_SIZE,
          height: HEAD_FIRE_HEIGHT,
          duration: 999999,
          particleCount: HEAD_FIRE_PARTICLE_COUNT,
          attachTo: `shombie_head_${shombieId}`,
        });
        universalHeadFlamesRef.current.set(shombieId, flameId);
        return null;
      }

      ensureParticleFireInstalled();

      try {
        const tierColorHex = getTierColorHex(tier);

        const fireGeometry = new particleFire.Geometry(
          HEAD_FIRE_SIZE / 2,
          HEAD_FIRE_HEIGHT,
          60
        );
        const fireMaterial = new particleFire.Material({
          color: hexToNumber(tierColorHex)
        });

        (fireMaterial as THREE.Material).blending = THREE.CustomBlending;
        (fireMaterial as any).blendSrc = THREE.OneFactor;
        (fireMaterial as any).blendDst = THREE.OneMinusSrcAlphaFactor;
        (fireMaterial as any).blendEquation = THREE.AddEquation;
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
    }, [camera, scene, ensureParticleFireInstalled, universalFlameRef]);

    // Create body fire
    const createBodyFire = useCallback((shombieId: string, partName: string, duration: number, colors: string[], position?: THREE.Vector3): BodyFire | null => {
      if (universalFlameRef?.current && position) {
        universalFlameRef.current.spawnFlame({
          type: 'point',
          position: position.clone(),
          colors: colors,
          size: BODY_FIRE_SIZE,
          height: BODY_FIRE_HEIGHT,
          duration: duration / 1000,
          particleCount: 40,
          attachTo: `shombie_body_${shombieId}_${partName}`,
        });
        return null;
      }

      ensureParticleFireInstalled();

      try {
        const colorHex = colors[0] || '#FFFF00';

        const fireGeometry = new particleFire.Geometry(
          BODY_FIRE_SIZE / 2,
          BODY_FIRE_HEIGHT,
          40
        );
        const fireMaterial = new particleFire.Material({
          color: hexToNumber(colorHex)
        });

        (fireMaterial as THREE.Material).blending = THREE.CustomBlending;
        (fireMaterial as any).blendSrc = THREE.OneFactor;
        (fireMaterial as any).blendDst = THREE.OneMinusSrcAlphaFactor;
        (fireMaterial as any).blendEquation = THREE.AddEquation;
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
          partName,
          startTime: Date.now(),
          duration,
          points: firePoints,
          material: fireMaterial,
          geometry: fireGeometry,
        };
      } catch (e) {
        console.warn('[ShombieRenderer] Failed to create body fire:', e);
        return null;
      }
    }, [camera, scene, ensureParticleFireInstalled, universalFlameRef]);

    // Clean up fires when shombies are removed
    useEffect(() => {
      const activeIds = new Set(shombies.filter(s => s.isActive).map(s => s.id));

      for (const [id, headFire] of headFiresRef.current.entries()) {
        if (!activeIds.has(id)) {
          scene.remove(headFire.points);
          headFire.geometry.dispose();
          headFire.material.dispose();
          headFiresRef.current.delete(id);
        }
      }

      for (const [shombieId, flameId] of universalHeadFlamesRef.current.entries()) {
        if (!activeIds.has(shombieId)) {
          universalFlameRef?.current?.removeFlame(flameId);
          universalHeadFlamesRef.current.delete(shombieId);
        }
      }

      bodyFiresRef.current = bodyFiresRef.current.filter(fire => {
        if (!activeIds.has(fire.shombieId)) {
          scene.remove(fire.points);
          fire.geometry.dispose();
          fire.material.dispose();
          return false;
        }
        return true;
      });
    }, [shombies, scene, universalFlameRef]);

    // Cleanup all fires on unmount
    useEffect(() => {
      return () => {
        for (const headFire of headFiresRef.current.values()) {
          scene.remove(headFire.points);
          headFire.geometry.dispose();
          headFire.material.dispose();
        }
        headFiresRef.current.clear();

        for (const [shombieId, flameId] of universalHeadFlamesRef.current.entries()) {
          universalFlameRef?.current?.removeFlame(flameId);
        }
        universalHeadFlamesRef.current.clear();

        for (const bodyFire of bodyFiresRef.current) {
          scene.remove(bodyFire.points);
          bodyFire.geometry.dispose();
          bodyFire.material.dispose();
        }
        bodyFiresRef.current = [];
      };
    }, [scene, universalFlameRef]);

    // Update fires every frame
    useFrame((_, delta) => {
      const now = Date.now();

      // Update legacy head fires
      for (const headFire of headFiresRef.current.values()) {
        if (headFire.material && typeof headFire.material.update === 'function') {
          headFire.material.update(delta);
        }
      }

      // Update universal flame head fire positions
      if (universalFlameRef?.current) {
        for (const [shombieId] of universalHeadFlamesRef.current.entries()) {
          const headPos = partPositionsRef.current.get(shombieId)?.get('head');
          if (headPos) {
            _scratchFlamePos.copy(headPos);
            _scratchFlamePos.y += 0.3;
            universalFlameRef.current.updateAttachedPosition(
              `shombie_head_${shombieId}`,
              _scratchFlamePos
            );
          }
        }

        // Update universal flame body fire positions (fires at hit positions track with shombie)
        for (const [attachId, fireInfo] of universalBodyFlamesRef.current.entries()) {
          const elapsed = now - fireInfo.startTime;
          if (elapsed >= fireInfo.duration) {
            universalFlameRef.current.removeFlame(fireInfo.flameId);
            universalBodyFlamesRef.current.delete(attachId);
            continue;
          }

          // Find the shombie to get current position
          const shombie = shombies.find(s => s.id === fireInfo.shombieId);
          if (!shombie) {
            universalFlameRef.current.removeFlame(fireInfo.flameId);
            universalBodyFlamesRef.current.delete(attachId);
            continue;
          }

          // Check if this is an offset-based fire (from addFireAtHitPosition)
          if (fireInfo.partName.startsWith('offset_')) {
            // Parse the offset from partName (format: "offset_X_Y_Z")
            const parts = fireInfo.partName.split('_');
            const offsetX = parseFloat(parts[1]) || 0;
            const offsetY = parseFloat(parts[2]) || 0;
            const offsetZ = parseFloat(parts[3]) || 0;

            // Calculate new position based on shombie's current position + offset
            // Apply rotation to the offset so fire stays relative to shombie orientation
            const cosR = Math.cos(shombie.rotation);
            const sinR = Math.sin(shombie.rotation);
            const rotatedOffsetX = offsetX * cosR - offsetZ * sinR;
            const rotatedOffsetZ = offsetX * sinR + offsetZ * cosR;

            _scratchFlamePos.set(
              shombie.position.x + rotatedOffsetX,
              shombie.position.y + offsetY,
              shombie.position.z + rotatedOffsetZ
            );
            universalFlameRef.current.updateAttachedPosition(attachId, _scratchFlamePos);
          } else {
            // Legacy: lookup by part name
            const partPos = partPositionsRef.current.get(fireInfo.shombieId)?.get(fireInfo.partName);
            if (partPos) {
              _scratchFlamePos.copy(partPos);
              universalFlameRef.current.updateAttachedPosition(attachId, _scratchFlamePos);
            }
          }
        }

      }

      // Update body fires (legacy internal system) — in-place removal to avoid allocations
      let bodyFireWriteIdx = 0;
      for (let bfi = 0; bfi < bodyFiresRef.current.length; bfi++) {
        const bodyFire = bodyFiresRef.current[bfi];

        if (bodyFire.material && typeof bodyFire.material.update === 'function') {
          bodyFire.material.update(delta);
        }

        if (now - bodyFire.startTime > bodyFire.duration) {
          scene.remove(bodyFire.points);
          bodyFire.geometry.dispose();
          bodyFire.material.dispose();
          continue;
        }

        const shombiePartPositions = partPositionsRef.current.get(bodyFire.shombieId);
        const partPos = shombiePartPositions?.get(bodyFire.partName);
        if (partPos) {
          bodyFire.points.position.copy(partPos);
        }

        bodyFiresRef.current[bodyFireWriteIdx++] = bodyFire;
      }
      bodyFiresRef.current.length = bodyFireWriteIdx;
    });

    useImperativeHandle(ref, () => ({
      update: (cameraPosition: THREE.Vector3, deltaTime: number) => {
        const mesh = meshRef.current;
        const uvOffsetAttr = uvOffsetAttrRef.current;
        if (!mesh) return;

        const now = performance.now() / 1000;
        const headPositions = new Map<string, THREE.Vector3>();

        let instanceIndex = 0;

        for (const shombie of shombies) {
          if (!shombie.isActive) continue;

          const timeSinceSpawn = Date.now() - shombie.spawnedAt;
          shombie.emergenceProgress = Math.min(1, timeSinceSpawn / SHOMBIE_EMERGENCE_DURATION_MS);

          const emergenceOffset = (1 - shombie.emergenceProgress) * -EMERGENCE_DEPTH;

          const isMoving = shombie.isChasing && shombie.velocity.length() > 0.1;
          const legMultiplier = isMoving ? SHOMBIE_LEG_ANIMATION_MULTIPLIER : 0.5;
          shombie.animationPhase += deltaTime * 4 * legMultiplier;

          const phase = shombie.animationPhase;
          const wobble = Math.sin(phase) * 0.1;

          let headOffsetX = 0;
          let headOffsetY = 0;
          const headPhase = phase * HEAD_SLIDE_SPEED;

          switch (shombie.headMovementType) {
            case 'slide':
              headOffsetX = Math.sin(headPhase) * HEAD_SLIDE_AMPLITUDE;
              break;
            case 'bob':
              headOffsetY = Math.sin(headPhase) * HEAD_BOB_AMPLITUDE;
              break;
            case 'circle':
              headOffsetX = Math.sin(headPhase) * HEAD_CIRCLE_RADIUS;
              break;
          }

          const headOffsetZ = shombie.headMovementType === 'circle'
            ? Math.cos(headPhase) * HEAD_CIRCLE_RADIUS
            : 0;

          let knockdownTiltAngle = 0;
          let knockdownYAngle = shombie.rotation;

          if (shombie.isKnockedDown) {
            knockdownYAngle = shombie.knockdownDirection
              ? Math.atan2(shombie.knockdownDirection.x, shombie.knockdownDirection.z)
              : shombie.rotation;

            const tiltDuration = KNOCKDOWN_TILT_DURATION_MS;
            const slideDuration = KNOCKDOWN_SLIDE_DURATION_MS;
            const totalDuration = KNOCKDOWN_TOTAL_DURATION_MS;
            const elapsed = (Date.now() - shombie.knockdownStartTime);

            if (elapsed < tiltDuration) {
              const tiltProgress = elapsed / tiltDuration;
              knockdownTiltAngle = Math.sin(tiltProgress * Math.PI / 2) * (Math.PI / 2);
            } else if (elapsed < tiltDuration + slideDuration) {
              knockdownTiltAngle = Math.PI / 2;
            } else if (elapsed < totalDuration) {
              const recoveryProgress = (elapsed - tiltDuration - slideDuration) / (totalDuration - tiltDuration - slideDuration);
              knockdownTiltAngle = (1 - recoveryProgress) * (Math.PI / 2);
            } else {
              knockdownTiltAngle = 0;
            }

            tmpEuler.set(knockdownTiltAngle, knockdownYAngle, 0);
            tmpQuaternion.setFromEuler(tmpEuler);
          } else {
            tmpEuler.set(0, shombie.rotation, 0);
            tmpQuaternion.setFromEuler(tmpEuler);
          }

          // Get UV offset from atlas for this tier
          const uvs = getShombieUVs(shombie.definition.tier);
          let uvOffsetX = 0;
          let uvOffsetY = 0;

          if (uvs) {
            // Handle animation if multiple frames
            if (uvs.frameCount > 1) {
              const elapsed = performance.now();
              const frameIndex = Math.floor(elapsed / uvs.frameDelayMs) % uvs.frameCount;
              const frameUVs = slotIndexToUVs(uvs.baseSlotIndex + frameIndex);
              uvOffsetX = frameUVs.uvOffsetX;
              uvOffsetY = frameUVs.uvOffsetY;
            } else {
              uvOffsetX = uvs.uvOffsetX;
              uvOffsetY = uvs.uvOffsetY;
            }
          }

          const healthPercent = shombie.currentHealth / shombie.maxHealth;
          const brightness = 0.7 + healthPercent * 0.3;

          // Check if atlas has texture for this tier
          const hasAtlasTexture = uvs !== null;
          if (hasAtlasTexture) {
            tmpColor.setRGB(brightness, brightness, brightness);
          } else {
            // No atlas texture: apply tier color
            const tierColorHex = getTierColorHex(shombie.definition.tier);
            tmpColor.set(tierColorHex);
            tmpColor.multiplyScalar(brightness);
          }

          const scale = shombie.scale;

          for (let partIdx = 0; partIdx < PARTS_PER_SHOMBIE; partIdx++) {
            const part = SHOMBIE_BODY_PARTS[partIdx];

            const twitch = shombie.partTwitches[part.name];
            const twitchResult = twitch
              ? applyTwitch(twitch, now, scale)
              : { dx: 0, dy: 0, dz: 0, dScaleX: 1, dScaleY: 1, dScaleZ: 1, rotation: 0 };

            let offsetX = part.offsetX * scale + twitchResult.dx;
            let offsetY = part.offsetY * scale + twitchResult.dy;
            let offsetZ = part.offsetZ * scale + twitchResult.dz;

            if (part.name === 'head') {
              offsetX += headOffsetX * scale;
              offsetY += headOffsetY * scale;
              offsetZ += headOffsetZ * scale;
              offsetY += Math.sin(phase * 2) * 0.02 * scale;
            } else if (part.name.includes('UpperArm')) {
              const armPhase = part.name.includes('left') ? phase : phase + Math.PI;
              const armSwing = Math.sin(armPhase);

              offsetZ -= 0.2 * scale;
              offsetZ += armSwing * ARM_SWING_AMPLITUDE * scale;
              offsetY += Math.abs(armSwing) * ARM_SWING_UP_DOWN * scale;
              offsetX += armSwing * 0.05 * scale * (part.name.includes('left') ? 1 : -1);
            } else if (part.name.includes('LowerArm')) {
              const armPhase = part.name.includes('left') ? phase : phase + Math.PI;
              const armSwing = Math.sin(armPhase);
              const bendAmount = (1 + armSwing) * 0.5;
              const elbowBend = bendAmount * ELBOW_BEND_MAX;

              offsetZ -= 0.2 * scale + armSwing * ARM_SWING_AMPLITUDE * 0.8 * scale;
              offsetZ += elbowBend * scale * 0.4;
              offsetY -= elbowBend * scale * 0.35;
              offsetY += Math.sin(armPhase * 1.2) * 0.03 * scale;
            } else if (part.name.includes('UpperLeg')) {
              const legPhase = part.name.includes('left') ? phase : phase + Math.PI;
              offsetZ += Math.sin(legPhase) * 0.15 * scale;
            } else if (part.name.includes('LowerLeg')) {
              const legPhase = part.name.includes('left') ? phase : phase + Math.PI;
              const legBackAmount = Math.max(0, -Math.sin(legPhase));
              const kneeBend = legBackAmount * ELBOW_BEND_MAX;

              offsetZ += Math.sin(legPhase) * 0.1 * scale;
              offsetY -= kneeBend * scale * 0.4;
              offsetZ += kneeBend * scale * 0.2;
            } else if (part.name === 'torso') {
              offsetX += wobble * 0.5 * scale;
            }

            let finalOffsetX = offsetX;
            let finalOffsetY = offsetY;
            let finalOffsetZ = offsetZ;

            if (shombie.isKnockedDown && knockdownTiltAngle > 0) {
              const cosY = Math.cos(-knockdownYAngle);
              const sinY = Math.sin(-knockdownYAngle);
              const alignedX = offsetX * cosY - offsetZ * sinY;
              const alignedZ = offsetX * sinY + offsetZ * cosY;

              const cosT = Math.cos(knockdownTiltAngle);
              const sinT = Math.sin(knockdownTiltAngle);
              const tiltedY = offsetY * cosT - alignedZ * sinT;
              const tiltedZ = offsetY * sinT + alignedZ * cosT;

              const cosY2 = Math.cos(knockdownYAngle);
              const sinY2 = Math.sin(knockdownYAngle);
              finalOffsetX = alignedX * cosY2 - tiltedZ * sinY2;
              finalOffsetZ = alignedX * sinY2 + tiltedZ * cosY2;
              finalOffsetY = tiltedY;
            } else {
              const cosR = Math.cos(shombie.rotation);
              const sinR = Math.sin(shombie.rotation);
              finalOffsetX = offsetX * cosR - offsetZ * sinR;
              finalOffsetZ = offsetX * sinR + offsetZ * cosR;
            }

            tmpPosition.set(
              shombie.position.x + finalOffsetX,
              shombie.position.y + finalOffsetY + emergenceOffset,
              shombie.position.z + finalOffsetZ
            );

            if (part.name === 'head') {
              headPositions.set(shombie.id, tmpPosition.clone());
            }

            if (!partPositionsRef.current.has(shombie.id)) {
              partPositionsRef.current.set(shombie.id, new Map());
            }
            partPositionsRef.current.get(shombie.id)!.set(part.name, tmpPosition.clone());

            tmpScale.set(
              part.scaleX * scale * twitchResult.dScaleX,
              part.scaleY * scale * twitchResult.dScaleY,
              part.scaleZ * scale * twitchResult.dScaleZ
            );
            tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
            mesh.setMatrixAt(instanceIndex, tmpMatrix);

            // Set UV offset for atlas
            if (uvOffsetAttr) {
              setInstanceUvOffset(uvOffsetAttr, instanceIndex, uvOffsetX, uvOffsetY);
            }

            mesh.setColorAt(instanceIndex, tmpColor);

            instanceIndex++;
          }
        }

        // Clean up part positions for inactive shombies
        for (const shombieId of partPositionsRef.current.keys()) {
          if (!shombies.find(s => s.id === shombieId && s.isActive)) {
            partPositionsRef.current.delete(shombieId);
          }
        }

        mesh.count = instanceIndex;
        if (instanceIndex > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
          }
          if (uvOffsetAttr) {
            uvOffsetAttr.needsUpdate = true;
          }
        }

        // Update head fires
        for (const shombie of shombies) {
          if (!shombie.isActive) continue;
          if (shombie.emergenceProgress < 1) continue;

          const headPos = headPositions.get(shombie.id);
          if (!headPos) continue;

          const hasUniversalFlame = universalHeadFlamesRef.current.has(shombie.id);
          let headFire = headFiresRef.current.get(shombie.id);

          if (!headFire && !hasUniversalFlame) {
            headFire = createHeadFire(shombie.id, shombie.definition.tier, headPos);
            if (headFire) {
              headFiresRef.current.set(shombie.id, headFire);
            }
          }

          if (headFire) {
            headFire.points.position.set(
              headPos.x,
              headPos.y + 0.3,
              headPos.z
            );
          }
        }
      },

      getHeadPosition: (shombieId: string) => {
        const shombie = shombies.find(s => s.id === shombieId && s.isActive);
        if (!shombie) return null;

        const headPart = SHOMBIE_BODY_PARTS[0];
        const phase = shombie.animationPhase;
        const headPhase = phase * HEAD_SLIDE_SPEED;

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

    }), [shombies, createHeadFire, createBodyFire]);

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
