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
import { FadeChunkBlocks } from '@/components/FadeChunkBlocks';
import { getAtlasVersion, useTextureAtlas } from '@/hooks/useTextureAtlas';
import { useAtlasSync } from '@/hooks/useAtlasSync';
import { useBlocksData } from '@/hooks/useBlocksData';

const FADE_EXTRA = 2;

export function CameraTrackedBlocks({
  showOwnershipOutline,
  currentUserId,
  hoveredBlockId,
  onMeshReady,
  performanceMode = false,
  groundTextureUrl
}: {
  showOwnershipOutline: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  onMeshReady?: (blockType: string, mesh: THREE.InstancedMesh | null) => void;
  performanceMode?: boolean;
  groundTextureUrl?: string | null;
}) {
  const { camera } = useThree();
  const { blocksByChunk, visibleChunksRef, visualDistance, updatePlayerPosition, loadedChunksRef, worldRevision } = useBlocks();

  // Phase 1 optimization: Call expensive hooks ONCE here instead of 71× in PlacedBlocks
  // Results are passed down through ChunkRenderer → PlacedBlocks as hoisted props
  const hoistedAtlas = useTextureAtlas();
  const hoistedAtlasTexture = hoistedAtlas.texture;
  const hoistedAtlasReady = hoistedAtlas.isReady;
  useAtlasSync(); // Single sync instead of 71× (each fires 6 React Query fetches)
  const { blocksMap: hoistedBlocksMap, isLoading: hoistedBlockDefsLoading } = useBlocksData();

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

  // Localize hoveredBlockId to the chunk that contains it
  // This prevents memo busting across all chunks when hover changes
  const hoveredChunkKey = useMemo(() => {
    if (!hoveredBlockId) return null;
    const ref = loadedChunksRef?.current;
    if (!ref) return null;
    for (const [chunkKey, chunkData] of ref) {
      const blocks = chunkData.visibleBlocks ?? chunkData.blocks;
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].id === hoveredBlockId) return chunkKey;
      }
    }
    return null;
  }, [hoveredBlockId, loadedChunksRef]);

  // Phase 1: Per-chunk rendering — iterate loaded chunks, classify into normal vs fade
  // Normal chunks: within visualDistance, full atlas rendering
  // Fade chunks: visualDistance+1 to visualDistance+2, grey silhouette rendering
  const { normalEntries, fadeEntries } = useMemo(() => {
    const normal: { key: string; blocks: PlacedBlock[] }[] = [];
    const fade: { key: string; blocks: PlacedBlock[]; distanceFactor: number }[] = [];
    const ref = loadedChunksRef?.current;

    const camChunkX = lastChunkRef.current.x;
    const camChunkZ = lastChunkRef.current.z;

    if (ref && ref.size > 0) {
      for (const [chunkKey, chunkData] of ref) {
        if (!chunkData?.blocks || chunkData.blocks.length === 0) continue;

        // Parse chunk coords from key "chunk_X_Z"
        const parts = chunkKey.split('_');
        const cx = parseInt(parts[1]);
        const cz = parseInt(parts[2]);
        const dcx = Math.abs(cx - camChunkX);
        const dcz = Math.abs(cz - camChunkZ);
        const chunkDist = Math.max(dcx, dcz); // Chebyshev distance

        const blocks = chunkData.visibleBlocks ?? chunkData.blocks;

        if (chunkDist <= visualDistance) {
          normal.push({ key: chunkKey, blocks });
        } else if (chunkDist <= visualDistance + FADE_EXTRA) {
          const distanceFactor = (chunkDist - visualDistance) / FADE_EXTRA;
          fade.push({ key: chunkKey, blocks, distanceFactor });
        }
      }
    }

    // FALLBACK: If loadedChunksRef is empty, use blocksByChunk (React state)
    if (normal.length === 0 && blocksByChunk.size > 0) {
      for (const [chunkKey, chunkBlocks] of blocksByChunk) {
        if (chunkBlocks && chunkBlocks.length > 0) {
          normal.push({ key: chunkKey, blocks: chunkBlocks });
        }
      }
    }

    diagnostics.setChunkRenderCount(normal.length);

    return { normalEntries: normal, fadeEntries: fade };
  }, [renderTrigger, blocksByChunk, loadedChunksRef, worldRevision, visualDistance]);

  return (
    <>
      <FadeChunkBlocks entries={fadeEntries} />
      <ProceduralGround
        visibleChunksRef={visibleChunksRef}
        renderTrigger={renderTrigger}
        textureUrl={groundTextureUrl || '/grass_texture_seamless.webp'}
        visualDistance={visualDistance}
        cameraRef={{ current: camera }}
      />
      {normalEntries.map(({ key, blocks: chunkBlocks }) => (
        <ChunkRenderer
          key={key}
          chunkKey={key}
          blocks={chunkBlocks}
          atlasVersion={atlasVersion}
          showOwnershipOutline={performanceMode ? false : showOwnershipOutline}
          currentUserId={currentUserId}
          hoveredBlockId={performanceMode ? null : (key === hoveredChunkKey ? hoveredBlockId : null)}
          onMeshReady={onMeshReady}
          performanceMode={performanceMode}
          hoistedAtlasTexture={hoistedAtlasTexture}
          hoistedAtlasReady={hoistedAtlasReady}
          hoistedBlocksMap={hoistedBlocksMap}
          hoistedBlockDefsLoading={hoistedBlockDefsLoading}
        />
      ))}
    </>
  );
}
