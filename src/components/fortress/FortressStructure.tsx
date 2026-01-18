import { useRef, useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { FORTRESS_DIMENSIONS } from './FortressCollision';

interface FortressStructureProps {
  fortressTextureUrl?: string | null;
  groundTextureUrl?: string | null;
}

export function FortressStructure({ 
  fortressTextureUrl, 
  groundTextureUrl 
}: FortressStructureProps) {
  const { cliffW, cliffH, frontT, courtyardDepth, frontZ, openingHalfW } = FORTRESS_DIMENSIONS;
  const openingH = 5;

  // Use props with fallbacks to defaults
  const cliffUrl = fortressTextureUrl || '/cliff_texture_seamless.webp';
  const grassUrl = groundTextureUrl || '/grass_texture_seamless.webp';

  // Track textures for disposal
  const [cliffTexture, setCliffTexture] = useState<THREE.Texture | null>(null);
  const [grassTexture, setGrassTexture] = useState<THREE.Texture | null>(null);
  const cliffTextureRef = useRef<THREE.Texture | null>(null);
  const grassTextureRef = useRef<THREE.Texture | null>(null);
  const clonedTexturesRef = useRef<THREE.Texture[]>([]);

  // Load base textures - re-run when URLs change
  useEffect(() => {
    // Dispose old textures before loading new ones
    if (cliffTextureRef.current) {
      cliffTextureRef.current.dispose();
      cliffTextureRef.current = null;
    }
    if (grassTextureRef.current) {
      grassTextureRef.current.dispose();
      grassTextureRef.current = null;
    }
    clonedTexturesRef.current.forEach(tex => tex.dispose());
    clonedTexturesRef.current = [];
    
    // Reset state to trigger re-render with null (shows nothing while loading)
    setCliffTexture(null);
    setGrassTexture(null);

    const loader = new THREE.TextureLoader();

    loader.load(cliffUrl, (texture) => {
      cliffTextureRef.current = texture;
      setCliffTexture(texture);
    });

    loader.load(grassUrl, (texture) => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(260, 260); // 1 texture unit per 1 meter (ground is 260x260m)
      grassTextureRef.current = texture;
      setGrassTexture(texture);
    });

    return () => {
      if (cliffTextureRef.current) {
        cliffTextureRef.current.dispose();
        cliffTextureRef.current = null;
      }
      if (grassTextureRef.current) {
        grassTextureRef.current.dispose();
        grassTextureRef.current = null;
      }
      clonedTexturesRef.current.forEach(tex => tex.dispose());
      clonedTexturesRef.current = [];
    };
  }, [cliffUrl, grassUrl]);

  // Create individual textures for each wall with proper scaling
  const frontTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3.6, 4);
    clonedTexturesRef.current.push(texture);
    return texture;
  }, [cliffTexture]);

  const topTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.8, 3);
    clonedTexturesRef.current.push(texture);
    return texture;
  }, [cliffTexture]);

  const sideTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 4);
    clonedTexturesRef.current.push(texture);
    return texture;
  }, [cliffTexture]);

  const backTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 4);
    clonedTexturesRef.current.push(texture);
    return texture;
  }, [cliffTexture]);

  const courtyardTexture = useMemo(() => {
    if (!grassTexture) return null;
    const texture = grassTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set((cliffW - 4) / 6.5, (courtyardDepth - 2) / 6.5);
    clonedTexturesRef.current.push(texture);
    return texture;
  }, [grassTexture, cliffW, courtyardDepth]);

  // Wait for textures before rendering
  if (!grassTexture || !frontTexture || !topTexture || !sideTexture || !backTexture || !courtyardTexture) {
    return null;
  }

  return (
    <group>
      {/* Ground is now rendered by ProceduralGround component */}

      {/* Front wall - Left pillar */}
      <mesh position={[-(cliffW / 2 + openingHalfW) / 2, cliffH / 2, frontZ]} castShadow receiveShadow>
        <boxGeometry args={[cliffW / 2 - openingHalfW, cliffH, frontT]} />
        <meshStandardMaterial map={frontTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Front wall - Right pillar */}
      <mesh position={[(cliffW / 2 + openingHalfW) / 2, cliffH / 2, frontZ]} castShadow receiveShadow>
        <boxGeometry args={[cliffW / 2 - openingHalfW, cliffH, frontT]} />
        <meshStandardMaterial map={frontTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Front wall - Top piece above opening */}
      <mesh position={[0, openingH + (cliffH - openingH) / 2, frontZ]} castShadow receiveShadow>
        <boxGeometry args={[openingHalfW * 2, cliffH - openingH, frontT]} />
        <meshStandardMaterial map={topTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Left wall */}
      <mesh position={[-cliffW / 2 + 1, cliffH / 2, frontZ - courtyardDepth / 2 - frontT / 2]} castShadow receiveShadow>
        <boxGeometry args={[2, cliffH, courtyardDepth + frontT]} />
        <meshStandardMaterial map={sideTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Right wall */}
      <mesh position={[cliffW / 2 - 1, cliffH / 2, frontZ - courtyardDepth / 2 - frontT / 2]} castShadow receiveShadow>
        <boxGeometry args={[2, cliffH, courtyardDepth + frontT]} />
        <meshStandardMaterial map={sideTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, cliffH / 2, frontZ - courtyardDepth - frontT]} castShadow receiveShadow>
        <boxGeometry args={[cliffW, cliffH, 2]} />
        <meshStandardMaterial map={backTexture} metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Courtyard floor */}
      <mesh
        position={[0, 0.01, frontZ - courtyardDepth / 2 - frontT / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[cliffW - 4, courtyardDepth - 2]} />
        <meshStandardMaterial
          map={courtyardTexture}
          metalness={0}
          roughness={1}
        />
      </mesh>
    </group>
  );
}
