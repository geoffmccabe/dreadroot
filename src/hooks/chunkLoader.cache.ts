import { PlacedBlock } from '@/types/blocks';

type PlayerChunk = { x: number; z: number } | null;

type ChunkDataLike = {
  blocks: PlacedBlock[];
  lastAccessedAt: number;
  hasOptimisticBlocks?: boolean;
};

export function isChunkPinnedImpl(
  chunkKey: string,
  playerChunk: PlayerChunk,
  loadedChunks: Map<string, ChunkDataLike>,
  unloadRadius: number
): boolean {
  const match = chunkKey.match(/^chunk_(-?\d+)_(-?\d+)$/);
  if (!match) return true; // Don't evict malformed keys

  const chunkX = parseInt(match[1], 10);
  const chunkZ = parseInt(match[2], 10);

  // If no player position, don't evict anything
  if (!playerChunk) return true;

  // Check distance to player
  const dx = Math.abs(chunkX - playerChunk.x);
  const dz = Math.abs(chunkZ - playerChunk.z);
  const distance = Math.max(dx, dz);

  if (distance <= unloadRadius) return true;

  // Check for optimistic blocks
  const chunkData = loadedChunks.get(chunkKey);
  if (chunkData?.hasOptimisticBlocks) return true;

  return false;
}

export function evictLRUChunksImpl(params: {
  loadedChunks: Map<string, ChunkDataLike>;
  isChunkPinned: (chunkKey: string) => boolean;
  maxLoadedChunks: number;
  evictionBatchSize: number;
  removeBlockCollider: (block: PlacedBlock) => void;
  scheduleEmit: () => void;
}): void {
  const { loadedChunks, isChunkPinned, maxLoadedChunks, evictionBatchSize, removeBlockCollider, scheduleEmit } = params;

  const chunkCount = loadedChunks.size;
  if (chunkCount <= maxLoadedChunks) return;

  // Find non-pinned chunks sorted by lastAccessedAt (oldest first)
  const evictionCandidates: Array<{ key: string; lastAccessedAt: number }> = [];

  for (const [key, data] of loadedChunks.entries()) {
    if (!isChunkPinned(key)) {
      evictionCandidates.push({ key, lastAccessedAt: data.lastAccessedAt });
    }
  }

  // Sort by lastAccessedAt ascending (oldest first)
  evictionCandidates.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

  // Evict up to evictionBatchSize chunks
  const toEvict = evictionCandidates.slice(0, evictionBatchSize);

  if (toEvict.length === 0) return;

  for (const { key } of toEvict) {
    const chunkData = loadedChunks.get(key);
    if (chunkData) {
      for (const block of chunkData.blocks) {
        removeBlockCollider(block);
      }
    }
    loadedChunks.delete(key);
  }

  scheduleEmit();
}
