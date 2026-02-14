/**
 * Atlas Manager
 *
 * Manages the global texture atlas:
 * - Slot allocation per category
 * - Incremental updates (single slot redraws)
 * - Change detection via URL hashing
 * - Coordinates with storage for persistence
 */

import {
  ATLAS_SLOT_SIZE,
  ATLAS_GRID_SIZE,
  ATLAS_PIXEL_SIZE,
  ATLAS_TOTAL_SLOTS,
} from './textureAtlas';
import {
  loadAtlas,
  saveAtlas,
  canvasToBlob,
  blobToImageBitmap,
  createEmptyMetadata,
  createEmptyAtlasCanvas,
  hashString,
  ATLAS_SCHEMA_VERSION,
  type AtlasMetadata,
  type AtlasSlotMetadata,
  type StoredAtlas,
} from './atlasStorage';
import { parseStripMetadata } from './animationToStrip';
import { decompressFrames, parseGIF } from 'gifuct-js';

/**
 * Generate per-slot mipmaps to prevent cross-slot color bleeding.
 * Standard GPU mipmap generation downsamples the entire atlas, causing
 * neighboring slot colors to bleed into each other at lower mip levels.
 * This function independently downsamples each slot at every mip level.
 */
export function generatePerSlotMipmaps(baseCanvas: HTMLCanvasElement): HTMLCanvasElement[] {
  const mipmaps: HTMLCanvasElement[] = [];
  let prevCanvas = baseCanvas;
  let size = baseCanvas.width;
  let slotSize = size / ATLAS_GRID_SIZE;

  // Generate complete mipmap chain down to 1x1 (required by WebGL for LinearMipmapLinearFilter)
  while (size > 1) {
    const nextSize = Math.max(1, Math.floor(size / 2));
    const nextSlotSize = slotSize / 2;

    const mipCanvas = document.createElement('canvas');
    mipCanvas.width = nextSize;
    mipCanvas.height = nextSize;
    const mipCtx = mipCanvas.getContext('2d')!;

    if (nextSlotSize >= 1) {
      // Per-slot downsample: independently downsample each slot to prevent cross-slot bleeding
      const intSlotSize = Math.floor(slotSize);
      const intNextSlotSize = Math.floor(nextSlotSize);
      for (let row = 0; row < ATLAS_GRID_SIZE; row++) {
        for (let col = 0; col < ATLAS_GRID_SIZE; col++) {
          mipCtx.drawImage(
            prevCanvas,
            col * intSlotSize, row * intSlotSize, intSlotSize, intSlotSize,
            col * intNextSlotSize, row * intNextSlotSize, intNextSlotSize, intNextSlotSize
          );
        }
      }
    } else {
      // Below 1px per slot: standard downsample (slot bleeding irrelevant at this size)
      mipCtx.drawImage(prevCanvas, 0, 0, nextSize, nextSize);
    }

    mipmaps.push(mipCanvas);
    prevCanvas = mipCanvas;
    size = nextSize;
    slotSize = nextSlotSize;
  }

  return mipmaps;
}

// Slot range allocations by category
// Trees: 30 tiers × 3 textures (trunk/branch/fruit) — dynamic allocation for animated textures
// Block textures removed (getBlockUVs never called from rendering) — reclaimed 270 slots for tree animation
export const SLOT_RANGES: Record<string, { start: number; end: number }> = {
  tree: { start: 0, end: 289 },          // 290 slots (dynamic: 90 static + up to 200 animated)
  shwarm: { start: 290, end: 539 },      // 250 slots (10 tiers × up to 24 animated frames)
  shombie: { start: 540, end: 569 },     // 30 slots
  shnake: { start: 570, end: 659 },      // 90 slots
  walapa: { start: 660, end: 689 },      // 30 slots
  global: { start: 690, end: 709 },      // 20 slots
  fungal_tree: { start: 710, end: 799 }, // 90 slots (30 tiers × 3 types, deterministic)
  misc: { start: 800, end: 1023 },       // 224 slots
};

// Placeholder colors for missing textures — light tan so blocks are visible, not black
function getPlaceholderColor(_slotIndex: number): string {
  return '#C9B8A3';
}

/**
 * Get pixel position for a slot index
 */
export function getSlotPixelPosition(slotIndex: number): { x: number; y: number } {
  const col = slotIndex % ATLAS_GRID_SIZE;
  const row = Math.floor(slotIndex / ATLAS_GRID_SIZE);
  return {
    x: col * ATLAS_SLOT_SIZE,
    y: row * ATLAS_SLOT_SIZE,
  };
}

/**
 * Load an image from URL with timeout
 */
async function loadImage(url: string, timeoutMs: number = 10000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const timeout = setTimeout(() => {
      console.warn(`[AtlasManager] Image load timeout: ${url}`);
      resolve(null);
    }, timeoutMs);

    img.onload = () => {
      clearTimeout(timeout);
      resolve(img);
    };

    img.onerror = () => {
      clearTimeout(timeout);
      console.warn(`[AtlasManager] Failed to load image: ${url}`);
      resolve(null);
    };

    img.src = url;
  });
}

/**
 * Check if a URL points to a GIF file
 */
function isGifUrl(url: string): boolean {
  const path = url.split('?')[0].toLowerCase();
  return path.endsWith('.gif');
}

/**
 * Fetch a GIF from URL, parse all frames, and return frame canvases + timing info.
 * Returns null on failure. Max 24 frames.
 */
async function loadGifFrames(url: string): Promise<{
  frames: HTMLCanvasElement[];
  frameDelay: number;
} | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const gif = parseGIF(arrayBuffer);
    const rawFrames = decompressFrames(gif, true);

    if (rawFrames.length === 0) return null;

    const maxFrames = 24;
    // Sample frames if too many
    let selectedIndices: number[];
    if (rawFrames.length <= maxFrames) {
      selectedIndices = rawFrames.map((_, i) => i);
    } else {
      selectedIndices = [];
      const step = (rawFrames.length - 1) / (maxFrames - 1);
      for (let i = 0; i < maxFrames; i++) {
        selectedIndices.push(Math.round(step * i));
      }
      selectedIndices = [...new Set(selectedIndices)].sort((a, b) => a - b);
    }

    // Calculate average delay
    let totalDelay = 0;
    for (const idx of selectedIndices) {
      totalDelay += rawFrames[idx].delay || 100;
    }
    const frameDelay = Math.round(totalDelay / selectedIndices.length);

    // Render full-composite frames
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = gif.lsd.width;
    fullCanvas.height = gif.lsd.height;
    const fullCtx = fullCanvas.getContext('2d')!;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = gif.lsd.width;
    tempCanvas.height = gif.lsd.height;
    const tempCtx = tempCanvas.getContext('2d')!;

    const frames: HTMLCanvasElement[] = [];

    for (let frameIdx = 0; frameIdx <= selectedIndices[selectedIndices.length - 1]; frameIdx++) {
      const frame = rawFrames[frameIdx];
      const { dims, patch, disposalType } = frame;

      // Draw frame patch
      tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
      const patchData = tempCtx.createImageData(dims.width, dims.height);
      patchData.data.set(patch);
      tempCtx.putImageData(patchData, 0, 0);
      fullCtx.drawImage(tempCanvas, 0, 0, dims.width, dims.height, dims.left, dims.top, dims.width, dims.height);

      // If selected, capture this frame as a square canvas
      if (selectedIndices.includes(frameIdx)) {
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = ATLAS_SLOT_SIZE;
        frameCanvas.height = ATLAS_SLOT_SIZE;
        const frameCtx = frameCanvas.getContext('2d')!;

        // Center crop to square
        const srcSize = Math.min(fullCanvas.width, fullCanvas.height);
        const srcX = (fullCanvas.width - srcSize) / 2;
        const srcY = (fullCanvas.height - srcSize) / 2;
        frameCtx.drawImage(fullCanvas, srcX, srcY, srcSize, srcSize, 0, 0, ATLAS_SLOT_SIZE, ATLAS_SLOT_SIZE);

        frames.push(frameCanvas);
      }

      // Handle disposal
      if (disposalType === 2) {
        fullCtx.clearRect(dims.left, dims.top, dims.width, dims.height);
      }
    }

    return { frames, frameDelay: frameDelay || 100 };
  } catch (err) {
    console.warn(`[AtlasManager] Failed to parse GIF: ${url}`, err);
    return null;
  }
}

/**
 * Mipmap padding size — edge pixels are duplicated outward by this amount
 * to prevent GPU mipmap bleed between neighboring atlas slots.
 */
const ATLAS_PADDING = 4;

/**
 * Draw image to canvas slot with edge-clamp padding for mipmap safety.
 * The image is drawn at full slot size, then edge pixels are extended outward
 * by ATLAS_PADDING pixels on each side using 1px-wide strips.
 */
function drawImageToSlot(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | ImageBitmap,
  slotIndex: number
): void {
  const pos = getSlotPixelPosition(slotIndex);
  const srcWidth = img.width;
  const srcHeight = img.height;
  const P = ATLAS_PADDING;
  const inner = ATLAS_SLOT_SIZE - 2 * P; // 248

  // Pre-fill slot with placeholder color so transparent PNG areas don't show as black
  ctx.fillStyle = '#C9B8A3';
  ctx.fillRect(pos.x, pos.y, ATLAS_SLOT_SIZE, ATLAS_SLOT_SIZE);

  // Center crop to square
  const srcSize = Math.min(srcWidth, srcHeight);
  const srcX = (srcWidth - srcSize) / 2;
  const srcY = (srcHeight - srcSize) / 2;

  // Draw image into the inner area (inset by P on each side)
  ctx.drawImage(img, srcX, srcY, srcSize, srcSize, pos.x + P, pos.y + P, inner, inner);

  // Extend edge pixels outward to fill padding (clamp-to-edge for mipmaps)
  // Top padding: copy the top 1px row of the inner image upward P times
  ctx.drawImage(ctx.canvas, pos.x + P, pos.y + P, inner, 1, pos.x + P, pos.y, inner, P);
  // Bottom padding: copy the bottom 1px row of the inner image downward
  ctx.drawImage(ctx.canvas, pos.x + P, pos.y + P + inner - 1, inner, 1, pos.x + P, pos.y + P + inner, inner, P);
  // Left padding: copy the left 1px column of the full slot height
  ctx.drawImage(ctx.canvas, pos.x + P, pos.y, 1, ATLAS_SLOT_SIZE, pos.x, pos.y, P, ATLAS_SLOT_SIZE);
  // Right padding: copy the right 1px column of the full slot height
  ctx.drawImage(ctx.canvas, pos.x + P + inner - 1, pos.y, 1, ATLAS_SLOT_SIZE, pos.x + P + inner, pos.y, P, ATLAS_SLOT_SIZE);
}

/**
 * Draw animation strip to consecutive slots
 * Returns number of slots used
 */
function drawAnimationStripToSlots(
  ctx: CanvasRenderingContext2D,
  stripImg: HTMLImageElement,
  frameCount: number,
  startSlotIndex: number
): number {
  const frameWidth = stripImg.width / frameCount;
  const frameHeight = stripImg.height;

  const P = ATLAS_PADDING;
  const inner = ATLAS_SLOT_SIZE - 2 * P;

  for (let i = 0; i < frameCount; i++) {
    const pos = getSlotPixelPosition(startSlotIndex + i);
    const srcX = i * frameWidth;
    const srcY = 0;

    // Pre-fill slot so transparent areas don't show as black
    ctx.fillStyle = '#C9B8A3';
    ctx.fillRect(pos.x, pos.y, ATLAS_SLOT_SIZE, ATLAS_SLOT_SIZE);

    // Center crop each frame
    const srcSize = Math.min(frameWidth, frameHeight);
    const srcCropX = srcX + (frameWidth - srcSize) / 2;
    const srcCropY = (frameHeight - srcSize) / 2;

    // Draw into inner area with padding
    ctx.drawImage(
      stripImg,
      srcCropX, srcCropY, srcSize, srcSize,
      pos.x + P, pos.y + P, inner, inner
    );

    // Edge-clamp padding (same as drawImageToSlot)
    ctx.drawImage(ctx.canvas, pos.x + P, pos.y + P, inner, 1, pos.x + P, pos.y, inner, P);
    ctx.drawImage(ctx.canvas, pos.x + P, pos.y + P + inner - 1, inner, 1, pos.x + P, pos.y + P + inner, inner, P);
    ctx.drawImage(ctx.canvas, pos.x + P, pos.y, 1, ATLAS_SLOT_SIZE, pos.x, pos.y, P, ATLAS_SLOT_SIZE);
    ctx.drawImage(ctx.canvas, pos.x + P + inner - 1, pos.y, 1, ATLAS_SLOT_SIZE, pos.x + P + inner, pos.y, P, ATLAS_SLOT_SIZE);
  }

  return frameCount;
}

/**
 * Draw placeholder color to slot
 */
function drawPlaceholderToSlot(
  ctx: CanvasRenderingContext2D,
  slotIndex: number,
  color?: string
): void {
  const pos = getSlotPixelPosition(slotIndex);
  ctx.fillStyle = color || getPlaceholderColor(slotIndex);
  ctx.fillRect(pos.x, pos.y, ATLAS_SLOT_SIZE, ATLAS_SLOT_SIZE);
}

/**
 * Atlas Manager class - singleton pattern
 */
class AtlasManagerClass {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private metadata: AtlasMetadata | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the atlas manager
   * Loads from storage or creates new empty atlas
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    await this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    console.log('[AtlasManager] Initializing...');

    // Try to load existing atlas from storage
    const stored = await loadAtlas(1);

    if (stored && (stored.metadata.schemaVersion || 0) >= ATLAS_SCHEMA_VERSION) {
      // Restore from storage - schema version matches
      this.canvas = createEmptyAtlasCanvas();
      this.ctx = this.canvas.getContext('2d')!;

      // Draw stored image to canvas
      const imageBitmap = await blobToImageBitmap(stored.imageBlob);
      this.ctx.drawImage(imageBitmap, 0, 0);
      imageBitmap.close();

      // Validate canvas has actual pixel data (not corrupt/empty)
      const slotCount = Object.keys(stored.metadata.slots).length;
      if (slotCount > 0) {
        const sampleData = this.ctx.getImageData(0, 0, 256, 256).data;
        let nonBlackPixels = 0;
        for (let i = 0; i < sampleData.length; i += 16) {
          if (sampleData[i] > 5 || sampleData[i + 1] > 5 || sampleData[i + 2] > 5) {
            nonBlackPixels++;
            if (nonBlackPixels > 10) break;
          }
        }
        if (nonBlackPixels <= 10) {
          console.warn(`[AtlasManager] Restored canvas appears empty despite ${slotCount} slots - clearing metadata to force reload`);
          this.metadata = createEmptyMetadata(1);
        } else {
          this.metadata = stored.metadata;
          console.log(`[AtlasManager] Restored atlas with ${slotCount} slots (schema v${stored.metadata.schemaVersion})`);
        }
      } else {
        this.metadata = stored.metadata;
        console.log(`[AtlasManager] Restored atlas with 0 slots`);
      }
    } else {
      if (stored) {
        console.log(`[AtlasManager] Atlas schema outdated (v${stored.metadata.schemaVersion || 0} < v${ATLAS_SCHEMA_VERSION}) - rebuilding`);
      }
      // Create new empty atlas
      this.canvas = createEmptyAtlasCanvas();
      this.ctx = this.canvas.getContext('2d')!;
      this.metadata = createEmptyMetadata(1);
      console.log('[AtlasManager] Created new empty atlas');
    }

    // Pre-fill uncached tree/fungal slots with visible placeholder color.
    // Without this, empty slots are BLACK (from createEmptyAtlasCanvas) and
    // blocks sampling those slots appear invisible until atlas sync completes.
    if (this.ctx && this.metadata) {
      let placeholderCount = 0;
      for (const [category, range] of Object.entries(SLOT_RANGES)) {
        if (category === 'tree' || category === 'fungal_tree') {
          for (let slot = range.start; slot <= range.end; slot++) {
            if (!this.metadata.slots[slot]) {
              drawPlaceholderToSlot(this.ctx, slot);
              placeholderCount++;
            }
          }
        }
      }
      if (placeholderCount > 0) {
        console.log(`[AtlasManager] Pre-filled ${placeholderCount} empty tree/fungal slots with placeholder`);
      }
    }

    this.isInitialized = true;
  }

  /**
   * Get the atlas canvas
   */
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  /**
   * Get atlas metadata
   */
  getMetadata(): AtlasMetadata | null {
    return this.metadata;
  }

  /**
   * Check if a texture ID exists in the atlas
   */
  hasTexture(textureId: string): boolean {
    if (!this.metadata) return false;
    return Object.values(this.metadata.slots).some(slot => slot.id === textureId);
  }

  /**
   * Get slot info for a texture ID
   */
  getSlotForTexture(textureId: string): { slotIndex: number; metadata: AtlasSlotMetadata } | null {
    if (!this.metadata) return null;

    for (const [indexStr, slotMeta] of Object.entries(this.metadata.slots)) {
      if (slotMeta.id === textureId) {
        return { slotIndex: parseInt(indexStr, 10), metadata: slotMeta };
      }
    }
    return null;
  }

  /**
   * Allocate next available slot for a category
   */
  private allocateSlot(category: string, slotsNeeded: number = 1): number | null {
    if (!this.metadata) return null;

    const range = SLOT_RANGES[category];
    if (!range) {
      console.error(`[AtlasManager] Unknown category: ${category}`);
      return null;
    }

    const nextSlot = this.metadata.nextFreeSlot[category] ?? range.start;

    if (nextSlot + slotsNeeded - 1 > range.end) {
      console.error(`[AtlasManager] Category ${category} is full (next: ${nextSlot}, need: ${slotsNeeded}, max: ${range.end})`);
      return null;
    }

    this.metadata.nextFreeSlot[category] = nextSlot + slotsNeeded;
    return nextSlot;
  }

  /**
   * Add or update a texture in the atlas
   * Returns the slot index, or null on failure
   */
  async setTexture(
    textureId: string,
    category: string,
    sourceUrl: string | null,
    fallbackColor?: string
  ): Promise<number | null> {
    await this.initialize();

    if (!this.canvas || !this.ctx || !this.metadata) {
      console.error('[AtlasManager] Not initialized');
      return null;
    }

    const urlHash = sourceUrl ? hashString(sourceUrl) : 'placeholder';

    // Check if texture already exists
    const existing = this.getSlotForTexture(textureId);

    if (existing) {
      // Check if URL changed
      if (existing.metadata.urlHash === urlHash) {
        // No change needed
        return existing.slotIndex;
      }

      // URL changed - update existing slot
      return this._updateSlot(existing.slotIndex, textureId, category, sourceUrl, urlHash, fallbackColor);
    }

    // New texture - determine slots needed
    const stripMeta = sourceUrl ? parseStripMetadata(sourceUrl) : null;
    let slotsNeeded = stripMeta ? stripMeta.frames : 1;

    // For GIF URLs without strip metadata, pre-scan to determine frame count
    if (!stripMeta && sourceUrl && isGifUrl(sourceUrl)) {
      const gifData = await loadGifFrames(sourceUrl);
      if (gifData && gifData.frames.length > 1) {
        slotsNeeded = gifData.frames.length;
      }
      const slotIndex = this.allocateSlot(category, slotsNeeded);
      if (slotIndex === null) return null;
      return this._updateSlot(slotIndex, textureId, category, sourceUrl, urlHash, fallbackColor, null, gifData);
    }

    const slotIndex = this.allocateSlot(category, slotsNeeded);
    if (slotIndex === null) return null;

    return this._updateSlot(slotIndex, textureId, category, sourceUrl, urlHash, fallbackColor, stripMeta);
  }

  /**
   * Set a texture at a SPECIFIC slot index (for deterministic allocation)
   * Use this when you need consistent slot positions regardless of sync order
   */
  async setTextureAtSlot(
    slotIndex: number,
    textureId: string,
    category: string,
    sourceUrl: string | null,
    fallbackColor?: string
  ): Promise<number | null> {
    await this.initialize();

    if (!this.canvas || !this.ctx || !this.metadata) {
      console.error('[AtlasManager] Not initialized');
      return null;
    }

    const urlHash = sourceUrl ? hashString(sourceUrl) : 'placeholder';

    // Check if this slot already has the same texture with same URL
    const existingAtSlot = this.metadata.slots[slotIndex];
    if (existingAtSlot && existingAtSlot.id === textureId && existingAtSlot.urlHash === urlHash) {
      // No change needed
      return slotIndex;
    }

    // Check if this textureId exists at a DIFFERENT slot (shouldn't happen with proper usage)
    const existingElsewhere = this.getSlotForTexture(textureId);
    if (existingElsewhere && existingElsewhere.slotIndex !== slotIndex) {
      // Remove from old slot first
      delete this.metadata.slots[existingElsewhere.slotIndex];
    }

    const stripMeta = sourceUrl ? parseStripMetadata(sourceUrl) : null;
    return this._updateSlot(slotIndex, textureId, category, sourceUrl, urlHash, fallbackColor, stripMeta);
  }

  /**
   * Internal: Update a specific slot with new texture
   */
  private async _updateSlot(
    slotIndex: number,
    textureId: string,
    category: string,
    sourceUrl: string | null,
    urlHash: string,
    fallbackColor?: string,
    stripMeta?: { frames: number; delay: number } | null,
    preloadedGif?: { frames: HTMLCanvasElement[]; frameDelay: number } | null
  ): Promise<number> {
    if (!this.ctx || !this.metadata) return slotIndex;

    let slotsUsed = 1;
    let isAnimated = false;
    let frameCount = 1;
    let frameDelayMs = 100;

    if (preloadedGif && preloadedGif.frames.length > 0) {
      // Pre-loaded GIF frames — draw each to consecutive slots
      for (let f = 0; f < preloadedGif.frames.length; f++) {
        const pos = getSlotPixelPosition(slotIndex + f);
        // Pre-fill so transparent areas don't show as black
        this.ctx.fillStyle = '#C9B8A3';
        this.ctx.fillRect(pos.x, pos.y, ATLAS_SLOT_SIZE, ATLAS_SLOT_SIZE);
        this.ctx.drawImage(preloadedGif.frames[f], pos.x, pos.y);
      }
      if (preloadedGif.frames.length > 1) {
        isAnimated = true;
        frameCount = preloadedGif.frames.length;
        frameDelayMs = preloadedGif.frameDelay;
        slotsUsed = frameCount;
      }
    } else if (sourceUrl) {
      // Check if GIF URL (and no pre-loaded data)
      if (isGifUrl(sourceUrl) && !stripMeta) {
        const gifData = await loadGifFrames(sourceUrl);
        if (gifData && gifData.frames.length > 0) {
          for (let f = 0; f < gifData.frames.length; f++) {
            const pos = getSlotPixelPosition(slotIndex + f);
            // Pre-fill so transparent areas don't show as black
            this.ctx!.fillStyle = '#C9B8A3';
            this.ctx!.fillRect(pos.x, pos.y, ATLAS_SLOT_SIZE, ATLAS_SLOT_SIZE);
            this.ctx.drawImage(gifData.frames[f], pos.x, pos.y);
          }
          if (gifData.frames.length > 1) {
            isAnimated = true;
            frameCount = gifData.frames.length;
            frameDelayMs = gifData.frameDelay;
            slotsUsed = frameCount;
          }
        } else {
          drawPlaceholderToSlot(this.ctx, slotIndex, fallbackColor);
        }
      } else {
        const img = await loadImage(sourceUrl);

        if (img) {
          if (stripMeta) {
            // Animated strip
            slotsUsed = drawAnimationStripToSlots(this.ctx, img, stripMeta.frames, slotIndex);
            isAnimated = true;
            frameCount = stripMeta.frames;
            frameDelayMs = stripMeta.delay;
          } else {
            // Static image
            drawImageToSlot(this.ctx, img, slotIndex);
          }
        } else {
          drawPlaceholderToSlot(this.ctx, slotIndex, fallbackColor);
        }
      }
    } else {
      // No URL - use placeholder
      drawPlaceholderToSlot(this.ctx, slotIndex, fallbackColor);
    }

    // Update metadata
    this.metadata.slots[slotIndex] = {
      id: textureId,
      category,
      sourceUrl,
      urlHash,
      type: isAnimated ? 'animated' : 'static',
      frameCount: isAnimated ? frameCount : undefined,
      frameDelayMs: isAnimated ? frameDelayMs : undefined,
    };

    this.metadata.lastModified = Date.now();
    this.metadata.version++;

    return slotIndex;
  }

  /**
   * Remove a texture from the atlas (draw placeholder)
   */
  async removeTexture(textureId: string): Promise<boolean> {
    await this.initialize();

    if (!this.ctx || !this.metadata) return false;

    const existing = this.getSlotForTexture(textureId);
    if (!existing) return false;

    // Draw placeholder over the slot
    drawPlaceholderToSlot(this.ctx, existing.slotIndex);

    // For animated textures, clear all frames
    if (existing.metadata.type === 'animated' && existing.metadata.frameCount) {
      for (let i = 1; i < existing.metadata.frameCount; i++) {
        drawPlaceholderToSlot(this.ctx, existing.slotIndex + i);
        delete this.metadata.slots[existing.slotIndex + i];
      }
    }

    // Remove from metadata
    delete this.metadata.slots[existing.slotIndex];
    this.metadata.lastModified = Date.now();
    this.metadata.version++;

    return true;
  }

  /**
   * Save current atlas state to IndexedDB
   */
  async save(): Promise<void> {
    if (!this.canvas || !this.metadata) {
      console.error('[AtlasManager] Cannot save - not initialized');
      return;
    }

    const blob = await canvasToBlob(this.canvas);

    await saveAtlas({
      atlasId: 1,
      imageBlob: blob,
      metadata: this.metadata,
    });
  }

  /**
   * Get all texture IDs in a category
   */
  getTexturesInCategory(category: string): string[] {
    if (!this.metadata) return [];

    return Object.values(this.metadata.slots)
      .filter(slot => slot.category === category)
      .map(slot => slot.id);
  }

  /**
   * Check if any textures need updating based on URL changes
   */
  getOutdatedTextures(
    currentUrls: Map<string, string | null> // textureId -> currentUrl
  ): string[] {
    if (!this.metadata) return [];

    const outdated: string[] = [];

    for (const [textureId, currentUrl] of currentUrls) {
      const existing = this.getSlotForTexture(textureId);

      if (!existing) {
        // New texture
        outdated.push(textureId);
      } else {
        const currentHash = currentUrl ? hashString(currentUrl) : 'placeholder';
        if (existing.metadata.urlHash !== currentHash) {
          // URL changed
          outdated.push(textureId);
        }
      }
    }

    return outdated;
  }

  /**
   * Clear the atlas and reset to empty state
   */
  async clear(): Promise<void> {
    this.canvas = createEmptyAtlasCanvas();
    this.ctx = this.canvas.getContext('2d')!;
    this.metadata = createEmptyMetadata(1);
    await this.save();
    console.log('[AtlasManager] Atlas cleared');
  }

  /**
   * Get statistics about atlas usage
   */
  getStats(): {
    totalSlots: number;
    usedSlots: number;
    byCategory: Record<string, number>;
  } {
    const byCategory: Record<string, number> = {};

    if (this.metadata) {
      for (const slot of Object.values(this.metadata.slots)) {
        byCategory[slot.category] = (byCategory[slot.category] || 0) + 1;
      }
    }

    return {
      totalSlots: ATLAS_TOTAL_SLOTS,
      usedSlots: this.metadata ? Object.keys(this.metadata.slots).length : 0,
      byCategory,
    };
  }

  /**
   * Batch set textures with parallel image loading
   * Loads all images concurrently (with concurrency limit), then draws sequentially.
   * Much faster than calling setTexture() in a loop.
   */
  async batchSetTextures(
    specs: Array<{
      textureId: string;
      category: string;
      sourceUrl: string | null;
      fallbackColor?: string;
      slotIndex?: number; // If set, use fixed slot; otherwise auto-allocate
    }>,
    concurrency: number = 10
  ): Promise<number> {
    await this.initialize();
    if (!this.canvas || !this.ctx || !this.metadata) return 0;

    // Step 1: Pre-scan GIF URLs to determine slot requirements
    // GIFs need multiple slots for animation frames, so we must know frame counts
    // before allocating slots. Load all GIFs first.
    const gifCache = new Map<string, Awaited<ReturnType<typeof loadGifFrames>>>();
    const gifUrls = [...new Set(
      specs.filter(s => s.sourceUrl && isGifUrl(s.sourceUrl)).map(s => s.sourceUrl!)
    )];

    // Load GIFs in parallel (with concurrency limit)
    for (let i = 0; i < gifUrls.length; i += concurrency) {
      const batch = gifUrls.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(url => loadGifFrames(url)));
      batch.forEach((url, idx) => gifCache.set(url, results[idx]));
    }

    // Step 2: Determine which textures need processing and resolve slots
    const toProcess: Array<{
      textureId: string;
      category: string;
      sourceUrl: string | null;
      fallbackColor?: string;
      resolvedSlot: number;
      urlHash: string;
      stripMeta: { frames: number; delay: number } | null;
      isGif: boolean;
    }> = [];

    for (const spec of specs) {
      const urlHash = spec.sourceUrl ? hashString(spec.sourceUrl) : 'placeholder';
      const stripMeta = spec.sourceUrl ? parseStripMetadata(spec.sourceUrl) : null;
      const isGif = spec.sourceUrl ? isGifUrl(spec.sourceUrl) : false;
      const gifData = isGif && spec.sourceUrl ? gifCache.get(spec.sourceUrl) : null;

      // Determine how many slots this texture needs
      let slotsNeeded = 1;
      if (stripMeta) {
        slotsNeeded = stripMeta.frames;
      } else if (gifData && gifData.frames.length > 1) {
        slotsNeeded = gifData.frames.length;
      }

      if (spec.slotIndex !== undefined) {
        // Fixed slot allocation
        const existing = this.metadata.slots[spec.slotIndex];
        if (existing && existing.id === spec.textureId && existing.urlHash === urlHash) continue;

        const existingElsewhere = this.getSlotForTexture(spec.textureId);
        if (existingElsewhere && existingElsewhere.slotIndex !== spec.slotIndex) {
          delete this.metadata.slots[existingElsewhere.slotIndex];
        }

        toProcess.push({ ...spec, resolvedSlot: spec.slotIndex, urlHash, stripMeta, isGif });
      } else {
        // Auto-allocate slot
        const existing = this.getSlotForTexture(spec.textureId);
        if (existing && existing.metadata.urlHash === urlHash) continue;

        if (existing) {
          toProcess.push({ ...spec, resolvedSlot: existing.slotIndex, urlHash, stripMeta, isGif });
        } else {
          const slot = this.allocateSlot(spec.category, slotsNeeded);
          if (slot === null) continue;
          toProcess.push({ ...spec, resolvedSlot: slot, urlHash, stripMeta, isGif });
        }
      }
    }

    // Log how many textures were skipped (cache hit) vs need redrawing
    const totalSpecs = specs.length;
    const skipped = totalSpecs - toProcess.length;
    console.log(`[AtlasManager] batchSetTextures: ${totalSpecs} specs, ${skipped} cached (skipped), ${toProcess.length} to redraw`);
    if (toProcess.length > 0) {
      // Log tree textures being redrawn (helps debug wrong-texture issues)
      const treeRedraws = toProcess.filter(p => p.category === 'tree');
      if (treeRedraws.length > 0) {
        console.log(`[AtlasManager] Redrawing ${treeRedraws.length} tree textures:`, treeRedraws.map(t => `${t.textureId}@slot${t.resolvedSlot}`).join(', '));
      }
    }

    if (toProcess.length === 0) return 0;

    // Step 3: Load all non-GIF images in parallel with concurrency limit
    const nonGifUrls = [...new Set(
      toProcess.filter(s => s.sourceUrl && !s.isGif).map(s => s.sourceUrl!)
    )];
    const imageCache = new Map<string, HTMLImageElement | null>();

    for (let i = 0; i < nonGifUrls.length; i += concurrency) {
      const batch = nonGifUrls.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(url => loadImage(url)));
      batch.forEach((url, idx) => imageCache.set(url, results[idx]));
    }

    // Step 4: Draw all textures to canvas sequentially
    for (const item of toProcess) {
      let isAnimated = false;
      let frameCount = 1;
      let frameDelayMs = 100;

      if (item.sourceUrl) {
        if (item.isGif) {
          // GIF: draw parsed frames to consecutive slots
          const gifData = gifCache.get(item.sourceUrl);
          if (gifData && gifData.frames.length > 0) {
            for (let f = 0; f < gifData.frames.length; f++) {
              const pos = getSlotPixelPosition(item.resolvedSlot + f);
              // Pre-fill so transparent areas don't show as black
              this.ctx!.fillStyle = '#C9B8A3';
              this.ctx!.fillRect(pos.x, pos.y, ATLAS_SLOT_SIZE, ATLAS_SLOT_SIZE);
              this.ctx!.drawImage(gifData.frames[f], pos.x, pos.y);
            }
            if (gifData.frames.length > 1) {
              isAnimated = true;
              frameCount = gifData.frames.length;
              frameDelayMs = gifData.frameDelay;
            }
          } else {
            drawPlaceholderToSlot(this.ctx!, item.resolvedSlot, item.fallbackColor);
          }
        } else {
          // Non-GIF: use cached image
          const img = imageCache.get(item.sourceUrl) ?? null;
          if (img) {
            if (item.stripMeta) {
              drawAnimationStripToSlots(this.ctx!, img, item.stripMeta.frames, item.resolvedSlot);
              isAnimated = true;
              frameCount = item.stripMeta.frames;
              frameDelayMs = item.stripMeta.delay;
            } else {
              drawImageToSlot(this.ctx!, img, item.resolvedSlot);
            }
          } else {
            drawPlaceholderToSlot(this.ctx!, item.resolvedSlot, item.fallbackColor);
          }
        }
      } else {
        drawPlaceholderToSlot(this.ctx!, item.resolvedSlot, item.fallbackColor);
      }

      this.metadata!.slots[item.resolvedSlot] = {
        id: item.textureId,
        category: item.category,
        sourceUrl: item.sourceUrl,
        urlHash: item.urlHash,
        type: isAnimated ? 'animated' : 'static',
        frameCount: isAnimated ? frameCount : undefined,
        frameDelayMs: isAnimated ? frameDelayMs : undefined,
      };
    }

    this.metadata!.lastModified = Date.now();
    this.metadata!.version++;

    return toProcess.length;
  }
}

// Singleton instance
export const atlasManager = new AtlasManagerClass();

/**
 * Clear the atlas IndexedDB cache and force a full rebuild on next load.
 * Call from browser console: window.clearAtlasCache()
 */
export async function clearAtlasCache(): Promise<void> {
  await atlasManager.clear();
  console.log('[AtlasManager] Cache cleared. Reload the page to rebuild all textures from scratch.');
}

// Expose on window for easy console access
if (typeof window !== 'undefined') {
  (window as any).clearAtlasCache = clearAtlasCache;
}
