import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';
import { getChunkMutationCounter } from '@/hooks/useChunkLoader';

import { useBlocks } from '@/contexts/BlocksContext';
import { PlacedBlock } from '@/types/blocks';
import { CHUNK_SIZE, getVisibleChunkKeys, parseChunkKey } from '@/lib/chunkManager';
import { CAMERA_START_X, CAMERA_START_Z } from './fortressScene.constants';

import ChunkRenderer from '@/components/ChunkRenderer';
import { InstancedAtlasBlockGroup } from '@/components/InstancedAtlasBlockGroup';
import { ProceduralGround } from './ProceduralGround';
import { FadeChunkBlocks } from '@/components/FadeChunkBlocks';
import { WaterBlocks } from '@/components/WaterBlocks';
import type { ViewSettings } from './FortressTypes';
import type { BlockType } from '@/types/blocks';
import { getAtlasVersion, useTextureAtlas } from '@/hooks/useTextureAtlas';
import { useAtlasSync } from '@/hooks/useAtlasSync';
import { useBlocksData } from '@/hooks/useBlocksData';
import { useWorldPonds } from '@/hooks/useWorldPonds';
import { updateFrustum } from '@/lib/frustumCuller';
import { isTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';
import { shrineTracker } from '@/lib/shrineTracker';

const FADE_EXTRA = 3;

// Shared geometry for merged tree mesh (created once, reused)
const _sharedBoxGeometry = new THREE.BoxGeometry(1, 1, 1);

// Minimal block def for tree blocks (blockDef is vestigial in IABG but required by interface)
const TREE_BLOCK_DEF: BlockType = {
  id: -1, key: 'tree_block', name: 'Tree Block', description: '',
  cost: 0, category: 'building', rarity: 'common', class: 'basic', tier: 1,
  properties: { color: '#ffffff', emissive: false, transparent: false, glowFactor: 0 }
};

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
  const mutationRafRef = useRef(0); // Debounce: collapse rapid mutations into single render
  const lastVisualDistance = useRef(visualDistance);

  const [renderTrigger, setRenderTrigger] = useState(0);
  const CHUNK_UPDATE_THROTTLE = 100; // ms

  // Stagger removed: web workers now handle mesh rebuilds off main thread,
  // so mounting all visible chunks at once is no longer a bottleneck.

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
  const lastHeartbeatRef = useRef(0);
  const lastKnownMutationRef = useRef(0);
  const HEARTBEAT_INTERVAL = 500; // Recovery scan interval — detects and reloads missing chunks

  useEffect(() => {
    // Update frustum every frame at priority 5 (before IABG at 60)
    const unregisterFrustum = frameLoop.register('frustum-update', () => {
      updateFrustum(camera);
    }, 5);

    const unregister = frameLoop.register('cameraChunks', () => {
      const currentChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
      const currentChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);
      const now = Date.now();

      const chunkChanged = currentChunkX !== lastChunkRef.current.x || currentChunkZ !== lastChunkRef.current.z;

      // Detect chunk mutations — counter increments on every set/delete/clear
      // of loadedChunksRef. Don't ack until we actually re-render, so throttled
      // mutations retry on the next frame tick.
      const currentMutation = getChunkMutationCounter();
      const hasPendingMutations = currentMutation !== lastKnownMutationRef.current;

      if (chunkChanged && now - lastUpdateTime.current > CHUNK_UPDATE_THROTTLE) {
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
        lastKnownMutationRef.current = getChunkMutationCounter();
        lastHeartbeatRef.current = now;

        requestAnimationFrame(() => setRenderTrigger(prev => prev + 1));
      } else if (hasPendingMutations) {
        lastKnownMutationRef.current = currentMutation;
        diagnostics.recordMutationRender();
        // Debounce: collapse mutations within the same frame into one render trigger
        cancelAnimationFrame(mutationRafRef.current);
        mutationRafRef.current = requestAnimationFrame(() => setRenderTrigger(prev => prev + 1));
      } else if (now - lastHeartbeatRef.current > HEARTBEAT_INTERVAL) {
        // Recovery scan: reload missing nearby chunks. Don't force re-render —
        // mutation detection handles it when chunks actually load.
        lastHeartbeatRef.current = now;
        updatePlayerPosition(camera.position.x, camera.position.z);
      }

    }, 100);

    return () => {
      unregisterFrustum();
      unregister();
      cancelAnimationFrame(mutationRafRef.current);
    };
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
    diagnostics.recordNormalEntriesEval();

    // Diagnostic: track tree blocks in normalEntries to debug disappearing trees
    let _totalTreeBlocks = 0;
    let _chunksWithTrees = 0;
    let _chunksUsingVisibleBlocks = 0;
    for (let i = 0; i < normal.length; i++) {
      const blks = normal[i].blocks;
      let chunkHasTrees = false;
      for (let j = 0; j < blks.length; j++) {
        if (isTreeBlockType(blks[j].block_type)) {
          _totalTreeBlocks++;
          chunkHasTrees = true;
        }
      }
      if (chunkHasTrees) _chunksWithTrees++;
      // Check if this chunk used visibleBlocks
      const parsed = parseChunkKey(normal[i].key);
      if (parsed && ref) {
        const cd = ref.get(normal[i].key);
        if (cd?.visibleBlocks?.length) _chunksUsingVisibleBlocks++;
      }
    }
    console.log(`[NormalEntries] eval: ${normal.length} chunks, ${_totalTreeBlocks} tree blocks in ${_chunksWithTrees} chunks, ${_chunksUsingVisibleBlocks} using visibleBlocks, fallback=${normal.length > 0 && blocksByChunk.size > 0 && ref?.size === 0 ? 'YES' : 'no'}, camChunk=(${camChunkX},${camChunkZ})`);

    return { normalEntries: normal, fadeEntries: fade };
  }, [renderTrigger, blocksByChunk, loadedChunksRef, worldRevision, visualDistance, camera]);

  // Generate water blocks for visible chunks
  const waterBlocks = useMemo(() => {
    if (!worldPonds.hasPonds || normalEntries.length === 0) return [];

    const chunkKeys = normalEntries.map(e => e.key);
    return worldPonds.getAllWaterBlocksForChunks(chunkKeys, CHUNK_SIZE);
  }, [worldPonds, normalEntries]);

  // Merged tree blocks: extract ALL tree blocks from ALL visible chunks into one array
  // This enables rendering with a single InstancedMesh (1 draw call vs ~165)
  const allTreeBlocks = useMemo(() => {
    if (normalEntries.length === 0) return [];

    const treeBlocks: PlacedBlock[] = [];
    const shrinePositions: Array<{ x: number; y: number; z: number }> = [];

    for (let c = 0; c < normalEntries.length; c++) {
      const blocks = normalEntries[c].blocks;
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (isTreeBlockType(block.block_type)) {
          treeBlocks.push(block);
          // Detect shrine blocks (fast char check: 'shr')
          const bt = block.block_type;
          if (bt.charCodeAt(0) === 115 && bt.charCodeAt(1) === 104 && bt.charCodeAt(2) === 114) {
            shrinePositions.push({ x: block.position_x, y: block.position_y, z: block.position_z });
          }
        }
      }
    }

    // Register shrine blocks for proximity tracking (moved from PlacedBlocks)
    shrineTracker.clearBlocks();
    if (shrinePositions.length > 0) {
      shrineTracker.registerShrineBlocks(shrinePositions);
    }

    console.log(`[AllTreeBlocks] ${treeBlocks.length} tree blocks from ${normalEntries.length} normalEntries`);

    return treeBlocks;
  }, [normalEntries]);

  // One-time pipeline diagnostic (fires once when normalEntries first has data)
  if (!debugLogRef.current && normalEntries.length > 0) {
    debugLogRef.current = true;
    const totalBlocks = normalEntries.reduce((sum, e) => sum + e.blocks.length, 0);
    console.log(`[CameraTrackedBlocks] Pipeline: ${normalEntries.length} chunks, ${totalBlocks} blocks, blockDefsLoading=${hoistedBlockDefsLoading}, atlasReady=${hoistedAtlasReady}, blocksMapSize=${hoistedBlocksMap.size}, fadeChunks=${fadeEntries.length}`);
  }

  return (
    <>
      <FadeChunkBlocks entries={fadeEntries} viewSettings={viewSettings} />
      <ProceduralGround
        visibleChunksRef={visibleChunksRef}
        textureUrl={groundTextureUrl || '/grass_texture_seamless.webp'}
        visualDistance={visualDistance}
        cameraRef={{ current: camera }}
      />
      {/* Merged tree mesh: 1 InstancedMesh for ALL tree blocks (1 draw call vs ~165) */}
      {/* DEBUG: log IABG mount condition */}
      {(() => { if (allTreeBlocks.length === 0) console.log('[IABG] NOT mounting: allTreeBlocks empty'); else if (!hoistedAtlasReady) console.log('[IABG] NOT mounting: atlas not ready'); else if (!hoistedAtlasTexture) console.log('[IABG] NOT mounting: no atlas texture'); return null; })()}
      {allTreeBlocks.length > 0 && hoistedAtlasReady && hoistedAtlasTexture && (
        <InstancedAtlasBlockGroup
          blocks={allTreeBlocks}
          blockDef={TREE_BLOCK_DEF}
          geometry={_sharedBoxGeometry}
          atlasTexture={hoistedAtlasTexture}
          performanceMode={performanceMode}
        />
      )}
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
          treeBlocksPreFiltered
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
