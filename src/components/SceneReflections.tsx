import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * SceneReflections creates a CubeCamera for real-time reflections.
 * The avatar and scene will be reflected in crystal blocks ONLY.
 * Heavily optimized to minimize FPS impact.
 */
export function SceneReflections() {
  const { gl, scene, camera } = useThree();
  const cubeRenderTarget = useRef<THREE.WebGLCubeRenderTarget | null>(null);
  const cubeCamera = useRef<THREE.CubeCamera | null>(null);
  const frameCount = useRef(0);
  const initialized = useRef(false);
  const lastCameraPos = useRef(new THREE.Vector3());
  
  // Initialize once with LOW resolution for performance
  useEffect(() => {
    // Use 128 resolution instead of 512 for massive performance gain
    const rt = new THREE.WebGLCubeRenderTarget(128, {
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    cubeRenderTarget.current = rt;
    
    const cam = new THREE.CubeCamera(0.1, 500, rt);
    cubeCamera.current = cam;
    scene.add(cam);
    
    console.log('✅ CubeCamera initialized (128px) for crystal block reflections');
    
    return () => {
      scene.remove(cam);
      rt.dispose();
    };
  }, [scene]);
  
  useFrame(() => {
    if (!cubeCamera.current || !cubeRenderTarget.current) return;
    
    frameCount.current++;
    
    // Update only every 15 frames for performance (was every 3)
    if (frameCount.current % 15 !== 0) return;
    
    // Skip if camera hasn't moved significantly
    const cameraMovedSq = camera.position.distanceToSquared(lastCameraPos.current);
    if (cameraMovedSq < 1) return; // Less than 1 unit moved
    
    lastCameraPos.current.copy(camera.position);
    
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
            mat.envMapIntensity = 3.0;
            mat.needsUpdate = true;
            console.log('✅ Applied env map to crystal material');
          }
        }
      });
    }
  });
  
  return null;
}
