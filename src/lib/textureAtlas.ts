/**
 * Texture Atlas System - Constants and Legacy Registry
 *
 * Atlas specs:
 * - Each texture slot: 256x256 pixels
 * - Atlas grid: 32x32 = 1024 slots
 * - Total atlas size: 8192x8192 pixels
 * - Format: WebP
 * - Naming: atlas_1, atlas_2, etc.
 *
 * NOTE: The new global atlas system uses:
 * - atlasManager.ts - for slot management and incremental updates
 * - atlasStorage.ts - for IndexedDB persistence
 * - atlasLookup.ts - for UV coordinate lookups
 * - useTextureAtlas.ts - main React hook
 * - useAtlasSync.ts - syncs database definitions to atlas
 *
 * The atlasRegistry below is kept for backwards compatibility during migration.
 */

export const ATLAS_SLOT_SIZE = 256;
export const ATLAS_GRID_SIZE = 32;
export const ATLAS_TOTAL_SLOTS = ATLAS_GRID_SIZE * ATLAS_GRID_SIZE; // 1024
export const ATLAS_PIXEL_SIZE = ATLAS_SLOT_SIZE * ATLAS_GRID_SIZE; // 8192
export const ANIMATION_FRAME_COUNT = 24;

export interface AtlasSlot {
  atlasId: number;       // Which atlas (1, 2, 3, ...)
  slotIndex: number;     // 0-1023 index in the atlas
  row: number;           // 0-31 row in atlas grid
  col: number;           // 0-31 column in atlas grid
  // UV coordinates (normalized 0-1)
  uvMinX: number;
  uvMinY: number;
  uvMaxX: number;
  uvMaxY: number;
}

export interface AtlasEntry {
  id: string;            // Unique identifier (e.g., "tree_t1_trunk", "tree_t5_branch")
  type: 'static' | 'animated';
  slot: AtlasSlot;       // For static, single slot. For animated, first slot of 24.
  frameCount?: number;   // For animated textures
  frameDelayMs?: number; // Animation speed
  sourceUrl?: string;    // Original texture URL (if loaded from URL)
  color?: string;        // Fallback color if no texture
}

export interface AtlasMetadata {
  atlasId: number;
  version: number;
  createdAt: string;
  slotCount: number;
  usedSlots: number;
  entries: AtlasEntry[];
}

/**
 * Calculate UV coordinates for a slot index
 */
export function getSlotUVs(slotIndex: number): { uvMinX: number; uvMinY: number; uvMaxX: number; uvMaxY: number } {
  const col = slotIndex % ATLAS_GRID_SIZE;
  const row = Math.floor(slotIndex / ATLAS_GRID_SIZE);

  const slotSize = 1 / ATLAS_GRID_SIZE;

  return {
    uvMinX: col * slotSize,
    uvMinY: 1 - (row + 1) * slotSize, // Flip Y for WebGL (0,0 is bottom-left)
    uvMaxX: (col + 1) * slotSize,
    uvMaxY: 1 - row * slotSize,
  };
}

/**
 * Create an AtlasSlot from atlas ID and slot index
 */
export function createSlot(atlasId: number, slotIndex: number): AtlasSlot {
  const col = slotIndex % ATLAS_GRID_SIZE;
  const row = Math.floor(slotIndex / ATLAS_GRID_SIZE);
  const uvs = getSlotUVs(slotIndex);

  return {
    atlasId,
    slotIndex,
    row,
    col,
    ...uvs,
  };
}

/**
 * Atlas Registry - tracks all atlases and their contents
 */
class TextureAtlasRegistry {
  private atlases: Map<number, AtlasMetadata> = new Map();
  private entryLookup: Map<string, AtlasEntry> = new Map();
  private nextSlotIndex: Map<number, number> = new Map(); // Per atlas

  /**
   * Initialize or get an atlas
   */
  getOrCreateAtlas(atlasId: number): AtlasMetadata {
    if (!this.atlases.has(atlasId)) {
      const metadata: AtlasMetadata = {
        atlasId,
        version: 1,
        createdAt: new Date().toISOString(),
        slotCount: ATLAS_TOTAL_SLOTS,
        usedSlots: 0,
        entries: [],
      };
      this.atlases.set(atlasId, metadata);
      this.nextSlotIndex.set(atlasId, 0);
    }
    return this.atlases.get(atlasId)!;
  }

  /**
   * Register a static texture entry
   */
  registerStatic(id: string, atlasId: number, slotIndex: number, sourceUrl?: string, color?: string): AtlasEntry {
    const entry: AtlasEntry = {
      id,
      type: 'static',
      slot: createSlot(atlasId, slotIndex),
      sourceUrl,
      color,
    };

    this.entryLookup.set(id, entry);

    const atlas = this.getOrCreateAtlas(atlasId);
    atlas.entries.push(entry);
    atlas.usedSlots++;

    return entry;
  }

  /**
   * Register an animated texture entry (variable frame count)
   */
  registerAnimated(
    id: string,
    atlasId: number,
    startSlotIndex: number,
    frameCount: number,
    frameDelayMs: number = 100,
    sourceUrl?: string
  ): AtlasEntry {
    const entry: AtlasEntry = {
      id,
      type: 'animated',
      slot: createSlot(atlasId, startSlotIndex),
      frameCount,
      frameDelayMs,
      sourceUrl,
    };

    this.entryLookup.set(id, entry);

    const atlas = this.getOrCreateAtlas(atlasId);
    atlas.entries.push(entry);
    atlas.usedSlots += frameCount;

    return entry;
  }

  /**
   * Get entry by ID
   */
  getEntry(id: string): AtlasEntry | undefined {
    return this.entryLookup.get(id);
  }

  /**
   * Get UV coordinates for an entry (for static) or specific frame (for animated)
   */
  getUVs(id: string, frameIndex: number = 0): { uvMinX: number; uvMinY: number; uvMaxX: number; uvMaxY: number } | null {
    const entry = this.entryLookup.get(id);
    if (!entry) return null;

    if (entry.type === 'static') {
      return {
        uvMinX: entry.slot.uvMinX,
        uvMinY: entry.slot.uvMinY,
        uvMaxX: entry.slot.uvMaxX,
        uvMaxY: entry.slot.uvMaxY,
      };
    } else {
      // Animated: calculate slot for this frame
      const actualFrame = frameIndex % (entry.frameCount || 24);
      const slotIndex = entry.slot.slotIndex + actualFrame;
      return getSlotUVs(slotIndex);
    }
  }

  /**
   * Get all entries for an atlas
   */
  getAtlasEntries(atlasId: number): AtlasEntry[] {
    return this.atlases.get(atlasId)?.entries || [];
  }

  /**
   * Get next available slot index for an atlas
   */
  getNextSlotIndex(atlasId: number): number {
    return this.nextSlotIndex.get(atlasId) || 0;
  }

  /**
   * Allocate slots and update next available
   */
  allocateSlots(atlasId: number, count: number): number {
    const startIndex = this.getNextSlotIndex(atlasId);
    this.nextSlotIndex.set(atlasId, startIndex + count);
    return startIndex;
  }

  /**
   * Check if atlas has space for N slots
   */
  hasSpace(atlasId: number, slotsNeeded: number): boolean {
    const nextSlot = this.getNextSlotIndex(atlasId);
    return nextSlot + slotsNeeded <= ATLAS_TOTAL_SLOTS;
  }

  /**
   * Find atlas with space, or return next atlas ID
   */
  findAtlasWithSpace(slotsNeeded: number): number {
    for (const [atlasId] of this.atlases) {
      if (this.hasSpace(atlasId, slotsNeeded)) {
        return atlasId;
      }
    }
    // All atlases full, return next ID
    return this.atlases.size + 1;
  }

  /**
   * Export metadata for persistence
   */
  exportMetadata(): AtlasMetadata[] {
    return Array.from(this.atlases.values());
  }

  /**
   * Import metadata from persistence
   */
  importMetadata(metadataList: AtlasMetadata[]): void {
    for (const metadata of metadataList) {
      this.atlases.set(metadata.atlasId, metadata);

      // Rebuild entry lookup and find max slot index
      let maxSlot = 0;
      for (const entry of metadata.entries) {
        this.entryLookup.set(entry.id, entry);
        const endSlot = entry.type === 'animated'
          ? entry.slot.slotIndex + ANIMATION_FRAME_COUNT
          : entry.slot.slotIndex + 1;
        if (endSlot > maxSlot) maxSlot = endSlot;
      }
      this.nextSlotIndex.set(metadata.atlasId, maxSlot);
    }
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.atlases.clear();
    this.entryLookup.clear();
    this.nextSlotIndex.clear();
  }
}

// Singleton instance
export const atlasRegistry = new TextureAtlasRegistry();

/**
 * Tree texture ID generators
 */
export function getTreeTextureId(tier: number, type: 'trunk' | 'branch' | 'fruit'): string {
  return `tree_t${tier}_${type}`;
}

/**
 * Get atlas entry for a tree texture, or null if not in atlas
 */
export function getTreeAtlasEntry(tier: number, type: 'trunk' | 'branch' | 'fruit'): AtlasEntry | undefined {
  return atlasRegistry.getEntry(getTreeTextureId(tier, type));
}
