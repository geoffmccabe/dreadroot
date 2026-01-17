// TreeRenderer - Renders tree blocks as instanced meshes
// Displays trunk and leaf blocks from the tree_blocks table

import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { TreeBlock } from '../types';

interface TreeRendererProps {
  treeBlocks: TreeBlock[];
  trunkTextureUrl?: string | null;
  leafTextureUrl?: string | null;
}

const tempMatrix = new THREE.Matrix4();
const defaultTrunkColor = new THREE.Color('#8B4513'); // Brown
const defaultLeafColor = new THREE.Color('#228B22'); // Forest green

export function TreeRenderer({ treeBlocks, trunkTextureUrl, leafTextureUrl }: TreeRendererProps) {
  const trunkMeshRef = useRef<THREE.InstancedMesh>(null);
  const leafMeshRef = useRef<THREE.InstancedMesh>(null);

  // Separate blocks by type
  const { trunkBlocks, leafBlocks } = useMemo(() => {
    const trunk: TreeBlock[] = [];
    const leaf: TreeBlock[] = [];
    
    for (const block of treeBlocks) {
      if (block.block_type === 'trunk') {
        trunk.push(block);
      } else if (block.block_type === 'leaf') {
        leaf.push(block);
      }
    }
    
    return { trunkBlocks: trunk, leafBlocks: leaf };
  }, [treeBlocks]);

  // Load textures
  const trunkTexture = useMemo(() => {
    if (!trunkTextureUrl) return null;
    const tex = new THREE.TextureLoader().load(trunkTextureUrl);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
  }, [trunkTextureUrl]);

  const leafTexture = useMemo(() => {
    if (!leafTextureUrl) return null;
    const tex = new THREE.TextureLoader().load(leafTextureUrl);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
  }, [leafTextureUrl]);

  // Update trunk instances
  useEffect(() => {
    if (!trunkMeshRef.current) return;
    
    trunkBlocks.forEach((block, i) => {
      tempMatrix.setPosition(
        block.position_x + 0.5,
        block.position_y + 0.5,
        block.position_z + 0.5
      );
      trunkMeshRef.current!.setMatrixAt(i, tempMatrix);
    });
    
    trunkMeshRef.current.count = trunkBlocks.length;
    trunkMeshRef.current.instanceMatrix.needsUpdate = true;
  }, [trunkBlocks]);

  // Update leaf instances
  useEffect(() => {
    if (!leafMeshRef.current) return;
    
    leafBlocks.forEach((block, i) => {
      tempMatrix.setPosition(
        block.position_x + 0.5,
        block.position_y + 0.5,
        block.position_z + 0.5
      );
      leafMeshRef.current!.setMatrixAt(i, tempMatrix);
    });
    
    leafMeshRef.current.count = leafBlocks.length;
    leafMeshRef.current.instanceMatrix.needsUpdate = true;
  }, [leafBlocks]);

  const maxBlocks = 5000; // Max blocks per type

  return (
    <>
      {/* Trunk blocks */}
      <instancedMesh
        ref={trunkMeshRef}
        args={[undefined, undefined, maxBlocks]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        {trunkTexture ? (
          <meshStandardMaterial map={trunkTexture} />
        ) : (
          <meshStandardMaterial color={defaultTrunkColor} />
        )}
      </instancedMesh>

      {/* Leaf blocks */}
      <instancedMesh
        ref={leafMeshRef}
        args={[undefined, undefined, maxBlocks]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        {leafTexture ? (
          <meshStandardMaterial map={leafTexture} transparent opacity={0.9} />
        ) : (
          <meshStandardMaterial color={defaultLeafColor} transparent opacity={0.9} />
        )}
      </instancedMesh>
    </>
  );
}
