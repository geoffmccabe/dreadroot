import React from 'react';
import { PlacedBlock } from '../types/blocks';

interface DBBlock extends Omit<PlacedBlock, 'created_at' | 'updated_at'> {
  created_at: string;
  updated_at: string;
  synced: boolean; // Track if synced to Supabase
  local_id?: string; // For offline blocks
}

interface UserSession {
  id: string; // Always '1' (single record store)
  user_id: string; // Last authenticated Supabase user ID
  last_active: string; // ISO timestamp
}

interface TextureBlob {
  url: string; // Primary key
  blob: Blob; // The actual texture data
  cached_at: string; // ISO timestamp
}

class BlockDB {
  private db: IDBDatabase | null = null;
  private dbName = 'waterfall-blocks-db';
  private dbVersion = 6; // Ensure all stores use delete+recreate pattern
  private storeName = 'blocks';
  private sessionStoreName = 'user_session';
  private textureStoreName = 'texture_blobs';

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
          console.log('IndexedDB initialized successfully, version:', this.db.version);
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
          
          console.log('IndexedDB stores ready');
        };
      } catch (error) {
        console.error('Error initializing IndexedDB:', error);
        // If all else fails, try deleting the database and starting fresh
        if (error instanceof DOMException && error.name === 'VersionError') {
          console.warn('Attempting to delete and recreate database...');
          indexedDB.deleteDatabase(this.dbName);
          // Retry once after deletion
          setTimeout(() => this.init().then(resolve).catch(reject), 100);
        } else {
          reject(error);
        }
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
}

export const blockDB = new BlockDB();

export const useIndexedDB = () => {
  // Memoize the return object to prevent unnecessary re-renders
  // These methods are stable since blockDB is a singleton
  return React.useMemo(() => ({
    getAllBlocks: () => blockDB.getAllBlocks(),
    addBlock: (block: DBBlock) => blockDB.addBlock(block),
    removeBlock: (blockId: string) => blockDB.removeBlock(blockId),
    getUnsyncedBlocks: () => blockDB.getUnsyncedBlocks(),
    markAsSynced: (blockId: string) => blockDB.markAsSynced(blockId),
    clearAllBlocks: () => blockDB.clearAllBlocks(),
    updateBlock: (blockId: string, updates: Partial<DBBlock>) => blockDB.updateBlock(blockId, updates),
    init: () => blockDB.init(),
    saveUserSession: (userId: string) => blockDB.saveUserSession(userId),
    getUserSession: () => blockDB.getUserSession(),
    clearUserSession: () => blockDB.clearUserSession(),
    getTextureBlob: (url: string) => blockDB.getTextureBlob(url),
    saveTextureBlob: (url: string, blob: Blob) => blockDB.saveTextureBlob(url, blob)
  }), []); // Empty deps since blockDB is stable
};