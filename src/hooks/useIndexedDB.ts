import { PlacedBlock } from './usePlacedBlocks';

interface DBBlock extends Omit<PlacedBlock, 'created_at' | 'updated_at'> {
  created_at: string;
  updated_at: string;
  synced: boolean; // Track if synced to Supabase
  local_id?: string; // For offline blocks
}

class BlockDB {
  private db: IDBDatabase | null = null;
  private dbName = 'waterfall-blocks-db';
  private dbVersion = 1;
  private storeName = 'blocks';

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('synced', 'synced', { unique: false });
          store.createIndex('position', ['position_x', 'position_y', 'position_z'], { unique: false });
        }
      };
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
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('synced');
      const request = index.getAll(IDBKeyRange.only(false));
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
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
    init: () => blockDB.init()
  };
};