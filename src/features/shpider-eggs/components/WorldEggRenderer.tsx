// World-egg renderer.
//
// Per-egg group: translucent shell containing a mini-shpider that
// walks in place. The shell + mini-shpider tumble together so the
// shpider stays centered inside the egg as the egg slowly inverts.
//
// Mini-shpider parts:
//   • Body (sphere, per-tier shpider body texture)
//   • Head (smaller sphere, dark, offset forward from body)
//   • 6 dark bent legs around the body equator, animated to wiggle
//     (walking-in-place — no translation)

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import type { WorldEgg } from '../hooks/useWorldEggs';
import { EGG_PICKUP_REACH } from '../hooks/useWorldEggs';
import type { ShpiderDefinition } from '@/features/shpider/types';

interface Props {
  eggs: WorldEgg[];
  definitions: ShpiderDefinition[];
  cameraRef?: React.RefObject<THREE.Camera | null>;
}

const NUM_TIERS = 10;
const FALLBACK_TEX = '/Bamboo_Seamless_t1.webp';

// Outer shell.
const SHELL_RADIUS = 0.22;

// Mini-shpider dimensions (must fit inside SHELL_RADIUS). Body and
// head are CUBES (matches the big shpiders, which also use BoxGeometry).
const BODY_SIZE = 0.16;
const BODY_HALF = BODY_SIZE / 2;
const HEAD_SIZE = 0.09;
const HEAD_HALF = HEAD_SIZE / 2;
const HEAD_OFFSET = BODY_HALF + HEAD_HALF; // head sits against body's front face
const LEG_LENGTH = 0.085;
const LEG_THICKNESS = 0.018;
const LEG_ANCHOR_RADIUS = BODY_HALF;

// Animation.
const FLOAT_HEIGHT = 0.4;
const FLOAT_AMPLITUDE = 0.08;
const FLOAT_FREQ = 1.6;
const SHELL_TUMBLE_HZ = 0.35;
const BODY_SPIN_HZ = 0.6;
const LEG_WIGGLE_HZ = 3.0;
const NUM_LEGS = 6;

export function WorldEggRenderer({ eggs, definitions, cameraRef }: Props) {
  const defsByTier = useMemo(() => {
    const arr: (ShpiderDefinition | null)[] = new Array(NUM_TIERS + 1).fill(null);
    for (const d of definitions) {
      if (d.tier >= 1 && d.tier <= NUM_TIERS) arr[d.tier] = d;
    }
    return arr;
  }, [definitions]);

  const urls = useMemo(() => {
    const arr: string[] = [];
    for (let t = 1; t <= NUM_TIERS; t++) {
      arr.push(defsByTier[t]?.body_texture_url || FALLBACK_TEX);
    }
    return arr;
  }, [defsByTier]);

  const texs = useLoader(THREE.TextureLoader, urls);
  useEffect(() => {
    texs.forEach(t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearMipMapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
    });
  }, [texs]);

  const shellGeometry = useMemo(
    () => new THREE.SphereGeometry(SHELL_RADIUS, 18, 14),
    [],
  );
  // Body + head are cubes, matching the big shpiders (which also use
  // BoxGeometry per ShpiderRenderer.tsx). Both share the body texture.
  const bodyGeometry = useMemo(
    () => new THREE.BoxGeometry(BODY_SIZE, BODY_SIZE, BODY_SIZE),
    [],
  );
  const headGeometry = useMemo(
    () => new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE),
    [],
  );
  // Leg geometry oriented along +Z so the leg cylinder rotates around
  // its anchor point at z=0 cleanly. Y is the cylinder's natural long
  // axis; we rotate it to point along Z when placing.
  const legGeometry = useMemo(
    () => new THREE.CylinderGeometry(LEG_THICKNESS * 0.6, LEG_THICKNESS, LEG_LENGTH, 6),
    [],
  );

  // Per-tier materials. Shell is translucent; body is opaque.
  const shellMaterials = useMemo(
    () => texs.map(tex => new THREE.MeshStandardMaterial({
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
    [texs],
  );
  const bodyMaterials = useMemo(
    () => texs.map(tex => new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.45,
      metalness: 0.05,
      emissive: '#222222',
      emissiveIntensity: 0.5,
    })),
    [texs],
  );
  const legMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: '#1a0a0a',
      roughness: 0.7,
      emissive: '#330000',
      emissiveIntensity: 0.3,
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
      {eggs.map((egg, idx) => (
        <EggInstance
          key={egg.id}
          egg={egg}
          index={idx}
          shellGeometry={shellGeometry}
          bodyGeometry={bodyGeometry}
          headGeometry={headGeometry}
          legGeometry={legGeometry}
          shellMaterial={shellMaterials[Math.max(0, Math.min(NUM_TIERS - 1, egg.tier - 1))]}
          bodyMaterial={bodyMaterials[Math.max(0, Math.min(NUM_TIERS - 1, egg.tier - 1))]}
          legMaterial={legMaterial}
        />
      ))}

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

function EggInstance({
  egg, index,
  shellGeometry, bodyGeometry, headGeometry, legGeometry,
  shellMaterial, bodyMaterial, legMaterial,
}: InstanceProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyGroupRef = useRef<THREE.Group>(null);
  const legRefs = useRef<(THREE.Group | null)[]>(new Array(NUM_LEGS).fill(null));

  // Leg anchor positions around body equator.
  const legAnchors = useMemo(() => {
    const arr: { x: number; z: number; angle: number }[] = [];
    for (let l = 0; l < NUM_LEGS; l++) {
      const a = (l / NUM_LEGS) * Math.PI * 2;
      arr.push({
        x: Math.cos(a) * LEG_ANCHOR_RADIUS,
        z: Math.sin(a) * LEG_ANCHOR_RADIUS,
        angle: a,
      });
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const phaseOffset = index * 1.7;

    // Whole-group: bob + slow tumble (egg inverting).
    const bob = Math.sin(t * FLOAT_FREQ + phaseOffset) * FLOAT_AMPLITUDE;
    if (groupRef.current) {
      groupRef.current.position.set(egg.x, egg.y + FLOAT_HEIGHT + bob, egg.z);
      groupRef.current.rotation.set(
        t * SHELL_TUMBLE_HZ * Math.PI * 2 + phaseOffset,
        t * 1.0,
        0,
      );
    }
    // Mini-shpider body+legs+head rotate together inside the shell —
    // a little slower than the shell tumble so the body appears to
    // turn relative to the shell.
    if (bodyGroupRef.current) {
      bodyGroupRef.current.rotation.y = t * BODY_SPIN_HZ * Math.PI * 2 + phaseOffset;
    }
    // Per-leg wiggle. Each leg group has its anchor at the body
    // surface; we rotate the group itself to swing the leg.
    for (let l = 0; l < NUM_LEGS; l++) {
      const g = legRefs.current[l];
      if (!g) continue;
      const legPhase = t * LEG_WIGGLE_HZ * Math.PI * 2 + l * 1.05;
      // Swing the leg up/down around the body's tangent axis.
      g.rotation.x = Math.sin(legPhase) * 0.6;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Translucent outer shell */}
      <mesh geometry={shellGeometry} material={shellMaterial} renderOrder={2} />

      {/* Mini-shpider — body + head + legs, all rotating together */}
      <group ref={bodyGroupRef}>
        {/* Body */}
        <mesh geometry={bodyGeometry} material={bodyMaterial} />

        {/* Head — small cube using the same body texture, offset
            forward (+Z is "front"). Same material as the big shpiders. */}
        <mesh geometry={headGeometry} material={bodyMaterial} position={[0, 0, HEAD_OFFSET]} />

        {/* 6 legs around the body equator. Each leg is a Group rooted
            at the body's surface point, with the leg cylinder shifted
            so its base sits at the group origin and the leg extends
            outward + slightly downward. */}
        {legAnchors.map((a, l) => (
          <group
            key={l}
            ref={(g) => { legRefs.current[l] = g; }}
            position={[a.x, 0, a.z]}
            // Orient so the leg's +Y axis points away from the body
            // center (outward radially). Then rotate to angle outward
            // and slightly down.
            rotation={[0, -a.angle, -Math.PI / 2 + 0.3]}
          >
            {/* Cylinder geometry's local +Y is the cylinder long axis;
                shift down by half its length so the group origin sits
                at the leg's BASE (where it attaches to the body), not
                its middle. */}
            <mesh
              geometry={legGeometry}
              material={legMaterial}
              position={[0, LEG_LENGTH / 2, 0]}
            />
          </group>
        ))}
      </group>
    </group>
  );
}
