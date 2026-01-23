// Tree Info Labels - Displays tier, location, owner, age, block count on all 4 sides of planted trees
// Uses Three.js Text with white text and thick black outline for visibility

import React, { useMemo } from 'react';
import { Text } from '@react-three/drei';
import { PlantedTree } from '../types';

interface TreeInfoLabelsProps {
  trees: PlantedTree[];
  seedDefinitions: Array<{ id: string; tier: number; trunk_texture_url: string | null }>;
  usernames: Map<string, string>; // Map of user_id to username
}

interface TreeLabelData {
  tree: PlantedTree;
  seedDef: { id: string; tier: number; trunk_texture_url: string | null } | undefined;
  username: string;
  ageInDays: number;
}

// Single tree's labels on all 4 sides
function SingleTreeLabels({ tree, seedDef, username, ageInDays }: TreeLabelData) {
  const tier = seedDef?.tier ?? 0;
  const blockCount = tree.current_block_count;
  const targetBlocks = tree.target_block_count;
  const isGrowing = !tree.is_fully_grown;
  
  // Format the label text
  const labelLines = [
    `T${tier}`,
    `${tree.base_x}, ${tree.base_y}, ${tree.base_z}`,
    username || 'Unknown',
    `${ageInDays}d old`,
    isGrowing ? `${blockCount}/${targetBlocks}` : `${blockCount} blocks`
  ];
  const labelText = labelLines.join('\n');
  
  // Position at the base of the tree, slightly above ground
  const baseX = tree.base_x + 0.5;
  const baseY = tree.base_y + 0.8;
  const baseZ = tree.base_z + 0.5;
  
  // Text properties for visibility
  const textProps = {
    fontSize: 0.15,
    color: 'white',
    anchorX: 'center' as const,
    anchorY: 'middle' as const,
    outlineWidth: 0.02,
    outlineColor: 'black',
    textAlign: 'center' as const,
    lineHeight: 1.2,
  };
  
  return (
    <group position={[baseX, baseY, baseZ]}>
      {/* Front (facing +Z) */}
      <Text
        {...textProps}
        position={[0, 0, 0.52]}
        rotation={[0, 0, 0]}
      >
        {labelText}
      </Text>
      
      {/* Back (facing -Z) */}
      <Text
        {...textProps}
        position={[0, 0, -0.52]}
        rotation={[0, Math.PI, 0]}
      >
        {labelText}
      </Text>
      
      {/* Left (facing -X) */}
      <Text
        {...textProps}
        position={[-0.52, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
      >
        {labelText}
      </Text>
      
      {/* Right (facing +X) */}
      <Text
        {...textProps}
        position={[0.52, 0, 0]}
        rotation={[0, -Math.PI / 2, 0]}
      >
        {labelText}
      </Text>
    </group>
  );
}

export function TreeInfoLabels({ trees, seedDefinitions, usernames }: TreeInfoLabelsProps) {
  // Pre-compute label data for all trees
  const labelData = useMemo(() => {
    const now = Date.now();
    const seedDefMap = new Map(seedDefinitions.map(sd => [sd.id, sd]));
    
    return trees.map(tree => {
      const seedDef = seedDefMap.get(tree.seed_definition_id);
      const plantedAt = new Date(tree.planted_at).getTime();
      const ageInDays = Math.floor((now - plantedAt) / (1000 * 60 * 60 * 24));
      const username = usernames.get(tree.planted_by) || 'Unknown';
      
      return {
        tree,
        seedDef,
        username,
        ageInDays,
      };
    });
  }, [trees, seedDefinitions, usernames]);
  
  return (
    <>
      {labelData.map(data => (
        <SingleTreeLabels
          key={data.tree.id}
          tree={data.tree}
          seedDef={data.seedDef}
          username={data.username}
          ageInDays={data.ageInDays}
        />
      ))}
    </>
  );
}
