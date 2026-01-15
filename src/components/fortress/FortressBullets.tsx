import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Bullet } from './FortressTypes';
import { diagnostics } from '@/lib/diagnosticsLogger';

// Pre-allocate geometry/material outside component to avoid GC
const MAX_BULLETS = 20;
const bulletGeometry = new THREE.SphereGeometry(0.05, 8, 8);
const bulletMaterial = new THREE.MeshBasicMaterial({ color: '#ffff00' });
const tmpMatrix = new THREE.Matrix4();

interface BulletsProps {
  bullets: Bullet[];
}

export function Bullets({ bullets }: BulletsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  
  useFrame(() => {
    diagnostics.useFrameCallCount++;
    
    if (!meshRef.current) return;
    
    let count = 0;
    for (const bullet of bullets) {
      if (count >= MAX_BULLETS) break;
      tmpMatrix.setPosition(bullet.position.x, bullet.position.y, bullet.position.z);
      meshRef.current.setMatrixAt(count, tmpMatrix);
      count++;
    }
    
    meshRef.current.count = count;
    if (count > 0) {
      meshRef.current.instanceMatrix.needsUpdate = true;
    }
  });
  
  return (
    <instancedMesh 
      ref={meshRef} 
      args={[bulletGeometry, bulletMaterial, MAX_BULLETS]}
      frustumCulled={false}
    />
  );
}
