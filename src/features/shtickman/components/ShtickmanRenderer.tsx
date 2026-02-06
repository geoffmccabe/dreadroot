import React, { useRef, useMemo, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import type { ShtickmanInstance } from '../types';
import {
  SHTICKMAN_RENDER_DISTANCE,
  HEAD_WIDTH_RATIO,
  HEAD_HEIGHT_RATIO,
  EYE_TRACKING_RANGE,
  PUPIL_LERP_SPEED,
  RANDOM_LOOK_INTERVAL_MS,
  RANDOM_LOOK_VARIANCE,
  EYE_WIDTH_RATIO,
  EYE_HEIGHT_RATIO,
  EYE_DEPTH,
  EYE_SEPARATION,
  EYE_VERTICAL_POS,
  PUPIL_SIZE_RATIO,
  EYE_OUTLINE_WIDTH,
  MAX_TOTAL_SHTICKMEN,
} from '../constants';
import { playerTracker } from '@/lib/playerTracker';

export interface ShtickmanRendererHandle {
  // Currently no exposed methods needed
}

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
    colorMode?: 'static' | 'rainbow' | 'black';
  }) => string;
  updateAttachedPosition: (attachId: string, position: THREE.Vector3) => void;
  removeFlame: (flameId: string) => void;
  removeAttached: (attachId: string) => void;
}

interface ShtickmanRendererProps {
  shtickmenRef: React.RefObject<ShtickmanInstance[]>;
  cameraRef: React.RefObject<THREE.Camera>;
  universalFlameRef?: React.MutableRefObject<UniversalFlameRendererHandle | null>;
}

// Fire hair configuration for high tier shtickmen (T5-T10)
const FIRE_HAIR_CONFIG: Record<number, {
  colors: string[];
  baseHeight: number;
  baseSize: number;
  colorMode?: 'static' | 'rainbow' | 'black';
}> = {
  5: { colors: ['#CCCCCC', '#AAAAAA', '#888888'], baseHeight: 4.0, baseSize: 0.9, colorMode: 'static' },
  6: { colors: ['#FFFFFF', '#F8F8FF', '#EEEEEE'], baseHeight: 8.0, baseSize: 1.05, colorMode: 'static' },
  7: { colors: ['#FF69B4', '#FF1493', '#FF85C1'], baseHeight: 12.0, baseSize: 1.2, colorMode: 'static' },
  8: { colors: ['#FF0000'], baseHeight: 16.0, baseSize: 1.35, colorMode: 'rainbow' },
  9: { colors: ['#200010'], baseHeight: 20.0, baseSize: 1.5, colorMode: 'black' },
  10: { colors: ['#FFD700', '#FFA500', '#FF8C00'], baseHeight: 24.0, baseSize: 1.65, colorMode: 'static' },
};

const FIRE_HAIR_PARTICLE_COUNT = 100;
const BAMBOO_RADIUS_RATIO = 0.0075;
const NUM_TIERS = 10;

const PROPORTIONS = {
  FOOT_HEIGHT: 0.0,
  ANKLE_HEIGHT: 0.04,
  KNEE_HEIGHT: 0.26,
  HIP_HEIGHT: 0.50,
  SPINE_HEIGHT: 0.58,
  SPINE1_HEIGHT: 0.68,
  SPINE2_HEIGHT: 0.78,
  NECK_HEIGHT: 0.88,
  HEAD_HEIGHT: 0.95,
  HIP_WIDTH: 0.06,
  SHOULDER_WIDTH: 0.10,
  SHOULDER_HEIGHT: 0.82,
  ELBOW_HEIGHT: 0.62,
  WRIST_HEIGHT: 0.45,
};

// Instancing capacity per tier (worst case: all shtickmen same tier)
const BONES_PER = 18;
const EYES_PER = 6;
const MAX_BONE_INSTANCES_PER_TIER = BONES_PER * MAX_TOTAL_SHTICKMEN;
const MAX_HEAD_INSTANCES_PER_TIER = MAX_TOTAL_SHTICKMEN;
const MAX_EYE_INSTANCES = EYES_PER * MAX_TOTAL_SHTICKMEN;

// Pre-allocated temporaries for per-frame rendering
const _temp = new THREE.Object3D();
const _vec1 = new THREE.Vector3();
const _vec2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const _colorBlack = new THREE.Color(0x000000);
const _colorWhite = new THREE.Color(0xffffff);
const _mat4World = new THREE.Matrix4();

// Bone connections [startBoneName, endBoneName]
const BONE_CONNECTIONS: [string, string][] = [
  ['Hips', 'Spine'], ['Spine', 'Spine1'], ['Spine1', 'Spine2'],
  ['Spine2', 'Neck'], ['Neck', 'Head'],
  ['Hips', 'LeftUpLeg'], ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'],
  ['Hips', 'RightUpLeg'], ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot'],
  ['Spine2', 'LeftShoulder'], ['LeftShoulder', 'LeftArm'],
  ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'],
  ['Spine2', 'RightShoulder'], ['RightShoulder', 'RightArm'],
  ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
];

// Bamboo texture URLs per tier (1-indexed: index 0 is placeholder, indices 1-10 for tiers 1-10)
const BAMBOO_TEXTURE_URLS: string[] = [
  '/Bamboo_Seamless_t1.webp', // index 0 placeholder (loaded but unused)
  '/Bamboo_Seamless_t1.webp',  // tier 1
  '/Bamboo_Seamless_t2.webp',  // tier 2
  '/Bamboo_Seamless_t3.webp',  // tier 3
  '/Bamboo_Seamless_t4.webp',  // tier 4
  '/Bamboo_Seamless_t5.webp',  // tier 5
  '/Bamboo_Seamless_t6.webp',  // tier 6
  '/Bamboo_Seamless_t7.webp',  // tier 7
  '/Bamboo_Seamless_t8.webp',  // tier 8
  '/Bamboo_Seamless_t9.webp',  // tier 9
  '/Bamboo_Seamless_t10.webp', // tier 10
];

/**
 * Create a standard humanoid skeleton with Mixamo-compatible bone naming
 */
function createHumanoidSkeleton(bodyHeight: number, headSize: number): {
  bones: THREE.Bone[];
  bonesByName: Map<string, THREE.Bone>;
} {
  const bonesByName = new Map<string, THREE.Bone>();

  const makeBone = (name: string): THREE.Bone => {
    const bone = new THREE.Bone();
    bone.name = name;
    bonesByName.set(name, bone);
    return bone;
  };

  const hips = makeBone('Hips');
  const spine = makeBone('Spine');
  const spine1 = makeBone('Spine1');
  const spine2 = makeBone('Spine2');
  const neck = makeBone('Neck');
  const head = makeBone('Head');
  const leftUpLeg = makeBone('LeftUpLeg');
  const leftLeg = makeBone('LeftLeg');
  const leftFoot = makeBone('LeftFoot');
  const rightUpLeg = makeBone('RightUpLeg');
  const rightLeg = makeBone('RightLeg');
  const rightFoot = makeBone('RightFoot');
  const leftShoulder = makeBone('LeftShoulder');
  const leftArm = makeBone('LeftArm');
  const leftForeArm = makeBone('LeftForeArm');
  const leftHand = makeBone('LeftHand');
  const rightShoulder = makeBone('RightShoulder');
  const rightArm = makeBone('RightArm');
  const rightForeArm = makeBone('RightForeArm');
  const rightHand = makeBone('RightHand');

  hips.add(spine); hips.add(leftUpLeg); hips.add(rightUpLeg);
  spine.add(spine1); spine1.add(spine2);
  spine2.add(neck); spine2.add(leftShoulder); spine2.add(rightShoulder);
  neck.add(head);
  leftUpLeg.add(leftLeg); leftLeg.add(leftFoot);
  rightUpLeg.add(rightLeg); rightLeg.add(rightFoot);
  leftShoulder.add(leftArm); leftArm.add(leftForeArm); leftForeArm.add(leftHand);
  rightShoulder.add(rightArm); rightArm.add(rightForeArm); rightForeArm.add(rightHand);

  const hipY = bodyHeight * PROPORTIONS.HIP_HEIGHT;
  hips.position.set(0, hipY, 0);
  spine.position.set(0, bodyHeight * (PROPORTIONS.SPINE_HEIGHT - PROPORTIONS.HIP_HEIGHT), 0);
  spine1.position.set(0, bodyHeight * (PROPORTIONS.SPINE1_HEIGHT - PROPORTIONS.SPINE_HEIGHT), 0);
  spine2.position.set(0, bodyHeight * (PROPORTIONS.SPINE2_HEIGHT - PROPORTIONS.SPINE1_HEIGHT), 0);
  neck.position.set(0, bodyHeight * (PROPORTIONS.NECK_HEIGHT - PROPORTIONS.SPINE2_HEIGHT), 0);
  head.position.set(0, bodyHeight * (PROPORTIONS.HEAD_HEIGHT - PROPORTIONS.NECK_HEIGHT) + headSize * 0.5, 0);

  const hipWidth = bodyHeight * PROPORTIONS.HIP_WIDTH;
  leftUpLeg.position.set(-hipWidth, 0, 0);
  rightUpLeg.position.set(hipWidth, 0, 0);

  const upperLegLen = bodyHeight * (PROPORTIONS.HIP_HEIGHT - PROPORTIONS.KNEE_HEIGHT);
  const lowerLegLen = bodyHeight * (PROPORTIONS.KNEE_HEIGHT - PROPORTIONS.ANKLE_HEIGHT);
  leftLeg.position.set(0, -upperLegLen, 0);
  rightLeg.position.set(0, -upperLegLen, 0);
  leftFoot.position.set(0, -lowerLegLen, 0);
  rightFoot.position.set(0, -lowerLegLen, 0);

  const shoulderWidth = bodyHeight * PROPORTIONS.SHOULDER_WIDTH;
  leftShoulder.position.set(-shoulderWidth * 0.3, 0, 0);
  rightShoulder.position.set(shoulderWidth * 0.3, 0, 0);

  const upperArmLen = bodyHeight * (PROPORTIONS.SHOULDER_HEIGHT - PROPORTIONS.ELBOW_HEIGHT);
  const lowerArmLen = bodyHeight * (PROPORTIONS.ELBOW_HEIGHT - PROPORTIONS.WRIST_HEIGHT);
  leftArm.position.set(-shoulderWidth * 0.7, 0, 0);
  rightArm.position.set(shoulderWidth * 0.7, 0, 0);
  leftForeArm.position.set(0, -upperArmLen, 0);
  rightForeArm.position.set(0, -upperArmLen, 0);
  leftHand.position.set(0, -lowerArmLen, 0);
  rightHand.position.set(0, -lowerArmLen, 0);

  const bones = [
    hips, spine, spine1, spine2, neck, head,
    leftUpLeg, leftLeg, leftFoot,
    rightUpLeg, rightLeg, rightFoot,
    leftShoulder, leftArm, leftForeArm, leftHand,
    rightShoulder, rightArm, rightForeArm, rightHand,
  ];

  return { bones, bonesByName };
}

/**
 * Apply simple procedural walk animation to skeleton
 */
function applyWalkAnimation(
  bonesByName: Map<string, THREE.Bone>,
  phase: number,
  movementSpeed: number,
  bodyHeight: number
): void {
  const isMoving = movementSpeed > 0.1;
  const t = phase;

  const legSwingAmp = isMoving ? 0.4 : 0.02;
  const legSwing = Math.sin(t) * legSwingAmp;
  const kneeSwing = isMoving ? Math.max(0, Math.sin(t)) * 0.5 : 0;

  const leftUpLeg = bonesByName.get('LeftUpLeg');
  const rightUpLeg = bonesByName.get('RightUpLeg');
  const leftLeg = bonesByName.get('LeftLeg');
  const rightLeg = bonesByName.get('RightLeg');

  if (leftUpLeg) leftUpLeg.rotation.x = legSwing;
  if (rightUpLeg) rightUpLeg.rotation.x = -legSwing;
  if (leftLeg) leftLeg.rotation.x = kneeSwing;
  if (rightLeg) rightLeg.rotation.x = isMoving ? Math.max(0, Math.sin(t + Math.PI)) * 0.5 : 0;

  const armSwing = -legSwing * 0.6;
  const leftArm = bonesByName.get('LeftArm');
  const rightArm = bonesByName.get('RightArm');
  const leftForeArm = bonesByName.get('LeftForeArm');
  const rightForeArm = bonesByName.get('RightForeArm');

  if (leftArm) leftArm.rotation.x = -armSwing;
  if (rightArm) rightArm.rotation.x = armSwing;
  if (leftForeArm) leftForeArm.rotation.x = -0.2;
  if (rightForeArm) rightForeArm.rotation.x = -0.2;

  const hips = bonesByName.get('Hips');
  const spine = bonesByName.get('Spine');
  const spine1 = bonesByName.get('Spine1');

  if (hips) hips.rotation.y = Math.sin(t) * 0.05;
  if (spine) spine.rotation.y = -Math.sin(t) * 0.03;
  if (spine1) spine1.rotation.y = -Math.sin(t) * 0.02;

  const head = bonesByName.get('Head');
  if (head) head.rotation.z = Math.sin(t * 0.5) * 0.05;
}

/**
 * Renderer for Shtickman enemies using per-tier instanced rendering.
 * 10 bone meshes + 10 head meshes (one per tier, each with own bamboo texture) + 1 eye mesh.
 * Tiers with count=0 generate no draw calls.
 */
export const ShtickmanRenderer = forwardRef<ShtickmanRendererHandle, ShtickmanRendererProps>(
  ({ shtickmenRef, cameraRef, universalFlameRef }, ref) => {
    // Per-tier mesh refs (1-indexed: index 0 unused, indices 1-10 for tiers 1-10)
    const boneMeshRefs = useRef<(THREE.InstancedMesh | null)[]>(new Array(NUM_TIERS + 1).fill(null));
    const headMeshRefs = useRef<(THREE.InstancedMesh | null)[]>(new Array(NUM_TIERS + 1).fill(null));
    const eyesMeshRef = useRef<THREE.InstancedMesh>(null);

    const skeletonCache = useRef<Map<string, {
      bonesByName: Map<string, THREE.Bone>;
      rootBone: THREE.Bone;
      bodyHeight: number;
      groundOffset: number;
    }>>(new Map());

    const headFlamesRef = useRef<Map<string, string>>(new Map());
    const headPositionsRef = useRef<Map<string, THREE.Vector3>>(new Map());

    useImperativeHandle(ref, () => ({}), []);

    // Shared unit geometries (scaled per-instance via matrix)
    const boneGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 8), []);
    const headGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 16), []);
    const eyeGeo = useMemo(() => new THREE.CircleGeometry(1, 16), []);

    // Load bamboo textures (11 total: index 0 placeholder + tiers 1-10)
    const bambooTextures = useTexture(BAMBOO_TEXTURE_URLS);

    useEffect(() => {
      const textures = Array.isArray(bambooTextures) ? bambooTextures : [bambooTextures];
      for (const tex of textures) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(1, 3);
        tex.needsUpdate = true;
      }
    }, [bambooTextures]);

    // One material per tier with its own bamboo texture
    const tierMaterials = useMemo(() => {
      const textures = Array.isArray(bambooTextures) ? bambooTextures : [bambooTextures];
      return textures.map(tex => new THREE.MeshLambertMaterial({ map: tex }));
    }, [bambooTextures]);

    const eyeMat = useMemo(() => new THREE.MeshBasicMaterial(), []);

    // Per-tier instance counters (1-indexed: index 0 unused, indices 1-10 for tiers 1-10)
    const boneCountsRef = useRef(new Int32Array(NUM_TIERS + 1));
    const headCountsRef = useRef(new Int32Array(NUM_TIERS + 1));

    useFrame((_, delta) => {
      const eyesMesh = eyesMeshRef.current;
      if (!eyesMesh || !shtickmenRef.current || !cameraRef.current) return;

      const camera = cameraRef.current;
      const deltaSeconds = Math.min(delta, 0.1);
      const shtickmen = shtickmenRef.current;

      // Reset per-tier counters
      boneCountsRef.current.fill(0);
      headCountsRef.current.fill(0);
      let eyeIdx = 0;

      const activeIds = new Set<string>();

      // Clean up skeleton cache for dead shtickmen
      const liveIds = new Set(shtickmen.filter(s => s.isActive).map(s => s.id));
      for (const cachedId of skeletonCache.current.keys()) {
        if (!liveIds.has(cachedId)) skeletonCache.current.delete(cachedId);
      }

      for (const s of shtickmen) {
        if (!s.isActive) continue;
        activeIds.add(s.id);

        // Distance check
        const dx = s.position.x - camera.position.x;
        const dz = s.position.z - camera.position.z;
        if (dx * dx + dz * dz > SHTICKMAN_RENDER_DISTANCE * SHTICKMAN_RENDER_DISTANCE) continue;

        const tier = Math.max(1, Math.min(NUM_TIERS, s.tier)); // clamp to valid tier 1-10
        const boneMesh = boneMeshRefs.current[tier];
        const headMesh = headMeshRefs.current[tier];
        if (!boneMesh || !headMesh) continue;

        const totalHeight = s.heightBlocks * s.scale;
        const headSize = s.headSizeBlocks * s.scale;
        const bodyHeight = totalHeight - headSize;
        const bambooRadius = totalHeight * BAMBOO_RADIUS_RATIO;

        // Get or create skeleton
        let skel = skeletonCache.current.get(s.id);
        if (!skel) {
          const { bones, bonesByName } = createHumanoidSkeleton(bodyHeight, headSize);
          skel = {
            bonesByName,
            rootBone: bones[0],
            bodyHeight,
            groundOffset: bodyHeight * PROPORTIONS.ANKLE_HEIGHT,
          };
          skeletonCache.current.set(s.id, skel);
        }

        const speed = Math.sqrt(s.velocity.x * s.velocity.x + s.velocity.z * s.velocity.z);
        applyWalkAnimation(skel.bonesByName, s.animationPhase, speed, bodyHeight);
        skel.rootBone.updateMatrixWorld(true);

        // Shtickman world transform: rotate by rotationY then translate to position
        _mat4World.makeRotationY(s.rotationY);
        _mat4World.setPosition(s.position.x, s.position.y, s.position.z);

        // Helper: get bone position in skeleton local space
        const boneLocal = (name: string, out: THREE.Vector3) => {
          const bone = skel!.bonesByName.get(name);
          if (bone) { bone.getWorldPosition(out); out.y -= skel!.groundOffset; }
          else out.set(0, 0, 0);
        };

        // === BONE CYLINDERS ===
        let boneIdx = boneCountsRef.current[tier];
        for (const [startName, endName] of BONE_CONNECTIONS) {
          boneLocal(startName, _vec1);
          boneLocal(endName, _vec2);

          // Transform to world space
          _vec1.applyMatrix4(_mat4World);
          _vec2.applyMatrix4(_mat4World);

          _dir.subVectors(_vec2, _vec1);
          const len = _dir.length();
          if (len < 0.001) continue;

          let r = bambooRadius;
          if (startName.includes('Spine') || startName === 'Hips') r *= 1.2;
          else if (startName.includes('Fore') || startName.includes('Hand') || startName.includes('Foot')) r *= 0.8;

          _temp.position.lerpVectors(_vec1, _vec2, 0.5);
          _temp.scale.set(r, len, r);
          _dir.divideScalar(len); // normalize
          _temp.quaternion.setFromUnitVectors(_upVec, _dir);
          _temp.updateMatrix();
          boneMesh.setMatrixAt(boneIdx, _temp.matrix);
          boneIdx++;
        }
        boneCountsRef.current[tier] = boneIdx;

        // === HEAD ===
        boneLocal('Head', _vec1);
        const headDiameter = bambooRadius * 1.2 * 2 * HEAD_WIDTH_RATIO;
        const headRadius = headDiameter / 2;
        const headHeight = headSize * HEAD_HEIGHT_RATIO;
        const headYOff = (headHeight - headSize) / 2;

        // Save local head pos for eyes and fire
        const headLocalX = _vec1.x;
        const headLocalY = _vec1.y;
        const headLocalZ = _vec1.z;

        _vec1.y += headYOff;
        _vec1.applyMatrix4(_mat4World);

        const headBone = skel.bonesByName.get('Head');
        _temp.position.copy(_vec1);
        _temp.scale.set(headRadius, headHeight, headRadius);
        _temp.rotation.set(0, s.rotationY, headBone ? headBone.rotation.z : 0);
        _temp.updateMatrix();
        const headIdx = headCountsRef.current[tier];
        headMesh.setMatrixAt(headIdx, _temp.matrix);
        headCountsRef.current[tier] = headIdx + 1;

        // === EYES ===
        const eyeWidth = headDiameter * EYE_WIDTH_RATIO;
        const eyeHeight = headDiameter * EYE_HEIGHT_RATIO;
        const eyeSep = headDiameter * EYE_SEPARATION;
        const pupilSz = eyeWidth * PUPIL_SIZE_RATIO;
        const outW = eyeWidth * EYE_OUTLINE_WIDTH;
        const eyeYOff = headHeight * EYE_VERTICAL_POS;
        const eyeZOff = headRadius + EYE_DEPTH;
        const headCY = headLocalY + headYOff;

        // Eye tracking logic
        const currentTimeMs = Date.now();
        const nearestPlayer = playerTracker.getNearestPlayer(s.position, EYE_TRACKING_RANGE);
        const eyeWorldY = s.position.y + headCY + eyeYOff;

        if (nearestPlayer) {
          s.eyeState.isTrackingPlayer = true;
          s.eyeState.trackedPlayerId = nearestPlayer.id;
          const pdx = nearestPlayer.position.x - s.position.x;
          const pdy = nearestPlayer.position.y - eyeWorldY;
          const pdz = nearestPlayer.position.z - s.position.z;
          let lookAngle = Math.atan2(pdx, pdz) - s.rotationY;
          while (lookAngle > Math.PI) lookAngle -= Math.PI * 2;
          while (lookAngle < -Math.PI) lookAngle += Math.PI * 2;
          const maxA = Math.PI / 2;
          s.eyeState.targetOffset.x = Math.max(-1, Math.min(1, lookAngle / maxA));
          const hDist = Math.sqrt(pdx * pdx + pdz * pdz);
          if (hDist > 0.1) {
            s.eyeState.targetOffset.y = Math.max(-1, Math.min(1, Math.atan2(pdy, hDist) / maxA));
          }
        } else {
          s.eyeState.isTrackingPlayer = false;
          s.eyeState.trackedPlayerId = null;
          if (currentTimeMs - s.eyeState.lastTargetChangeAt > RANDOM_LOOK_INTERVAL_MS) {
            s.eyeState.targetOffset.x = (Math.random() * 2 - 1) * RANDOM_LOOK_VARIANCE;
            s.eyeState.targetOffset.y = (Math.random() * 2 - 1) * RANDOM_LOOK_VARIANCE * 0.5;
            s.eyeState.lastTargetChangeAt = currentTimeMs;
          }
        }

        const lf = Math.min(1, PUPIL_LERP_SPEED * deltaSeconds);
        s.eyeState.leftPupilOffset.x += (s.eyeState.targetOffset.x - s.eyeState.leftPupilOffset.x) * lf;
        s.eyeState.leftPupilOffset.y += (s.eyeState.targetOffset.y - s.eyeState.leftPupilOffset.y) * lf;
        s.eyeState.rightPupilOffset.x += (s.eyeState.targetOffset.x - s.eyeState.rightPupilOffset.x) * lf;
        s.eyeState.rightPupilOffset.y += (s.eyeState.targetOffset.y - s.eyeState.rightPupilOffset.y) * lf;

        const pRangeX = (eyeWidth - pupilSz) / 2 * 0.8;
        const pRangeY = (eyeHeight - pupilSz) / 2 * 0.8;

        const eyeCY = headCY + eyeYOff;
        const eyeCZ = headLocalZ + eyeZOff;
        const leftCX = headLocalX - eyeSep / 2;
        const rightCX = headLocalX + eyeSep / 2;

        // Helper: set eye instance from local-space position and scale
        const setEye = (lx: number, ly: number, lz: number, sx: number, sy: number, col: THREE.Color) => {
          _vec2.set(lx, ly, lz).applyMatrix4(_mat4World);
          _temp.position.copy(_vec2);
          _temp.scale.set(sx, sy, 1);
          _temp.rotation.set(0, s.rotationY, 0);
          _temp.updateMatrix();
          eyesMesh.setMatrixAt(eyeIdx, _temp.matrix);
          eyesMesh.setColorAt(eyeIdx, col);
          eyeIdx++;
        };

        // Left eye: outline, white, pupil
        setEye(leftCX, eyeCY, eyeCZ - 0.001,
          (eyeWidth + outW * 2) / 2, (eyeHeight + outW * 2) / 2, _colorBlack);
        setEye(leftCX, eyeCY, eyeCZ,
          eyeWidth / 2, eyeHeight / 2, _colorWhite);
        setEye(
          leftCX + s.eyeState.leftPupilOffset.x * pRangeX,
          eyeCY + s.eyeState.leftPupilOffset.y * pRangeY,
          eyeCZ + 0.001,
          pupilSz / 2, pupilSz / 2, _colorBlack);

        // Right eye: outline, white, pupil
        setEye(rightCX, eyeCY, eyeCZ - 0.001,
          (eyeWidth + outW * 2) / 2, (eyeHeight + outW * 2) / 2, _colorBlack);
        setEye(rightCX, eyeCY, eyeCZ,
          eyeWidth / 2, eyeHeight / 2, _colorWhite);
        setEye(
          rightCX + s.eyeState.rightPupilOffset.x * pRangeX,
          eyeCY + s.eyeState.rightPupilOffset.y * pRangeY,
          eyeCZ + 0.001,
          pupilSz / 2, pupilSz / 2, _colorBlack);

        // === FIRE HAIR for T5-T10 ===
        if (s.tier >= 5 && universalFlameRef?.current) {
          const headTopLocalY = headLocalY + headYOff + headHeight / 2;
          let headTopWorldPos = headPositionsRef.current.get(s.id);
          if (!headTopWorldPos) {
            headTopWorldPos = new THREE.Vector3();
            headPositionsRef.current.set(s.id, headTopWorldPos);
          }
          headTopWorldPos.set(s.position.x, s.position.y + headTopLocalY, s.position.z);

          const fireConfig = FIRE_HAIR_CONFIG[s.tier];
          if (fireConfig) {
            if (!headFlamesRef.current.has(s.id)) {
              const flameId = universalFlameRef.current.spawnFlame({
                type: 'point',
                position: headTopWorldPos.clone(),
                colors: fireConfig.colors,
                size: fireConfig.baseSize * s.scale,
                height: fireConfig.baseHeight * s.scale,
                duration: 999999,
                particleCount: FIRE_HAIR_PARTICLE_COUNT,
                attachTo: `shtickman_head_${s.id}`,
                colorMode: fireConfig.colorMode,
              });
              headFlamesRef.current.set(s.id, flameId);
            } else {
              universalFlameRef.current.updateAttachedPosition(
                `shtickman_head_${s.id}`,
                headTopWorldPos
              );
            }
          }
        }
      }

      // Set instance counts and mark updates for each tier (1-indexed)
      for (let tier = 1; tier <= NUM_TIERS; tier++) {
        const bm = boneMeshRefs.current[tier];
        const hm = headMeshRefs.current[tier];
        if (bm) {
          bm.count = boneCountsRef.current[tier];
          if (bm.count > 0) bm.instanceMatrix.needsUpdate = true;
        }
        if (hm) {
          hm.count = headCountsRef.current[tier];
          if (hm.count > 0) hm.instanceMatrix.needsUpdate = true;
        }
      }

      eyesMesh.count = eyeIdx;
      eyesMesh.instanceMatrix.needsUpdate = true;
      if (eyesMesh.instanceColor) eyesMesh.instanceColor.needsUpdate = true;

      // Clean up flames for dead shtickmen
      if (universalFlameRef?.current) {
        for (const [id, flameId] of headFlamesRef.current.entries()) {
          if (!activeIds.has(id)) {
            universalFlameRef.current.removeFlame(flameId);
            headFlamesRef.current.delete(id);
            headPositionsRef.current.delete(id);
          }
        }
      }
    });

    // Render meshes for tiers 1-10 (skip index 0)
    const tierIndices = Array.from({ length: NUM_TIERS }, (_, i) => i + 1); // [1, 2, 3, ..., 10]

    return (
      <group>
        {tierIndices.map((tier) => (
          <React.Fragment key={tier}>
            <instancedMesh
              ref={(el) => { boneMeshRefs.current[tier] = el; }}
              args={[boneGeo, tierMaterials[tier], MAX_BONE_INSTANCES_PER_TIER]}
              frustumCulled={false}
            />
            <instancedMesh
              ref={(el) => { headMeshRefs.current[tier] = el; }}
              args={[headGeo, tierMaterials[tier], MAX_HEAD_INSTANCES_PER_TIER]}
              frustumCulled={false}
            />
          </React.Fragment>
        ))}
        <instancedMesh ref={eyesMeshRef} args={[eyeGeo, eyeMat, MAX_EYE_INSTANCES]} frustumCulled={false} />
      </group>
    );
  }
);

ShtickmanRenderer.displayName = 'ShtickmanRenderer';
