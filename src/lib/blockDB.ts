// Browser-only client-side persistence layer for chunks, blocks,
// user session, and texture blobs. Extracted from useIndexedDB.ts
// during Phase C step 3. The React hook wrapper now lives in
// useIndexedDB.ts and re-exports from here.
//
// L2 DO note: IndexedDB is a browser API. The DO can't import this
// module — chunk-cache concerns live in the client only. The DO
// owns canonical state and doesn't need a local read cache.

import type { PlacedBlock } from '@/types/blocks';

export interface DBBlock extends Omit<PlacedBlock, 'created_at' | 'updated_at'> {
  created_at: string;
  updated_at: string;
  synced: boolean; // Track if synced to Supabase
  local_id?: string; // For offline blocks
}

export interface UserSession {
  id: string; // Always '1' (single record store)
  user_id: string; // Last authenticated Supabase user ID
  last_active: string; // ISO timestamp
}

export interface TextureBlob {
  url: string; // Primary key
  blob: Blob; // The actual texture data
  cached_at: string; // ISO timestamp
}

// Phase 3D: Cached chunk data with version tracking
export interface CachedChunk {
  key: string; // "worldId:chunkX:chunkZ"
  worldId: string;
  chunkX: number;
  chunkZ: number;
  version: number; // Server version at time of cache
  blocks: PlacedBlock[];
  cachedAt: number; // Date.now() timestamp
}

export class BlockDB {
  private db: IDBDatabase | null = null;
  private dbName = 'waterfall-blocks-db';
  private dbVersion = 7; // Bump for chunk_cache store
  private storeName = 'blocks';
  private sessionStoreName = 'user_session';
  private textureStoreName = 'texture_blobs';
  private chunkCacheStoreName = 'chunk_cache'; // Phase 3D
  private initPromise: Promise<void> | null = null; // Singleton guard

  async init(): Promise<void> {
    // If already initialized, return immediately
    if (this.db) return;
    
    // If init is in progress, wait for it
    if (this.initPromise) return this.initPromise;
    
    // Start init and store the promise
    this.initPromise = new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(this.dbName, this.dbVersion);
        
        request.onerror = () => {
          console.error('IndexedDB open error:', request.error);
          this.initPromise = null;
          reject(request.error);
        };
        
        request.onsuccess = () => {
          this.db = request.result;
          // Silenced: IndexedDB init is now a singleton
          resolve();
        };
        
        request.onblocked = () => {
          console.warn('IndexedDB upgrade blocked - close all other tabs');
        };
        
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const oldVersion = event.oldVersion;
          const newVersion = event.newVersion || this.dbVersion;
          
          console.log(`IndexedDB upgrade: v${oldVersion} -> v${newVersion}`);
          
          // Handle version conflicts by clearing and recreating
          if (oldVersion > newVersion) {
            console.warn('Version conflict detected - database downgrade not supported');
            // Delete all stores and recreate
            Array.from(db.objectStoreNames).forEach(name => {
              db.deleteObjectStore(name);
            });
          }
          
          // Clear existing blocks store if it exists (to fix corruption)
          if (db.objectStoreNames.contains(this.storeName)) {
            db.deleteObjectStore(this.storeName);
          }
          
          // Create fresh blocks store
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('synced', 'synced', { unique: false });
          store.createIndex('position', ['position_x', 'position_y', 'position_z'], { unique: false });
          
          // Clear and recreate user_session store
          if (db.objectStoreNames.contains(this.sessionStoreName)) {
            db.deleteObjectStore(this.sessionStoreName);
          }
          db.createObjectStore(this.sessionStoreName, { keyPath: 'id' });
          
          // Clear and recreate texture_blobs store
          if (db.objectStoreNames.contains(this.textureStoreName)) {
            db.deleteObjectStore(this.textureStoreName);
          }
          db.createObjectStore(this.textureStoreName, { keyPath: 'url' });
          
          // Phase 3D: Create chunk_cache store
          if (db.objectStoreNames.contains(this.chunkCacheStoreName)) {
            db.deleteObjectStore(this.chunkCacheStoreName);
          }
          const chunkStore = db.createObjectStore(this.chunkCacheStoreName, { keyPath: 'key' });
          chunkStore.createIndex('worldId', 'worldId', { unique: false });
          chunkStore.createIndex('cachedAt', 'cachedAt', { unique: false });
          
          console.log('IndexedDB stores ready');
        };
      } catch (error) {
        console.error('Error initializing IndexedDB:', error);
        // If all else fails, try deleting the database and starting fresh
        if (error instanceof DOMException && error.name === 'VersionError') {
          console.warn('Attempting to delete and recreate database...');
          indexedDB.deleteDatabase(this.dbName);
          // Retry once after deletion
          this.initPromise = null;
          setTimeout(() => this.init().then(resolve).catch(reject), 100);
        } else {
          this.initPromise = null;
          reject(error);
        }
      }
    });
    
    return this.initPromise;
  }

  async getAllBlocks(): Promise<DBBlock[]> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async addBlock(block: DBBlock): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(block);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // Batch add blocks in a single transaction (much faster than individual adds)
  async addBlocksBatch(blocks: DBBlock[]): Promise<void> {
    if (!this.db) await this.init();
    if (blocks.length === 0) return;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      
      // Add all blocks in single transaction
      for (const block of blocks) {
        store.put(block);
      }
    });
  }

  async removeBlock(blockId: string): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(blockId);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // Batch remove blocks in a single transaction
  async removeBlocksBatch(blockIds: string[]): Promise<void> {
    if (!this.db) await this.init();
    if (blockIds.length === 0) return;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      
      // Delete all blocks in single transaction
      for (const id of blockIds) {
        store.delete(id);
      }
    });
  }

  async getUnsyncedBlocks(): Promise<DBBlock[]> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        
        // Use cursor instead of index to avoid corruption issues
        const request = store.openCursor();
        const unsyncedBlocks: DBBlock[] = [];
        
        request.onerror = () => {
          console.error('Error reading unsynced blocks:', request.error);
          reject(request.error);
        };
        
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const block = cursor.value as DBBlock;
            // Ensure synced field is properly typed
            if (block.synced === false || (block.synced as any) === 'false' || block.synced == null) {
              // Normalize synced field to boolean
              block.synced = false;
              unsyncedBlocks.push(block);
            }
            cursor.continue();
          } else {
            resolve(unsyncedBlocks);
          }
        };
      } catch (error) {
        console.error('Error in getUnsyncedBlocks:', error);
        resolve([]); // Return empty array on error to prevent sync loop
      }
    });
  }

  async markAsSynced(blockId: string): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const getRequest = store.get(blockId);
      
      getRequest.onsuccess = () => {
        const block = getRequest.result;
        if (block) {
          block.synced = true;
          const putRequest = store.put(block);
          putRequest.onerror = () => reject(putRequest.error);
          putRequest.onsuccess = () => resolve();
        } else {
          resolve(); // Block doesn't exist, nothing to update
        }
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async clearAllBlocks(): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // Update block with new server data
  async updateBlock(blockId: string, updates: Partial<DBBlock>): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const getRequest = store.get(blockId);
      
      getRequest.onsuccess = () => {
        const block = getRequest.result;
        if (block) {
          const updatedBlock = { ...block, ...updates };
          const putRequest = store.put(updatedBlock);
          putRequest.onerror = () => reject(putRequest.error);
          putRequest.onsuccess = () => resolve();
        } else {
          resolve(); // Block doesn't exist
        }
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // User session management
  async saveUserSession(userId: string): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.sessionStoreName], 'readwrite');
      const store = transaction.objectStore(this.sessionStoreName);
      const session: UserSession = {
        id: '1',
        user_id: userId,
        last_active: new Date().toISOString()
      };
      const request = store.put(session);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log('💾 Saved user to IndexedDB:', userId);
        resolve();
      };
    });
  }

  async getUserSession(): Promise<UserSession | null> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.sessionStoreName], 'readonly');
      const store = transaction.objectStore(this.sessionStoreName);
      const request = store.get('1');
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  async clearUserSession(): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.sessionStoreName], 'readwrite');
      const store = transaction.objectStore(this.sessionStoreName);
      const request = store.clear();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log('💾 Cleared user session from IndexedDB');
        resolve();
      };
    });
  }

  // Texture blob management
  async getTextureBlob(url: string): Promise<Blob | null> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.textureStoreName], 'readonly');
      const store = transaction.objectStore(this.textureStoreName);
      const request = store.get(url);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result as TextureBlob | undefined;
        resolve(result?.blob || null);
      };
    });
  }

  async saveTextureBlob(url: string, blob: Blob): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.textureStoreName], 'readwrite');
      const store = transaction.objectStore(this.textureStoreName);
      const textureBlob: TextureBlob = {
        url,
        blob,
        cached_at: new Date().toISOString()
      };
      const request = store.put(textureBlob);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // Phase 3D: Chunk cache methods
  
  /**
   * Get a cached chunk by world, chunkX, chunkZ
   */
  async getCachedChunk(worldId: string, chunkX: number, chunkZ: number): Promise<CachedChunk | null> {
    if (!this.db) await this.init();
    
    const key = `${worldId}:${chunkX}:${chunkZ}`;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkCacheStoreName], 'readonly');
      const store = transaction.objectStore(this.chunkCacheStoreName);
      const request = store.get(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  /**
   * Batch get multiple cached chunks in a single transaction
   * Returns a Map of chunkKey -> CachedChunk (only for chunks that exist in cache)
   */
  async getCachedChunksBatch(
    worldId: string, 
    chunkCoords: Array<{ x: number; z: number }>
  ): Promise<Map<string, CachedChunk>> {
    if (!this.db) await this.init();
    if (chunkCoords.length === 0) return new Map();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkCacheStoreName], 'readonly');
      const store = transaction.objectStore(this.chunkCacheStoreName);
      const results = new Map<string, CachedChunk>();
      let pending = chunkCoords.length;
      
      transaction.onerror = () => reject(transaction.error);
      
      for (const { x, z } of chunkCoords) {
        const key = `${worldId}:${x}:${z}`;
        const chunkKey = `chunk_${x}_${z}`;
        const request = store.get(key);
        
        request.onsuccess = () => {
          if (request.result) {
            results.set(chunkKey, request.result);
          }
          pending--;
          if (pending === 0) resolve(results);
        };
        
        request.onerror = () => {
          pending--;
          if (pending === 0) resolve(results);
        };
      }
    });
  }

  /**
   * Save a chunk to the cache
   */
  async saveCachedChunk(chunk: CachedChunk): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkCacheStoreName], 'readwrite');
      const store = transaction.objectStore(this.chunkCacheStoreName);
      const request = store.put(chunk);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Batch save multiple chunks in a single transaction (much faster)
   */
  async saveCachedChunksBatch(chunks: CachedChunk[]): Promise<void> {
    if (!this.db) await this.init();
    if (chunks.length === 0) return;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkCacheStoreName], 'readwrite');
      const store = transaction.objectStore(this.chunkCacheStoreName);
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      
      for (const chunk of chunks) {
        store.put(chunk);
      }
    });
  }

  /**
   * Clear all cached chunks for a specific world
   */
  async clearCachedChunksForWorld(worldId: string): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkCacheStoreName], 'readwrite');
      const store = transaction.objectStore(this.chunkCacheStoreName);
      const index = store.index('worldId');
      const request = index.openCursor(IDBKeyRange.only(worldId));
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  }

  /**
   * Clear old cached chunks (older than maxAge ms) to prevent unbounded growth
   */
  async clearOldCachedChunks(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    if (!this.db) await this.init();
    
    const cutoff = Date.now() - maxAgeMs;
    let deletedCount = 0;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkCacheStoreName], 'readwrite');
      const store = transaction.objectStore(this.chunkCacheStoreName);
      const index = store.index('cachedAt');
      const request = index.openCursor(IDBKeyRange.upperBound(cutoff));
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          resolve(deletedCount);
        }
      };
    });
  }

  /**
   * Check if a block_type is a tree block type (supports encoded format type_depth_tier)
   */
  private isTreeBlockType(blockType: string): boolean {
    // Full type names
    const TREE_BLOCK_BASE_TYPES = [
      'trunk', 'branch', 'root', 'leaf', 'fruit', 'spike', 'nob', 'cross',
      'shroom', 'shroom_stem', 'shroom_cap', 'fungal_stem', 'fungal_cap_top',
      'fungal_cap_underside', 'glow_bark', 'invisiblock', 'shrine'
    ];
    // Short codes from blockTypeEncoder
    const TREE_BLOCK_SHORT_CODES = [
      't', 'b', 'r', 'l', 's', 'n', 'x', 'sm', 'ss', 'sc', 'fs', 'fct', 'fcu', 'ib', 'gb', 'f', 'shr'
    ];

    // Direct match (full type name or short code)
    if (TREE_BLOCK_BASE_TYPES.includes(blockType)) return true;
    if (TREE_BLOCK_SHORT_CODES.includes(blockType)) return true;

    // Encoded format: type_depth_tier (e.g., trunk_0_5, b_2_3, r_-1_5)
    const parts = blockType.split('_');
    if (parts.length >= 2) {
      const baseType = parts[0];
      // Handle compound types like shroom_stem, shroom_cap, fungal_stem, etc.
      if (parts.length >= 3) {
        const compoundType = `${parts[0]}_${parts[1]}`;
        if (TREE_BLOCK_BASE_TYPES.includes(compoundType)) return true;
      }
      // Check if first part is a valid type or short code
      if (TREE_BLOCK_BASE_TYPES.includes(baseType)) return true;
      if (TREE_BLOCK_SHORT_CODES.includes(baseType)) return true;
    }

    return false;
  }

  /**
   * Clear ALL tree-related blocks from ALL chunk caches
   * This is the nuclear option for ghost tree cleanup
   * FIXED: Now handles both legacy and new encoded block types (type_depth_tier)
   */
  async clearTreeBlocksFromCache(): Promise<number> {
    if (!this.db) await this.init();
    
    let removedCount = 0;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkCacheStoreName], 'readwrite');
      const store = transaction.objectStore(this.chunkCacheStoreName);
      const request = store.openCursor();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const chunk = cursor.value as CachedChunk;
          const originalLength = chunk.blocks.length;
          
          // Filter out ALL tree blocks - handles both legacy and encoded formats
          chunk.blocks = chunk.blocks.filter(block => {
            return !this.isTreeBlockType(block.block_type);
          });
          
          if (chunk.blocks.length < originalLength) {
            removedCount += originalLength - chunk.blocks.length;
            cursor.update(chunk);
          }
          
          cursor.continue();
        } else {
          resolve(removedCount);
        }
      };
    });
  }

  /**
   * Completely clear all chunk cache (nuclear option)
   */
  async clearAllChunkCache(): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkCacheStoreName], 'readwrite');
      const store = transaction.objectStore(this.chunkCacheStoreName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log('[IndexedDB] Chunk cache completely cleared');
        resolve();
      };
    });
  }

  /**
   * Invalidate (delete) a specific chunk from the cache.
   * This forces a fresh fetch from server on next load.
   * Used after tree growth to ensure new blocks are loaded.
   */
  async invalidateCachedChunk(worldId: string, chunkX: number, chunkZ: number): Promise<void> {
    if (!this.db) await this.init();

    const key = `${worldId}:${chunkX}:${chunkZ}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkCacheStoreName], 'readwrite');
      const store = transaction.objectStore(this.chunkCacheStoreName);
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Invalidate multiple chunks from the cache in a single transaction.
   * Used after tree growth to ensure all affected chunks refetch on next load.
   */
  async invalidateCachedChunksBatch(worldId: string, chunkCoords: Array<{ x: number; z: number }>): Promise<void> {
    if (!this.db) await this.init();
    if (chunkCoords.length === 0) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkCacheStoreName], 'readwrite');
      const store = transaction.objectStore(this.chunkCacheStoreName);

      transaction.oncomplete = () => {
        console.log(`[IndexedDB] Invalidated ${chunkCoords.length} chunk cache entries`);
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);

      for (const { x, z } of chunkCoords) {
        const key = `${worldId}:${x}:${z}`;
        store.delete(key);
      }
    });
  }

  /**
   * Update the version of a cached chunk WITHOUT deleting the blocks.
   * This preserves the cache data while marking it with the new server version.
   * More efficient than invalidate+refetch when we know the data is still valid.
   */
  async updateCachedChunkVersion(
    worldId: string,
    chunkX: number,
    chunkZ: number,
    newVersion: number
  ): Promise<void> {
    if (!this.db) await this.init();

    const key = `${worldId}:${chunkX}:${chunkZ}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkCacheStoreName], 'readwrite');
      const store = transaction.objectStore(this.chunkCacheStoreName);

      const getRequest = store.get(key);
      getRequest.onsuccess = () => {
        const existing = getRequest.result as CachedChunk | undefined;
        if (existing) {
          existing.version = newVersion;
          existing.cachedAt = Date.now();
          store.put(existing);
        }
        resolve();
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Batch update versions of multiple cached chunks WITHOUT deleting the blocks.
   * Used after tree growth to mark chunks as up-to-date with new server versions.
   */
  async updateCachedChunkVersionsBatch(
    worldId: string,
    chunkUpdates: Array<{ x: number; z: number; version: number }>
  ): Promise<void> {
    if (!this.db) await this.init();
    if (chunkUpdates.length === 0) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.chunkCacheStoreName], 'readwrite');
      const store = transaction.objectStore(this.chunkCacheStoreName);
      let pending = chunkUpdates.length;

      transaction.oncomplete = () => {
        console.log(`[IndexedDB] Updated versions for ${chunkUpdates.length} cached chunks`);
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);

      const now = Date.now();
      for (const { x, z, version } of chunkUpdates) {
        const key = `${worldId}:${x}:${z}`;
        const getRequest = store.get(key);

        getRequest.onsuccess = () => {
          const existing = getRequest.result as CachedChunk | undefined;
          if (existing) {
            existing.version = version;
            existing.cachedAt = now;
            store.put(existing);
          }
          pending--;
        };

        getRequest.onerror = () => {
          pending--;
        };
      }
    });
  }

  /**
   * Clear tree blocks from the main 'blocks' store (not chunk cache)
   * This prevents the sync loop from re-uploading ghost tree blocks
   * FIXED: Now handles both legacy and new encoded block types (type_depth_tier)
   */
  async clearTreeBlocksFromBlocksStore(treeBlockTypes: string[]): Promise<number> {
    if (!this.db) await this.init();
    
    let removedCount = 0;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.openCursor();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const block = cursor.value;
          // Use the same isTreeBlockType check for consistency
          if (this.isTreeBlockType(block.block_type)) {
            cursor.delete();
            removedCount++;
          }
          cursor.continue();
        } else {
          console.log(`[IndexedDB] Removed ${removedCount} tree blocks from blocks store`);
          resolve(removedCount);
        }
      };
    });
  }
}

export const blockDB = new BlockDB();