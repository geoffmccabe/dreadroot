// Thin React-facing wrapper around the browser-only blockDB module.
// Phase C step 3 moved the BlockDB class + singleton into
// src/lib/blockDB.ts so it can be imported without dragging React
// along. This file keeps backward-compat re-exports so the ~7 files
// that already do `import { blockDB, CachedChunk } from '@/hooks/useIndexedDB'`
// don't need to be touched.

import React from 'react';
import { blockDB } from '@/lib/blockDB';
import type { CachedChunk, DBBlock, UserSession, TextureBlob } from '@/lib/blockDB';

// Re-export so existing import paths continue to work unchanged.
export { blockDB };
export type { CachedChunk, DBBlock, UserSession, TextureBlob };

/** React hook binding around the blockDB singleton. Memoized so
 *  components don't re-render when the singleton's identity is stable
 *  (which it always is). Non-React callers should import `blockDB`
 *  directly from `@/lib/blockDB` (or via the re-export here). */
export const useIndexedDB = () => {
  return React.useMemo(() => ({
    getAllBlocks: () => blockDB.getAllBlocks(),
    addBlock: (block: DBBlock) => blockDB.addBlock(block),
    addBlocksBatch: (blocks: DBBlock[]) => blockDB.addBlocksBatch(blocks),
    removeBlock: (blockId: string) => blockDB.removeBlock(blockId),
    removeBlocksBatch: (blockIds: string[]) => blockDB.removeBlocksBatch(blockIds),
    getUnsyncedBlocks: () => blockDB.getUnsyncedBlocks(),
    markAsSynced: (blockId: string) => blockDB.markAsSynced(blockId),
    clearAllBlocks: () => blockDB.clearAllBlocks(),
    updateBlock: (blockId: string, updates: Partial<DBBlock>) => blockDB.updateBlock(blockId, updates),
    init: () => blockDB.init(),
    saveUserSession: (userId: string) => blockDB.saveUserSession(userId),
    getUserSession: () => blockDB.getUserSession(),
    clearUserSession: () => blockDB.clearUserSession(),
    getTextureBlob: (url: string) => blockDB.getTextureBlob(url),
    saveTextureBlob: (url: string, blob: Blob) => blockDB.saveTextureBlob(url, blob),
    // Phase 3D: Chunk cache methods
    getCachedChunk: (worldId: string, chunkX: number, chunkZ: number) =>
      blockDB.getCachedChunk(worldId, chunkX, chunkZ),
    getCachedChunksBatch: (worldId: string, chunkCoords: Array<{ x: number; z: number }>) =>
      blockDB.getCachedChunksBatch(worldId, chunkCoords),
    saveCachedChunk: (chunk: CachedChunk) => blockDB.saveCachedChunk(chunk),
    saveCachedChunksBatch: (chunks: CachedChunk[]) => blockDB.saveCachedChunksBatch(chunks),
    clearCachedChunksForWorld: (worldId: string) => blockDB.clearCachedChunksForWorld(worldId),
    clearOldCachedChunks: (maxAgeMs?: number) => blockDB.clearOldCachedChunks(maxAgeMs),
    // Ghost tree cleanup
    clearTreeBlocksFromCache: () => blockDB.clearTreeBlocksFromCache(),
    clearAllChunkCache: () => blockDB.clearAllChunkCache(),
    clearTreeBlocksFromBlocksStore: (treeBlockTypes: string[]) => blockDB.clearTreeBlocksFromBlocksStore(treeBlockTypes),
    // Cache invalidation for tree growth
    invalidateCachedChunk: (worldId: string, chunkX: number, chunkZ: number) =>
      blockDB.invalidateCachedChunk(worldId, chunkX, chunkZ),
    invalidateCachedChunksBatch: (worldId: string, chunkCoords: Array<{ x: number; z: number }>) =>
      blockDB.invalidateCachedChunksBatch(worldId, chunkCoords),
    // Cache version updates (preserves blocks, more efficient than invalidate)
    updateCachedChunkVersion: (worldId: string, chunkX: number, chunkZ: number, newVersion: number) =>
      blockDB.updateCachedChunkVersion(worldId, chunkX, chunkZ, newVersion),
    updateCachedChunkVersionsBatch: (worldId: string, chunkUpdates: Array<{ x: number; z: number; version: number }>) =>
      blockDB.updateCachedChunkVersionsBatch(worldId, chunkUpdates),
  }), []); // Empty deps since blockDB is stable
};
