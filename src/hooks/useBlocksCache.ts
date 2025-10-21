import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { BlockType } from '@/types/blocks';

interface CachedBlockData {
  blocks: BlockType[];
  version: number;
  timestamp: number;
}

interface CachedTexture {
  url: string;
  blob: Blob;
  timestamp: number;
}

class BlocksCacheDB {
  private db: IDBDatabase | null = null;
  private dbName = 'waterfall-blocks-cache';
  private dbVersion = 1;
  private blocksStoreName = 'block_definitions';
  private texturesStoreName = 'textures';

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        console.log('📦 BlocksCache IndexedDB initialized');
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Store for block definitions (single record with key 'current')
        if (!db.objectStoreNames.contains(this.blocksStoreName)) {
          db.createObjectStore(this.blocksStoreName, { keyPath: 'id' });
        }
        
        // Store for texture blobs (keyed by URL)
        if (!db.objectStoreNames.contains(this.texturesStoreName)) {
          const textureStore = db.createObjectStore(this.texturesStoreName, { keyPath: 'url' });
          textureStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  async getCachedBlocks(): Promise<CachedBlockData | null> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.blocksStoreName], 'readonly');
      const store = transaction.objectStore(this.blocksStoreName);
      const request = store.get('current');
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          console.log('✅ Loaded cached blocks from IndexedDB:', result.blocks.length, 'blocks');
        }
        resolve(result || null);
      };
    });
  }

  async setCachedBlocks(data: CachedBlockData): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.blocksStoreName], 'readwrite');
      const store = transaction.objectStore(this.blocksStoreName);
      const request = store.put({ id: 'current', ...data });
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log('💾 Cached blocks to IndexedDB:', data.blocks.length, 'blocks');
        resolve();
      };
    });
  }

  async getCachedTexture(url: string): Promise<Blob | null> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.texturesStoreName], 'readonly');
      const store = transaction.objectStore(this.texturesStoreName);
      const request = store.get(url);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result as CachedTexture | undefined;
        if (result) {
          // Check if texture is less than 7 days old
          const age = Date.now() - result.timestamp;
          const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
          if (age < maxAge) {
            resolve(result.blob);
          } else {
            // Expired, remove it
            this.removeCachedTexture(url);
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };
    });
  }

  async setCachedTexture(url: string, blob: Blob): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.texturesStoreName], 'readwrite');
      const store = transaction.objectStore(this.texturesStoreName);
      const cachedTexture: CachedTexture = {
        url,
        blob,
        timestamp: Date.now()
      };
      const request = store.put(cachedTexture);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async removeCachedTexture(url: string): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.texturesStoreName], 'readwrite');
      const store = transaction.objectStore(this.texturesStoreName);
      const request = store.delete(url);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clearOldTextures(): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.texturesStoreName], 'readwrite');
      const store = transaction.objectStore(this.texturesStoreName);
      const index = store.index('timestamp');
      const request = index.openCursor();
      
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      const cutoffTime = Date.now() - maxAge;
      
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const texture = cursor.value as CachedTexture;
          if (texture.timestamp < cutoffTime) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }
}

export const blocksCacheDB = new BlocksCacheDB();

export const useBlocksCache = () => {
  const [blocks, setBlocks] = useState<BlockType[]>([]);
  const [blocksMap, setBlocksMap] = useState<Map<string, BlockType>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [cacheVersion, setCacheVersion] = useState(0);

  // Fetch blocks from Supabase
  const fetchBlocksFromSupabase = useCallback(async (): Promise<BlockType[]> => {
    const { data, error } = await supabase
      .from('blocks')
      .select('*')
      .order('cost', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw error;

    const typedBlocks: BlockType[] = (data || []).map(block => ({
      id: block.id,
      key: block.key,
      name: block.name,
      description: block.description || '',
      cost: block.cost,
      category: block.category as BlockType['category'],
      rarity: block.rarity as BlockType['rarity'],
      texture: block.texture_url ? { diffuse: block.texture_url } : undefined,
      properties: {
        ...(block.properties as BlockType['properties']),
        glowFactor: block.glow_factor || undefined
      }
    }));

    return typedBlocks;
  }, []);

  // Update blocks state
  const updateBlocksState = useCallback((newBlocks: BlockType[]) => {
    const blockMap = new Map<string, BlockType>();
    newBlocks.forEach(block => blockMap.set(block.key, block));
    
    setBlocks(newBlocks);
    setBlocksMap(blockMap);
  }, []);

  // Load blocks: try cache first, then Supabase
  const loadBlocks = useCallback(async () => {
    try {
      // 1. Try to load from IndexedDB cache first (instant)
      const cached = await blocksCacheDB.getCachedBlocks();
      if (cached) {
        console.log('⚡ Using cached blocks (instant load)');
        updateBlocksState(cached.blocks);
        setCacheVersion(cached.version);
        setIsLoading(false);
        
        // Continue to fetch latest in background for sync
      }

      // 2. Fetch from Supabase (background sync)
      console.log('🔄 Syncing blocks from Supabase...');
      const freshBlocks = await fetchBlocksFromSupabase();
      
      // 3. Compare and update if different
      const newVersion = Date.now();
      const hasChanges = !cached || 
        JSON.stringify(cached.blocks) !== JSON.stringify(freshBlocks);
      
      if (hasChanges) {
        console.log('🆕 Block definitions updated from Supabase');
        updateBlocksState(freshBlocks);
        setCacheVersion(newVersion);
        
        // Save to cache
        await blocksCacheDB.setCachedBlocks({
          blocks: freshBlocks,
          version: newVersion,
          timestamp: Date.now()
        });
        
        // Notify components that blocks were updated
        window.dispatchEvent(new CustomEvent('blocksUpdated'));
      } else {
        console.log('✓ Blocks are up to date');
      }
      
    } catch (error) {
      console.error('Failed to load blocks:', error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchBlocksFromSupabase, updateBlocksState]);

  // Initialize on mount
  useEffect(() => {
    blocksCacheDB.init().then(() => {
      loadBlocks();
      // Clean up old textures on startup
      blocksCacheDB.clearOldTextures().catch(console.error);
    });
  }, [loadBlocks]);

  // Set up real-time subscription for block updates
  useEffect(() => {
    console.log('🔔 Setting up real-time subscription for blocks...');
    
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'blocks'
        },
        (payload) => {
          console.log('🔔 Block changed in database:', payload);
          // Reload blocks when any change occurs
          loadBlocks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadBlocks]);

  const getBlockByKey = useCallback((key: string): BlockType | undefined => {
    return blocksMap.get(key);
  }, [blocksMap]);

  const refreshBlocks = useCallback(async () => {
    setIsLoading(true);
    await loadBlocks();
  }, [loadBlocks]);

  return { 
    blocks, 
    blocksMap, 
    isLoading, 
    getBlockByKey, 
    refreshBlocks,
    cacheVersion 
  };
};
