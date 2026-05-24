// ShpiderRenderer — Phase 4 (animated).
// Renders all active shpiders as InstancedMesh groups for body, head,
// leg segments, eyelashes, and mandibles. Drives the hop AI tick in
// the same useFrame so we only iterate the active list once.
//
// Animations covered here:
//   - Hop: linear X/Z + parabolic Y arc, Y(t) = sin(π t) × arcHeight.
//   - Head slide: oscillates forward/back along shpider facing by
//     ±headSize/2 (full headSize peak-to-peak), each shpider on its
//     own random phase.
//   - Legs: idle subtle bob + tuck-in / splay-out during the hop.
//   - Mandibles: per-shpider random click schedule, two cones snap
//     inward then back to rest.
//   - Eyelashes: static; 12 curved lashes arranged in an arc on the
//     head's front face. They don't move but they rotate with the
//     head (which is itself sliding).

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import type { ShpiderInstance } from '../types';
import { LEGS_PER_SHPIDER, SEGMENTS_PER_LEG, LEG_SEGMENT_THICKNESS } from '../constants';
import { stepShpiderHopAI, getHopProgress } from '../lib/hopAI';
import {
  EYELASH_GEOMETRY,
  MANDIBLE_GEOMETRY,
  MANDIBLE_OPEN_ANGLE,
  MANDIBLE_CLICK_DURATION_MS,
  MANDIBLE_MIN_CLICK_INTERVAL_MS,
  MANDIBLE_MAX_CLICK_INTERVAL_MS,
} from '../lib/shpiderGeometry';

const MAX_INSTANCES = 200;
const RENDER_DISTANCE = 80;
const RENDER_DISTANCE_SQ = RENDER_DISTANCE * RENDER_DISTANCE;

const MAX_LEG_INSTANCES = MAX_INSTANCES * LEGS_PER_SHPIDER * SEGMENTS_PER_LEG;
const MAX_MANDIBLE_INSTANCES = MAX_INSTANCES * 2;

// Head slide: ~1 Hz oscillator. Amplitude = headSize / 2, so peak to
// peak = full head width — matches the user's spec.
const HEAD_SLIDE_HZ = 1.1;

// Reused scratch.
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _surfaceQuat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _legDir = new THREE.Vector3();
const _segStart = new THREE.Vector3();
const _segEnd = new THREE.Vector3();
const _segMid = new THREE.Vector3();
const _worldRot = new THREE.Quaternion();
const _forwardWorld = new THREE.Vector3();
const _upWorld = new THREE.Vector3();
const _rightWorld = new THREE.Vector3();
const _localPoint = new THREE.Vector3();

/** Triangle wave 0→1→0 over duration. */
function clickTriangle(t01: number): number {
  return t01 < 0.5 ? t01 * 2 : (1 - t01) * 2;
}

/**
 * Local-space endpoints for a leg segment, with animation modifiers
 * applied based on hop progress and the per-leg idle phase.
 */
function getSegmentEndpoints(
  legIdx: number,
  segmentIdx: number,
  bodySize: number,
  hopT: number | null, // 0..1 if hopping, else null
  legPhase: number,
  time: number,
  out: { start: THREE.Vector3; end: THREE.Vector3 },
): void {
  const a = (legIdx / LEGS_PER_SHPIDER) * Math.PI * 2 + 0.1;
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);
  const r = bodySize * 0.5;

  // Idle bob: each leg's foot dips slightly on its own phase.
  const idleBob = Math.sin(time * 1.5 + legPhase) * 0.03;

  // Hop modifier: tuck in at the peak of the arc, splay out as we land.
  let tuck = 0;
  let splay = 0;
  if (hopT != null) {
    // tuck peaks at midair (~hopT 0.4), inverted by landing.
    tuck = Math.sin(Math.PI * hopT) * 0.45;
    // splay kicks in near landing.
    splay = hopT > 0.75 ? (hopT - 0.75) * 4 * 0.25 : 0;
  }

  // Outward multiplier (1 = base, < 1 = tucked, > 1 = splayed).
  const outMul = 1 - tuck + splay;
  // Down multiplier: less downward reach when tucked, more when splayed.
  const downMul = 1 - tuck * 0.6 + splay * 0.3;

  const shoulderX = cosA * r;
  const shoulderZ = sinA * r;
  const shoulderY = 0;

  const elbowX = cosA * r * 2.0 * outMul;
  const elbowZ = sinA * r * 2.0 * outMul;
  const elbowY = -bodySize * 0.25 * downMul + idleBob * 0.3;

  const ankleX = cosA * r * 2.5 * outMul;
  const ankleZ = sinA * r * 2.5 * outMul;
  const ankleY = -bodySize * 0.75 * downMul + idleBob * 0.7;

  const footX = cosA * r * 2.5 * outMul;
  const footZ = sinA * r * 2.5 * outMul;
  const footY = -bodySize * 1.10 * downMul + idleBob;

  if (segmentIdx === 0) {
    out.start.set(shoulderX, shoulderY, shoulderZ);
    out.end.set(elbowX, elbowY, elbowZ);
  } else if (segmentIdx === 1) {
    out.start.set(elbowX, elbowY, elbowZ);
    out.end.set(ankleX, ankleY, ankleZ);
  } else {
    out.start.set(ankleX, ankleY, ankleZ);
    out.end.set(footX, footY, footZ);
  }
}

interface ShpiderRendererProps {
  shpidersRef: React.RefObject<ShpiderInstance[]>;
  cameraRef: React.RefObject<THREE.Camera | null>;
}

export function ShpiderRenderer({ shpidersRef, cameraRef }: ShpiderRendererProps) {
  // First-tier definition supplies the placeholder textures for now.
  const sample = shpidersRef.current?.[0]?.definition;
  const fallback = '/Bamboo_Seamless_t1.webp';
  const bodyTexUrl = sample?.body_texture_url ?? fallback;
  const legTexUrl  = sample?.leg_texture_url  ?? fallback;
  const faceTexUrl = sample?.face_texture_url ?? bodyTexUrl;

  const bodyTex = useLoader(THREE.TextureLoader, bodyTexUrl);
  const legTex  = useLoader(THREE.TextureLoader, legTexUrl);
  const faceTex = useLoader(THREE.TextureLoader, faceTexUrl);

  useEffect(() => {
    [bodyTex, legTex, faceTex].forEach(t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearMipMapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
    });
  }, [bodyTex, legTex, faceTex]);

  const bodyGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const headGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const legGeo  = useMemo(
    () => new THREE.BoxGeometry(LEG_SEGMENT_THICKNESS, 1, LEG_SEGMENT_THICKNESS),
    []
  );

  const bodyMat = useMemo(() => new THREE.MeshLambertMaterial({ map: bodyTex }), [bodyTex]);
  const headMat = useMemo(() => new THREE.MeshLambertMaterial({ map: bodyTex }), [bodyTex]);
  const legMat  = useMemo(() => new THREE.MeshLambertMaterial({ map: legTex }),  [legTex]);
  // Eyelashes + mandibles share a dark non-textured chitin colour.
  const chitinMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1a1a1f'),
    roughness: 0.55,
    metalness: 0.15,
  }), []);

  const bodyMeshRef     = useRef<THREE.InstancedMesh>(null);
  const headMeshRef     = useRef<THREE.InstancedMesh>(null);
  const legMeshRef      = useRef<THREE.InstancedMesh>(null);
  const eyelashMeshRef  = useRef<THREE.InstancedMesh>(null);
  const mandibleMeshRef = useRef<THREE.InstancedMesh>(null);

  const epScratch = useMemo(() => ({ start: new THREE.Vector3(), end: new THREE.Vector3() }), []);

  useFrame(({ clock }, delta) => {
    const list = shpidersRef.current;
    const camera = cameraRef.current;
    if (!list || !camera) return;
    const bodyMesh = bodyMeshRef.current;
    const headMesh = headMeshRef.current;
    const legMesh  = legMeshRef.current;
    const eyelashMesh  = eyelashMeshRef.current;
    const mandibleMesh = mandibleMeshRef.current;
    if (!bodyMesh || !headMesh || !legMesh || !eyelashMesh || !mandibleMesh) return;

    const now = Date.now();
    const t = clock.elapsedTime;
    const dt = Math.min(delta, 0.1);
    const playerX = camera.position.x;
    const playerY = camera.position.y;
    const playerZ = camera.position.z;

    let bodyCount = 0;
    let headCount = 0;
    let legCount  = 0;
    let eyelashCount  = 0;
    let mandibleCount = 0;

    for (const s of list) {
      if (!s.isActive) continue;

      // === AI tick. Mutates position/rotation/surfaceNormal. ===
      stepShpiderHopAI(s, { now, dt, playerX, playerY, playerZ });

      const dx = s.position.x - playerX;
      const dz = s.position.z - playerZ;
      if (dx * dx + dz * dz > RENDER_DISTANCE_SQ) continue;
      if (bodyCount >= MAX_INSTANCES) break;

      const def = s.definition;
      const bodySize = def.body_size * s.scale;
      const headSize = def.head_size * s.scale;
      const halfBody = bodySize * 0.5;

      // === Build the shpider's world transform once per shpider. ===
      // surfaceNormal becomes the body's local +Y; `rotation` is yaw
      // around that local +Y. Combined quaternion = align × yaw.
      _surfaceQuat.setFromUnitVectors(_yAxis, s.surfaceNormal);
      _yawQuat.setFromAxisAngle(_yAxis, s.rotation);
      _quat.copy(_surfaceQuat).multiply(_yawQuat);

      // === Body ===
      // Body center sits half-body-distance ABOVE the surface (along
      // local +Y in world space = surfaceNormal direction).
      _localPoint.set(0, halfBody, 0).applyQuaternion(_quat);
      _pos.set(
        s.position.x + _localPoint.x,
        s.position.y + _localPoint.y,
        s.position.z + _localPoint.z,
      );
      _scale.set(bodySize, bodySize, bodySize);
      _mat.compose(_pos, _quat, _scale);
      bodyMesh.setMatrixAt(bodyCount++, _mat);

      // === Head ===
      const slide = Math.sin(t * Math.PI * 2 * HEAD_SLIDE_HZ + s.headSlidePhase) * (headSize * 0.5);
      const headForwardBase = bodySize * 0.45;
      const headForward = headForwardBase + slide;
      const headLocalY = bodySize + headSize * 0.5;

      _localPoint.set(0, headLocalY, headForward).applyQuaternion(_quat);
      _pos.set(
        s.position.x + _localPoint.x,
        s.position.y + _localPoint.y,
        s.position.z + _localPoint.z,
      );
      _scale.set(headSize, headSize, headSize);
      _mat.compose(_pos, _quat, _scale);
      headMesh.setMatrixAt(headCount++, _mat);

      // Stash the head world position for eyelash + mandible offsets.
      const headWorldX = _pos.x;
      const headWorldY = _pos.y;
      const headWorldZ = _pos.z;

      // === Eyelashes ===
      // Anchor a hair forward of the head's front face.
      const eyelashOffset = headSize * 0.5 + 0.005;
      _localPoint.set(0, headLocalY, headForward + eyelashOffset).applyQuaternion(_quat);
      _pos.set(
        s.position.x + _localPoint.x,
        s.position.y + _localPoint.y,
        s.position.z + _localPoint.z,
      );
      _scale.set(headSize, headSize, headSize);
      _mat.compose(_pos, _quat, _scale);
      eyelashMesh.setMatrixAt(eyelashCount++, _mat);

      // === Mandibles ===
      if (s.mandibleClickStartedAt === 0 && now >= s.nextMandibleClickAt) {
        s.mandibleClickStartedAt = now;
      }
      let clickPhase = 0;
      if (s.mandibleClickStartedAt > 0) {
        const elapsed = now - s.mandibleClickStartedAt;
        if (elapsed >= MANDIBLE_CLICK_DURATION_MS) {
          s.mandibleClickStartedAt = 0;
          s.nextMandibleClickAt = now + MANDIBLE_MIN_CLICK_INTERVAL_MS
            + Math.random() * (MANDIBLE_MAX_CLICK_INTERVAL_MS - MANDIBLE_MIN_CLICK_INTERVAL_MS);
        } else {
          clickPhase = clickTriangle(elapsed / MANDIBLE_CLICK_DURATION_MS);
        }
      }
      const splay = MANDIBLE_OPEN_ANGLE * (1 - clickPhase);

      // Mandibles attach to the front-center of the face and point
      // outward (+Z forward in local frame). They fan left/right by
      // rotating around the local +Y (up) axis; click animation
      // collapses that splay to 0 so the two cones meet.
      const mandibleLocalY = headLocalY - headSize * 0.25;
      const mandibleLocalZ = headForward + headSize * 0.5;
      _localPoint.set(0, mandibleLocalY, mandibleLocalZ).applyQuaternion(_quat);
      _pos.set(
        s.position.x + _localPoint.x,
        s.position.y + _localPoint.y,
        s.position.z + _localPoint.z,
      );

      for (let side = 0; side < 2; side++) {
        if (mandibleCount >= MAX_MANDIBLE_INSTANCES) break;
        const sideSign = side === 0 ? -1 : 1;

        // Splay around local +Y axis so mandibles fan to either side.
        _worldRot.copy(_quat);
        const yawQ = new THREE.Quaternion().setFromAxisAngle(_yAxis, sideSign * splay);
        _worldRot.multiply(yawQ);

        // Mirror the right mandible's geometry (which is authored
        // bending toward +X) by flipping its X scale.
        _scale.set(sideSign === -1 ? headSize : -headSize, headSize, headSize);
        _mat.compose(_pos, _worldRot, _scale);
        mandibleMesh.setMatrixAt(mandibleCount++, _mat);
      }

      // === Legs ===
      const hopT = getHopProgress(s, now);
      for (let leg = 0; leg < LEGS_PER_SHPIDER; leg++) {
        for (let seg = 0; seg < SEGMENTS_PER_LEG; seg++) {
          if (legCount >= MAX_LEG_INSTANCES) break;

          getSegmentEndpoints(leg, seg, bodySize, hopT, s.legPhaseOffsets[leg], t, epScratch);

          // Local endpoints are in shpider-local space (Y up, Z forward,
          // but oriented relative to the body, not the world). Apply the
          // combined surface+yaw quat to bring them to world space, then
          // translate by the shpider's body center.
          _segStart.copy(epScratch.start).applyQuaternion(_quat);
          _segStart.x += s.position.x;
          _segStart.y += s.position.y + halfBody;
          _segStart.z += s.position.z;

          _segEnd.copy(epScratch.end).applyQuaternion(_quat);
          _segEnd.x += s.position.x;
          _segEnd.y += s.position.y + halfBody;
          _segEnd.z += s.position.z;

          _segMid.addVectors(_segStart, _segEnd).multiplyScalar(0.5);
          _legDir.subVectors(_segEnd, _segStart);
          const segLength = _legDir.length();
          if (segLength < 0.0001) continue;
          _legDir.normalize();

          _worldRot.setFromUnitVectors(_yAxis, _legDir);
          _scale.set(1, segLength, 1);
          _mat.compose(_segMid, _worldRot, _scale);
          legMesh.setMatrixAt(legCount++, _mat);
        }
      }
    }

    bodyMesh.count = bodyCount;
    headMesh.count = headCount;
    legMesh.count = legCount;
    eyelashMesh.count = eyelashCount;
    mandibleMesh.count = mandibleCount;
    bodyMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    legMesh.instanceMatrix.needsUpdate = true;
    eyelashMesh.instanceMatrix.needsUpdate = true;
    mandibleMesh.instanceMatrix.needsUpdate = true;

    bodyMesh.visible = bodyCount > 0;
    headMesh.visible = headCount > 0;
    legMesh.visible = legCount > 0;
    eyelashMesh.visible = eyelashCount > 0;
    mandibleMesh.visible = mandibleCount > 0;
  });

  return (
    <>
      <instancedMesh
        ref={bodyMeshRef}
        args={[bodyGeo, bodyMat, MAX_INSTANCES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={headMeshRef}
        args={[headGeo, headMat, MAX_INSTANCES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={legMeshRef}
        args={[legGeo, legMat, MAX_LEG_INSTANCES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={eyelashMeshRef}
        args={[EYELASH_GEOMETRY, chitinMat, MAX_INSTANCES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={mandibleMeshRef}
        args={[MANDIBLE_GEOMETRY, chitinMat, MAX_MANDIBLE_INSTANCES]}
        frustumCulled={false}
      />
    </>
  );
}
