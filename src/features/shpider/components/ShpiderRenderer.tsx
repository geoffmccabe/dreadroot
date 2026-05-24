// ShpiderRenderer — Phase 3 (static).
// Renders all active shpiders as 3 InstancedMesh groups: body cube,
// head cube, leg segments. No animation yet — legs sit in a fixed
// 8-spoke idle pose; head sits on top of body, oriented forward.
// The hop AI (Phase 4) will start writing per-frame matrices that
// move the body + interpolate leg segments.

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import type { ShpiderInstance } from '../types';
import { LEGS_PER_SHPIDER, SEGMENTS_PER_LEG, LEG_SEGMENT_THICKNESS } from '../constants';

const MAX_INSTANCES = 200;
const RENDER_DISTANCE = 80;
const RENDER_DISTANCE_SQ = RENDER_DISTANCE * RENDER_DISTANCE;

// Number of leg-segment instances per shpider × max shpiders.
const MAX_LEG_INSTANCES = MAX_INSTANCES * LEGS_PER_SHPIDER * SEGMENTS_PER_LEG;

// Reused per-frame scratch — never allocated inside the loop.
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _legDir = new THREE.Vector3();
const _segStart = new THREE.Vector3();
const _segEnd = new THREE.Vector3();
const _segMid = new THREE.Vector3();
const _localRot = new THREE.Quaternion();
const _worldRot = new THREE.Quaternion();
const _outward = new THREE.Vector3();
const _hipLocal = new THREE.Vector3();

/** Compute the in-shpider-local-space midpoint of a leg segment. */
function getSegmentEndpoints(
  legIdx: number,
  segmentIdx: number,
  bodySize: number,
): { start: THREE.Vector3; end: THREE.Vector3 } {
  const a = (legIdx / LEGS_PER_SHPIDER) * Math.PI * 2 + 0.1;
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);
  const r = bodySize * 0.5; // body radius (assuming cubic body)

  // Three control points along the leg in local space:
  //   shoulder (body surface) → elbow (outward + slight down) → ankle
  //   (further outward + further down) → foot (straight down).
  // 4 control points → 3 segments.
  const shoulder = new THREE.Vector3(cosA * r,         0,                sinA * r);
  const elbow    = new THREE.Vector3(cosA * r * 2.0,  -bodySize * 0.25,  sinA * r * 2.0);
  const ankle    = new THREE.Vector3(cosA * r * 2.5,  -bodySize * 0.75,  sinA * r * 2.5);
  const foot     = new THREE.Vector3(cosA * r * 2.5,  -bodySize * 1.10,  sinA * r * 2.5);

  if (segmentIdx === 0) return { start: shoulder, end: elbow };
  if (segmentIdx === 1) return { start: elbow,    end: ankle };
  return { start: ankle, end: foot };
}

interface ShpiderRendererProps {
  shpidersRef: React.RefObject<ShpiderInstance[]>;
  cameraRef: React.RefObject<THREE.Camera | null>;
}

export function ShpiderRenderer({ shpidersRef, cameraRef }: ShpiderRendererProps) {
  // Resolve which texture to display. For Phase 3, every shpider shares
  // the first tier-1 definition's textures (placeholder copies of the
  // matching-tier Shombie textures). Phase 7 polish handles per-tier.
  const fallbackBodyUrl = '/Bamboo_Seamless_t1.webp';
  const fallbackLegUrl  = '/Bamboo_Seamless_t1.webp';
  const sample = shpidersRef.current?.[0]?.definition;
  const bodyTexUrl = sample?.body_texture_url ?? fallbackBodyUrl;
  const legTexUrl  = sample?.leg_texture_url  ?? fallbackLegUrl;

  const bodyTex = useLoader(THREE.TextureLoader, bodyTexUrl);
  const legTex  = useLoader(THREE.TextureLoader, legTexUrl);

  useEffect(() => {
    [bodyTex, legTex].forEach(t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearMipMapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
    });
  }, [bodyTex, legTex]);

  const bodyGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const headGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const legGeo  = useMemo(
    () => new THREE.BoxGeometry(LEG_SEGMENT_THICKNESS, 1, LEG_SEGMENT_THICKNESS),
    []
  );

  const bodyMat = useMemo(() => new THREE.MeshLambertMaterial({ map: bodyTex }), [bodyTex]);
  const headMat = useMemo(() => new THREE.MeshLambertMaterial({ map: bodyTex }), [bodyTex]);
  const legMat  = useMemo(() => new THREE.MeshLambertMaterial({ map: legTex }),  [legTex]);

  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
  const headMeshRef = useRef<THREE.InstancedMesh>(null);
  const legMeshRef  = useRef<THREE.InstancedMesh>(null);

  useFrame(() => {
    const list = shpidersRef.current;
    const camera = cameraRef.current;
    if (!list || !camera) return;
    const bodyMesh = bodyMeshRef.current;
    const headMesh = headMeshRef.current;
    const legMesh  = legMeshRef.current;
    if (!bodyMesh || !headMesh || !legMesh) return;

    let bodyCount = 0;
    let headCount = 0;
    let legCount  = 0;

    for (const s of list) {
      if (!s.isActive) continue;

      // Cheap culling. Phase 4 will hook this into the shared frustum
      // helper alongside the other enemies.
      const dx = s.position.x - camera.position.x;
      const dz = s.position.z - camera.position.z;
      if (dx * dx + dz * dz > RENDER_DISTANCE_SQ) continue;
      if (bodyCount >= MAX_INSTANCES) break;

      const def = s.definition;
      const bodySize = def.body_size * s.scale;
      const headSize = def.head_size * s.scale;
      // Body sits with its bottom at y=0 → center y = bodySize/2.
      const bodyY = bodySize * 0.5;
      // Head pops out the top of the body, biased forward by half-head.
      const headY = bodySize + headSize * 0.5;
      const headForward = bodySize * 0.45;

      // Body matrix
      _pos.set(s.position.x, s.position.y + bodyY, s.position.z);
      _quat.setFromAxisAngle(_yAxis, s.rotation);
      _scale.set(bodySize, bodySize, bodySize);
      _mat.compose(_pos, _quat, _scale);
      bodyMesh.setMatrixAt(bodyCount++, _mat);

      // Head matrix — offset forward in the shpider's facing direction.
      const cosR = Math.cos(s.rotation);
      const sinR = Math.sin(s.rotation);
      // Forward in world = (sin(rot), 0, cos(rot)) using Three.js's
      // standard -Z-forward convention and the rotation-around-Y axis.
      const fx = Math.sin(s.rotation);
      const fz = Math.cos(s.rotation);
      _pos.set(
        s.position.x + fx * headForward,
        s.position.y + headY,
        s.position.z + fz * headForward,
      );
      _scale.set(headSize, headSize, headSize);
      _mat.compose(_pos, _quat, _scale);
      headMesh.setMatrixAt(headCount++, _mat);

      // 8 legs × 3 segments. Each segment is a box of length =
      // |end-start| in shpider-local space, rotated to align its
      // Y axis with the world direction.
      for (let leg = 0; leg < LEGS_PER_SHPIDER; leg++) {
        for (let seg = 0; seg < SEGMENTS_PER_LEG; seg++) {
          if (legCount >= MAX_LEG_INSTANCES) break;

          const { start: localStart, end: localEnd } = getSegmentEndpoints(leg, seg, bodySize);

          // Rotate local-space points around shpider Y axis by s.rotation,
          // then offset by shpider position.
          _segStart.set(
            localStart.x * cosR + localStart.z * sinR,
            localStart.y,
            -localStart.x * sinR + localStart.z * cosR,
          ).add(s.position).add(new THREE.Vector3(0, bodyY, 0));
          _segEnd.set(
            localEnd.x * cosR + localEnd.z * sinR,
            localEnd.y,
            -localEnd.x * sinR + localEnd.z * cosR,
          ).add(s.position).add(new THREE.Vector3(0, bodyY, 0));

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
    legMesh.count  = legCount;
    bodyMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    legMesh.instanceMatrix.needsUpdate  = true;

    // Hide entirely when nothing is visible (avoids a draw call).
    bodyMesh.visible = bodyCount > 0;
    headMesh.visible = headCount > 0;
    legMesh.visible  = legCount  > 0;
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
    </>
  );
}
