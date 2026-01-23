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

// Single side label component - renders tier separately with different styling
function SideLabelGroup({ 
  tier, 
  locationText, 
  username, 
  ageText, 
  blockText,
  position,
  rotation
}: {
  tier: number;
  locationText: string;
  username: string;
  ageText: string;
  blockText: string;
  position: [number, number, number];
  rotation: [number, number, number];
}) {
  const baseFontSize = 0.07;
  const tierFontSize = 0.09; // 2pts larger
  
  return (
    <group position={position} rotation={rotation}>
      {/* Tier label - black text, white outline, larger */}
      <Text
        fontSize={tierFontSize}
        color="black"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="white"
        position={[0, 0.22, 0]}
      >
        {`T${tier}`}
      </Text>
      
      {/* Other info - white text, black outline, positioned below tier with gap */}
      <Text
        fontSize={baseFontSize}
        color="white"
        anchorX="center"
        anchorY="top"
        outlineWidth={0.010}
        outlineColor="black"
        textAlign="center"
        lineHeight={1.3}
        position={[0, 0.10, 0]}
      >
        {`${locationText}\n${username}\n${ageText}\n${blockText}`}
      </Text>
    </group>
  );
}

// Single tree's labels on all 4 sides
function SingleTreeLabels({ tree, seedDef, username, ageInDays }: TreeLabelData) {
  const tier = seedDef?.tier ?? 0;
  const blockCount = tree.current_block_count;
  const targetBlocks = tree.target_block_count;
  const isGrowing = !tree.is_fully_grown;
  
  // Format text with parentheses around coordinates
  const locationText = `(${tree.base_x}, ${tree.base_y}, ${tree.base_z})`;
  const ageText = `${Math.max(1, ageInDays)} Days`; // Round up (at least 1 day)
  const blockText = isGrowing ? `${blockCount}/${targetBlocks}` : `${blockCount} blocks`;
  
  // Position at the base of the tree, slightly above ground
  const baseX = tree.base_x + 0.5;
  const baseY = tree.base_y + 0.8;
  const baseZ = tree.base_z + 0.5;
  
  return (
    <group position={[baseX, baseY, baseZ]}>
      {/* Front (facing +Z) - viewer at +Z looking toward -Z */}
      <SideLabelGroup
        tier={tier}
        locationText={locationText}
        username={username}
        ageText={ageText}
        blockText={blockText}
        position={[0, 0, 0.52]}
        rotation={[0, 0, 0]}
      />
      
      {/* Back (facing -Z) - viewer at -Z looking toward +Z */}
      <SideLabelGroup
        tier={tier}
        locationText={locationText}
        username={username}
        ageText={ageText}
        blockText={blockText}
        position={[0, 0, -0.52]}
        rotation={[0, Math.PI, 0]}
      />
      
      {/* Left (facing -X) - viewer at -X looking toward +X */}
      <SideLabelGroup
        tier={tier}
        locationText={locationText}
        username={username}
        ageText={ageText}
        blockText={blockText}
        position={[-0.52, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
      />
      
      {/* Right (facing +X) - viewer at +X looking toward -X */}
      <SideLabelGroup
        tier={tier}
        locationText={locationText}
        username={username}
        ageText={ageText}
        blockText={blockText}
        position={[0.52, 0, 0]}
        rotation={[0, -Math.PI / 2, 0]}
      />
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
      const ageInDays = Math.ceil((now - plantedAt) / (1000 * 60 * 60 * 24)); // Round up
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
