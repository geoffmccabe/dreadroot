import { useRef, useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { FORTRESS_DIMENSIONS } from './FortressCollision';

interface FortressStructureProps {
  fortressTextureUrl?: string | null;
  groundTextureUrl?: string | null;
}

// Crenellation (battlement) cube size — "2x2 square blocks on top".
const MERLON = 2;

// The mesh fortress walls + battlements were converted to real, superadmin-owned
// placed blocks (see fortressBlockSchematic.ts + scripts/seed_fortress_blocks.sql):
// ~5844 blocks fill the exact same volumes in Default World. We stop drawing the
// mesh walls so they don't double-draw over the blocks. The courtyard floor +
// fortress colliders stay. Flip this back to true to restore the old hardcoded
// walls (e.g. for a world that has no seeded fortress blocks).
const RENDER_MESH_WALLS = false;

/**
 * Merlon center offsets along a wall's top edge. Merlons (2-wide) alternate with
 * gaps so the top reads as a serrated castle battlement. A merlon sits flush at
 * each corner and the rest distribute evenly inward — so the center absorbs the
 * leftover (its gap, and effectively 1–3 blocks worth of span, flexes to fit).
 */
function crenelCenters(length: number, w = MERLON, gap = MERLON): number[] {
  if (length <= w) return [length / 2];
  const period = w + gap;
  const n = Math.max(2, Math.round((length - w) / period) + 1);
  const step = (length - w) / (n - 1);
  return Array.from({ length: n }, (_, i) => w / 2 + i * step);
}

/** Renders 2×2×2 merlon cubes along one top edge of the wall. */
function Crenellations({
  axis, min, max, perp, top, material,
}: {
  axis: 'x' | 'z';
  min: number; max: number; perp: number; top: number;
  material: THREE.Material;
}) {
  const lo = Math.min(min, max);
  const centers = crenelCenters(Math.abs(max - min));
  return (
    <>
      {centers.map((c, i) => {
        const along = lo + c;
        const position: [number, number, number] =
          axis === 'x' ? [along, top + MERLON / 2, perp] : [perp, top + MERLON / 2, along];
        return (
          <mesh key={i} position={position} material={material} castShadow receiveShadow>
            <boxGeometry args={[MERLON, MERLON, MERLON]} />
          </mesh>
        );
      })}
    </>
  );
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

  // Small-repeat cliff texture + a shared material for the merlon cubes (matches the walls).
  const merlonTexture = useMemo(() => {
    if (!cliffTexture) return null;
    const texture = cliffTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    clonedTexturesRef.current.push(texture);
    return texture;
  }, [cliffTexture]);

  const merlonMaterial = useMemo(() => {
    if (!merlonTexture) return null;
    return new THREE.MeshStandardMaterial({
      map: merlonTexture,
      metalness: 0.1,
      roughness: 0.9,
    });
  }, [merlonTexture]);

  useEffect(() => () => merlonMaterial?.dispose(), [merlonMaterial]);

  const courtyardTexture = useMemo(() => {
    if (!grassTexture) return null;
    const texture = grassTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set((cliffW - 4) / 6.5, (courtyardDepth - 2) / 6.5);
    clonedTexturesRef.current.push(texture);
    return texture;
  }, [grassTexture, cliffW, courtyardDepth]);

  // Wait for textures before rendering. The courtyard floor only needs grass;
  // the cliff-derived wall textures are only required when drawing the mesh walls.
  if (!grassTexture || !courtyardTexture) {
    return null;
  }
  if (RENDER_MESH_WALLS && (!frontTexture || !topTexture || !sideTexture || !backTexture)) {
    return null;
  }

  // Top-edge spans (y = cliffH) for the four wall runs the battlements sit on.
  const backZ = frontZ - courtyardDepth - frontT;

  return (
    <group>
      {/* Ground is now rendered by ProceduralGround component */}

      {/* Walls + battlements are now real placed blocks — see RENDER_MESH_WALLS above. */}
      {RENDER_MESH_WALLS && (
        <>
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

      {/* Crenellations (battlements) along all four top edges */}
      {merlonMaterial && (
        <>
          <Crenellations axis="x" min={-cliffW / 2} max={cliffW / 2} perp={frontZ} top={cliffH} material={merlonMaterial} />
          <Crenellations axis="x" min={-cliffW / 2} max={cliffW / 2} perp={backZ} top={cliffH} material={merlonMaterial} />
          <Crenellations axis="z" min={backZ} max={frontZ} perp={-cliffW / 2 + 1} top={cliffH} material={merlonMaterial} />
          <Crenellations axis="z" min={backZ} max={frontZ} perp={cliffW / 2 - 1} top={cliffH} material={merlonMaterial} />
        </>
      )}
        </>
      )}

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
