import { PlacedBlock } from '../types/blocks';

interface DBBlock extends Omit<PlacedBlock, 'created_at' | 'updated_at'> {
  created_at: string;
  updated_at: string;
  synced: boolean; // Track if synced to Supabase
  local_id?: string; // For offline blocks
}

class BlockDB {
  private db: IDBDatabase | null = null;
  private dbName = 'waterfall-blocks-db';
  private dbVersion = 4; // Support full Supabase auth storage in auth store
  private storeName = 'blocks';
  private authStoreName = 'auth';

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(this.dbName, this.dbVersion);
        
        request.onerror = () => {
          console.error('IndexedDB open error:', request.error);
          reject(request.error);
        };
        
        request.onsuccess = () => {
          this.db = request.result;
          console.log('IndexedDB initialized successfully');
          resolve();
        };
        
        request.onupgradeneeded = (event) => {
          console.log('IndexedDB upgrade needed, clearing corrupted data');
          const db = (event.target as IDBOpenDBRequest).result;
          
          // Clear existing blocks store if it exists (to fix corruption)
          if (db.objectStoreNames.contains(this.storeName)) {
            db.deleteObjectStore(this.storeName);
          }
          
          // Create fresh blocks store
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('synced', 'synced', { unique: false });
          store.createIndex('position', ['position_x', 'position_y', 'position_z'], { unique: false });
          console.log('IndexedDB blocks store recreated');
          
          // Create auth store for user ID persistence
          if (!db.objectStoreNames.contains(this.authStoreName)) {
            db.createObjectStore(this.authStoreName, { keyPath: 'key' });
            console.log('IndexedDB auth store created');
          }
        };
      } catch (error) {
        console.error('Error initializing IndexedDB:', error);
        reject(error);
      }
    });
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

  // Auth methods for user ID persistence
  async getUserId(): Promise<string | null> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.authStoreName], 'readonly');
      const store = transaction.objectStore(this.authStoreName);
      const request = store.get('anonymous-user-id');
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result?.value || null);
    });
  }

  async setUserId(userId: string): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.authStoreName], 'readwrite');
      const store = transaction.objectStore(this.authStoreName);
      const request = store.put({ key: 'anonymous-user-id', value: userId });
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clearUserId(): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.authStoreName], 'readwrite');
      const store = transaction.objectStore(this.authStoreName);
      const request = store.delete('anonymous-user-id');
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // Generic key-value storage methods for Supabase auth
  async getAuthItem(key: string): Promise<string | null> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.authStoreName], 'readonly');
      const store = transaction.objectStore(this.authStoreName);
      const request = store.get(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result?.value || null);
    });
  }

  async setAuthItem(key: string, value: string): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.authStoreName], 'readwrite');
      const store = transaction.objectStore(this.authStoreName);
      const request = store.put({ key, value });
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async removeAuthItem(key: string): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.authStoreName], 'readwrite');
      const store = transaction.objectStore(this.authStoreName);
      const request = store.delete(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

export const blockDB = new BlockDB();

export const useIndexedDB = () => {
  return {
    getAllBlocks: () => blockDB.getAllBlocks(),
    addBlock: (block: DBBlock) => blockDB.addBlock(block),
    removeBlock: (blockId: string) => blockDB.removeBlock(blockId),
    getUnsyncedBlocks: () => blockDB.getUnsyncedBlocks(),
    markAsSynced: (blockId: string) => blockDB.markAsSynced(blockId),
    clearAllBlocks: () => blockDB.clearAllBlocks(),
    updateBlock: (blockId: string, updates: Partial<DBBlock>) => blockDB.updateBlock(blockId, updates),
    init: () => blockDB.init(),
    getUserId: () => blockDB.getUserId(),
    setUserId: (userId: string) => blockDB.setUserId(userId),
    clearUserId: () => blockDB.clearUserId()
  };
};