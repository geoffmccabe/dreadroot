import React, { useRef, useImperativeHandle, forwardRef, useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Bullet } from './FortressTypes';

// Pre-allocate geometry/material outside component to avoid GC
const MAX_BULLETS = 20;
const bulletGeometry = new THREE.SphereGeometry(0.05, 8, 8);
// Use a material that supports vertex colors
const bulletMaterial = new THREE.MeshBasicMaterial({ vertexColors: false });
const tmpMatrix = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const MIN_RENDER_DISTANCE_SQ = 1.0; // 1 meter squared

export interface BulletsHandle {
  update: () => void;
}

interface BulletsProps {
  bullets: Bullet[];
}

export const Bullets = forwardRef<BulletsHandle, BulletsProps>(({ bullets }, ref) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { camera } = useThree();
  
  // Initialize instanceColor attribute on mount
  useEffect(() => {
    if (meshRef.current && !meshRef.current.instanceColor) {
      // Create instance color buffer
      const colors = new Float32Array(MAX_BULLETS * 3);
      meshRef.current.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    }
  }, []);
  
  // Expose update function instead of using useFrame
  useImperativeHandle(ref, () => ({
    update: () => {
      if (!meshRef.current) return;
      
      const camX = camera.position.x;
      const camY = camera.position.y;
      const camZ = camera.position.z;
      
      let count = 0;
      for (const bullet of bullets) {
        if (count >= MAX_BULLETS) break;
        
        // Skip bullets too close to the camera (within 1m)
        const dx = bullet.position.x - camX;
        const dy = bullet.position.y - camY;
        const dz = bullet.position.z - camZ;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < MIN_RENDER_DISTANCE_SQ) continue;
        
        tmpMatrix.setPosition(bullet.position.x, bullet.position.y, bullet.position.z);
        meshRef.current.setMatrixAt(count, tmpMatrix);
        
        // Set per-instance color from bullet.color
        tmpColor.set(bullet.color || '#ffff00');
        meshRef.current.setColorAt(count, tmpColor);
        
        count++;
      }
      
      meshRef.current.count = count;
      if (count > 0) {
        meshRef.current.instanceMatrix.needsUpdate = true;
        if (meshRef.current.instanceColor) {
          meshRef.current.instanceColor.needsUpdate = true;
        }
      }
    }
  }), [bullets, camera]);
  
  return (
    <instancedMesh 
      ref={meshRef} 
      args={[bulletGeometry, bulletMaterial, MAX_BULLETS]}
      frustumCulled={false}
    />
  );
});

Bullets.displayName = 'Bullets';
