// World-egg renderer. Per-egg group (no longer instanced) because
// each egg now contains a mini-shpider visual inside a translucent
// shell — too much per-egg state for instancing to be worth it at
// the typical 1–5 active eggs.
//
// Structure per egg:
//   • Translucent shell (50% opacity, per-tier shpider body texture)
//   • Inner "mini-shpider" body (2/3 shell diameter, opaque, same texture)
//   • 6 small leg cones around the body, wiggling in place (walking)
//   • Debug label below the egg showing tier + horizontal distance
//     to the local player camera (helps verify pickup-reach issues)
//
// The whole group bobs + rotates upside-down slowly so the mini-shpider
// rotates WITH the egg shell. Inner body has an extra rotation so it
// visibly moves relative to the shell.

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
const SHELL_RADIUS = 0.22;
const BODY_RADIUS = SHELL_RADIUS * (2 / 3);
const FLOAT_HEIGHT = 0.4;
const FLOAT_AMPLITUDE = 0.08;
const FLOAT_FREQ = 1.6;
const SHELL_TUMBLE_HZ = 0.4;   // upside-down tumble
const BODY_SPIN_HZ = 0.9;      // mini-shpider rotates differently
const LEG_WIGGLE_HZ = 3.5;
const NUM_LEGS = 6;
const LEG_LENGTH = 0.10;
const LEG_THICKNESS = 0.012;
const LEG_RADIUS_OFFSET = BODY_RADIUS + 0.005; // leg root at body surface

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
  const bodyGeometry = useMemo(
    () => new THREE.SphereGeometry(BODY_RADIUS, 14, 10),
    [],
  );
  const legGeometry = useMemo(
    () => new THREE.CylinderGeometry(LEG_THICKNESS, LEG_THICKNESS, LEG_LENGTH, 5),
    [],
  );

  // Two materials per tier: translucent shell, opaque body.
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
      metalness: 0.1,
      emissive: '#222222',
      emissiveIntensity: 0.4,
    })),
    [texs],
  );
  const legMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#1a0e0e', roughness: 0.6 }),
    [],
  );

  // Promp ref ("Press F to pick up") — placed above closest in-range egg.
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
          legGeometry={legGeometry}
          shellMaterial={shellMaterials[Math.max(0, Math.min(NUM_TIERS - 1, egg.tier - 1))]}
          bodyMaterial={bodyMaterials[Math.max(0, Math.min(NUM_TIERS - 1, egg.tier - 1))]}
          legMaterial={legMaterial}
          cameraRef={cameraRef}
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
  legGeometry: THREE.BufferGeometry;
  shellMaterial: THREE.Material;
  bodyMaterial: THREE.Material;
  legMaterial: THREE.Material;
  cameraRef?: React.RefObject<THREE.Camera | null>;
}

function EggInstance({
  egg, index,
  shellGeometry, bodyGeometry, legGeometry,
  shellMaterial, bodyMaterial, legMaterial,
  cameraRef,
}: InstanceProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const legRefs = useRef<(THREE.Mesh | null)[]>(new Array(NUM_LEGS).fill(null));
  const debugTextRef = useRef<any>(null);
  const debugTextStrRef = useRef<string>('');

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const phaseOffset = index * 1.7;

    // Whole-group position: bob up/down, very slow tumble so the egg
    // visibly inverts over time (~one half-tumble every ~1.25s).
    const bob = Math.sin(t * FLOAT_FREQ + phaseOffset) * FLOAT_AMPLITUDE;
    const tumbleZ = t * SHELL_TUMBLE_HZ * Math.PI * 2 + phaseOffset;
    if (groupRef.current) {
      groupRef.current.position.set(egg.x, egg.y + FLOAT_HEIGHT + bob, egg.z);
      groupRef.current.rotation.set(tumbleZ, t * 1.2 + index, 0);
    }

    // Inner body rotates a bit faster — visible "shpider turning"
    // inside the shell. The body group sits at origin so the rotation
    // is around its own center (which IS the shell center too — they
    // move together as required).
    if (bodyRef.current) {
      bodyRef.current.rotation.y = t * BODY_SPIN_HZ * Math.PI * 2 + phaseOffset;
    }

    // Wiggle legs in place — walking-without-going-anywhere.
    for (let l = 0; l < NUM_LEGS; l++) {
      const leg = legRefs.current[l];
      if (!leg) continue;
      const legPhase = t * LEG_WIGGLE_HZ * Math.PI * 2 + l * 0.9;
      // Rotation around the leg's own X (forward/back swing) — the
      // resting orientation is "leg points outward from body center"
      // (set in the JSX); this wiggle adds a small fore/aft swing on
      // top.
      leg.rotation.z = Math.sin(legPhase) * 0.45;
    }

    // Debug distance label — always visible above (below) the egg so
    // we can verify pickup-reach. Tells us at a glance whether the
    // player is in range.
    if (debugTextRef.current && cameraRef?.current) {
      const cam = cameraRef.current;
      const dx = egg.x - cam.position.x;
      const dz = egg.z - cam.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const inRange = dist <= EGG_PICKUP_REACH;
      const next = `T${egg.tier} • ${dist.toFixed(1)}m ${inRange ? '✓' : ''}`;
      if (next !== debugTextStrRef.current) {
        debugTextRef.current.text = next;
        debugTextStrRef.current = next;
      }
    }
  });

  // Pre-compute leg anchor positions around the body equator.
  const legAnchors = useMemo(() => {
    const arr: { x: number; z: number; rotY: number }[] = [];
    for (let l = 0; l < NUM_LEGS; l++) {
      const a = (l / NUM_LEGS) * Math.PI * 2;
      arr.push({
        x: Math.cos(a) * LEG_RADIUS_OFFSET,
        z: Math.sin(a) * LEG_RADIUS_OFFSET,
        rotY: a,
      });
    }
    return arr;
  }, []);

  return (
    <group ref={groupRef}>
      {/* Translucent outer shell */}
      <mesh geometry={shellGeometry} material={shellMaterial} renderOrder={2} />

      {/* Mini-shpider — body + legs grouped so they tumble with the shell */}
      <group ref={bodyRef}>
        <mesh geometry={bodyGeometry} material={bodyMaterial} />
        {legAnchors.map((a, l) => (
          <mesh
            key={l}
            ref={(m) => { legRefs.current[l] = m; }}
            geometry={legGeometry}
            material={legMaterial}
            // Anchor at body surface, rotate the cylinder so its long
            // axis points outward (Y is the cylinder's long axis).
            position={[a.x, 0, a.z]}
            rotation={[0, a.rotY, Math.PI / 2]}
          />
        ))}
      </group>

      {/* Debug distance label (below the egg, world-space). The
          parent group rotates/tumbles, so the label tumbles with it
          — that's actually fine for confirming the egg is rendering. */}
      <Text
        ref={debugTextRef}
        position={[0, -0.32, 0]}
        fontSize={0.07}
        color="yellow"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.005}
        outlineColor="black"
      >
        T?
      </Text>
    </group>
  );
}
