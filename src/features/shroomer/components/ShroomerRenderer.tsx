import { useRef, useImperativeHandle, forwardRef, useMemo, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useFrustumCullGroup } from '@/lib/useFrustumCullGroup';
import { SHROOMER_BODY_PARTS, PARTS_PER_SHROOMER, type ShroomerInstance, type PartTwitch } from '../types';
import {
  MAX_TOTAL_SHROOMERS,
  TIER_COLORS,
  SHROOMER_EMERGENCE_DURATION_MS,
  SHROOMER_LEG_ANIMATION_MULTIPLIER,
  SHROOMER_HITBOX_RADIUS,
  SHROOMER_HITBOX_HEIGHT,
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
  SHROOMER_RENDER_DISTANCE,
  SHROOMER_ANIM_DISTANCE,
  MAX_HEAD_FLAMES,
  TUMBLE_WAIT_MS,
  TUMBLE_RECOVER_MS,
} from '../constants';
import particleFire from 'three-particle-fire';
import { getGlobalAtlasTexture, isAtlasReady } from '@/hooks/useTextureAtlas';
import { getShroomerUVs, slotIndexToUVs } from '@/lib/atlasLookup';
import { createAtlasStandardMaterial, createUvOffsetAttribute, setInstanceUvOffset } from '@/lib/atlasMaterial';

// Pre-allocated objects
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpColor = new THREE.Color();
const tmpEuler = new THREE.Euler();
const _scratchFlamePos = new THREE.Vector3();
// Blast-tumble scratch (reused — no per-frame allocation).
const _tumbleAxis = new THREE.Vector3();
const _tumbleQuat = new THREE.Quaternion();
const _uprightQuat = new THREE.Quaternion();
const _offsetVec = new THREE.Vector3();
const _upVec = new THREE.Vector3();
const TUMBLE_PIVOT_HEIGHT = 1.2;
const TUMBLE_GROUND_REST = 0.4;

// LOD distance thresholds (squared, horizontal) for the renderer.
const SHROOMER_RENDER_DIST_SQ = SHROOMER_RENDER_DISTANCE * SHROOMER_RENDER_DISTANCE;
const SHROOMER_ANIM_DIST_SQ = SHROOMER_ANIM_DISTANCE * SHROOMER_ANIM_DISTANCE;
// Reused identity for frozen/no-twitch parts (avoids per-part allocation).
const SHROOMER_TWITCH_IDENTITY = { dx: 0, dy: 0, dz: 0, dScaleX: 1, dScaleY: 1, dScaleZ: 1, rotation: 0 };
// Reused buffers for nearest-N head-flame selection (no per-frame allocation).
const _flameCand: { id: string; d: number }[] = [];
const _flameNearSet = new Set<string>();
const _byDist = (a: { d: number }, b: { d: number }) => a.d - b.d;

// Reused per-shroomer transform context + result (module-level → no per-frame
// allocation at horde scale). The `update` loop fills `_ctx` once per shroomer,
// then calls placePartInto() per part, which writes into `_placeResult`.
const _ctx = {
  shroomer: null as ShroomerInstance | null,
  scale: 1,
  now: 0,
  phase: 0,
  wobble: 0,
  headOffsetX: 0,
  headOffsetY: 0,
  headOffsetZ: 0,
  emergenceOffset: 0,
  lodFrozen: false,
  tumbling: false,
  tumblePivotY: 0,
  tumbleSettleY: 0,
  knockdownTiltAngle: 0,
  knockdownYAngle: 0,
  quat: new THREE.Quaternion(),
};
const _placeResult = { px: 0, py: 0, pz: 0 };

// Compute a part's final world position, mirroring the shombie renderer's
// per-part offset + animation + tumble/knockdown/rotation math exactly.
function placePartInto(
  partName: string,
  baseOffsetX: number,
  baseOffsetY: number,
  baseOffsetZ: number,
  twitch: PartTwitch | undefined,
  animate: boolean,
): void {
  const c = _ctx;
  const s = c.shroomer!;
  const scale = c.scale;
  const twitchResult = (!c.lodFrozen && twitch)
    ? applyTwitch(twitch, c.now, scale)
    : SHROOMER_TWITCH_IDENTITY;

  let offsetX = baseOffsetX * scale + twitchResult.dx;
  let offsetY = baseOffsetY * scale + twitchResult.dy;
  let offsetZ = baseOffsetZ * scale + twitchResult.dz;

  if (!c.lodFrozen && !c.tumbling && animate) {
    if (partName === 'head') {
      offsetX += c.headOffsetX * scale;
      offsetY += c.headOffsetY * scale;
      offsetZ += c.headOffsetZ * scale;
      offsetY += Math.sin(c.phase * 2) * 0.02 * scale;
    } else if (partName.includes('UpperArm')) {
      const armPhase = partName.includes('left') ? c.phase : c.phase + Math.PI;
      const armSwing = Math.sin(armPhase);
      offsetZ -= 0.2 * scale;
      offsetZ += armSwing * ARM_SWING_AMPLITUDE * scale;
      offsetY += Math.abs(armSwing) * ARM_SWING_UP_DOWN * scale;
      offsetX += armSwing * 0.05 * scale * (partName.includes('left') ? 1 : -1);
    } else if (partName.includes('LowerArm')) {
      const armPhase = partName.includes('left') ? c.phase : c.phase + Math.PI;
      const armSwing = Math.sin(armPhase);
      const bendAmount = (1 + armSwing) * 0.5;
      const elbowBend = bendAmount * ELBOW_BEND_MAX;
      offsetZ -= 0.2 * scale + armSwing * ARM_SWING_AMPLITUDE * 0.8 * scale;
      offsetZ += elbowBend * scale * 0.4;
      offsetY -= elbowBend * scale * 0.35;
      offsetY += Math.sin(armPhase * 1.2) * 0.03 * scale;
    } else if (partName.includes('UpperLeg')) {
      const legPhase = partName.includes('left') ? c.phase : c.phase + Math.PI;
      offsetZ += Math.sin(legPhase) * 0.15 * scale;
    } else if (partName.includes('LowerLeg')) {
      const legPhase = partName.includes('left') ? c.phase : c.phase + Math.PI;
      const legBackAmount = Math.max(0, -Math.sin(legPhase));
      const kneeBend = legBackAmount * ELBOW_BEND_MAX;
      offsetZ += Math.sin(legPhase) * 0.1 * scale;
      offsetY -= kneeBend * scale * 0.4;
      offsetZ += kneeBend * scale * 0.2;
    } else if (partName === 'torso') {
      offsetX += c.wobble * 0.5 * scale;
    }
  }

  let finalOffsetX = offsetX;
  let finalOffsetY = offsetY;
  let finalOffsetZ = offsetZ;

  if (c.tumbling) {
    _offsetVec.set(offsetX, offsetY - c.tumblePivotY, offsetZ).applyQuaternion(c.quat);
    finalOffsetX = _offsetVec.x;
    finalOffsetY = _offsetVec.y + c.tumblePivotY - c.tumbleSettleY;
    finalOffsetZ = _offsetVec.z;
  } else if (s.isKnockedDown && c.knockdownTiltAngle > 0) {
    const cosY = Math.cos(-c.knockdownYAngle);
    const sinY = Math.sin(-c.knockdownYAngle);
    const alignedX = offsetX * cosY - offsetZ * sinY;
    const alignedZ = offsetX * sinY + offsetZ * cosY;

    const cosT = Math.cos(c.knockdownTiltAngle);
    const sinT = Math.sin(c.knockdownTiltAngle);
    const tiltedY = offsetY * cosT - alignedZ * sinT;
    const tiltedZ = offsetY * sinT + alignedZ * cosT;

    const cosY2 = Math.cos(c.knockdownYAngle);
    const sinY2 = Math.sin(c.knockdownYAngle);
    finalOffsetX = alignedX * cosY2 - tiltedZ * sinY2;
    finalOffsetZ = alignedX * sinY2 + tiltedZ * cosY2;
    finalOffsetY = tiltedY;
  } else {
    const cosR = Math.cos(s.rotation);
    const sinR = Math.sin(s.rotation);
    finalOffsetX = offsetX * cosR - offsetZ * sinR;
    finalOffsetZ = offsetX * sinR + offsetZ * cosR;
  }

  _placeResult.px = s.position.x + finalOffsetX;
  _placeResult.py = s.position.y + finalOffsetY + c.emergenceOffset;
  _placeResult.pz = s.position.z + finalOffsetZ;
}

// ── GEOMETRY: the ONLY real difference from the Shombie renderer. ───────────
//  • Body parts (torso, arms, legs) → CYLINDERS oriented along the part's
//    main (Y) axis. Unit cylinder (radius 0.5, height 1) so the same per-part
//    scale (scaleX/Y/Z) maps the same box-sized bounds onto a cylinder.
//  • Head → SPHERE (unit diameter 1, so part scale 0.5 → 0.5m sphere).
//  • Mushroom cap ("hat") → wide+flat CAPSULE, diameter == full body height,
//    sitting on the head with the head's top third embedded inside it.
const cylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const sphereGeometry = new THREE.SphereGeometry(0.5, 16, 12);

// Compute the shroomer's full body height from the part layout (same parts as
// the shombie), used as the cap diameter. height = max(top) - min(bottom).
function computeBodyHeight(): number {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of SHROOMER_BODY_PARTS) {
    const top = p.offsetY + p.scaleY / 2;
    const bottom = p.offsetY - p.scaleY / 2;
    if (top > maxY) maxY = top;
    if (bottom < minY) minY = bottom;
  }
  return maxY - minY;
}
const BODY_HEIGHT = computeBodyHeight();
const CAP_DIAMETER = BODY_HEIGHT;          // requirement: cap diameter == body height
const CAP_RADIUS = CAP_DIAMETER / 2;
// Flat cap: small vertical extent. CapsuleGeometry(radius, length, ...) — we
// build a unit-ish capsule then scale it WIDE and FLAT per-instance so the
// horizontal radius is large and the vertical height is small.
const CAP_BASE_RADIUS = 0.5;               // unit radius; scaled per-instance
const CAP_HEIGHT_FACTOR = 0.28;            // cap vertical height as fraction of radius (flat)
const capsuleGeometry = new THREE.CapsuleGeometry(CAP_BASE_RADIUS, CAP_BASE_RADIUS * 0.4, 4, 12);

// Head sphere radius in part-units (head part scaleX/Y/Z = 0.5 → radius 0.25
// since unit sphere diameter = part scale). The head part scale is applied to
// the unit sphere geometry; head radius in world units = headScale * 0.5.
const HEAD_PART = SHROOMER_BODY_PARTS[0]; // 'head'

// Max instances per geometry. Body parts = all parts except the head
// (head + cap have their own meshes). We allocate generously.
const MAX_BODY_INSTANCES = MAX_TOTAL_SHROOMERS * PARTS_PER_SHROOMER;
const MAX_HEAD_INSTANCES = MAX_TOTAL_SHROOMERS;
const MAX_CAP_INSTANCES = MAX_TOTAL_SHROOMERS;

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

// Head fire tracking
interface HeadFire {
  shroomerId: string;
  points: THREE.Points;
  material: any;
  geometry: any;
}

// Body fire tracking
interface BodyFire {
  shroomerId: string;
  partName: string;
  startTime: number;
  duration: number;
  points: THREE.Points;
  material: any;
  geometry: any;
}

let particleFireInstalled = false;

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

export interface ShroomerRendererHandle {
  update: (cameraPosition: THREE.Vector3, deltaTime: number) => void;
  getHeadPosition: (shroomerId: string) => THREE.Vector3 | null;
  getHitbox: (shroomerId: string) => { center: THREE.Vector3; radius: number; height: number } | null;
}

interface ShroomerRendererProps {
  shroomers: ShroomerInstance[];
  universalFlameRef?: React.MutableRefObject<UniversalFlameRendererHandle | null>;
}

/**
 * Apply twitchiness to a body part offset (identical to the shombie renderer)
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
 * Renders shroomers — identical to the shombie renderer in every way EXCEPT
 * the body GEOMETRY: cylinders for limbs/torso, a sphere head, and a wide flat
 * mushroom-cap capsule. Uses the same shombie atlas textures.
 */
export const ShroomerRenderer = forwardRef<ShroomerRendererHandle, ShroomerRendererProps>(
  ({ shroomers, universalFlameRef }, ref) => {
    const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
    const headMeshRef = useRef<THREE.InstancedMesh>(null);
    const capMeshRef = useRef<THREE.InstancedMesh>(null);
    const groupRef = useRef<THREE.Group>(null);
    const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
    const bodyUvOffsetAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
    const headUvOffsetAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
    const capUvOffsetAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
    const headFiresRef = useRef<Map<string, HeadFire>>(new Map());
    const bodyFiresRef = useRef<BodyFire[]>([]);
    const partPositionsRef = useRef<Map<string, Map<string, THREE.Vector3>>>(new Map());
    const universalHeadFlamesRef = useRef<Map<string, string>>(new Map());

    // Frustum-cull the whole shroomer group.
    useFrustumCullGroup(
      'shroomer',
      [bodyMeshRef, headMeshRef, capMeshRef],
      () => shroomers.length === 0 ? null : shroomers.filter(s => s.isActive).map(s => s.position),
      { radiusPad: 3 },
    );
    const universalBodyFlamesRef = useRef<Map<string, { flameId: string; shroomerId: string; partName: string; startTime: number; duration: number }>>(new Map());
    const { scene, camera } = useThree();

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

    // Create atlas material (shared by all three meshes)
    const material = useMemo(() => {
      const atlasTexture = getGlobalAtlasTexture();
      if (!atlasTexture || !isAtlasReady()) {
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
        if (isAtlasReady()) {
          const atlasTexture = getGlobalAtlasTexture();
          if (atlasTexture && materialRef.current && !materialRef.current.map) {
            const newMat = createAtlasStandardMaterial(atlasTexture, {
              roughness: 0.8,
              metalness: 0.1,
            });
            materialRef.current = newMat;
            if (bodyMeshRef.current) bodyMeshRef.current.material = newMat;
            if (headMeshRef.current) headMeshRef.current.material = newMat;
            if (capMeshRef.current) capMeshRef.current.material = newMat;
          }
        }
      };

      const interval = setInterval(checkAtlas, 100);
      return () => clearInterval(interval);
    }, []);

    // Setup UV offset attributes when meshes are ready
    useEffect(() => {
      if (bodyMeshRef.current && !bodyUvOffsetAttrRef.current) {
        bodyUvOffsetAttrRef.current = createUvOffsetAttribute(bodyMeshRef.current, MAX_BODY_INSTANCES);
      }
      if (headMeshRef.current && !headUvOffsetAttrRef.current) {
        headUvOffsetAttrRef.current = createUvOffsetAttribute(headMeshRef.current, MAX_HEAD_INSTANCES);
      }
      if (capMeshRef.current && !capUvOffsetAttrRef.current) {
        capUvOffsetAttrRef.current = createUvOffsetAttribute(capMeshRef.current, MAX_CAP_INSTANCES);
      }
    }, []);

    // Create head fire (universal instanced flame system only).
    const createHeadFire = useCallback((shroomerId: string, tier: number, headPos: THREE.Vector3): HeadFire | null => {
      if (!universalFlameRef?.current) return null;

      const tierColors = getTierColors(tier);
      const flameId = universalFlameRef.current.spawnFlame({
        type: 'point',
        position: headPos.clone().add(new THREE.Vector3(0, 0.3, 0)),
        colors: tierColors,
        size: HEAD_FIRE_SIZE,
        height: HEAD_FIRE_HEIGHT,
        duration: 999999,
        particleCount: HEAD_FIRE_PARTICLE_COUNT,
        attachTo: `shroomer_head_${shroomerId}`,
      });
      universalHeadFlamesRef.current.set(shroomerId, flameId);
      return null;
    }, [universalFlameRef]);

    const removeHeadFlame = useCallback((shroomerId: string) => {
      const flameId = universalHeadFlamesRef.current.get(shroomerId);
      if (flameId !== undefined) {
        universalFlameRef?.current?.removeFlame(flameId);
        universalHeadFlamesRef.current.delete(shroomerId);
      }
      const hf = headFiresRef.current.get(shroomerId);
      if (hf) {
        scene.remove(hf.points);
        hf.geometry.dispose();
        hf.material.dispose();
        headFiresRef.current.delete(shroomerId);
      }
    }, [scene, universalFlameRef]);

    // Create body fire
    const createBodyFire = useCallback((shroomerId: string, partName: string, duration: number, colors: string[], position?: THREE.Vector3): BodyFire | null => {
      if (universalFlameRef?.current && position) {
        universalFlameRef.current.spawnFlame({
          type: 'point',
          position: position.clone(),
          colors: colors,
          size: BODY_FIRE_SIZE,
          height: BODY_FIRE_HEIGHT,
          duration: duration / 1000,
          particleCount: 40,
          attachTo: `shroomer_body_${shroomerId}_${partName}`,
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
          shroomerId,
          partName,
          startTime: Date.now(),
          duration,
          points: firePoints,
          material: fireMaterial,
          geometry: fireGeometry,
        };
      } catch (e) {
        console.warn('[ShroomerRenderer] Failed to create body fire:', e);
        return null;
      }
    }, [camera, scene, ensureParticleFireInstalled, universalFlameRef]);

    // Clean up fires when shroomers are removed
    useEffect(() => {
      const activeIds = new Set(shroomers.filter(s => s.isActive).map(s => s.id));

      for (const [id, headFire] of headFiresRef.current.entries()) {
        if (!activeIds.has(id)) {
          scene.remove(headFire.points);
          headFire.geometry.dispose();
          headFire.material.dispose();
          headFiresRef.current.delete(id);
        }
      }

      for (const [shroomerId, flameId] of universalHeadFlamesRef.current.entries()) {
        if (!activeIds.has(shroomerId)) {
          universalFlameRef?.current?.removeFlame(flameId);
          universalHeadFlamesRef.current.delete(shroomerId);
        }
      }

      bodyFiresRef.current = bodyFiresRef.current.filter(fire => {
        if (!activeIds.has(fire.shroomerId)) {
          scene.remove(fire.points);
          fire.geometry.dispose();
          fire.material.dispose();
          return false;
        }
        return true;
      });
    }, [shroomers, scene, universalFlameRef]);

    // Cleanup all fires on unmount
    useEffect(() => {
      return () => {
        for (const headFire of headFiresRef.current.values()) {
          scene.remove(headFire.points);
          headFire.geometry.dispose();
          headFire.material.dispose();
        }
        headFiresRef.current.clear();

        for (const [, flameId] of universalHeadFlamesRef.current.entries()) {
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

      for (const headFire of headFiresRef.current.values()) {
        if (headFire.material && typeof headFire.material.update === 'function') {
          headFire.material.update(delta);
        }
      }

      if (universalFlameRef?.current) {
        for (const [shroomerId] of universalHeadFlamesRef.current.entries()) {
          const headPos = partPositionsRef.current.get(shroomerId)?.get('head');
          if (headPos) {
            _scratchFlamePos.copy(headPos);
            _scratchFlamePos.y += 0.3;
            universalFlameRef.current.updateAttachedPosition(
              `shroomer_head_${shroomerId}`,
              _scratchFlamePos
            );
          }
        }

        for (const [attachId, fireInfo] of universalBodyFlamesRef.current.entries()) {
          const elapsed = now - fireInfo.startTime;
          if (elapsed >= fireInfo.duration) {
            universalFlameRef.current.removeFlame(fireInfo.flameId);
            universalBodyFlamesRef.current.delete(attachId);
            continue;
          }

          const shroomer = shroomers.find(s => s.id === fireInfo.shroomerId);
          if (!shroomer) {
            universalFlameRef.current.removeFlame(fireInfo.flameId);
            universalBodyFlamesRef.current.delete(attachId);
            continue;
          }

          if (fireInfo.partName.startsWith('offset_')) {
            const parts = fireInfo.partName.split('_');
            const offsetX = parseFloat(parts[1]) || 0;
            const offsetY = parseFloat(parts[2]) || 0;
            const offsetZ = parseFloat(parts[3]) || 0;

            const cosR = Math.cos(shroomer.rotation);
            const sinR = Math.sin(shroomer.rotation);
            const rotatedOffsetX = offsetX * cosR - offsetZ * sinR;
            const rotatedOffsetZ = offsetX * sinR + offsetZ * cosR;

            _scratchFlamePos.set(
              shroomer.position.x + rotatedOffsetX,
              shroomer.position.y + offsetY,
              shroomer.position.z + rotatedOffsetZ
            );
            universalFlameRef.current.updateAttachedPosition(attachId, _scratchFlamePos);
          } else {
            const partPos = partPositionsRef.current.get(fireInfo.shroomerId)?.get(fireInfo.partName);
            if (partPos) {
              _scratchFlamePos.copy(partPos);
              universalFlameRef.current.updateAttachedPosition(attachId, _scratchFlamePos);
            }
          }
        }
      }

      // Update body fires (legacy internal system) — in-place removal
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

        const shroomerPartPositions = partPositionsRef.current.get(bodyFire.shroomerId);
        const partPos = shroomerPartPositions?.get(bodyFire.partName);
        if (partPos) {
          bodyFire.points.position.copy(partPos);
        }

        bodyFiresRef.current[bodyFireWriteIdx++] = bodyFire;
      }
      bodyFiresRef.current.length = bodyFireWriteIdx;
    });

    useImperativeHandle(ref, () => ({
      update: (cameraPosition: THREE.Vector3, deltaTime: number) => {
        const bodyMesh = bodyMeshRef.current;
        const headMesh = headMeshRef.current;
        const capMesh = capMeshRef.current;
        const bodyUvAttr = bodyUvOffsetAttrRef.current;
        const headUvAttr = headUvOffsetAttrRef.current;
        const capUvAttr = capUvOffsetAttrRef.current;
        if (!bodyMesh || !headMesh || !capMesh) return;

        const now = performance.now() / 1000;

        let bodyIdx = 0;
        let headIdx = 0;
        let capIdx = 0;
        let candCount = 0;

        for (const shroomer of shroomers) {
          if (!shroomer.isActive) continue;

          const cdx = shroomer.position.x - cameraPosition.x;
          const cdz = shroomer.position.z - cameraPosition.z;
          const camDistSq = cdx * cdx + cdz * cdz;
          if (camDistSq > SHROOMER_RENDER_DIST_SQ) continue;
          const lodFrozen = camDistSq > SHROOMER_ANIM_DIST_SQ;

          const timeSinceSpawn = Date.now() - shroomer.spawnedAt;
          shroomer.emergenceProgress = Math.min(1, timeSinceSpawn / SHROOMER_EMERGENCE_DURATION_MS);

          if (shroomer.emergenceProgress >= 1) {
            let e = _flameCand[candCount];
            if (!e) { e = { id: '', d: 0 }; _flameCand[candCount] = e; }
            e.id = shroomer.id; e.d = camDistSq;
            candCount++;
          }

          const emergenceOffset = (1 - shroomer.emergenceProgress) * -EMERGENCE_DEPTH;

          const isMoving = shroomer.isChasing && shroomer.velocity.length() > 0.1;
          const legMultiplier = isMoving ? SHROOMER_LEG_ANIMATION_MULTIPLIER : 0.5;
          if (!lodFrozen) shroomer.animationPhase += deltaTime * 4 * legMultiplier;

          const phase = shroomer.animationPhase;
          const wobble = lodFrozen ? 0 : Math.sin(phase) * 0.1;

          let headOffsetX = 0;
          let headOffsetY = 0;
          const headPhase = phase * HEAD_SLIDE_SPEED;

          if (!lodFrozen) {
            switch (shroomer.headMovementType) {
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
          }

          const headOffsetZ = (!lodFrozen && shroomer.headMovementType === 'circle')
            ? Math.cos(headPhase) * HEAD_CIRCLE_RADIUS
            : 0;

          let knockdownTiltAngle = 0;
          let knockdownYAngle = shroomer.rotation;

          let tumbling = false;
          let tumblePivotY = 0;
          let tumbleSettleY = 0;
          if (shroomer.isTumbling) {
            tumbling = true;
            const tnow = Date.now();
            const launchAt = shroomer.tumbleLaunchAt ?? tnow;
            const landedAt = shroomer.tumbleLandedAt ?? 0;
            const rate = shroomer.tumbleRate ?? 0;
            _tumbleAxis.set(shroomer.tumbleAxisX ?? 0, shroomer.tumbleAxisY ?? 1, shroomer.tumbleAxisZ ?? 0);
            if (landedAt === 0) {
              tmpQuaternion.setFromAxisAngle(_tumbleAxis, rate * (tnow - launchAt) / 1000);
            } else {
              _tumbleQuat.setFromAxisAngle(_tumbleAxis, rate * (landedAt - launchAt) / 1000);
              const sinceLand = tnow - landedAt;
              if (sinceLand < TUMBLE_WAIT_MS) {
                tmpQuaternion.copy(_tumbleQuat);
              } else {
                const t = Math.min(1, (sinceLand - TUMBLE_WAIT_MS) / TUMBLE_RECOVER_MS);
                tmpEuler.set(0, shroomer.rotation, 0);
                _uprightQuat.setFromEuler(tmpEuler);
                tmpQuaternion.copy(_tumbleQuat).slerp(_uprightQuat, t);
              }
            }
            tumblePivotY = TUMBLE_PIVOT_HEIGHT * shroomer.scale;
            if (landedAt !== 0) {
              _upVec.set(0, 1, 0).applyQuaternion(tmpQuaternion);
              const upDot = Math.max(0, Math.min(1, _upVec.y));
              tumbleSettleY = (tumblePivotY - TUMBLE_GROUND_REST * shroomer.scale) * (1 - upDot);
            }
          } else if (shroomer.isKnockedDown) {
            knockdownYAngle = shroomer.knockdownDirection
              ? Math.atan2(shroomer.knockdownDirection.x, shroomer.knockdownDirection.z)
              : shroomer.rotation;

            const tiltDuration = KNOCKDOWN_TILT_DURATION_MS;
            const slideDuration = KNOCKDOWN_SLIDE_DURATION_MS;
            const totalDuration = KNOCKDOWN_TOTAL_DURATION_MS;
            const elapsed = (Date.now() - shroomer.knockdownStartTime);

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
            tmpEuler.set(0, shroomer.rotation, 0);
            tmpQuaternion.setFromEuler(tmpEuler);
          }

          // Get UV offset from the shroomer's own atlas tiles (seeded from
          // shombie texture URLs via the SQL copy + useAtlasSync registration).
          const uvs = getShroomerUVs(shroomer.definition.tier);
          let uvOffsetX = 0;
          let uvOffsetY = 0;

          if (uvs) {
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

          const healthPercent = shroomer.currentHealth / shroomer.maxHealth;
          const brightness = 0.7 + healthPercent * 0.3;

          const hasAtlasTexture = uvs !== null;
          if (hasAtlasTexture) {
            tmpColor.setRGB(brightness, brightness, brightness);
          } else {
            const tierColorHex = getTierColorHex(shroomer.definition.tier);
            tmpColor.set(tierColorHex);
            tmpColor.multiplyScalar(brightness);
          }

          const scale = shroomer.scale;

          // Fill the module-level transform context once per shroomer so
          // placePartInto() (module-level, no per-frame allocation) can compute
          // each part's world transform identically to the shombie renderer.
          _ctx.shroomer = shroomer;
          _ctx.scale = scale;
          _ctx.now = now;
          _ctx.phase = phase;
          _ctx.wobble = wobble;
          _ctx.headOffsetX = headOffsetX;
          _ctx.headOffsetY = headOffsetY;
          _ctx.headOffsetZ = headOffsetZ;
          _ctx.emergenceOffset = emergenceOffset;
          _ctx.lodFrozen = lodFrozen;
          _ctx.tumbling = tumbling;
          _ctx.tumblePivotY = tumblePivotY;
          _ctx.tumbleSettleY = tumbleSettleY;
          _ctx.knockdownTiltAngle = knockdownTiltAngle;
          _ctx.knockdownYAngle = knockdownYAngle;
          _ctx.quat.copy(tmpQuaternion);

          let partMap = partPositionsRef.current.get(shroomer.id);
          if (!partMap) { partMap = new Map<string, THREE.Vector3>(); partPositionsRef.current.set(shroomer.id, partMap); }

          // ── Body parts (cylinders) — every part EXCEPT the head ──────────
          for (let partIdx = 0; partIdx < PARTS_PER_SHROOMER; partIdx++) {
            const part = SHROOMER_BODY_PARTS[partIdx];
            if (part.name === 'head') continue; // head + cap handled separately

            const twitch = shroomer.partTwitches[part.name];
            const twitchResult = (!lodFrozen && twitch)
              ? applyTwitch(twitch, now, scale)
              : SHROOMER_TWITCH_IDENTITY;

            placePartInto(part.name, part.offsetX, part.offsetY, part.offsetZ, twitch, true);
            tmpPosition.set(_placeResult.px, _placeResult.py, _placeResult.pz);

            let pv = partMap.get(part.name);
            if (!pv) { pv = new THREE.Vector3(); partMap.set(part.name, pv); }
            pv.copy(tmpPosition);

            // Cylinder uses the same per-part box scale (radius from X/Z, height from Y).
            tmpScale.set(
              part.scaleX * scale * twitchResult.dScaleX,
              part.scaleY * scale * twitchResult.dScaleY,
              part.scaleZ * scale * twitchResult.dScaleZ
            );
            tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
            bodyMesh.setMatrixAt(bodyIdx, tmpMatrix);
            if (bodyUvAttr) setInstanceUvOffset(bodyUvAttr, bodyIdx, uvOffsetX, uvOffsetY);
            bodyMesh.setColorAt(bodyIdx, tmpColor);
            bodyIdx++;
          }

          // ── Head (sphere) ───────────────────────────────────────────────
          const headTwitch = shroomer.partTwitches['head'];
          placePartInto('head', HEAD_PART.offsetX, HEAD_PART.offsetY, HEAD_PART.offsetZ, headTwitch, true);
          tmpPosition.set(_placeResult.px, _placeResult.py, _placeResult.pz);

          let headPv = partMap.get('head');
          if (!headPv) { headPv = new THREE.Vector3(); partMap.set('head', headPv); }
          headPv.copy(tmpPosition);

          const headTwitchResult = (!lodFrozen && headTwitch) ? applyTwitch(headTwitch, now, scale) : SHROOMER_TWITCH_IDENTITY;
          tmpScale.set(
            HEAD_PART.scaleX * scale * headTwitchResult.dScaleX,
            HEAD_PART.scaleY * scale * headTwitchResult.dScaleY,
            HEAD_PART.scaleZ * scale * headTwitchResult.dScaleZ
          );
          tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
          headMesh.setMatrixAt(headIdx, tmpMatrix);
          if (headUvAttr) setInstanceUvOffset(headUvAttr, headIdx, uvOffsetX, uvOffsetY);
          headMesh.setColorAt(headIdx, tmpColor);
          headIdx++;

          // ── Mushroom cap (wide flat capsule) ────────────────────────────
          // Sits on the head so the head's TOP ONE-THIRD is embedded inside the
          // cap. Cap diameter == full body height. We position the cap above the
          // head by (headRadius - headRadius*2/3) = headRadius/3, then drop it by
          // the cap's lower half so the cap bottom dips over the head top third.
          const headRadiusWorld = HEAD_PART.scaleY * scale * 0.5;
          const capHalfHeight = CAP_RADIUS * scale * CAP_HEIGHT_FACTOR;
          // Cap center: above head center so that cap bottom = head top - (1/3 head height inside).
          // head top = headOffsetY part-space + headRadius. Embed top third → cap
          // bottom sits at (head top - 2*headRadius/3). Cap center = capBottom + capHalfHeight.
          const capLocalY = (HEAD_PART.offsetY) * scale + headRadiusWorld - (2 * headRadiusWorld / 3) + capHalfHeight;
          // Reuse placePartInto for orientation by placing a virtual part at the
          // cap local offset (use head's X/Z so it tracks horizontal head anim).
          placePartInto(
            'head',
            HEAD_PART.offsetX,
            capLocalY / scale, // placePartInto multiplies baseOffsetY by scale internally
            HEAD_PART.offsetZ,
            headTwitch,
            true,
          );
          tmpPosition.set(_placeResult.px, _placeResult.py, _placeResult.pz);
          // Wide + flat. Capsule geometry diameter (X/Z) = 2*CAP_BASE_RADIUS = 1,
          // so horizontal scale = desired diameter (CAP_DIAMETER * scale). Vertical
          // squashed flat: geometry height = 2*radius + length.
          const capGeomHeight = CAP_BASE_RADIUS * 2 + CAP_BASE_RADIUS * 0.4;
          const capHorizScale = CAP_DIAMETER * scale;     // diameter == body height
          const capVertScale = (capHalfHeight * 2) / capGeomHeight; // flat
          tmpScale.set(capHorizScale, capVertScale, capHorizScale);
          tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
          capMesh.setMatrixAt(capIdx, tmpMatrix);
          if (capUvAttr) setInstanceUvOffset(capUvAttr, capIdx, uvOffsetX, uvOffsetY);
          capMesh.setColorAt(capIdx, tmpColor);
          capIdx++;
        }

        // Clean up part positions for inactive shroomers
        for (const shroomerId of partPositionsRef.current.keys()) {
          if (!shroomers.find(s => s.id === shroomerId && s.isActive)) {
            partPositionsRef.current.delete(shroomerId);
          }
        }

        bodyMesh.count = bodyIdx;
        headMesh.count = headIdx;
        capMesh.count = capIdx;

        if (bodyIdx > 0) {
          bodyMesh.instanceMatrix.needsUpdate = true;
          if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
          if (bodyUvAttr) bodyUvAttr.needsUpdate = true;
        }
        if (headIdx > 0) {
          headMesh.instanceMatrix.needsUpdate = true;
          if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;
          if (headUvAttr) headUvAttr.needsUpdate = true;
        }
        if (capIdx > 0) {
          capMesh.instanceMatrix.needsUpdate = true;
          if (capMesh.instanceColor) capMesh.instanceColor.needsUpdate = true;
          if (capUvAttr) capUvAttr.needsUpdate = true;
        }

        // Shroomers have NO head flame (no flame hair, unlike shombies). Remove
        // any that somehow exist; never create one. (Burn fire still works via
        // the global burn system's body flame-attach points.)
        void candCount;
        for (const shroomer of shroomers) {
          if (universalHeadFlamesRef.current.has(shroomer.id) || headFiresRef.current.has(shroomer.id)) {
            removeHeadFlame(shroomer.id);
          }
        }
      },

      getHeadPosition: (shroomerId: string) => {
        const shroomer = shroomers.find(s => s.id === shroomerId && s.isActive);
        if (!shroomer) return null;

        const headPart = SHROOMER_BODY_PARTS[0];
        const phase = shroomer.animationPhase;
        const headPhase = phase * HEAD_SLIDE_SPEED;

        let headOffsetX = 0;
        let headOffsetY = 0;
        let headOffsetZ = 0;

        switch (shroomer.headMovementType) {
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

        const offsetX = headPart.offsetX * shroomer.scale + headOffsetX * shroomer.scale;
        const offsetY = headPart.offsetY * shroomer.scale + headOffsetY * shroomer.scale + Math.sin(phase * 2) * 0.02 * shroomer.scale;
        const offsetZ = headPart.offsetZ * shroomer.scale + headOffsetZ * shroomer.scale;

        const rotatedX = offsetX * Math.cos(shroomer.rotation) - offsetZ * Math.sin(shroomer.rotation);
        const rotatedZ = offsetX * Math.sin(shroomer.rotation) + offsetZ * Math.cos(shroomer.rotation);

        return new THREE.Vector3(
          shroomer.position.x + rotatedX,
          shroomer.position.y + offsetY,
          shroomer.position.z + rotatedZ
        );
      },

      getHitbox: (shroomerId: string) => {
        const shroomer = shroomers.find(s => s.id === shroomerId && s.isActive);
        if (!shroomer) return null;

        return {
          center: new THREE.Vector3(
            shroomer.position.x,
            shroomer.position.y + SHROOMER_HITBOX_HEIGHT / 2,
            shroomer.position.z
          ),
          radius: SHROOMER_HITBOX_RADIUS * shroomer.scale,
          height: SHROOMER_HITBOX_HEIGHT * shroomer.scale,
        };
      },

    }), [shroomers, createHeadFire, createBodyFire, removeHeadFlame]);

    return (
      <group ref={groupRef}>
        <instancedMesh
          ref={bodyMeshRef}
          args={[cylinderGeometry, material, MAX_BODY_INSTANCES]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
        <instancedMesh
          ref={headMeshRef}
          args={[sphereGeometry, material, MAX_HEAD_INSTANCES]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
        <instancedMesh
          ref={capMeshRef}
          args={[capsuleGeometry, material, MAX_CAP_INSTANCES]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
      </group>
    );
  }
);

ShroomerRenderer.displayName = 'ShroomerRenderer';
