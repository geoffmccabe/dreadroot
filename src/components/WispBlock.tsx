import React, { useRef, useMemo, useEffect } from 'react';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { BlockType } from '@/types/blocks';

interface WispBlockProps {
  positionRef: React.MutableRefObject<THREE.Vector3>;
  blockType: BlockType;
  onMeshReady?: (mesh: THREE.Mesh | null) => void;
}

export const WispBlock: React.FC<WispBlockProps> = ({ 
  positionRef, 
  blockType,
  onMeshReady 
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowIntensityRef = useRef(0.5);
  const glowDirectionRef = useRef(1);
  
  // Load texture with proper caching (useLoader handles caching automatically)
  const texture = blockType.texture?.diffuse 
    ? useLoader(THREE.TextureLoader, blockType.texture.diffuse)
    : null;

  // Create material with transparency and glow
  const material = useMemo(() => {
    const baseColor = blockType.properties?.color || '#ffffff';
    
    return new THREE.MeshStandardMaterial({
      map: texture,
      color: baseColor,
      transparent: true,
      opacity: 0.5,
      emissive: new THREE.Color(baseColor),
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide
    });
  }, [texture, blockType.properties?.color]);

  // Notify parent when mesh is ready
  useEffect(() => {
    if (meshRef.current && onMeshReady) {
      onMeshReady(meshRef.current);
    }
    return () => {
      if (onMeshReady) {
        onMeshReady(null);
      }
    };
  }, [onMeshReady]);

  // Track if component is mounted to avoid unnecessary work
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Animate glow and smooth position interpolation
  useFrame((state, delta) => {
    // Early exit if unmounted or mesh not ready
    if (!isMountedRef.current || !meshRef.current) return;
    
    // Read target position from ref (no re-renders)
    const targetPos = positionRef.current;
    
    // Smooth position interpolation (lerp to target position)
    meshRef.current.position.lerp(targetPos, 0.3);
    
    // Pulsing glow effect
    glowIntensityRef.current += glowDirectionRef.current * delta * 2;
    
    if (glowIntensityRef.current >= 1.0) {
      glowIntensityRef.current = 1.0;
      glowDirectionRef.current = -1;
    } else if (glowIntensityRef.current <= 0.5) {
      glowIntensityRef.current = 0.5;
      glowDirectionRef.current = 1;
    }
    
    // Update emissive intensity
    if (meshRef.current.material instanceof THREE.MeshStandardMaterial) {
      meshRef.current.material.emissiveIntensity = glowIntensityRef.current;
    }
    
    // Gentle floating/bobbing animation
    const bobOffset = Math.sin(state.clock.elapsedTime * 2) * 0.1;
    meshRef.current.position.y = targetPos.y + bobOffset;
    
    // Gentle rotation
    meshRef.current.rotation.y += delta * 0.5;
  });

  return (
    <mesh 
      ref={meshRef} 
      position={[positionRef.current.x, positionRef.current.y, positionRef.current.z]}
      material={material}
    >
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  );
};
