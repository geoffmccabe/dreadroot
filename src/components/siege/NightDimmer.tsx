// NightDimmer — self-contained night mood for a single siege map (e.g. the SciFi City
// demo). It scales the shared scene lights (sun/hemisphere/ambient from DynamicLighting)
// DOWN while mounted and restores them on unmount, so emissive (glowing) materials —
// neon, signs, lit windows — stand out against a dim night scene. Re-applies each frame
// cheaply (only 3 lights) so it holds even if the lighting controller re-asserts.

import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const SCALE = 0.18; // how dark (0 = black, 1 = full daylight)

export function NightDimmer() {
  const scene = useThree((s) => s.scene);
  const saved = useRef<Array<[THREE.Light, number]>>([]);
  const prevFog = useRef<THREE.Scene['fog']>(null);

  useEffect(() => {
    // Snapshot + dim once; restore on unmount.
    const list: Array<[THREE.Light, number]> = [];
    scene.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight && (l.type === 'DirectionalLight' || l.type === 'HemisphereLight' || l.type === 'AmbientLight')) {
        list.push([l, l.intensity]);
      }
    });
    saved.current = list;
    prevFog.current = scene.fog;
    scene.fog = new THREE.Fog(0x0a0d14, 60, 480); // cool dark night haze
    return () => {
      for (const [l, i] of saved.current) l.intensity = i;
      scene.fog = prevFog.current;
    };
  }, [scene]);

  // Hold the dim each frame (cheap; counters any re-assert from the day/night controller).
  useFrame(() => {
    for (const [l, i] of saved.current) l.intensity = i * SCALE;
  });

  return null;
}
