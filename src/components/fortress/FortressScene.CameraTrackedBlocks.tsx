import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';

import { useBlocks } from '@/contexts/BlocksContext';
import { PlacedBlock } from '@/types/blocks';
import { CHUNK_SIZE, getVisibleChunkKeys } from '@/lib/chunkManager';
import { CAMERA_START_X, CAMERA_START_Z } from './fortressScene.constants';

import ChunkRenderer from '@/components/ChunkRenderer';
import { ProceduralGround } from './ProceduralGround';
import { getAtlasVersion } from '@/hooks/useTextureAtlas';

export function CameraTrackedBlocks({
  blocks,
  showOwnershipOutline,
  currentUserId,
  hoveredBlockId,
  onMeshReady,
  performanceMode = false,
  groundTextureUrl
}: {
  blocks: PlacedBlock[];
  showOwnershipOutline: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  onMeshReady?: (blockType: string, mesh: THREE.InstancedMesh | null) => void;
  performanceMode?: boolean;
  groundTextureUrl?: string | null;
}) {
  const { camera } = useThree();
  const { blocksByChunk, visibleChunksRef, visualDistance, updatePlayerPosition, loadedChunksRef, worldRevision } = useBlocks();

  const lastChunkRef = useRef({ x: 0, z: 0 });
  const lastUpdateTime = useRef(0);
  const lastVisualDistance = useRef(visualDistance);

  const [renderTrigger, setRenderTrigger] = useState(0);
  const CHUNK_UPDATE_THROTTLE = 100; // ms

  // Track atlas version for chunk re-renders on atlas update
  const [atlasVersion, setAtlasVersion] = useState(() => getAtlasVersion());
  useEffect(() => {
    const interval = setInterval(() => {
      const v = getAtlasVersion();
      if (v !== atlasVersion) setAtlasVersion(v);
    }, 1000);
    return () => clearInterval(interval);
  }, [atlasVersion]);

  // Initialize visible chunks on mount - runs ONCE with stable starting position
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const initX = CAMERA_START_X;
    const initZ = CAMERA_START_Z;

    const visibleChunkKeys = getVisibleChunkKeys(initX, initZ, visualDistance);
    visibleChunksRef.current = new Set(visibleChunkKeys);
    lastChunkRef.current = {
      x: Math.floor(initX / CHUNK_SIZE),
      z: Math.floor(initZ / CHUNK_SIZE)
    };
    setRenderTrigger(prev => prev + 1);
  }, [visualDistance, visibleChunksRef]);

  // Recalculate visible chunks when visualDistance changes
  useEffect(() => {
    if (visualDistance !== lastVisualDistance.current) {
      lastVisualDistance.current = visualDistance;
      const visibleChunkKeys = getVisibleChunkKeys(
        camera.position.x,
        camera.position.z,
        visualDistance
      );
      visibleChunksRef.current = new Set(visibleChunkKeys);
      updatePlayerPosition(camera.position.x, camera.position.z);
      setRenderTrigger(prev => prev + 1);
    }
  }, [visualDistance, camera, visibleChunksRef, updatePlayerPosition]);

  // Track camera movement via the centralized frame loop
  useEffect(() => {
    const unregister = frameLoop.register('cameraChunks', () => {
      const currentChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
      const currentChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);
      const now = Date.now();

      if ((currentChunkX !== lastChunkRef.current.x || currentChunkZ !== lastChunkRef.current.z) &&
          now - lastUpdateTime.current > CHUNK_UPDATE_THROTTLE) {
        lastUpdateTime.current = now;
        lastChunkRef.current = { x: currentChunkX, z: currentChunkZ };

        const visibleChunkKeys = getVisibleChunkKeys(
          camera.position.x,
          camera.position.z,
          lastVisualDistance.current
        );

        const setRef = visibleChunksRef.current;
        setRef.clear();
        for (const key of visibleChunkKeys) setRef.add(key);
        diagnostics.e4++;

        updatePlayerPosition(camera.position.x, camera.position.z);

        requestAnimationFrame(() => setRenderTrigger(prev => prev + 1));
      }
    }, 100);

    return unregister;
  }, [camera, visibleChunksRef, updatePlayerPosition]);

  // Phase 1: Per-chunk rendering — iterate loaded chunks, render one ChunkRenderer per chunk
  // No global flatten, no dedup Set, no localeCompare sort
  const chunkEntries = useMemo(() => {
    const entries: { key: string; blocks: PlacedBlock[] }[] = [];
    const ref = loadedChunksRef?.current;

    if (ref && ref.size > 0) {
      for (const [chunkKey, chunkData] of ref) {
        if (chunkData?.blocks && chunkData.blocks.length > 0) {
          // Use visibleBlocks (surface-culled) if available, else full blocks
          entries.push({
            key: chunkKey,
            blocks: chunkData.visibleBlocks ?? chunkData.blocks
          });
        }
      }
    }

    // FALLBACK: If loadedChunksRef is empty, use blocksByChunk (React state)
    if (entries.length === 0 && blocksByChunk.size > 0) {
      for (const [chunkKey, chunkBlocks] of blocksByChunk) {
        if (chunkBlocks && chunkBlocks.length > 0) {
          entries.push({ key: chunkKey, blocks: chunkBlocks });
        }
      }
    }

    // Update diagnostic counter
    diagnostics.setChunkRenderCount(entries.length);

    return entries;
  }, [renderTrigger, blocksByChunk, loadedChunksRef, worldRevision]);

  return (
    <>
      <ProceduralGround
        visibleChunksRef={visibleChunksRef}
        renderTrigger={renderTrigger}
        textureUrl={groundTextureUrl || '/grass_texture_seamless.webp'}
        visualDistance={visualDistance}
        cameraRef={{ current: camera }}
      />
      {chunkEntries.map(({ key, blocks: chunkBlocks }) => (
        <ChunkRenderer
          key={key}
          chunkKey={key}
          blocks={chunkBlocks}
          atlasVersion={atlasVersion}
          showOwnershipOutline={performanceMode ? false : showOwnershipOutline}
          currentUserId={currentUserId}
          hoveredBlockId={performanceMode ? null : (hoveredBlockId || null)}
          onMeshReady={onMeshReady}
          performanceMode={performanceMode}
        />
      ))}
    </>
  );
}
