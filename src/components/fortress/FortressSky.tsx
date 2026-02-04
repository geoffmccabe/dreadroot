import React, { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { WeatherSettings, CycleState, CloudLayerSettings } from './FortressTypes';
import { createCloudMesh, type CloudMeshHandle } from './SkyCloudLayer';

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
  onRefsReady: (refs: {
    skyMeshRef: React.RefObject<THREE.Mesh>;
    starMeshRef: React.RefObject<THREE.Mesh>
  }) => void;
  skyTextureUrl?: string | null;
}

export function SkyTexture({ onRefsReady, skyTextureUrl }: SkyTextureProps) {
  const { scene } = useThree();
  const starMeshRef = useRef<THREE.Mesh | null>(null);
  const skyMeshRef = useRef<THREE.Mesh | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);

  // Use prop with fallback to default
  const skyUrl = skyTextureUrl || '/space_night_sky.webp';

  useEffect(() => {
    // Dispose old textures and meshes when URL changes
    if (starMeshRef.current) {
      scene.remove(starMeshRef.current);
      starMeshRef.current.geometry.dispose();
      (starMeshRef.current.material as THREE.Material).dispose();
      starMeshRef.current = null;
    }
    if (skyMeshRef.current) {
      scene.remove(skyMeshRef.current);
      skyMeshRef.current.geometry.dispose();
      (skyMeshRef.current.material as THREE.Material).dispose();
      skyMeshRef.current = null;
    }
    if (textureRef.current) {
      textureRef.current.dispose();
      textureRef.current = null;
    }

    const textureLoader = new THREE.TextureLoader();
    // Use full sphere geometry - extends well below horizon
    // phiStart=0, phiLength=2*PI (full circle), thetaStart=0, thetaLength=PI (full sphere)
    const skyGeo = new THREE.SphereGeometry(640, 64, 32, 0, Math.PI * 2, 0, Math.PI);

    // Layer 1: Solid color sky sphere
    const skyColorMat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      color: 0x000000,
      fog: false,
      transparent: true,
      depthWrite: false,
      opacity: 0
    });
    const skyColorMesh = new THREE.Mesh(skyGeo.clone(), skyColorMat);
    // Position sphere so it extends below ground level
    skyColorMesh.position.y = -50;
    skyMeshRef.current = skyColorMesh;
    scene.add(skyColorMesh);

    // Layer 2: Star texture sphere
    textureLoader.load(skyUrl, (loadedTexture) => {
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

      const starGeo = new THREE.SphereGeometry(638, 64, 32, 0, Math.PI * 2, 0, Math.PI);
      const starMat = new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        map: loadedTexture,
        transparent: true,
        opacity: 1,
        fog: false,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const starMesh = new THREE.Mesh(starGeo, starMat);
      // Match sky sphere position
      starMesh.position.y = -50;
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
  }, [scene, onRefsReady, skyUrl]);

  return null;
}

export interface SkyHandle {
  update: (delta: number) => void;
}

interface DynamicSkyProps {
  weatherSettings: WeatherSettings;
  cycleStateRef: React.MutableRefObject<CycleState>;
  skyTextureUrl?: string | null;
  freezeCycle?: boolean;
  lightingOverride?: number | null;
}

const defaultCloud: CloudLayerSettings = { enabled: false, opacity: 0.45, coverage: 0.5, height: 300, speed: 5, direction: 45, scale: 2.0, color: '#ffffff' };

export const DynamicSky = forwardRef<SkyHandle, DynamicSkyProps>(({ weatherSettings, cycleStateRef, skyTextureUrl, freezeCycle = false, lightingOverride = null }, ref) => {
  const { scene, camera } = useThree();
  const skyRefs = useRef<{
    skyMeshRef: React.RefObject<THREE.Mesh>;
    starMeshRef: React.RefObject<THREE.Mesh>
  } | null>(null);

  // Track previous night state to avoid unnecessary setState calls
  const prevIsNightRef = useRef(false);

  // Cloud meshes — created once, added to scene imperatively
  const cloud1Ref = useRef<CloudMeshHandle | null>(null);
  const cloud2Ref = useRef<CloudMeshHandle | null>(null);
  const farClipSetRef = useRef(false);

  // Create cloud meshes and add to scene
  useEffect(() => {
    const c1 = createCloudMesh();
    const c2 = createCloudMesh();
    cloud1Ref.current = c1;
    cloud2Ref.current = c2;
    scene.add(c1.mesh);
    scene.add(c2.mesh);

    return () => {
      scene.remove(c1.mesh);
      scene.remove(c2.mesh);
      c1.dispose();
      c2.dispose();
      cloud1Ref.current = null;
      cloud2Ref.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  const handleRefsReady = useCallback((refs: {
    skyMeshRef: React.RefObject<THREE.Mesh>;
    starMeshRef: React.RefObject<THREE.Mesh>
  }) => {
    skyRefs.current = refs;
  }, []);

  // Store weatherSettings in a ref so the imperative update() always reads fresh values
  const weatherRef = useRef(weatherSettings);
  weatherRef.current = weatherSettings;

  // Expose update function instead of using useFrame
  useImperativeHandle(ref, () => ({
    update: (delta: number) => {
      const ws = weatherRef.current;
      let lightingPercentage: number;
      let cyclePosition: number;

      if (lightingOverride !== null) {
        lightingPercentage = lightingOverride;
        cyclePosition = cycleStateRef.current.cyclePosition;
      } else if (freezeCycle) {
        lightingPercentage = cycleStateRef.current.lightingPercentage;
        cyclePosition = cycleStateRef.current.cyclePosition;
      } else {
        const cycleDurationMs = ws.cycleDuration * 60 * 1000;
        const currentTime = Date.now();
        cyclePosition = (currentTime % cycleDurationMs) / cycleDurationMs;

        const sineWave = Math.sin(cyclePosition * Math.PI * 2) * 0.5 + 0.5;
        const [minLighting, maxLighting] = ws.lightingRange;
        lightingPercentage = minLighting + (maxLighting - minLighting) * sineWave;
      }

      const newIsNight = lightingPercentage < 50;

      cycleStateRef.current.lightingPercentage = lightingPercentage;
      cycleStateRef.current.cyclePosition = cyclePosition;
      cycleStateRef.current.isNight = newIsNight;
      prevIsNightRef.current = newIsNight;

      // Update sky transitions
      if (skyRefs.current) {
        const skyMesh = skyRefs.current.skyMeshRef.current;
        const starMesh = skyRefs.current.starMeshRef.current;

        if (skyMesh) {
          const mat = skyMesh.material as THREE.MeshBasicMaterial;
          const t = lightingPercentage / 100;
          const skyR = 135 / 255 * t;
          const skyG = 206 / 255 * t;
          const skyB = 235 / 255 * t;
          mat.color.setRGB(skyR, skyG, skyB);
          mat.opacity = t;
          if (!scene.userData.skyColor) scene.userData.skyColor = new THREE.Color();
          scene.userData.skyColor.setRGB(skyR, skyG, skyB);
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

      // Update cloud layers
      const lightingPct = lightingPercentage / 100;
      const cloud1Settings = ws.cloudLayer1 ?? defaultCloud;
      const cloud2Settings = ws.cloudLayer2 ?? defaultCloud;

      if (cloud1Ref.current) {
        cloud1Ref.current.update(cloud1Settings, camera, delta, lightingPct);
      }
      if (cloud2Ref.current) {
        cloud2Ref.current.update(cloud2Settings, camera, delta, lightingPct);
      }
    }
  }), [cycleStateRef, freezeCycle, lightingOverride, scene, camera]);

  return (
    <SkyTexture
      onRefsReady={handleRefsReady}
      skyTextureUrl={skyTextureUrl}
    />
  );
});

DynamicSky.displayName = 'DynamicSky';
