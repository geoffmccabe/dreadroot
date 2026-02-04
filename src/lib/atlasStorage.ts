/**
 * Atlas Storage System
 *
 * Handles IndexedDB persistence for the global texture atlas.
 * Stores both the atlas image blob and slot metadata.
 */

import { ATLAS_PIXEL_SIZE } from './textureAtlas';

const DB_NAME = 'fortress_atlas';
const DB_VERSION = 1;
const STORE_NAME = 'atlases';

export interface AtlasSlotMetadata {
  id: string;              // e.g., "tree_t5_trunk", "shwarm_t3", "block_stone"
  category: string;        // "tree", "shwarm", "shombie", "shnake", "walapa", "block", "global"
  sourceUrl: string | null; // Original URL (null for placeholder)
  urlHash: string;         // Hash of URL for change detection
  type: 'static' | 'animated';
  frameCount?: number;     // For animated textures
  frameDelayMs?: number;   // Animation speed
}

export interface AtlasMetadata {
  atlasId: number;
  version: number;
  schemaVersion?: number;  // Bumped when slot ranges change to force rebuild
  lastModified: number;    // Timestamp
  slots: Record<number, AtlasSlotMetadata>; // slotIndex -> metadata
  nextFreeSlot: Record<string, number>;     // category -> next available slot
}

export interface StoredAtlas {
  atlasId: number;
  imageBlob: Blob;
  metadata: AtlasMetadata;
}

let db: IDBDatabase | null = null;

/**
 * Initialize the IndexedDB database
 */
export async function initAtlasDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[AtlasStorage] Failed to open database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'atlasId' });
      }
    };
  });
}

/**
 * Save atlas to IndexedDB
 */
export async function saveAtlas(atlas: StoredAtlas): Promise<void> {
  const database = await initAtlasDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.put(atlas);

    request.onerror = () => {
      console.error('[AtlasStorage] Failed to save atlas:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log(`[AtlasStorage] Atlas ${atlas.atlasId} saved (${(atlas.imageBlob.size / 1024 / 1024).toFixed(2)} MB)`);
      resolve();
    };
  });
}

/**
 * Load atlas from IndexedDB
 */
export async function loadAtlas(atlasId: number): Promise<StoredAtlas | null> {
  const database = await initAtlasDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.get(atlasId);

    request.onerror = () => {
      console.error('[AtlasStorage] Failed to load atlas:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      if (request.result) {
        console.log(`[AtlasStorage] Atlas ${atlasId} loaded from cache`);
        resolve(request.result as StoredAtlas);
      } else {
        resolve(null);
      }
    };
  });
}

/**
 * Delete atlas from IndexedDB
 */
export async function deleteAtlas(atlasId: number): Promise<void> {
  const database = await initAtlasDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.delete(atlasId);

    request.onerror = () => {
      console.error('[AtlasStorage] Failed to delete atlas:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log(`[AtlasStorage] Atlas ${atlasId} deleted`);
      resolve();
    };
  });
}

/**
 * Check if atlas exists in IndexedDB
 */
export async function atlasExists(atlasId: number): Promise<boolean> {
  const atlas = await loadAtlas(atlasId);
  return atlas !== null;
}

/**
 * Convert canvas to blob for storage
 */
export async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert canvas to blob'));
        }
      },
      'image/webp',
      0.92 // High quality
    );
  });
}

/**
 * Convert blob to ImageBitmap for drawing
 */
export async function blobToImageBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

/**
 * Create empty atlas metadata
 */
// Bump this when SLOT_RANGES in atlasManager.ts change to force atlas rebuild
export const ATLAS_SCHEMA_VERSION = 7;

export function createEmptyMetadata(atlasId: number): AtlasMetadata {
  return {
    atlasId,
    version: 1,
    schemaVersion: ATLAS_SCHEMA_VERSION,
    lastModified: Date.now(),
    slots: {},
    nextFreeSlot: {
      tree: 0,        // 0-149 (150 slots)
      shwarm: 150,    // 150-399 (250 slots for animated textures)
      shombie: 400,   // 400-429 (30 slots)
      shnake: 430,    // 430-519 (90 slots)
      walapa: 520,    // 520-549 (30 slots)
      global: 550,    // 550-569 (20 slots)
      block: 570,     // 570-839 (270 slots)
      misc: 840,      // 840-1023 (184 slots)
    },
  };
}

/**
 * Create a simple hash of a string (for URL change detection)
 */
export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16);
}

/**
 * Create empty canvas for new atlas
 */
export function createEmptyAtlasCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_PIXEL_SIZE;
  canvas.height = ATLAS_PIXEL_SIZE;

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, ATLAS_PIXEL_SIZE, ATLAS_PIXEL_SIZE);

  return canvas;
}
