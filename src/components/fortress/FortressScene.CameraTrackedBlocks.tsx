import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';

import { useBlocks } from '@/contexts/BlocksContext';
import { PlacedBlock } from '@/types/blocks';
import { CHUNK_SIZE, getVisibleChunkKeys, parseChunkKey } from '@/lib/chunkManager';
import { FOG_DISTANCE_CHUNKS } from '@/lib/fogConfig';
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

  // Lazy blockId → chunkKey index: only rebuilt when hoveredBlockId is set AND chunks changed
  const blockIdToChunkRef = useRef<Map<string, string>>(new Map());
  const blockIdMapRevisionRef = useRef(-1);

  // O(1) lookup for hovered block's chunk (was O(chunks × blocks))
  const hoveredChunkKey = useMemo(() => {
    if (!hoveredBlockId) return null;

    // Rebuild map only when worldRevision changed since last build
    if (blockIdMapRevisionRef.current !== worldRevision) {
      const ref = loadedChunksRef?.current;
      const map = blockIdToChunkRef.current;
      map.clear();
      if (ref) {
        for (const [chunkKey, chunkData] of ref) {
          const blocks = (chunkData.visibleBlocks?.length) ? chunkData.visibleBlocks : chunkData.blocks;
          for (let i = 0; i < blocks.length; i++) {
            map.set(blocks[i].id, chunkKey);
          }
        }
      }
      blockIdMapRevisionRef.current = worldRevision;
    }

    return blockIdToChunkRef.current.get(hoveredBlockId) ?? null;
  }, [hoveredBlockId, worldRevision, loadedChunksRef]);

  // Phase 1: Per-chunk rendering — iterate loaded chunks, classify into normal vs fade
  // Normal chunks: within visualDistance, full atlas rendering
  // Fade chunks: visualDistance+1 to visualDistance+2, grey silhouette rendering
  //
  // PERF: Cache entry objects per chunk key. Only create a new entry when the blocks
  // ref changes. This prevents ChunkRenderer React.memo from being busted by
  // worldRevision/renderTrigger changes that don't actually change chunk data.
  const entryCacheRef = useRef<Map<string, { key: string; blocks: PlacedBlock[]; sig?: string; dist?: number }>>(new Map());

  // One-time diagnostic for chunk exclusions
  const chunkExclusionLogRef = useRef(false);

  const { normalEntries, fadeEntries } = useMemo(() => {
    const normal: { key: string; blocks: PlacedBlock[]; sig?: string; dist?: number }[] = [];
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

        if (chunkDist <= FOG_DISTANCE_CHUNKS) {
          // Reuse the cached entry (keeping its OLD blocks ref) when the
          // chunk's CONTENT signature is unchanged, even if the
          // visibleBlocks/blocks array ref rotated (refetch / surface
          // recompute). Same old ref => ChunkRenderer.memo skips =>
          // no regroup, no mesh rebuild for chunks that didn't change.
          // This was the 0%-grouping-cache / ~10s MeshRebuild stall: refs
          // rotated far more often than block content actually changed.
          const sig = chunkData.signature
            ? `${chunkData.signature.count}:${chunkData.signature.xor}:${chunkData.signature.sum}`
            : '';
          const cached = cache.get(chunkKey);
          let entry: { key: string; blocks: PlacedBlock[]; sig?: string; dist?: number };
          if (cached && cached.blocks === blocks) {
            entry = cached;
          } else if (cached && sig !== '' && cached.sig === sig) {
            entry = cached; // ref changed but content identical — keep old
          } else {
            entry = { key: chunkKey, blocks, sig };
          }
          // Refresh distance every pass — the progressive renderer sorts on it.
          entry.dist = chunkDist;
          cache.set(chunkKey, entry);
          activeKeys.add(chunkKey);
          normal.push(entry);
        } else {
          // Beyond the fog wall — don't render; fog has fully hidden it.
          excluded.push({ key: chunkKey, dist: chunkDist, blocks: chunkData.blocks.length });
        }
      }
    }

    // One-time diagnostic: log excluded chunks
    if (!chunkExclusionLogRef.current && excluded.length > 0) {
      chunkExclusionLogRef.current = true;
      console.log(`[ChunkVisibility] Camera chunk: (${camChunkX}, ${camChunkZ}), fog render distance: ${FOG_DISTANCE_CHUNKS} chunks`);
      console.log(`[ChunkVisibility] Excluded ${excluded.length} chunks beyond ${FOG_DISTANCE_CHUNKS}:`);
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

    // Sort visible chunks nearest-first. The progressive renderer below feeds
    // chunks to React in this order, and the mesh worker is fed in that same
    // order downstream — so the closest chunks build first. Without this the
    // list was in chunk-LOAD order: running fast past a region left the chunk
    // under your feet waiting behind far chunks that loaded earlier.
    normal.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));

    diagnostics.setChunkRenderCount(normal.length);

    // D-Flow: Track chunk pipeline metrics
    diagnostics.visibleChunkCount = normal.length + fade.length;
    let visBlkTotal = 0;
    for (const entry of normal) visBlkTotal += entry.blocks.length;
    for (const entry of fade) visBlkTotal += entry.blocks.length;
    diagnostics.totalVisibleBlocks = visBlkTotal;

    // Track loaded chunk stats
    if (ref) {
      diagnostics.loadedChunkCount = ref.size;
      let loadedTotal = 0;
      for (const chunkData of ref.values()) {
        const blks = chunkData.visibleBlocks?.length ? chunkData.visibleBlocks : chunkData.blocks;
        loadedTotal += blks.length;
      }
      diagnostics.totalLoadedBlocks = loadedTotal;
    }

    return { normalEntries: normal, fadeEntries: fade };
  // Note: blocksByChunk intentionally excluded — it's a new Map on every worldRevision
  // which would bust all ChunkRenderer memos. loadedChunksRef + worldRevision is sufficient.
  }, [renderTrigger, loadedChunksRef, worldRevision, visualDistance, camera]);

  // Progressive render budget: don't hand all new chunks to React at once.
  // Feed up to CHUNKS_PER_FRAME new chunks per frame (nearest first — see the
  // distance sort on `normal` above). Chunks already rendered stay stable
  // (memo prevents re-render).
  const CHUNKS_PER_FRAME = 8;
  const renderedKeysRef = useRef(new Set<string>());
  const [progressiveTrigger, setProgressiveTrigger] = useState(0);

  // Track which normalEntries are ready to render
  const progressiveEntries = useMemo(() => {
    const rendered = renderedKeysRef.current;

    // Remove keys no longer in normalEntries (chunks that moved out of range)
    const currentKeys = new Set(normalEntries.map(e => e.key));
    for (const key of rendered) {
      if (!currentKeys.has(key)) rendered.delete(key);
    }

    // Count how many new chunks need to be added
    let newCount = 0;
    for (const entry of normalEntries) {
      if (!rendered.has(entry.key)) newCount++;
    }

    if (newCount === 0) {
      // All chunks already rendered — return full list
      return normalEntries;
    }

    // Add up to CHUNKS_PER_FRAME new entries (they're already sorted by distance)
    let added = 0;
    for (const entry of normalEntries) {
      if (!rendered.has(entry.key)) {
        rendered.add(entry.key);
        added++;
        if (added >= CHUNKS_PER_FRAME) break;
      }
    }

    // Schedule next frame to add more if there are still pending chunks
    if (added < newCount) {
      requestAnimationFrame(() => setProgressiveTrigger(v => v + 1));
    }

    // Return only entries that are in the rendered set
    return normalEntries.filter(e => rendered.has(e.key));
  }, [normalEntries, progressiveTrigger]);

  // Generate water blocks for visible chunks
  const waterBlocks = useMemo(() => {
    if (!worldPonds.hasPonds || progressiveEntries.length === 0) return [];

    const chunkKeys = progressiveEntries.map(e => e.key);
    return worldPonds.getAllWaterBlocksForChunks(chunkKeys, CHUNK_SIZE);
  }, [worldPonds, progressiveEntries]);

  // One-time pipeline diagnostic (fires once when normalEntries first has data)
  if (!debugLogRef.current && progressiveEntries.length > 0) {
    debugLogRef.current = true;
    const totalBlocks = progressiveEntries.reduce((sum, e) => sum + e.blocks.length, 0);
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
      {progressiveEntries.map(({ key, blocks: chunkBlocks }) => (
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
