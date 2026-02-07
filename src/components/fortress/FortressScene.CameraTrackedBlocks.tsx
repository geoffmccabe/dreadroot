import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';

import { useBlocks } from '@/contexts/BlocksContext';
import { PlacedBlock } from '@/types/blocks';
import { CHUNK_SIZE, getVisibleChunkKeys, parseChunkKey } from '@/lib/chunkManager';
import { CAMERA_START_X, CAMERA_START_Z } from './fortressScene.constants';

import ChunkRenderer from '@/components/ChunkRenderer';
import { ProceduralGround } from './ProceduralGround';
import { FadeChunkBlocks } from '@/components/FadeChunkBlocks';
import { WaterBlocks } from '@/components/WaterBlocks';
import type { ViewSettings } from './FortressTypes';
import { getAtlasVersion, useTextureAtlas } from '@/hooks/useTextureAtlas';
import { useAtlasSync } from '@/hooks/useAtlasSync';
import { useBlocksData } from '@/hooks/useBlocksData';
import { useWorldPonds } from '@/hooks/useWorldPonds';

const FADE_EXTRA = 3;

export function CameraTrackedBlocks({
  showOwnershipOutline,
  currentUserId,
  hoveredBlockId,
  onMeshReady,
  performanceMode = false,
  groundTextureUrl,
  viewSettings
}: {
  showOwnershipOutline: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  onMeshReady?: (blockType: string, mesh: THREE.InstancedMesh | null) => void;
  performanceMode?: boolean;
  groundTextureUrl?: string | null;
  viewSettings?: ViewSettings;
}) {
  const { camera } = useThree();
  const { blocksByChunk, visibleChunksRef, visualDistance, updatePlayerPosition, loadedChunksRef, worldRevision, currentWorldId } = useBlocks();

  // Load pond data for water rendering
  const worldPonds = useWorldPonds(currentWorldId);

  // Phase 1 optimization: Call expensive hooks ONCE here instead of 71× in PlacedBlocks
  // Results are passed down through ChunkRenderer → PlacedBlocks as hoisted props
  const hoistedAtlas = useTextureAtlas();
  const hoistedAtlasTexture = hoistedAtlas.texture;
  const hoistedAtlasReady = hoistedAtlas.isReady;
  useAtlasSync(); // Single sync instead of 71× (each fires 6 React Query fetches)
  const { blocksMap: hoistedBlocksMap, isLoading: hoistedBlockDefsLoading } = useBlocksData();

  // One-time diagnostic: log rendering pipeline state to confirm blocks flow through
  const debugLogRef = useRef(false);

  const lastChunkRef = useRef({ x: 0, z: 0 });
  const lastUpdateTime = useRef(0);
  const lastVisualDistance = useRef(visualDistance);

  const [renderTrigger, setRenderTrigger] = useState(0);
  const CHUNK_UPDATE_THROTTLE = 100; // ms

  // === Chunk Mount Staggering ===
  // Prevents 40+ new chunks from mounting simultaneously at boundary crossings.
  // Each render cycle admits at most MAX_NEW_CHUNKS_PER_CYCLE new chunks.
  // Already-rendered chunks pass through immediately (no throttle on re-renders).
  const MAX_NEW_CHUNKS_PER_CYCLE = 4;
  const STAGGER_DELAY_MS = 30; // ms between mount batches
  const admittedChunksRef = useRef<Set<string>>(new Set());
  const lastStaggerWorldRef = useRef<string | null>(null);

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
      // NOTE: Must check length explicitly - `??` doesn't catch empty arrays
      const blocks = (chunkData.visibleBlocks?.length) ? chunkData.visibleBlocks : chunkData.blocks;
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].id === hoveredBlockId) return chunkKey;
      }
    }
    return null;
  }, [hoveredBlockId, loadedChunksRef]);

  // Phase 1: Per-chunk rendering — iterate loaded chunks, classify into normal vs fade
  // Normal chunks: within visualDistance, full atlas rendering
  // Fade chunks: visualDistance+1 to visualDistance+2, grey silhouette rendering
  //
  // PERF: Cache entry objects per chunk key. Only create a new entry when the blocks
  // ref changes. This prevents ChunkRenderer React.memo from being busted by
  // worldRevision/renderTrigger changes that don't actually change chunk data.
  const entryCacheRef = useRef<Map<string, { key: string; blocks: PlacedBlock[] }>>(new Map());

  // One-time diagnostic for chunk exclusions
  const chunkExclusionLogRef = useRef(false);

  const { normalEntries, fadeEntries } = useMemo(() => {
    const normal: { key: string; blocks: PlacedBlock[] }[] = [];
    const fade: { key: string; blocks: PlacedBlock[]; distanceFactor: number }[] = [];
    const ref = loadedChunksRef?.current;
    const cache = entryCacheRef.current;

    // Compute camera chunk from live camera position (not lastChunkRef which may lag)
    const camChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
    const camChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);

    // Track which keys are still in use so we can prune stale cache entries
    const activeKeys = new Set<string>();

    // Track excluded chunks for diagnostic
    const excluded: { key: string; dist: number; blocks: number }[] = [];

    if (ref && ref.size > 0) {
      for (const [chunkKey, chunkData] of ref) {
        if (!chunkData?.blocks || chunkData.blocks.length === 0) continue;

        // Use visibleBlocks if non-empty, otherwise fall back to full blocks array
        // NOTE: Must check length explicitly - `??` doesn't catch empty arrays
        const blocks = (chunkData.visibleBlocks?.length) ? chunkData.visibleBlocks : chunkData.blocks;

        // Parse chunk coords from key "chunk_X_Z"
        const parsed = parseChunkKey(chunkKey);

        // If key format is unexpected, render as normal (safe fallback)
        if (!parsed) {
          const cached = cache.get(chunkKey);
          const entry = (cached && cached.blocks === blocks) ? cached : { key: chunkKey, blocks };
          cache.set(chunkKey, entry);
          activeKeys.add(chunkKey);
          normal.push(entry);
          continue;
        }

        const dcx = Math.abs(parsed.chunkX - camChunkX);
        const dcz = Math.abs(parsed.chunkZ - camChunkZ);
        const chunkDist = Math.max(dcx, dcz); // Chebyshev distance

        if (chunkDist <= visualDistance) {
          // Reuse cached entry if blocks ref is the same — prevents ChunkRenderer re-render
          const cached = cache.get(chunkKey);
          const entry = (cached && cached.blocks === blocks) ? cached : { key: chunkKey, blocks };
          cache.set(chunkKey, entry);
          activeKeys.add(chunkKey);
          normal.push(entry);
        } else if (chunkDist <= visualDistance + FADE_EXTRA) {
          const distanceFactor = (chunkDist - visualDistance) / FADE_EXTRA;
          activeKeys.add(chunkKey);
          fade.push({ key: chunkKey, blocks, distanceFactor });
        } else {
          // Track excluded chunk for diagnostic
          excluded.push({ key: chunkKey, dist: chunkDist, blocks: chunkData.blocks.length });
        }
      }
    }

    // One-time diagnostic: log excluded chunks
    if (!chunkExclusionLogRef.current && excluded.length > 0) {
      chunkExclusionLogRef.current = true;
      console.log(`[ChunkVisibility] Camera chunk: (${camChunkX}, ${camChunkZ}), visualDistance: ${visualDistance}, FADE_EXTRA: ${FADE_EXTRA}`);
      console.log(`[ChunkVisibility] Excluded ${excluded.length} chunks beyond range ${visualDistance + FADE_EXTRA}:`);
      for (const e of excluded.slice(0, 10)) {
        console.log(`  - ${e.key}: dist=${e.dist}, ${e.blocks} blocks (has colliders but won't render)`);
      }
      if (excluded.length > 10) {
        console.log(`  ... and ${excluded.length - 10} more`);
      }
    }

    // Prune stale cache entries for chunks no longer loaded
    if (cache.size > activeKeys.size + 20) {
      for (const key of cache.keys()) {
        if (!activeKeys.has(key)) cache.delete(key);
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
  }, [renderTrigger, blocksByChunk, loadedChunksRef, worldRevision, visualDistance, camera]);

  // === Stagger new chunk mounts ===
  // On world change, reset admitted set
  if (currentWorldId !== lastStaggerWorldRef.current) {
    lastStaggerWorldRef.current = currentWorldId;
    admittedChunksRef.current.clear();
  }

  const admitted = admittedChunksRef.current;
  const staggeredEntries: { key: string; blocks: PlacedBlock[] }[] = [];
  let pendingNewChunks = 0;

  // Lazy prune: remove stale keys when set grows much larger than active chunks
  if (admitted.size > normalEntries.length + 50) {
    const activeKeys = new Set(normalEntries.map(e => e.key));
    for (const key of admitted) {
      if (!activeKeys.has(key)) admitted.delete(key);
    }
  }

  let newAdmittedCount = 0;
  for (const entry of normalEntries) {
    if (admitted.has(entry.key)) {
      staggeredEntries.push(entry);
    } else if (newAdmittedCount < MAX_NEW_CHUNKS_PER_CYCLE) {
      admitted.add(entry.key);
      staggeredEntries.push(entry);
      newAdmittedCount++;
    } else {
      pendingNewChunks++;
    }
  }

  if (newAdmittedCount > 0 && pendingNewChunks > 0) {
    console.log(`[ChunkStagger] Admitted ${newAdmittedCount} new chunks, ${pendingNewChunks} pending, ${staggeredEntries.length} rendering`);
  }

  // Schedule next mount batch if chunks are waiting
  useEffect(() => {
    if (pendingNewChunks > 0) {
      const timer = setTimeout(() => {
        setRenderTrigger(prev => prev + 1);
      }, STAGGER_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [normalEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate water blocks for visible chunks
  const waterBlocks = useMemo(() => {
    if (!worldPonds.hasPonds || normalEntries.length === 0) return [];

    const chunkKeys = normalEntries.map(e => e.key);
    return worldPonds.getAllWaterBlocksForChunks(chunkKeys, CHUNK_SIZE);
  }, [worldPonds, normalEntries]);

  // One-time pipeline diagnostic (fires once when normalEntries first has data)
  if (!debugLogRef.current && normalEntries.length > 0) {
    debugLogRef.current = true;
    const totalBlocks = normalEntries.reduce((sum, e) => sum + e.blocks.length, 0);
    console.log(`[CameraTrackedBlocks] Pipeline: ${normalEntries.length} chunks, ${totalBlocks} blocks, blockDefsLoading=${hoistedBlockDefsLoading}, atlasReady=${hoistedAtlasReady}, blocksMapSize=${hoistedBlocksMap.size}, fadeChunks=${fadeEntries.length}`);

    // DEBUG: Compare chunkData.blocks vs chunkData.visibleBlocks for non-tree block loss
    const ref = loadedChunksRef?.current;
    if (ref) {
      for (const [chunkKey, chunkData] of ref) {
        if (!chunkData?.blocks || chunkData.blocks.length === 0) continue;
        const allBlocks = chunkData.blocks;
        const visBlocks = chunkData.visibleBlocks;

        // Count non-tree blocks in both arrays
        let allNonTree = 0;
        let visNonTree = 0;
        const nonTreeTypes = new Set<string>();

        for (const b of allBlocks) {
          const isTree = b.block_type.startsWith('t_') || b.block_type.startsWith('trunk') || b.block_type.startsWith('b_') || b.block_type.startsWith('branch') || b.block_type.startsWith('r_') || b.block_type.startsWith('root') || b.block_type.startsWith('cap') || b.block_type.startsWith('l_') || b.block_type.startsWith('leaf') || b.block_type.startsWith('canopy') || b.block_type.startsWith('fungal') || b.block_type.startsWith('f_') || b.block_type.startsWith('s_') || b.block_type.startsWith('spike') || b.block_type.startsWith('n_') || b.block_type.startsWith('nob') || b.block_type.startsWith('x_') || b.block_type.startsWith('cross') || b.block_type.startsWith('sm_') || b.block_type.startsWith('shroom') || b.block_type.startsWith('ss_') || b.block_type.startsWith('sc_') || b.block_type.startsWith('fs_') || b.block_type.startsWith('fct') || b.block_type.startsWith('fcu') || b.block_type.startsWith('ib') || b.block_type === 'invisiblock';
          if (!isTree) {
            allNonTree++;
            nonTreeTypes.add(b.block_type);
          }
        }

        if (visBlocks) {
          for (const b of visBlocks) {
            const isTree = b.block_type.startsWith('t_') || b.block_type.startsWith('trunk') || b.block_type.startsWith('b_') || b.block_type.startsWith('branch') || b.block_type.startsWith('r_') || b.block_type.startsWith('root') || b.block_type.startsWith('cap') || b.block_type.startsWith('l_') || b.block_type.startsWith('leaf') || b.block_type.startsWith('canopy') || b.block_type.startsWith('fungal') || b.block_type.startsWith('f_') || b.block_type.startsWith('s_') || b.block_type.startsWith('spike') || b.block_type.startsWith('n_') || b.block_type.startsWith('nob') || b.block_type.startsWith('x_') || b.block_type.startsWith('cross') || b.block_type.startsWith('sm_') || b.block_type.startsWith('shroom') || b.block_type.startsWith('ss_') || b.block_type.startsWith('sc_') || b.block_type.startsWith('fs_') || b.block_type.startsWith('fct') || b.block_type.startsWith('fcu') || b.block_type.startsWith('ib') || b.block_type === 'invisiblock';
            if (!isTree) visNonTree++;
          }
        }

        if (allNonTree > 0) {
          console.log(`[PLACED BLOCKS DEBUG] ${chunkKey}: blocks=${allBlocks.length} (${allNonTree} placed), visibleBlocks=${visBlocks ? visBlocks.length + ' (' + visNonTree + ' placed)' : 'UNDEFINED (using blocks)'}, types: ${[...nonTreeTypes].join(', ')}`);
        }
      }
    }
  }

  return (
    <>
      <FadeChunkBlocks entries={fadeEntries} viewSettings={viewSettings} />
      <ProceduralGround
        visibleChunksRef={visibleChunksRef}
        renderTrigger={renderTrigger}
        textureUrl={groundTextureUrl || '/grass_texture_seamless.webp'}
        visualDistance={visualDistance}
        cameraRef={{ current: camera }}
      />
      {staggeredEntries.map(({ key, blocks: chunkBlocks }) => (
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
      {/* Water/Lava blocks - rendered after opaque blocks for transparency */}
      {waterBlocks.length > 0 && (
        <WaterBlocks
          waterBlocks={waterBlocks}
          waterTintColor={worldPonds.settings.waterTintColor}
          lavaTintColor={worldPonds.settings.lavaTintColor}
        />
      )}
    </>
  );
}
