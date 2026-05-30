// World-egg renderer.
//
// Per-egg group: translucent shell containing a miniature version of
// the big shpider — body cube, head cube on top with sliding
// animation, 8 legs × 3 segments each animated by the SAME
// getSegmentEndpoints function the big shpider uses. Just smaller.

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import type { WorldEgg } from '../hooks/useWorldEggs';
import { EGG_PICKUP_REACH } from '../hooks/useWorldEggs';
import type { ShpiderDefinition } from '@/features/shpider/types';
import { LEGS_PER_SHPIDER, SEGMENTS_PER_LEG, LEG_SEGMENT_THICKNESS } from '@/features/shpider/constants';
import { getSegmentEndpoints, HEAD_SLIDE_HZ } from '@/features/shpider/lib/legGeometry';

interface Props {
  eggs: WorldEgg[];
  definitions: ShpiderDefinition[];
  cameraRef?: React.RefObject<THREE.Camera | null>;
}

const NUM_TIERS = 10;
const FALLBACK_TEX = '/Bamboo_Seamless_t1.webp';

// Outer shell.
const SHELL_RADIUS = 0.22;

// Mini-shpider body — sized to fit (with head + legs) inside the
// shell. Big shpiders use bodySize from their definition (e.g. ~1.0);
// here we just use a fixed small bodySize.
const MINI_BODY_SIZE = 0.13;
const MINI_HEAD_SIZE = MINI_BODY_SIZE * 0.65;
const MINI_LEG_THICKNESS_SCALE = 0.45; // scale the big shpider's leg thickness down

// Animation.
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

  // Both shell + body + head use the BODY texture (matches the big
  // shpider — body and head share the same body texture). Legs use
  // the LEG texture per tier when available; fallback to body tex.
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

  // Geometries — unit cubes scaled per-instance to match the big shpider.
  const shellGeometry = useMemo(
    () => new THREE.SphereGeometry(SHELL_RADIUS, 18, 14),
    [],
  );
  const bodyGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const headGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const legGeometry = useMemo(
    () => new THREE.BoxGeometry(
      LEG_SEGMENT_THICKNESS * MINI_LEG_THICKNESS_SCALE,
      1,
      LEG_SEGMENT_THICKNESS * MINI_LEG_THICKNESS_SCALE,
    ),
    [],
  );

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
            shellMaterial={shellMaterials[tierIdx]}
            bodyMaterial={bodyMaterials[tierIdx]}
            legMaterial={legMaterials[tierIdx]}
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
  shellMaterial: THREE.Material;
  bodyMaterial: THREE.Material;
  legMaterial: THREE.Material;
}

// Scratch vectors per leg-segment placement, reused across all eggs
// (one per frame so we don't allocate new Vector3s per leg per egg).
const _segScratch = { start: new THREE.Vector3(), end: new THREE.Vector3() };
const _segMid = new THREE.Vector3();
const _segDir = new THREE.Vector3();
const _segUp = new THREE.Vector3(0, 1, 0);

function EggInstance({
  egg, index,
  shellGeometry, bodyGeometry, headGeometry, legGeometry,
  shellMaterial, bodyMaterial, legMaterial,
}: InstanceProps) {
  const groupRef = useRef<THREE.Group>(null);
  const shpiderGroupRef = useRef<THREE.Group>(null);
  const bodyMeshRef = useRef<THREE.Mesh>(null);
  const headMeshRef = useRef<THREE.Mesh>(null);
  const legMeshRefs = useRef<(THREE.Mesh | null)[]>(
    new Array(LEGS_PER_SHPIDER * SEGMENTS_PER_LEG).fill(null),
  );

  // Per-leg random offsets/freq/amplitude, persisted for the egg's
  // lifetime so each leg has a consistent gait.
  const legParams = useMemo(() => {
    const arr: { phase: number; freq: number; lift: number }[] = [];
    // Deterministic seed from egg.id so same egg always animates the same
    let seed = 0;
    for (let i = 0; i < egg.id.length; i++) seed = (seed * 31 + egg.id.charCodeAt(i)) | 0;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) | 0;
      return ((seed >>> 0) / 0xffffffff);
    };
    for (let i = 0; i < LEGS_PER_SHPIDER; i++) {
      arr.push({
        phase: rand() * Math.PI * 2,
        freq: 0.8 + rand() * 0.5,
        lift: 0.25 + rand() * 0.15,
      });
    }
    return arr;
  }, [egg.id]);
  // Random head-slide phase per egg.
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

    // Body — sits at halfBody above origin (matches big shpider).
    const halfBody = MINI_BODY_SIZE * 0.5;
    if (bodyMeshRef.current) {
      bodyMeshRef.current.position.set(0, halfBody, 0);
      bodyMeshRef.current.scale.set(MINI_BODY_SIZE, MINI_BODY_SIZE, MINI_BODY_SIZE);
    }

    // Head — directly above body, sliding forward/back. Same formula
    // as ShpiderRenderer.tsx (head Y = bodySize + headSize*0.5; head Z
    // = bodySize*0.45 + sin(...) * (headSize*0.5)).
    const slide = Math.sin(t * Math.PI * 2 * HEAD_SLIDE_HZ + headSlidePhase) * (MINI_HEAD_SIZE * 0.5);
    const headForward = MINI_BODY_SIZE * 0.45 + slide;
    const headY = MINI_BODY_SIZE + MINI_HEAD_SIZE * 0.5;
    if (headMeshRef.current) {
      headMeshRef.current.position.set(0, headY, headForward);
      headMeshRef.current.scale.set(MINI_HEAD_SIZE, MINI_HEAD_SIZE, MINI_HEAD_SIZE);
    }

    // Legs — 8 legs × 3 segments, same getSegmentEndpoints math as
    // the big shpider. crawlT=1 means "always walking."
    let meshIdx = 0;
    for (let leg = 0; leg < LEGS_PER_SHPIDER; leg++) {
      const lp = legParams[leg];
      for (let seg = 0; seg < SEGMENTS_PER_LEG; seg++, meshIdx++) {
        const m = legMeshRefs.current[meshIdx];
        if (!m) continue;
        getSegmentEndpoints(
          leg, seg, MINI_BODY_SIZE,
          null,  // no hop
          1.0,   // always crawl
          lp.phase, lp.freq, lp.lift,
          t, _segScratch,
        );
        // Endpoints are body-local (origin = body center on surface,
        // y=0 at body bottom). Big shpider adds halfBody to Y so the
        // body is centered correctly; do the same here.
        _segScratch.start.y += halfBody;
        _segScratch.end.y += halfBody;

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

      {/* Mini-shpider — body + head + 8 legs × 3 segments, all parented
          to one group so they tumble together with the shell. */}
      <group ref={shpiderGroupRef}>
        <mesh ref={bodyMeshRef} geometry={bodyGeometry} material={bodyMaterial} />
        <mesh ref={headMeshRef} geometry={headGeometry} material={bodyMaterial} />
        {Array.from({ length: LEGS_PER_SHPIDER * SEGMENTS_PER_LEG }).map((_, i) => (
          <mesh
            key={i}
            ref={(m) => { legMeshRefs.current[i] = m; }}
            geometry={legGeometry}
            material={legMaterial}
          />
        ))}
      </group>
    </group>
  );
}
