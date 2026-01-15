import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { WeatherSettings, CycleState } from './FortressTypes';

// Helper function to interpolate between colors
export function interpolateColor(color1: number, color2: number, factor: number): number {
  const c1 = { r: (color1 >> 16) & 0xff, g: (color1 >> 8) & 0xff, b: color1 & 0xff };
  const c2 = { r: (color2 >> 16) & 0xff, g: (color2 >> 8) & 0xff, b: color2 & 0xff };

  const r = Math.round(c1.r + (c2.r - c1.r) * factor);
  const g = Math.round(c1.g + (c2.g - c1.g) * factor);
  const b = Math.round(c1.b + (c2.b - c1.b) * factor);

  return (r << 16) | (g << 8) | b;
}

// Calculate sky color based on lighting percentage
export function getSkyColor(lightingPercentage: number): number {
  const dayColor = 0x87ceeb;
  const nightColor = 0x000000;
  return interpolateColor(nightColor, dayColor, lightingPercentage / 100);
}

interface SkyTextureProps {
  cycleStateRef: React.MutableRefObject<CycleState>;
  weatherSettings: WeatherSettings;
  onRefsReady: (refs: { 
    skyMeshRef: React.RefObject<THREE.Mesh>; 
    starMeshRef: React.RefObject<THREE.Mesh> 
  }) => void;
}

export function SkyTexture({ cycleStateRef, weatherSettings, onRefsReady }: SkyTextureProps) {
  const { scene } = useThree();
  const starMeshRef = useRef<THREE.Mesh | null>(null);
  const skyMeshRef = useRef<THREE.Mesh | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);

  useEffect(() => {
    const textureLoader = new THREE.TextureLoader();
    const skyGeo = new THREE.SphereGeometry(320, 64, 32);

    // Layer 1: Solid color sky sphere
    const skyColorMat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      color: 0x000000,
      fog: false,
      transparent: true,
      opacity: 0
    });
    const skyColorMesh = new THREE.Mesh(skyGeo.clone(), skyColorMat);
    skyMeshRef.current = skyColorMesh;
    scene.add(skyColorMesh);

    // Layer 2: Star texture sphere
    textureLoader.load('/space_night_sky.webp', (loadedTexture) => {
      loadedTexture.wrapS = THREE.ClampToEdgeWrapping;
      loadedTexture.wrapT = THREE.ClampToEdgeWrapping;

      // Crop edges to eliminate seam artifacts
      const img = loadedTexture.image;
      const cropPixels = 3;
      const cropX = (cropPixels / img.width) * 2;
      const cropY = (cropPixels / img.height) * 2;

      loadedTexture.repeat.set(1 - cropX, 1 - cropY);
      loadedTexture.offset.set(cropX / 2, cropY / 2);

      textureRef.current = loadedTexture;

      const starGeo = new THREE.SphereGeometry(319, 64, 32);
      const starMat = new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        map: loadedTexture,
        transparent: true,
        opacity: 1,
        fog: false,
        blending: THREE.AdditiveBlending
      });

      const starMesh = new THREE.Mesh(starGeo, starMat);
      starMeshRef.current = starMesh;
      scene.add(starMesh);

      console.log('✓ Stars loaded:', loadedTexture.image.width, 'x', loadedTexture.image.height);
    });

    onRefsReady({ skyMeshRef, starMeshRef });

    return () => {
      if (skyMeshRef.current) {
        scene.remove(skyMeshRef.current);
        skyMeshRef.current.geometry.dispose();
        (skyMeshRef.current.material as THREE.Material).dispose();
      }
      if (starMeshRef.current) {
        scene.remove(starMeshRef.current);
        starMeshRef.current.geometry.dispose();
        (starMeshRef.current.material as THREE.Material).dispose();
      }
      textureRef.current?.dispose();
    };
  }, [scene, onRefsReady]);

  return null;
}

interface DynamicSkyProps {
  weatherSettings: WeatherSettings;
  cycleStateRef: React.MutableRefObject<CycleState>;
}

export function DynamicSky({ weatherSettings, cycleStateRef }: DynamicSkyProps) {
  const [isNight, setIsNight] = useState(false);
  const skyRefs = useRef<{ 
    skyMeshRef: React.RefObject<THREE.Mesh>; 
    starMeshRef: React.RefObject<THREE.Mesh> 
  } | null>(null);

  const handleRefsReady = useCallback((refs: { 
    skyMeshRef: React.RefObject<THREE.Mesh>; 
    starMeshRef: React.RefObject<THREE.Mesh> 
  }) => {
    skyRefs.current = refs;
  }, []);

  // Consolidated weather + sky update loop
  useFrame(() => {
    // 1. Update weather cycle
    const cycleDurationMs = weatherSettings.cycleDuration * 60 * 1000;
    const currentTime = Date.now();
    const cyclePosition = (currentTime % cycleDurationMs) / cycleDurationMs;

    const sineWave = Math.sin(cyclePosition * Math.PI * 2) * 0.5 + 0.5;
    const [minLighting, maxLighting] = weatherSettings.lightingRange;
    const lightingPercentage = minLighting + (maxLighting - minLighting) * sineWave;

    const newIsNight = lightingPercentage < 50;

    cycleStateRef.current = { lightingPercentage, cyclePosition, isNight: newIsNight };

    if (newIsNight !== isNight) {
      setIsNight(newIsNight);
    }

    // 2. Update sky transitions
    if (skyRefs.current) {
      const skyMesh = skyRefs.current.skyMeshRef.current;
      const starMesh = skyRefs.current.starMeshRef.current;

      if (skyMesh) {
        const mat = skyMesh.material as THREE.MeshBasicMaterial;
        const t = lightingPercentage / 100;
        mat.color.setRGB(135 / 255 * t, 206 / 255 * t, 235 / 255 * t);
        mat.opacity = t;
      }

      if (starMesh) {
        const mat = starMesh.material as THREE.MeshBasicMaterial;
        if (lightingPercentage <= 30) {
          mat.opacity = 1.0 - (lightingPercentage / 30);
        } else {
          mat.opacity = 0;
        }
      }
    }
  });

  return (
    <SkyTexture 
      cycleStateRef={cycleStateRef} 
      weatherSettings={weatherSettings} 
      onRefsReady={handleRefsReady} 
    />
  );
}
