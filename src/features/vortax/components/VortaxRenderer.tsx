import { useRef, useImperativeHandle, forwardRef, useMemo, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useFrustumCullGroup } from '@/lib/useFrustumCullGroup';
import {
  VORTAX_BODY_PARTS,
  type VortaxInstance,
  type PartTwitch,
} from '../types';
import {
  MAX_TOTAL_VORTAXES,
  TIER_COLORS,
  VORTAX_EMERGENCE_DURATION_MS,
  VORTAX_LEG_ANIMATION_MULTIPLIER,
  VORTAX_HITBOX_RADIUS,
  VORTAX_HITBOX_HEIGHT,
  HEAD_SLIDE_AMPLITUDE,
  HEAD_SLIDE_SPEED,
  HEAD_BOB_AMPLITUDE,
  HEAD_CIRCLE_RADIUS,
  ARM_SWING_AMPLITUDE,
  ARM_SWING_UP_DOWN,
  ELBOW_BEND_MAX,
  BODY_FIRE_SIZE,
  BODY_FIRE_HEIGHT,
  HEAD_FIRE_SIZE,
  HEAD_FIRE_HEIGHT,
  HEAD_FIRE_PARTICLE_COUNT,
  VORTAX_RENDER_DISTANCE,
  VORTAX_ANIM_DISTANCE,
} from '../constants';
import { getGlobalAtlasTexture, isAtlasReady } from '@/hooks/useTextureAtlas';
import { getVortaxUVs, slotIndexToUVs } from '@/lib/atlasLookup';
import { createAtlasStandardMaterial, createUvOffsetAttribute, setInstanceUvOffset } from '@/lib/atlasMaterial';

// Pre-allocated objects
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpColor = new THREE.Color();
const tmpEuler = new THREE.Euler();
const _scratchFlamePos = new THREE.Vector3();
const _offsetVec = new THREE.Vector3();
const _spinAxis = new THREE.Vector3();

// LOD distance thresholds (squared, horizontal).
const VORTAX_RENDER_DIST_SQ = VORTAX_RENDER_DISTANCE * VORTAX_RENDER_DISTANCE;
const VORTAX_ANIM_DIST_SQ = VORTAX_ANIM_DISTANCE * VORTAX_ANIM_DISTANCE;
const VORTAX_TWITCH_IDENTITY = { dx: 0, dy: 0, dz: 0, dScaleX: 1, dScaleY: 1, dScaleZ: 1, rotation: 0 };

// Reused per-vortax transform context. Each frame fills `_ctx` once, then
// placePartInto() writes a body-part CENTER into `_placeResult`.
const _ctx = {
  vortax: null as VortaxInstance | null,
  scale: 1,
  now: 0,
  phase: 0,
  wobble: 0,
  headOffsetX: 0,
  headOffsetY: 0,
  headOffsetZ: 0,
  emergenceOffset: 0,
  lodFrozen: false,
};
const _placeResult = { px: 0, py: 0, pz: 0 };

/** Map a virtual 'cap' to the head part for animation purposes. */
function bodyPartFor(name: string) {
  if (name === 'cap') return VORTAX_BODY_PARTS[0]; // head drives the cap's anim
  return null;
}

/**
 * Compute a body-part CENTER world position (no per-part orientation — spheres
 * are radially symmetric, so we only need the translated center; the Y-rotation
 * of the whole body is applied to the XZ offset, same as the shroomer).
 */
function placePartCenterInto(
  partName: string,
  baseOffsetX: number,
  baseOffsetY: number,
  baseOffsetZ: number,
  twitch: PartTwitch | undefined,
): void {
  const c = _ctx;
  const s = c.vortax!;
  const scale = c.scale;
  const twitchResult = (!c.lodFrozen && twitch) ? applyTwitch(twitch, c.now, scale) : VORTAX_TWITCH_IDENTITY;

  let offsetX = baseOffsetX * scale + twitchResult.dx;
  let offsetY = baseOffsetY * scale + twitchResult.dy;
  let offsetZ = baseOffsetZ * scale + twitchResult.dz;

  if (!c.lodFrozen) {
    const animName = partName === 'cap' ? 'head' : partName;
    if (animName === 'head') {
      offsetX += c.headOffsetX * scale;
      offsetY += c.headOffsetY * scale;
      offsetZ += c.headOffsetZ * scale;
      offsetY += Math.sin(c.phase * 2) * 0.02 * scale;
    } else if (animName.includes('UpperArm')) {
      const armPhase = animName.includes('left') ? c.phase : c.phase + Math.PI;
      const armSwing = Math.sin(armPhase);
      offsetZ -= 0.2 * scale;
      offsetZ += armSwing * ARM_SWING_AMPLITUDE * scale;
      offsetY += Math.abs(armSwing) * ARM_SWING_UP_DOWN * scale;
      offsetX += armSwing * 0.05 * scale * (animName.includes('left') ? 1 : -1);
    } else if (animName.includes('LowerArm')) {
      const armPhase = animName.includes('left') ? c.phase : c.phase + Math.PI;
      const armSwing = Math.sin(armPhase);
      const bendAmount = (1 + armSwing) * 0.5;
      const elbowBend = bendAmount * ELBOW_BEND_MAX;
      offsetZ -= 0.2 * scale + armSwing * ARM_SWING_AMPLITUDE * 0.8 * scale;
      offsetZ += elbowBend * scale * 0.4;
      offsetY -= elbowBend * scale * 0.35;
      offsetY += Math.sin(armPhase * 1.2) * 0.03 * scale;
    } else if (animName.includes('UpperLeg')) {
      const legPhase = animName.includes('left') ? c.phase : c.phase + Math.PI;
      offsetZ += Math.sin(legPhase) * 0.15 * scale;
    } else if (animName.includes('LowerLeg')) {
      const legPhase = animName.includes('left') ? c.phase : c.phase + Math.PI;
      const legBackAmount = Math.max(0, -Math.sin(legPhase));
      const kneeBend = legBackAmount * ELBOW_BEND_MAX;
      offsetZ += Math.sin(legPhase) * 0.1 * scale;
      offsetY -= kneeBend * scale * 0.4;
      offsetZ += kneeBend * scale * 0.2;
    } else if (animName === 'torso') {
      offsetX += c.wobble * 0.5 * scale;
    }
  }

  // Y-rotation of the whole body.
  const cosR = Math.cos(s.rotation);
  const sinR = Math.sin(s.rotation);
  const finalOffsetX = offsetX * cosR - offsetZ * sinR;
  const finalOffsetZ = offsetX * sinR + offsetZ * cosR;

  _placeResult.px = s.position.x + finalOffsetX;
  _placeResult.py = s.position.y + offsetY + c.emergenceOffset;
  _placeResult.pz = s.position.z + finalOffsetZ;
}

// ── GEOMETRY: ONE unit sphere, instanced for ALL spheres of ALL vortaxes. ──
const sphereGeometry = new THREE.SphereGeometry(0.5, 10, 8);

// Generous cap on total instanced spheres. ~170 spheres/vortax (doubled counts).
const SPHERES_PER_VORTAX = 180;

// Damped-spring constants for the post-blast regroup (~1.5s settle).
const REGROUP_SPRING = 20;
const REGROUP_DAMP = 6;
const MAX_SPHERE_INSTANCES = MAX_TOTAL_VORTAXES * SPHERES_PER_VORTAX;

const EMERGENCE_DEPTH = 2.0;

function getTierColorHex(tier: number): string {
  return TIER_COLORS[tier]?.[0] || '#FFFF00';
}
function getTierColors(tier: number): string[] {
  return TIER_COLORS[tier] || ['#FFFF00'];
}

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

export interface VortaxRendererHandle {
  update: (cameraPosition: THREE.Vector3, deltaTime: number) => void;
  getHeadPosition: (vortaxId: string) => THREE.Vector3 | null;
  getHitbox: (vortaxId: string) => { center: THREE.Vector3; radius: number; height: number } | null;
}

interface VortaxRendererProps {
  vortaxes: VortaxInstance[];
  universalFlameRef?: React.MutableRefObject<UniversalFlameRendererHandle | null>;
}

/**
 * Apply twitchiness to a body part offset (identical to the shroomer renderer)
 */
function applyTwitch(
  twitch: PartTwitch,
  time: number,
  scale: number
): { dx: number; dy: number; dz: number; dScaleX: number; dScaleY: number; dScaleZ: number; rotation: number } {
  const t = time * twitch.frequency + twitch.phaseOffset;
  const amp = twitch.amplitude * scale;

  let dx = 0, dy = 0, dz = 0;
  const dScaleX = 1, dScaleY = 1, dScaleZ = 1;
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
      // Spheres ignore scale-pulse (radially symmetric) — fall through as translate.
      dx = Math.sin(fastT * 1.7) * fastAmp * 0.2;
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

/** Rotate `v` around unit `axis` by `angle` (Rodrigues), writing into out. */
function rotateAroundAxis(
  vx: number, vy: number, vz: number,
  ax: number, ay: number, az: number,
  angle: number,
  out: THREE.Vector3,
): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // dot(axis, v)
  const dot = ax * vx + ay * vy + az * vz;
  // cross(axis, v)
  const cx = ay * vz - az * vy;
  const cy = az * vx - ax * vz;
  const cz = ax * vy - ay * vx;
  out.set(
    vx * cos + cx * sin + ax * dot * (1 - cos),
    vy * cos + cy * sin + ay * dot * (1 - cos),
    vz * cos + cz * sin + az * dot * (1 - cos),
  );
}

/**
 * Renders vortaxes as orbiting sphere-clouds. ONE instanced sphere mesh holds
 * every sphere of every vortax. Each frame we compute the part center (same
 * layout/animation as the shroomer), then add the per-sphere orbit offset.
 * Destroyed spheres are skipped.
 */
export const VortaxRenderer = forwardRef<VortaxRendererHandle, VortaxRendererProps>(
  ({ vortaxes, universalFlameRef }, ref) => {
    const sphereMeshRef = useRef<THREE.InstancedMesh>(null);
    const groupRef = useRef<THREE.Group>(null);
    const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
    const uvOffsetAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
    const partPositionsRef = useRef<Map<string, Map<string, THREE.Vector3>>>(new Map());
    const universalBodyFlamesRef = useRef<Map<string, { flameId: string; vortaxId: string; partName: string; startTime: number; duration: number }>>(new Map());

    void BODY_FIRE_SIZE; void BODY_FIRE_HEIGHT; void HEAD_FIRE_SIZE; void HEAD_FIRE_HEIGHT; void HEAD_FIRE_PARTICLE_COUNT;
    void getTierColors;

    useFrustumCullGroup(
      'vortax',
      [sphereMeshRef],
      () => vortaxes.length === 0 ? null : vortaxes.filter(s => s.isActive).map(s => s.position),
      { radiusPad: 12 }, // 20m giants — pad the cull sphere generously
    );
    const { scene } = useThree();
    void scene;

    // Create atlas material
    // Spheres are 70% opaque (30% transparent) at all times.
    const makeGhostly = (m: THREE.MeshStandardMaterial) => {
      m.transparent = true;
      m.opacity = 0.7;
      m.depthWrite = false;
      return m;
    };
    const material = useMemo(() => {
      const atlasTexture = getGlobalAtlasTexture();
      if (!atlasTexture || !isAtlasReady()) {
        const mat = makeGhostly(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.1 }));
        materialRef.current = mat;
        return mat;
      }
      const mat = makeGhostly(createAtlasStandardMaterial(atlasTexture, { roughness: 0.8, metalness: 0.1 }));
      materialRef.current = mat;
      return mat;
    }, []);

    // Update material when atlas becomes ready
    useEffect(() => {
      const checkAtlas = () => {
        if (isAtlasReady()) {
          const atlasTexture = getGlobalAtlasTexture();
          if (atlasTexture && materialRef.current && !materialRef.current.map) {
            const newMat = makeGhostly(createAtlasStandardMaterial(atlasTexture, { roughness: 0.8, metalness: 0.1 }));
            materialRef.current = newMat;
            if (sphereMeshRef.current) sphereMeshRef.current.material = newMat;
          }
        }
      };
      const interval = setInterval(checkAtlas, 100);
      return () => clearInterval(interval);
    }, []);

    // Setup UV offset attribute
    useEffect(() => {
      if (sphereMeshRef.current && !uvOffsetAttrRef.current) {
        uvOffsetAttrRef.current = createUvOffsetAttribute(sphereMeshRef.current, MAX_SPHERE_INSTANCES);
      }
    }, []);

    // Flame attach-point updates per frame (engulf the giant).
    useFrame(() => {
      if (!universalFlameRef?.current) return;
      const now = Date.now();
      for (const [attachId, fireInfo] of universalBodyFlamesRef.current.entries()) {
        const elapsed = now - fireInfo.startTime;
        if (elapsed >= fireInfo.duration) {
          universalFlameRef.current.removeFlame(fireInfo.flameId);
          universalBodyFlamesRef.current.delete(attachId);
          continue;
        }
        const partPos = partPositionsRef.current.get(fireInfo.vortaxId)?.get(fireInfo.partName);
        if (partPos) {
          _scratchFlamePos.copy(partPos);
          universalFlameRef.current.updateAttachedPosition(attachId, _scratchFlamePos);
        }
      }
    });

    useImperativeHandle(ref, () => ({
      update: (cameraPosition: THREE.Vector3, deltaTime: number) => {
        const mesh = sphereMeshRef.current;
        const uvAttr = uvOffsetAttrRef.current;
        if (!mesh) return;

        const now = performance.now() / 1000;
        let sphereIdx = 0;

        for (const vortax of vortaxes) {
          if (!vortax.isActive) continue;

          const cdx = vortax.position.x - cameraPosition.x;
          const cdz = vortax.position.z - cameraPosition.z;
          const camDistSq = cdx * cdx + cdz * cdz;
          if (camDistSq > VORTAX_RENDER_DIST_SQ) continue;
          const lodFrozen = camDistSq > VORTAX_ANIM_DIST_SQ;

          const timeSinceSpawn = Date.now() - vortax.spawnedAt;
          vortax.emergenceProgress = Math.min(1, timeSinceSpawn / VORTAX_EMERGENCE_DURATION_MS);
          const emergenceOffset = (1 - vortax.emergenceProgress) * -EMERGENCE_DEPTH;

          const isMoving = vortax.isChasing && vortax.velocity.length() > 0.1;
          const legMultiplier = isMoving ? VORTAX_LEG_ANIMATION_MULTIPLIER : 0.5;
          if (!lodFrozen) vortax.animationPhase += deltaTime * 4 * legMultiplier;

          const phase = vortax.animationPhase;
          const wobble = lodFrozen ? 0 : Math.sin(phase) * 0.1;

          let headOffsetX = 0;
          let headOffsetY = 0;
          const headPhase = phase * HEAD_SLIDE_SPEED;
          if (!lodFrozen) {
            switch (vortax.headMovementType) {
              case 'slide': headOffsetX = Math.sin(headPhase) * HEAD_SLIDE_AMPLITUDE; break;
              case 'bob': headOffsetY = Math.sin(headPhase) * HEAD_BOB_AMPLITUDE; break;
              case 'circle': headOffsetX = Math.sin(headPhase) * HEAD_CIRCLE_RADIUS; break;
            }
          }
          const headOffsetZ = (!lodFrozen && vortax.headMovementType === 'circle')
            ? Math.cos(headPhase) * HEAD_CIRCLE_RADIUS : 0;

          // UV offset from the vortax's own atlas tile.
          const uvs = getVortaxUVs(vortax.definition.tier);
          let uvOffsetX = 0, uvOffsetY = 0;
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

          const healthPercent = vortax.currentHealth / vortax.maxHealth;
          const brightness = 0.7 + healthPercent * 0.3;
          const hasAtlasTexture = uvs !== null;
          if (hasAtlasTexture) {
            tmpColor.setRGB(brightness, brightness, brightness);
          } else {
            const tierColorHex = getTierColorHex(vortax.definition.tier);
            tmpColor.set(tierColorHex);
            tmpColor.multiplyScalar(brightness);
          }

          const scale = vortax.scale;
          tmpQuaternion.identity();

          // Fill module-level transform context once per vortax.
          _ctx.vortax = vortax;
          _ctx.scale = scale;
          _ctx.now = now;
          _ctx.phase = phase;
          _ctx.wobble = wobble;
          _ctx.headOffsetX = headOffsetX;
          _ctx.headOffsetY = headOffsetY;
          _ctx.headOffsetZ = headOffsetZ;
          _ctx.emergenceOffset = emergenceOffset;
          _ctx.lodFrozen = lodFrozen;

          // ── Compute each PART CENTER once (head, torso, limbs + virtual cap).
          let partMap = partPositionsRef.current.get(vortax.id);
          if (!partMap) { partMap = new Map<string, THREE.Vector3>(); partPositionsRef.current.set(vortax.id, partMap); }

          const partCenters = _partCenterCache;
          partCenters.clear();
          for (const part of VORTAX_BODY_PARTS) {
            placePartCenterInto(part.name, part.offsetX, part.offsetY, part.offsetZ, vortax.partTwitches[part.name]);
            partCenters.set(part.name, { x: _placeResult.px, y: _placeResult.py, z: _placeResult.pz });
            let pv = partMap.get(part.name);
            if (!pv) { pv = new THREE.Vector3(); partMap.set(part.name, pv); }
            pv.set(_placeResult.px, _placeResult.py, _placeResult.pz);
          }
          // Virtual cap center (above the head).
          const head = VORTAX_BODY_PARTS[0];
          placePartCenterInto('cap', head.offsetX, head.offsetY + head.scaleY * 0.6, head.offsetZ, vortax.partTwitches['head']);
          partCenters.set('cap', { x: _placeResult.px, y: _placeResult.py, z: _placeResult.pz });

          // ── Place each (live) sphere = part center + orbit offset.
          for (let i = 0; i < vortax.spheres.length; i++) {
            const sp = vortax.spheres[i];
            if (sp.destroyed) continue;
            const pc = partCenters.get(sp.partName);
            if (!pc) continue;

            // Orbit angle (frozen at LOD distance for cheapness).
            const angle = sp.phase + (lodFrozen ? 0 : now * sp.angularSpeed);
            // Rotate the orbit's angle-0 unit vector around the axis.
            rotateAroundAxis(sp.baseX, sp.baseY, sp.baseZ, sp.axisX, sp.axisY, sp.axisZ, angle, _offsetVec);

            // Sphere world position = partCenter + (localOrbitCenter + orbitVec) * scale,
            // with the orbit-center XZ rotated by the body Y-rotation. The part center
            // already folded the part offset + body rotation; here we add the sphere's
            // LOCAL deviation (its own jittered orbit center relative to the part
            // center) plus the orbit radius vector, both scaled.
            const cosR = Math.cos(vortax.rotation);
            const sinR = Math.sin(vortax.rotation);
            // local deviation of this sphere's orbit center from the PART center:
            const devX = (sp.centerX - _partOffsetX(sp.partName)) * scale;
            const devY = (sp.centerY - _partOffsetY(sp.partName)) * scale;
            const devZ = (sp.centerZ - _partOffsetZ(sp.partName)) * scale;
            const orbX = _offsetVec.x * sp.orbitRadius * scale;
            const orbY = _offsetVec.y * sp.orbitRadius * scale;
            const orbZ = _offsetVec.z * sp.orbitRadius * scale;

            // Blast displacement: damped spring back to the orbit (regroup).
            // Only scattered spheres pay the cost.
            if (sp.dispX || sp.dispY || sp.dispZ || sp.velX || sp.velY || sp.velZ) {
              sp.velX += (-REGROUP_SPRING * sp.dispX - REGROUP_DAMP * sp.velX) * deltaTime;
              sp.velY += (-REGROUP_SPRING * sp.dispY - REGROUP_DAMP * sp.velY) * deltaTime;
              sp.velZ += (-REGROUP_SPRING * sp.dispZ - REGROUP_DAMP * sp.velZ) * deltaTime;
              sp.dispX += sp.velX * deltaTime;
              sp.dispY += sp.velY * deltaTime;
              sp.dispZ += sp.velZ * deltaTime;
              // Snap to rest once tiny so they fully regroup.
              if (Math.abs(sp.dispX) < 1e-3 && Math.abs(sp.dispY) < 1e-3 && Math.abs(sp.dispZ) < 1e-3 &&
                  Math.abs(sp.velX) < 1e-3 && Math.abs(sp.velY) < 1e-3 && Math.abs(sp.velZ) < 1e-3) {
                sp.dispX = sp.dispY = sp.dispZ = 0;
                sp.velX = sp.velY = sp.velZ = 0;
              }
            }

            const lx = devX + orbX + sp.dispX * scale;
            const lz = devZ + orbZ + sp.dispZ * scale;
            tmpPosition.set(
              pc.x + (lx * cosR - lz * sinR),
              pc.y + devY + orbY + sp.dispY * scale,
              pc.z + (lx * sinR + lz * cosR),
            );

            const diam = sp.diameter * scale; // geometry is unit-diameter sphere
            tmpScale.set(diam, diam, diam);
            // Self-spin: each sphere rotates about its own random axis.
            const spinAngle = sp.spinPhase + (lodFrozen ? 0 : now * sp.spinSpeed);
            _spinAxis.set(sp.spinAxisX, sp.spinAxisY, sp.spinAxisZ);
            tmpQuaternion.setFromAxisAngle(_spinAxis, spinAngle);
            tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
            mesh.setMatrixAt(sphereIdx, tmpMatrix);
            if (uvAttr) setInstanceUvOffset(uvAttr, sphereIdx, uvOffsetX, uvOffsetY);
            mesh.setColorAt(sphereIdx, tmpColor);
            sphereIdx++;
            if (sphereIdx >= MAX_SPHERE_INSTANCES) break;
          }
          if (sphereIdx >= MAX_SPHERE_INSTANCES) break;
        }

        // Clean up part positions for inactive vortaxes
        for (const vortaxId of partPositionsRef.current.keys()) {
          if (!vortaxes.find(s => s.id === vortaxId && s.isActive)) {
            partPositionsRef.current.delete(vortaxId);
          }
        }

        mesh.count = sphereIdx;
        if (sphereIdx > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          if (uvAttr) uvAttr.needsUpdate = true;
        }
      },

      getHeadPosition: (vortaxId: string) => {
        const vortax = vortaxes.find(s => s.id === vortaxId && s.isActive);
        if (!vortax) return null;
        const headPart = VORTAX_BODY_PARTS[0];
        return new THREE.Vector3(
          vortax.position.x + headPart.offsetX * vortax.scale,
          vortax.position.y + headPart.offsetY * vortax.scale,
          vortax.position.z + headPart.offsetZ * vortax.scale,
        );
      },

      getHitbox: (vortaxId: string) => {
        const vortax = vortaxes.find(s => s.id === vortaxId && s.isActive);
        if (!vortax) return null;
        return {
          center: new THREE.Vector3(
            vortax.position.x,
            vortax.position.y + (VORTAX_HITBOX_HEIGHT * vortax.scale) / 2,
            vortax.position.z
          ),
          radius: VORTAX_HITBOX_RADIUS * vortax.scale,
          height: VORTAX_HITBOX_HEIGHT * vortax.scale,
        };
      },

    }), [vortaxes]);

    return (
      <group ref={groupRef}>
        <instancedMesh
          ref={sphereMeshRef}
          args={[sphereGeometry, material, MAX_SPHERE_INSTANCES]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
      </group>
    );
  }
);

VortaxRenderer.displayName = 'VortaxRenderer';

// ── Helpers: per-part base offsets (so a sphere's stored orbit-center, which is
//    relative to the BODY origin, can be re-expressed relative to its PART center).
const _partCenterCache = new Map<string, { x: number; y: number; z: number }>();
const _partOffsetLookup: Record<string, { x: number; y: number; z: number }> = (() => {
  const map: Record<string, { x: number; y: number; z: number }> = {};
  for (const p of VORTAX_BODY_PARTS) map[p.name] = { x: p.offsetX, y: p.offsetY, z: p.offsetZ };
  const head = VORTAX_BODY_PARTS[0];
  map['cap'] = { x: head.offsetX, y: head.offsetY + head.scaleY * 0.6, z: head.offsetZ };
  return map;
})();
function _partOffsetX(name: string): number { return _partOffsetLookup[name]?.x ?? 0; }
function _partOffsetY(name: string): number { return _partOffsetLookup[name]?.y ?? 0; }
function _partOffsetZ(name: string): number { return _partOffsetLookup[name]?.z ?? 0; }

void bodyPartFor;
