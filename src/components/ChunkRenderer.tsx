// Phase 1: Per-chunk rendering wrapper
// React.memo ensures only chunks with changed blocks references re-render
import React from 'react';
import { PlacedBlocks } from './PlacedBlocks';
import type { PlacedBlock } from '@/types/blocks';
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
}

const ChunkRendererInner: React.FC<ChunkRendererProps> = ({
  blocks,
  showOwnershipOutline,
  currentUserId,
  hoveredBlockId,
  onMeshReady,
  performanceMode
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
    />
  );

  // Record chunk rebuild time (this runs on every render of this chunk)
  diagnostics.recordChunkRebuild(performance.now() - t0);

  return result;
};

const ChunkRenderer = React.memo(ChunkRendererInner, (prev, next) => {
  // Re-render only when blocks reference changes, atlas updates, or visual props change
  return (
    prev.blocks === next.blocks &&
    prev.atlasVersion === next.atlasVersion &&
    prev.hoveredBlockId === next.hoveredBlockId &&
    prev.showOwnershipOutline === next.showOwnershipOutline &&
    prev.currentUserId === next.currentUserId &&
    prev.performanceMode === next.performanceMode
  );
});

ChunkRenderer.displayName = 'ChunkRenderer';
export default ChunkRenderer;
