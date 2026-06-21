import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { frameLoop } from '@/lib/frameLoop';
import { shadowStore } from '@/features/lights/shadowStore';
import { CycleState } from './FortressTypes';

// Sun shadow: ONE directional light whose tight ortho shadow camera follows the player.
// This replaces per-monster moving spotlight shadows (3 full-scene passes → 1) and gives
// stable, accurate ground shadows. Only nearby chunks/monsters fall inside the box and
// frustum-cull into it, so the cost is one cheap pass.
const SUN_HALF = 32;            // ortho half-size → 64u box centred on the player
const SUN_MAP = 2048;           // single map, tight area → crisp
const SUN_DIST = 80;            // how far up-sun the light sits from the player
const SUN_DIR = new THREE.Vector3(35, 45, 15).normalize(); // matches the static position below
const SUN_TEXEL = (2 * SUN_HALF) / SUN_MAP; // world units per shadow texel (for snapping)

export interface LightingHandle {
  update: () => void;
}

interface DynamicLightingProps {
  cycleStateRef: React.MutableRefObject<CycleState>;
}

export const DynamicLighting = forwardRef<LightingHandle, DynamicLightingProps>(({ cycleStateRef }, ref) => {
  const hemisphereRef = useRef<THREE.HemisphereLight>(null);
  const directionalRef = useRef<THREE.DirectionalLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const { camera } = useThree();

  // Cache previous lighting value to avoid unnecessary updates
  const prevLightingRef = useRef(0);

  // ONE-TIME shadow layer setup
  useEffect(() => {
    const timer = setTimeout(() => {
      if (directionalRef.current?.shadow?.camera) {
        directionalRef.current.shadow.camera.layers.enableAll();
        console.log('✅ Shadow camera layers enabled for avatar');
      }
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Sun shadow follows the player. Without this the ortho shadow box stays at world
  // origin and you walk out of it. Texel-snapping the centre stops shadow-edge crawl.
  useEffect(() => {
    return frameLoop.register('sun-shadow-follow', () => {
      if (!shadowStore.get()) return; // zero cost when shadows are off
      const light = directionalRef.current;
      if (!light) return;
      // Snap the box centre to the shadow-map texel grid (kills shimmer while moving).
      const cx = Math.round(camera.position.x / SUN_TEXEL) * SUN_TEXEL;
      const cz = Math.round(camera.position.z / SUN_TEXEL) * SUN_TEXEL;
      const cy = camera.position.y - 1.0; // ~ground/feet under the camera
      light.position.set(cx + SUN_DIR.x * SUN_DIST, cy + SUN_DIR.y * SUN_DIST, cz + SUN_DIR.z * SUN_DIST);
      light.target.position.set(cx, cy, cz);
      light.target.updateMatrixWorld();
    }, 20);
  }, [camera]);

  // Expose update function instead of using useFrame
  useImperativeHandle(ref, () => ({
    update: () => {
      // Only update if lighting changed significantly (>1% change)
      const currentLighting = cycleStateRef.current.lightingPercentage;
      if (Math.abs(currentLighting - prevLightingRef.current) < 1) {
        return;
      }
      prevLightingRef.current = currentLighting;

      // Ensure minimum 5% ambient light
      const baseIntensity = Math.max(0.05, currentLighting / 100);

      if (hemisphereRef.current) {
        hemisphereRef.current.intensity = 1.1 * baseIntensity;
      }
      if (directionalRef.current) {
        directionalRef.current.intensity = 1.0 * baseIntensity;
      }
      if (ambientRef.current) {
        ambientRef.current.intensity = 0.25 * baseIntensity;
      }
    }
  }), [cycleStateRef]);

  return (
    <>
      <hemisphereLight
        ref={hemisphereRef}
        args={['#ffffff', '#edfff6', 1.1]}
      />
      <directionalLight
        ref={directionalRef}
        position={[35, 45, 15]}
        intensity={1.0}
        castShadow
        shadow-mapSize-width={SUN_MAP}
        shadow-mapSize-height={SUN_MAP}
        shadow-camera-near={1}
        shadow-camera-far={SUN_DIST + SUN_HALF * 2}
        shadow-camera-left={-SUN_HALF}
        shadow-camera-right={SUN_HALF}
        shadow-camera-top={SUN_HALF}
        shadow-camera-bottom={-SUN_HALF}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      />
      <ambientLight
        ref={ambientRef}
        intensity={0.25}
      />
    </>
  );
});

DynamicLighting.displayName = 'DynamicLighting';
