import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * SceneReflections creates a CubeCamera for real-time reflections.
 * The avatar and scene will be reflected in crystal blocks ONLY.
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
    
    console.log('✅ CubeCamera initialized for crystal block reflections');
    
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
    
    // First-time setup: apply env map ONLY to MeshPhysicalMaterial (crystal blocks)
    if (!initialized.current) {
      initialized.current = true;
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshPhysicalMaterial;
          // Only target MeshPhysicalMaterial (used for crystal/transparent blocks)
          if (mat && mat.type === 'MeshPhysicalMaterial') {
            mat.envMap = cubeRenderTarget.current!.texture;
            mat.envMapIntensity = 3.0; // High intensity for crystal reflections
            mat.needsUpdate = true;
            console.log('✅ Applied high-quality env map to crystal material');
          }
        }
      });
    }
  });
  
  return null;
}
