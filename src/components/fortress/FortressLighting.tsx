import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CycleState } from './FortressTypes';

interface DynamicLightingProps {
  cycleStateRef: React.MutableRefObject<CycleState>;
}

export function DynamicLighting({ cycleStateRef }: DynamicLightingProps) {
  const hemisphereRef = useRef<THREE.HemisphereLight>(null);
  const directionalRef = useRef<THREE.DirectionalLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);

  // Cache previous lighting value to avoid unnecessary updates
  const prevLightingRef = useRef(0);

  useFrame(() => {
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
  });

  // Enable Layer 1 on shadow camera for avatar visibility
  const shadowLayerSet = useRef(false);
  useFrame(() => {
    if (!shadowLayerSet.current && directionalRef.current?.shadow?.camera) {
      directionalRef.current.shadow.camera.layers.enableAll();
      console.log('✅ Shadow camera layers enabled for avatar');
      shadowLayerSet.current = true;
    }
  });

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
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={100}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />
      <ambientLight
        ref={ambientRef}
        intensity={0.25}
      />
    </>
  );
}
