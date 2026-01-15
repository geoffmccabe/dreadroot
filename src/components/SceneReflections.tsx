import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface SceneReflectionsProps {
  children?: React.ReactNode;
}

/**
 * SceneReflections component creates a CubeCamera that captures the scene
 * and provides an environment map that can be used for reflections.
 * This allows the avatar and other dynamic objects to be reflected in crystal blocks.
 */
export function SceneReflections({ children }: SceneReflectionsProps) {
  const { gl, scene, camera } = useThree();
  const cubeRenderTargetRef = useRef<THREE.WebGLCubeRenderTarget | null>(null);
  const cubeCameraRef = useRef<THREE.CubeCamera | null>(null);
  const frameCountRef = useRef(0);
  
  // Create cube camera and render target once
  useMemo(() => {
    // Lower resolution for performance (128 or 256)
    const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(128, {
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    cubeRenderTargetRef.current = cubeRenderTarget;
    
    // Near/far planes for the cube camera
    const cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeRenderTarget);
    cubeCameraRef.current = cubeCamera;
    
    return () => {
      cubeRenderTarget.dispose();
    };
  }, []);

  // Update cube camera every few frames for performance
  useFrame(() => {
    frameCountRef.current++;
    
    // Only update every 5 frames to save performance
    if (frameCountRef.current % 5 !== 0) return;
    
    if (cubeCameraRef.current && cubeRenderTargetRef.current) {
      // Position cube camera at the main camera position
      cubeCameraRef.current.position.copy(camera.position);
      
      // Update the cube camera (renders the scene from all 6 directions)
      cubeCameraRef.current.update(gl, scene);
      
      // Apply the environment map to the scene for reflections
      scene.environment = cubeRenderTargetRef.current.texture;
      
      // Also update all materials that need the new envMap
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat.envMapIntensity && mat.envMapIntensity > 0) {
            mat.envMap = cubeRenderTargetRef.current!.texture;
            mat.needsUpdate = true;
          }
        }
      });
      
      if (frameCountRef.current === 5) {
        console.log('✅ CubeCamera reflections active');
      }
    }
  });

  return <>{children}</>;
}
