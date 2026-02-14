// Phase 1: Per-chunk rendering wrapper
// React.memo ensures only chunks with changed blocks references re-render
import React from 'react';
import * as THREE from 'three';
import { PlacedBlocks } from './PlacedBlocks';
import type { PlacedBlock, BlockType } from '@/types/blocks';
import { diagnostics } from '@/lib/diagnosticsLogger';

interface ChunkRendererProps {
  chunkKey: string;
  blocks: PlacedBlock[];
  atlasVersion: number;
  showOwnershipOutline: boolean;
  currentUserId?: string;
  hoveredBlockId?: string | null;
  onMeshReady?: (blockType: string, mesh: THREE.InstancedMesh | null) => void;
  performanceMode?: boolean;
  // Hoisted hook results from CameraTrackedBlocks (shared across all chunks)
  hoistedAtlasTexture?: THREE.Texture | null;
  hoistedAtlasReady?: boolean;
  hoistedBlocksMap?: Map<string, BlockType>;
  hoistedBlockDefsLoading?: boolean;
  // When true, tree blocks are rendered by MergedTreeMesh — skip IABG in PlacedBlocks
  treeBlocksPreFiltered?: boolean;
}

const ChunkRendererInner: React.FC<ChunkRendererProps> = ({
  blocks,
  showOwnershipOutline,
  currentUserId,
  hoveredBlockId,
  onMeshReady,
  performanceMode,
  hoistedAtlasTexture,
  hoistedAtlasReady,
  hoistedBlocksMap,
  hoistedBlockDefsLoading,
  treeBlocksPreFiltered
}) => {
  const t0 = performance.now();

  // Render the standard PlacedBlocks component with this chunk's blocks
  const result = (
    <PlacedBlocks
      blocks={blocks}
      showOwnershipOutline={showOwnershipOutline}
      currentUserId={currentUserId}
      hoveredBlockId={hoveredBlockId}
      onMeshReady={onMeshReady}
      performanceMode={performanceMode}
      hoistedAtlasTexture={hoistedAtlasTexture}
      hoistedAtlasReady={hoistedAtlasReady}
      hoistedBlocksMap={hoistedBlocksMap}
      hoistedBlockDefsLoading={hoistedBlockDefsLoading}
      treeBlocksPreFiltered={treeBlocksPreFiltered}
    />
  );

  // Record chunk rebuild time (this runs on every render of this chunk)
  diagnostics.recordChunkRebuild(performance.now() - t0);

  return result;
};

const ChunkRenderer = React.memo(ChunkRendererInner, (prev, next) => {
  // Re-render only when blocks reference changes or visual props change
  // Atlas version changes are detected internally by InstancedAtlasBlockGroup's polling
  return (
    prev.blocks === next.blocks &&
    prev.hoveredBlockId === next.hoveredBlockId &&
    prev.showOwnershipOutline === next.showOwnershipOutline &&
    prev.currentUserId === next.currentUserId &&
    prev.performanceMode === next.performanceMode &&
    prev.hoistedAtlasTexture === next.hoistedAtlasTexture &&
    prev.hoistedAtlasReady === next.hoistedAtlasReady &&
    prev.hoistedBlocksMap === next.hoistedBlocksMap &&
    prev.hoistedBlockDefsLoading === next.hoistedBlockDefsLoading &&
    prev.treeBlocksPreFiltered === next.treeBlocksPreFiltered
  );
});

ChunkRenderer.displayName = 'ChunkRenderer';
export default ChunkRenderer;
