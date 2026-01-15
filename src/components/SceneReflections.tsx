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
    // Create render target at higher resolution for clearer reflections
    const rt = new THREE.WebGLCubeRenderTarget(512, {
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    cubeRenderTarget.current = rt;
    
    // Create cube camera with closer near plane for better quality
    const cam = new THREE.CubeCamera(0.1, 500, rt);
    cubeCamera.current = cam;
    scene.add(cam);
    
    // Make all reflective surfaces highly reflective for testing
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat && mat.envMapIntensity !== undefined) {
          // Boost reflection intensity significantly
          mat.envMapIntensity = 2.0;
          mat.metalness = Math.max(mat.metalness || 0, 0.5);
          mat.roughness = Math.min(mat.roughness || 1, 0.3);
          mat.needsUpdate = true;
        }
      }
    });
    
    console.log('✅ CubeCamera initialized for reflections (high quality)');
    
    return () => {
      scene.remove(cam);
      rt.dispose();
    };
  }, [scene]);
  
  useFrame(() => {
    if (!cubeCamera.current || !cubeRenderTarget.current) return;
    
    frameCount.current++;
    
    // Update every 3 frames for smoother reflections
    if (frameCount.current % 3 !== 0) return;
    
    // Position at camera location
    cubeCamera.current.position.copy(camera.position);
    
    // Render the scene to cube map
    cubeCamera.current.update(gl, scene);
    
    // Set as scene environment (affects all PBR materials)
    scene.environment = cubeRenderTarget.current.texture;
    
    // First-time setup: apply env map to all materials
    if (!initialized.current) {
      initialized.current = true;
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat && mat.isMeshStandardMaterial) {
            mat.envMap = cubeRenderTarget.current!.texture;
            mat.envMapIntensity = 2.0;
            mat.needsUpdate = true;
          }
        }
      });
    }
  });
  
  return null;
}
