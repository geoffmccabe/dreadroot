// Water pool feature: 32x32m reflective pool, 10m deep
// Players sink, can jump slowly upward, underwater camera effect with oxygen timer

import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CHUNK_SIZE } from '@/lib/chunkManager';

// Pool configuration
export const POOL_CONFIG = {
  // Position: 5 chunks in front of fortress door (frontZ = -8, so 5 * 16 = 80 forward)
  centerX: 0,
  centerZ: -8 + (5 * CHUNK_SIZE), // = 72
  
  // Dimensions
  width: 32,  // X axis
  length: 32, // Z axis
  depth: 10,  // Y axis (below ground level)
  
  // Physics
  sinkSpeed: 2.0,        // m/s downward when not jumping
  jumpBoost: 3.5,        // m/s upward when jumping underwater
  swimDrag: 0.6,         // Horizontal movement multiplier
  
  // Oxygen
  maxOxygen: 10,         // seconds of breath
  oxygenDamageRate: 5,   // HP per second when out of oxygen
  oxygenRecoveryRate: 3, // seconds to fully recover oxygen when surfaced
  
  // Visual
  surfaceColor: 0x1a5f7a,
  surfaceOpacity: 0.7,
  underwaterFogColor: new THREE.Color(0x0a3040),
  underwaterFogNear: 2,
  underwaterFogFar: 20,
};

// Check if a position is inside the pool water volume
export function isInPool(x: number, y: number, z: number): boolean {
  const { centerX, centerZ, width, length, depth } = POOL_CONFIG;
  const halfW = width / 2;
  const halfL = length / 2;
  
  return (
    x >= centerX - halfW && x <= centerX + halfW &&
    z >= centerZ - halfL && z <= centerZ + halfL &&
    y > -depth && y < 0  // Below surface (y=0) but above pool floor
  );
}

// Check if position is at water surface level (for oxygen recovery)
export function isAtSurface(x: number, y: number, z: number): boolean {
  const { centerX, centerZ, width, length } = POOL_CONFIG;
  const halfW = width / 2;
  const halfL = length / 2;
  
  return (
    x >= centerX - halfW && x <= centerX + halfW &&
    z >= centerZ - halfL && z <= centerZ + halfL &&
    y >= -0.5 && y < 0.5  // Near the surface
  );
}

// Get pool bounds as Box3 for collision
export function getPoolBounds(): THREE.Box3 {
  const { centerX, centerZ, width, length, depth } = POOL_CONFIG;
  const halfW = width / 2;
  const halfL = length / 2;
  
  return new THREE.Box3(
    new THREE.Vector3(centerX - halfW, -depth, centerZ - halfL),
    new THREE.Vector3(centerX + halfW, 0, centerZ + halfL)
  );
}

interface WaterPoolProps {
  onPlayerSubmerged?: (isSubmerged: boolean, oxygen: number, maxOxygen: number) => void;
}

export function WaterPool({ onPlayerSubmerged }: WaterPoolProps) {
  const { scene } = useThree();
  const surfaceMeshRef = useRef<THREE.Mesh>(null);
  const poolGroupRef = useRef<THREE.Group>(null);
  
  const { centerX, centerZ, width, length, depth, surfaceColor, surfaceOpacity } = POOL_CONFIG;
  
  // Create reflective water surface material
  const surfaceMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: surfaceColor,
      transparent: true,
      opacity: surfaceOpacity,
      metalness: 0.8,
      roughness: 0.1,
      side: THREE.DoubleSide,
      envMapIntensity: 1.5,
    });
  }, [surfaceColor, surfaceOpacity]);
  
  // Pool walls material (dark blue)
  const wallMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: 0x0a2030,
      metalness: 0.3,
      roughness: 0.7,
    });
  }, []);
  
  // Pool floor material
  const floorMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: 0x051520,
      metalness: 0.2,
      roughness: 0.8,
    });
  }, []);
  
  // Cleanup
  useEffect(() => {
    return () => {
      surfaceMaterial.dispose();
      wallMaterial.dispose();
      floorMaterial.dispose();
    };
  }, [surfaceMaterial, wallMaterial, floorMaterial]);
  
  // Subtle wave animation for the surface
  useFrame((_, delta) => {
    if (surfaceMeshRef.current) {
      // Gentle up/down wave motion
      surfaceMeshRef.current.position.y = Math.sin(performance.now() * 0.001) * 0.02;
    }
  });
  
  const halfW = width / 2;
  const halfL = length / 2;
  const wallThickness = 0.5;
  
  return (
    <group ref={poolGroupRef} position={[centerX, 0, centerZ]}>
      {/* Water surface - reflective plane */}
      <mesh
        ref={surfaceMeshRef}
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[width, length]} />
        <primitive object={surfaceMaterial} attach="material" />
      </mesh>
      
      {/* Pool floor */}
      <mesh
        position={[0, -depth, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[width, length]} />
        <primitive object={floorMaterial} attach="material" />
      </mesh>
      
      {/* Pool walls - North (front) */}
      <mesh position={[0, -depth / 2, halfL + wallThickness / 2]} receiveShadow castShadow>
        <boxGeometry args={[width + wallThickness * 2, depth, wallThickness]} />
        <primitive object={wallMaterial} attach="material" />
      </mesh>
      
      {/* Pool walls - South (back) */}
      <mesh position={[0, -depth / 2, -halfL - wallThickness / 2]} receiveShadow castShadow>
        <boxGeometry args={[width + wallThickness * 2, depth, wallThickness]} />
        <primitive object={wallMaterial} attach="material" />
      </mesh>
      
      {/* Pool walls - East (right) */}
      <mesh position={[halfW + wallThickness / 2, -depth / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[wallThickness, depth, length]} />
        <primitive object={wallMaterial} attach="material" />
      </mesh>
      
      {/* Pool walls - West (left) */}
      <mesh position={[-halfW - wallThickness / 2, -depth / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[wallThickness, depth, length]} />
        <primitive object={wallMaterial} attach="material" />
      </mesh>
    </group>
  );
}

WaterPool.displayName = 'WaterPool';
