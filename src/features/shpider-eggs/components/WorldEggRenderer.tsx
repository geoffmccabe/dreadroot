// World-egg renderer.
//
// Per-egg group: translucent shell containing a miniature version of
// the big shpider. Reuses the big shpider's leg math, head-slide,
// eyelash + mandible geometries, and eye structure — just smaller
// and centered inside the egg's sphere.

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import type { WorldEgg } from '../hooks/useWorldEggs';
import { EGG_PICKUP_REACH } from '../hooks/useWorldEggs';
import type { ShpiderDefinition } from '@/features/shpider/types';
import { LEGS_PER_SHPIDER, SEGMENTS_PER_LEG, LEG_SEGMENT_THICKNESS } from '@/features/shpider/constants';
import { getSegmentEndpoints, HEAD_SLIDE_HZ } from '@/features/shpider/lib/legGeometry';
import {
  EYELASH_GEOMETRY,
  MANDIBLE_GEOMETRY,
  MANDIBLE_OPEN_ANGLE,
} from '@/features/shpider/lib/shpiderGeometry';

interface Props {
  eggs: WorldEgg[];
  definitions: ShpiderDefinition[];
  cameraRef?: React.RefObject<THREE.Camera | null>;
}

const NUM_TIERS = 10;
const FALLBACK_TEX = '/Bamboo_Seamless_t1.webp';

// Outer shell.
const SHELL_RADIUS = 0.22;

// Mini-shpider body — 20% smaller than the previous v4.1.4 sizing
// (0.13 → 0.104). The body cube is centered at the sphere center so
// the whole shpider sits inside the shell symmetrically.
const MINI_BODY_SIZE = 0.104;
const MINI_HEAD_SIZE = MINI_BODY_SIZE * 0.65; // ~0.068
const MINI_LEG_THICKNESS = LEG_SEGMENT_THICKNESS * MINI_BODY_SIZE; // ~0.0156 — matches big shpider's 15%-of-body ratio

// Eye proportions (from big shpider).
const EYE_WIDTH_RATIO = 0.55;
const EYE_HEIGHT_RATIO = 0.30;
const EYE_LOCAL_Y_RATIO = -0.10;
const EYE_PUPIL_RADIUS_RATIO = 0.08;

// Float animation.
const FLOAT_HEIGHT = 0.4;
const FLOAT_AMPLITUDE = 0.08;
const FLOAT_FREQ = 1.6;
const SHELL_TUMBLE_HZ = 0.35;

export function WorldEggRenderer({ eggs, definitions, cameraRef }: Props) {
  const defsByTier = useMemo(() => {
    const arr: (ShpiderDefinition | null)[] = new Array(NUM_TIERS + 1).fill(null);
    for (const d of definitions) {
      if (d.tier >= 1 && d.tier <= NUM_TIERS) arr[d.tier] = d;
    }
    return arr;
  }, [definitions]);

  // Body + head share the body texture; legs use leg texture if available.
  const bodyUrls = useMemo(() => {
    const arr: string[] = [];
    for (let t = 1; t <= NUM_TIERS; t++) {
      arr.push(defsByTier[t]?.body_texture_url || FALLBACK_TEX);
    }
    return arr;
  }, [defsByTier]);
  const legUrls = useMemo(() => {
    const arr: string[] = [];
    for (let t = 1; t <= NUM_TIERS; t++) {
      arr.push(defsByTier[t]?.leg_texture_url || defsByTier[t]?.body_texture_url || FALLBACK_TEX);
    }
    return arr;
  }, [defsByTier]);

  const bodyTexs = useLoader(THREE.TextureLoader, bodyUrls);
  const legTexs = useLoader(THREE.TextureLoader, legUrls);
  useEffect(() => {
    [...bodyTexs, ...legTexs].forEach(t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearMipMapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
    });
  }, [bodyTexs, legTexs]);

  // Geometries.
  const shellGeometry = useMemo(
    () => new THREE.SphereGeometry(SHELL_RADIUS, 18, 14),
    [],
  );
  const bodyGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const headGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const legGeometry = useMemo(
    () => new THREE.BoxGeometry(MINI_LEG_THICKNESS, 1, MINI_LEG_THICKNESS),
    [],
  );
  const eyeGeometry = useMemo(() => new THREE.CircleGeometry(0.5, 18), []);

  // Per-tier materials.
  const shellMaterials = useMemo(
    () => bodyTexs.map(tex => new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.4,
      metalness: 0.1,
      emissive: '#1a1a1a',
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    })),
    [bodyTexs],
  );
  const bodyMaterials = useMemo(
    () => bodyTexs.map(tex => new THREE.MeshLambertMaterial({ map: tex })),
    [bodyTexs],
  );
  const legMaterials = useMemo(
    () => legTexs.map(tex => new THREE.MeshLambertMaterial({ map: tex })),
    [legTexs],
  );
  // Eyelashes + mandibles share the big shpider's dark chitin material.
  const chitinMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: new THREE.Color('#1a1a1f'),
      roughness: 0.55,
      metalness: 0.15,
    }),
    [],
  );
  const eyeWhiteMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    [],
  );
  const eyePupilMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    [],
  );

  // "Press F to pick up" prompt — above the closest in-range egg.
  const promptRef = useRef<THREE.Group | null>(null);
  const promptVisibleRef = useRef(false);
  const REACH_SQ = EGG_PICKUP_REACH * EGG_PICKUP_REACH;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const cam = cameraRef?.current;
    const prompt = promptRef.current;
    if (!cam || !prompt) return;

    const cx = cam.position.x, cz = cam.position.z;
    let bestEgg: WorldEgg | null = null;
    let bestSq = REACH_SQ;
    for (const e of eggs) {
      const dx = e.x - cx, dz = e.z - cz;
      const dsq = dx * dx + dz * dz;
      if (dsq < bestSq) { bestSq = dsq; bestEgg = e; }
    }
    if (bestEgg) {
      const bob = Math.sin(t * FLOAT_FREQ) * FLOAT_AMPLITUDE;
      prompt.position.set(bestEgg.x, bestEgg.y + FLOAT_HEIGHT + bob + 0.55, bestEgg.z);
      if (!promptVisibleRef.current) {
        prompt.visible = true;
        promptVisibleRef.current = true;
      }
    } else if (promptVisibleRef.current) {
      prompt.visible = false;
      promptVisibleRef.current = false;
    }
  });

  return (
    <>
      {eggs.map((egg, idx) => {
        const tierIdx = Math.max(0, Math.min(NUM_TIERS - 1, egg.tier - 1));
        return (
          <EggInstance
            key={egg.id}
            egg={egg}
            index={idx}
            shellGeometry={shellGeometry}
            bodyGeometry={bodyGeometry}
            headGeometry={headGeometry}
            legGeometry={legGeometry}
            eyeGeometry={eyeGeometry}
            shellMaterial={shellMaterials[tierIdx]}
            bodyMaterial={bodyMaterials[tierIdx]}
            legMaterial={legMaterials[tierIdx]}
            chitinMaterial={chitinMaterial}
            eyeWhiteMaterial={eyeWhiteMaterial}
            eyePupilMaterial={eyePupilMaterial}
          />
        );
      })}

      <group ref={promptRef} visible={false}>
        <Text
          fontSize={0.18}
          color="white"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.018}
          outlineColor="black"
        >
          Press F to pick up
        </Text>
      </group>
    </>
  );
}

interface InstanceProps {
  egg: WorldEgg;
  index: number;
  shellGeometry: THREE.BufferGeometry;
  bodyGeometry: THREE.BufferGeometry;
  headGeometry: THREE.BufferGeometry;
  legGeometry: THREE.BufferGeometry;
  eyeGeometry: THREE.BufferGeometry;
  shellMaterial: THREE.Material;
  bodyMaterial: THREE.Material;
  legMaterial: THREE.Material;
  chitinMaterial: THREE.Material;
  eyeWhiteMaterial: THREE.Material;
  eyePupilMaterial: THREE.Material;
}

// Shared scratch — one set across all eggs (only touched inside a
// single useFrame so no concurrency).
const _segScratch = { start: new THREE.Vector3(), end: new THREE.Vector3() };
const _segMid = new THREE.Vector3();
const _segDir = new THREE.Vector3();
const _segUp = new THREE.Vector3(0, 1, 0);

function EggInstance({
  egg, index,
  shellGeometry, bodyGeometry, headGeometry, legGeometry, eyeGeometry,
  shellMaterial, bodyMaterial, legMaterial,
  chitinMaterial, eyeWhiteMaterial, eyePupilMaterial,
}: InstanceProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyMeshRef = useRef<THREE.Mesh>(null);
  const headMeshRef = useRef<THREE.Mesh>(null);
  const eyelashMeshRef = useRef<THREE.Mesh>(null);
  const mandibleLeftRef = useRef<THREE.Mesh>(null);
  const mandibleRightRef = useRef<THREE.Mesh>(null);
  const eyeWhiteRef = useRef<THREE.Mesh>(null);
  const eyePupilRef = useRef<THREE.Mesh>(null);
  const legMeshRefs = useRef<(THREE.Mesh | null)[]>(
    new Array(LEGS_PER_SHPIDER * SEGMENTS_PER_LEG).fill(null),
  );

  // Per-egg deterministic random offsets.
  const legParams = useMemo(() => {
    let seed = 0;
    for (let i = 0; i < egg.id.length; i++) seed = (seed * 31 + egg.id.charCodeAt(i)) | 0;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) | 0;
      return ((seed >>> 0) / 0xffffffff);
    };
    const arr: { phase: number; freq: number; lift: number }[] = [];
    for (let i = 0; i < LEGS_PER_SHPIDER; i++) {
      arr.push({
        phase: rand() * Math.PI * 2,
        freq: 0.8 + rand() * 0.5,
        lift: 0.25 + rand() * 0.15,
      });
    }
    return arr;
  }, [egg.id]);
  const headSlidePhase = useMemo(() => {
    let seed = 0;
    for (let i = 0; i < egg.id.length; i++) seed = (seed * 17 + egg.id.charCodeAt(i)) | 0;
    return ((seed >>> 0) / 0xffffffff) * Math.PI * 2;
  }, [egg.id]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const phaseOffset = index * 1.7;

    // Outer group: egg world position + bob + slow tumble.
    const bob = Math.sin(t * FLOAT_FREQ + phaseOffset) * FLOAT_AMPLITUDE;
    if (groupRef.current) {
      groupRef.current.position.set(egg.x, egg.y + FLOAT_HEIGHT + bob, egg.z);
      groupRef.current.rotation.set(
        t * SHELL_TUMBLE_HZ * Math.PI * 2 + phaseOffset,
        t * 1.0,
        0,
      );
    }

    const halfBody = MINI_BODY_SIZE * 0.5;
    const halfHead = MINI_HEAD_SIZE * 0.5;

    // Body cube — CENTERED at sphere origin (y=0).
    if (bodyMeshRef.current) {
      bodyMeshRef.current.position.set(0, 0, 0);
      bodyMeshRef.current.scale.set(MINI_BODY_SIZE, MINI_BODY_SIZE, MINI_BODY_SIZE);
    }

    // Head Y = halfBody + halfHead (head sits flush on top of body).
    // Head Z = forward by bodySize*0.45 (matches big shpider), with a
    // sin slide of ±halfHead so the head visibly slides forward/back.
    const headLocalY = halfBody + halfHead;
    const slide = Math.sin(t * Math.PI * 2 * HEAD_SLIDE_HZ + headSlidePhase) * halfHead;
    const headForward = MINI_BODY_SIZE * 0.45 + slide;
    if (headMeshRef.current) {
      headMeshRef.current.position.set(0, headLocalY, headForward);
      headMeshRef.current.scale.set(MINI_HEAD_SIZE, MINI_HEAD_SIZE, MINI_HEAD_SIZE);
    }

    // Eyelashes — anchored a hair forward of head's front face.
    const eyelashOffset = halfHead + 0.002;
    if (eyelashMeshRef.current) {
      eyelashMeshRef.current.position.set(0, headLocalY, headForward + eyelashOffset);
      eyelashMeshRef.current.scale.set(MINI_HEAD_SIZE, MINI_HEAD_SIZE, MINI_HEAD_SIZE);
    }

    // Eye — football on head's front face, white body + black pupil.
    const eyeY = headLocalY + EYE_LOCAL_Y_RATIO * MINI_HEAD_SIZE;
    const eyeZ = headForward + halfHead + 0.001;
    const eyeW = EYE_WIDTH_RATIO * MINI_HEAD_SIZE;
    const eyeH = EYE_HEIGHT_RATIO * MINI_HEAD_SIZE;
    const eyePupilR = EYE_PUPIL_RADIUS_RATIO * MINI_HEAD_SIZE;
    if (eyeWhiteRef.current) {
      eyeWhiteRef.current.position.set(0, eyeY, eyeZ);
      eyeWhiteRef.current.scale.set(eyeW, eyeH, 1);
    }
    if (eyePupilRef.current) {
      eyePupilRef.current.position.set(0, eyeY, eyeZ + 0.0005);
      eyePupilRef.current.scale.set(eyePupilR * 2, eyePupilR * 2, 1);
    }

    // Mandibles — two cones at front-bottom of face, splayed outward.
    const mandY = headLocalY - MINI_HEAD_SIZE * 0.25;
    const mandZ = headForward + halfHead;
    if (mandibleLeftRef.current) {
      mandibleLeftRef.current.position.set(0, mandY, mandZ);
      mandibleLeftRef.current.rotation.set(0, MANDIBLE_OPEN_ANGLE, 0);
      mandibleLeftRef.current.scale.set(MINI_HEAD_SIZE, MINI_HEAD_SIZE, MINI_HEAD_SIZE);
    }
    if (mandibleRightRef.current) {
      mandibleRightRef.current.position.set(0, mandY, mandZ);
      mandibleRightRef.current.rotation.set(0, -MANDIBLE_OPEN_ANGLE, 0);
      // Mirror via -X scale so we get the opposite-side mandible.
      mandibleRightRef.current.scale.set(-MINI_HEAD_SIZE, MINI_HEAD_SIZE, MINI_HEAD_SIZE);
    }

    // Legs — 8 × 3 segments, same getSegmentEndpoints as big shpider.
    // Shift DOWN by halfBody so legs hang below body center.
    let meshIdx = 0;
    for (let leg = 0; leg < LEGS_PER_SHPIDER; leg++) {
      const lp = legParams[leg];
      for (let seg = 0; seg < SEGMENTS_PER_LEG; seg++, meshIdx++) {
        const m = legMeshRefs.current[meshIdx];
        if (!m) continue;
        getSegmentEndpoints(
          leg, seg, MINI_BODY_SIZE,
          null,   // no hop
          1.0,    // always walking
          lp.phase, lp.freq, lp.lift,
          t, _segScratch,
        );
        // getSegmentEndpoints assumes body bottom at y=0; we want body
        // CENTER at y=0, so shift the leg endpoints down by halfBody.
        _segScratch.start.y -= halfBody;
        _segScratch.end.y -= halfBody;

        _segMid.addVectors(_segScratch.start, _segScratch.end).multiplyScalar(0.5);
        _segDir.subVectors(_segScratch.end, _segScratch.start);
        const len = _segDir.length();
        if (len < 1e-4) continue;
        _segDir.normalize();

        m.position.copy(_segMid);
        m.quaternion.setFromUnitVectors(_segUp, _segDir);
        m.scale.set(1, len, 1);
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* Translucent outer shell */}
      <mesh geometry={shellGeometry} material={shellMaterial} renderOrder={2} />

      {/* Mini-shpider — body cube, head cube on top, 8 legs × 3
          segments, eyelashes, eye, two mandibles. */}
      <mesh ref={bodyMeshRef} geometry={bodyGeometry} material={bodyMaterial} />
      <mesh ref={headMeshRef} geometry={headGeometry} material={bodyMaterial} />
      <mesh ref={eyelashMeshRef} geometry={EYELASH_GEOMETRY} material={chitinMaterial} />
      <mesh ref={mandibleLeftRef} geometry={MANDIBLE_GEOMETRY} material={chitinMaterial} />
      <mesh ref={mandibleRightRef} geometry={MANDIBLE_GEOMETRY} material={chitinMaterial} />
      <mesh ref={eyeWhiteRef} geometry={eyeGeometry} material={eyeWhiteMaterial} />
      <mesh ref={eyePupilRef} geometry={eyeGeometry} material={eyePupilMaterial} />
      {Array.from({ length: LEGS_PER_SHPIDER * SEGMENTS_PER_LEG }).map((_, i) => (
        <mesh
          key={i}
          ref={(m) => { legMeshRefs.current[i] = m; }}
          geometry={legGeometry}
          material={legMaterial}
        />
      ))}
    </group>
  );
}
