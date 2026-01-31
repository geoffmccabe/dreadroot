// Tree Info Labels - Displays tier, location, owner, age, block count on all 4 sides of planted trees
// Uses Three.js Text with white text and thick black outline for visibility

import React, { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { PlantedTree } from '../types';
import { CHUNK_SIZE } from '@/lib/chunkManager';

interface TreeInfoLabelsProps {
  trees: PlantedTree[];
  seedDefinitions: Array<{ id: string; tier: number; trunk_texture_url: string | null }>;
  usernames: Map<string, string>; // Map of user_id to username
  cameraRef: React.RefObject<THREE.Camera>;
}

interface TreeLabelData {
  tree: PlantedTree;
  seedDef: { id: string; tier: number; trunk_texture_url: string | null } | undefined;
  username: string;
  ageInDays: number;
}

// Max number of labeled trees to render (caps draw calls from labels)
const MAX_LABELED_TREES = 3;
// Max distance (in blocks) from camera to show labels
const LABEL_DISTANCE = 24;

// Single side label component - single merged Text element (1 draw call per side)
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

  return (
    <group position={position} rotation={rotation}>
      {/* Merged label: tier + info in single Text element (halves draw calls) */}
      <Text
        fontSize={baseFontSize}
        color="white"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.012}
        outlineColor="black"
        textAlign="center"
        lineHeight={1.3}
      >
        {`T${tier}\n${locationText}\n${username}\n${ageText}\n${blockText}`}
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
  
  // Position at the center of the seed block face
  const baseX = tree.base_x + 0.5;
  const baseY = tree.base_y + 0.5;
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
        rotation={[0, -Math.PI / 2, 0]}
      />

      {/* Right (facing +X) - viewer at +X looking toward -X */}
      <SideLabelGroup
        tier={tier}
        locationText={locationText}
        username={username}
        ageText={ageText}
        blockText={blockText}
        position={[0.52, 0, 0]}
        rotation={[0, Math.PI / 2, 0]}
      />
    </group>
  );
}

export function TreeInfoLabels({ trees, seedDefinitions, usernames, cameraRef }: TreeInfoLabelsProps) {
  // Track which chunk the camera is in
  const cameraChunkRef = useRef({ cx: Infinity, cz: Infinity });
  const [cameraChunk, setCameraChunk] = useState<{ cx: number; cz: number }>({ cx: Infinity, cz: Infinity });

  useFrame(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    const cx = Math.floor(cam.position.x / CHUNK_SIZE);
    const cz = Math.floor(cam.position.z / CHUNK_SIZE);
    if (cx !== cameraChunkRef.current.cx || cz !== cameraChunkRef.current.cz) {
      cameraChunkRef.current = { cx, cz };
      setCameraChunk({ cx, cz });
    }
  });

  // Track camera position for distance culling
  const cameraPosRef = useRef(new THREE.Vector3());

  useFrame(() => {
    const cam = cameraRef.current;
    if (cam) cameraPosRef.current.copy(cam.position);
  });

  // Pre-compute label data: chunk-filtered, distance-culled, count-limited
  const labelData = useMemo(() => {
    const now = Date.now();
    const seedDefMap = new Map(seedDefinitions.map(sd => [sd.id, sd]));
    const camPos = cameraPosRef.current;

    // Filter to camera chunk and within distance
    const candidates = trees
      .filter(tree => {
        const treeCx = Math.floor(tree.base_x / CHUNK_SIZE);
        const treeCz = Math.floor(tree.base_z / CHUNK_SIZE);
        if (treeCx !== cameraChunk.cx || treeCz !== cameraChunk.cz) return false;
        // Distance culling
        const dx = tree.base_x - camPos.x;
        const dz = tree.base_z - camPos.z;
        return (dx * dx + dz * dz) <= LABEL_DISTANCE * LABEL_DISTANCE;
      })
      .map(tree => {
        const seedDef = seedDefMap.get(tree.seed_definition_id);
        const plantedAt = new Date(tree.planted_at).getTime();
        const ageInDays = Math.ceil((now - plantedAt) / (1000 * 60 * 60 * 24));
        const username = usernames.get(tree.planted_by) || 'Unknown';
        // Compute distance for sorting
        const dx = tree.base_x - camPos.x;
        const dz = tree.base_z - camPos.z;
        const distSq = dx * dx + dz * dz;

        return { tree, seedDef, username, ageInDays, distSq };
      });

    // Sort by distance and limit count to cap draw calls
    candidates.sort((a, b) => a.distSq - b.distSq);
    return candidates.slice(0, MAX_LABELED_TREES);
  }, [trees, seedDefinitions, usernames, cameraChunk]);

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
