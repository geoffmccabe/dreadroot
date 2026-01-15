import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * SceneReflections creates a CubeCamera for real-time reflections.
 * The avatar and scene will be reflected in crystal blocks.
 */
export function SceneReflections() {
  const { gl, scene, camera } = useThree();
  const cubeRenderTarget = useRef<THREE.WebGLCubeRenderTarget | null>(null);
  const cubeCamera = useRef<THREE.CubeCamera | null>(null);
  const frameCount = useRef(0);
  const initialized = useRef(false);
  
  // Initialize once
  useEffect(() => {
    // Create render target at moderate resolution
    const rt = new THREE.WebGLCubeRenderTarget(256, {
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    cubeRenderTarget.current = rt;
    
    // Create cube camera
    const cam = new THREE.CubeCamera(0.5, 500, rt);
    cubeCamera.current = cam;
    scene.add(cam);
    
    console.log('✅ CubeCamera initialized for reflections');
    
    return () => {
      scene.remove(cam);
      rt.dispose();
    };
  }, [scene]);
  
  useFrame(() => {
    if (!cubeCamera.current || !cubeRenderTarget.current) return;
    
    frameCount.current++;
    
    // Update every 10 frames for performance (6fps updates at 60fps)
    if (frameCount.current % 10 !== 0) return;
    
    // Position at camera location
    cubeCamera.current.position.copy(camera.position);
    
    // Render the scene to cube map
    cubeCamera.current.update(gl, scene);
    
    // Set as scene environment (affects all PBR materials)
    scene.environment = cubeRenderTarget.current.texture;
    
    // First-time setup: apply to existing materials
    if (!initialized.current) {
      initialized.current = true;
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat && mat.envMapIntensity !== undefined && mat.envMapIntensity > 0) {
            mat.envMap = cubeRenderTarget.current!.texture;
            mat.needsUpdate = true;
          }
        }
      });
    }
  });
  
  return null;
}
