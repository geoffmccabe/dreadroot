/**
 * Texture Atlas Generator
 *
 * Generates atlas images by packing textures into a single large image.
 * Handles missing textures with solid color placeholders.
 *
 * Features:
 * - Crop-to-fill scaling (preserves aspect ratio, fills 256x256)
 * - Animation support (GIF/video → multiple frames in atlas)
 * - Keeps original frame count (doesn't stretch to 24)
 */

import {
  ATLAS_SLOT_SIZE,
  ATLAS_GRID_SIZE,
  ATLAS_PIXEL_SIZE,
  ANIMATION_FRAME_COUNT,
  atlasRegistry,
  getTreeTextureId,
  type AtlasEntry,
} from './textureAtlas';
import { parseStripMetadata } from './animationToStrip';

// Tree tier count (T1-T30)
const TREE_TIER_COUNT = 30;

// Placeholder colors for missing textures (earthy/natural tones)
const PLACEHOLDER_COLORS = [
  '#4a4a4a', '#5a5a5a', '#6a6a6a', '#7a7a7a', // Greys
  '#4a3a2a', '#5a4a3a', '#6a5a4a', '#7a6a5a', // Browns
  '#3a4a3a', '#4a5a4a', '#5a6a5a', '#6a7a6a', // Grey-greens
];

/**
 * Generate a random grey color for placeholder
 */
function getRandomGreyColor(): string {
  const grey = Math.floor(Math.random() * 60) + 60; // 60-120 range
  return `rgb(${grey}, ${grey}, ${grey})`;
}

/**
 * Generate a seeded "random" grey based on tier/type for consistency
 */
function getSeededGreyColor(tier: number, typeIndex: number): string {
  const seed = tier * 3 + typeIndex;
  const grey = 60 + (seed * 17) % 60; // Deterministic grey 60-120
  return `rgb(${grey}, ${grey}, ${grey})`;
}

/**
 * Load an image from URL
 */
async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Draw a solid color to a canvas region
 */
function drawSolidColor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

/**
 * Draw an image to a canvas region using CROP-TO-FILL scaling
 * This preserves aspect ratio by:
 * 1. Scaling the image so its smaller dimension fills the target
 * 2. Center-cropping any overflow
 */
function drawImageCropToFill(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  destX: number,
  destY: number,
  destSize: number
): void {
  const srcWidth = img.width;
  const srcHeight = img.height;

  // Find the largest square that fits (center crop)
  const srcSize = Math.min(srcWidth, srcHeight);
  const srcX = (srcWidth - srcSize) / 2;
  const srcY = (srcHeight - srcSize) / 2;

  // Draw cropped square scaled to destination
  ctx.drawImage(img, srcX, srcY, srcSize, srcSize, destX, destY, destSize, destSize);
}

/**
 * Get pixel position for a slot index
 */
function getSlotPixelPosition(slotIndex: number): { x: number; y: number } {
  const col = slotIndex % ATLAS_GRID_SIZE;
  const row = Math.floor(slotIndex / ATLAS_GRID_SIZE);
  return {
    x: col * ATLAS_SLOT_SIZE,
    y: row * ATLAS_SLOT_SIZE,
  };
}

/**
 * Check if a URL is an animation strip and get its metadata
 */
function getStripMetadata(url: string | undefined): { frames: number; delay: number } | null {
  if (!url) return null;
  return parseStripMetadata(url);
}

/**
 * Draw an animation strip image to consecutive atlas slots
 * Strip images are horizontal (frame1 | frame2 | frame3 | ...)
 * Each frame is ATLAS_SLOT_SIZE x ATLAS_SLOT_SIZE in the source
 *
 * @returns Number of slots used
 */
function drawAnimationStrip(
  ctx: CanvasRenderingContext2D,
  stripImg: HTMLImageElement,
  frameCount: number,
  startSlotIndex: number
): number {
  const frameWidth = stripImg.width / frameCount;
  const frameHeight = stripImg.height;

  for (let i = 0; i < frameCount; i++) {
    const pos = getSlotPixelPosition(startSlotIndex + i);

    // Source: each frame in the horizontal strip
    const srcX = i * frameWidth;
    const srcY = 0;

    // Use crop-to-fill for each frame (in case frame isn't square)
    const srcSize = Math.min(frameWidth, frameHeight);
    const srcCropX = srcX + (frameWidth - srcSize) / 2;
    const srcCropY = (frameHeight - srcSize) / 2;

    ctx.drawImage(
      stripImg,
      srcCropX, srcCropY, srcSize, srcSize,
      pos.x, pos.y, ATLAS_SLOT_SIZE, ATLAS_SLOT_SIZE
    );
  }

  return frameCount;
}

export interface TreeTextureSource {
  tier: number;
  trunkUrl?: string;
  branchUrl?: string;
  fruitUrl?: string;
}

export interface AtlasGenerationResult {
  atlasId: number;
  canvas: HTMLCanvasElement;
  blob: Blob | null;
  entries: AtlasEntry[];
  stats: {
    totalSlots: number;
    usedSlots: number;
    loadedTextures: number;
    placeholderTextures: number;
  };
}

/**
 * Generate tree texture atlas
 *
 * @param atlasId - Atlas identifier (1, 2, 3, ...)
 * @param treeSources - Array of tree texture sources (tier + URLs)
 * @returns Atlas generation result with canvas, blob, and metadata
 */
export async function generateTreeAtlas(
  atlasId: number,
  treeSources: TreeTextureSource[]
): Promise<AtlasGenerationResult> {
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_PIXEL_SIZE;
  canvas.height = ATLAS_PIXEL_SIZE;
  const ctx = canvas.getContext('2d')!;

  // Fill with transparent black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, ATLAS_PIXEL_SIZE, ATLAS_PIXEL_SIZE);

  // Initialize atlas in registry
  atlasRegistry.getOrCreateAtlas(atlasId);

  const entries: AtlasEntry[] = [];
  let slotIndex = 0;
  let loadedCount = 0;
  let placeholderCount = 0;

  // Cache loaded trunk textures for fallback
  const trunkImageCache: Map<number, HTMLImageElement | null> = new Map();

  // First pass: load all trunk textures (they're the fallback)
  for (const source of treeSources) {
    if (source.trunkUrl) {
      const img = await loadImage(source.trunkUrl);
      trunkImageCache.set(source.tier, img);
    }
  }

  // Helper to process a texture (static or animated) and return slots used
  async function processTexture(
    id: string,
    url: string | undefined,
    fallbackImg: HTMLImageElement | null,
    fallbackUrl: string | undefined,
    placeholderTypeIndex: number,
    tier: number
  ): Promise<{ slotsUsed: number; loaded: boolean }> {
    // Check if this is an animation strip
    const stripMeta = getStripMetadata(url);

    if (url) {
      const img = await loadImage(url);
      if (img) {
        if (stripMeta) {
          // Animated strip: draw each frame to consecutive slots
          const slotsUsed = drawAnimationStrip(ctx, img, stripMeta.frames, slotIndex);
          const entry = atlasRegistry.registerAnimated(id, atlasId, slotIndex, stripMeta.frames, stripMeta.delay, url);
          entries.push(entry);
          loadedCount++;
          return { slotsUsed, loaded: true };
        } else {
          // Static image: draw once
          const pos = getSlotPixelPosition(slotIndex);
          drawImageCropToFill(ctx, img, pos.x, pos.y, ATLAS_SLOT_SIZE);
          const entry = atlasRegistry.registerStatic(id, atlasId, slotIndex, url);
          entries.push(entry);
          loadedCount++;
          return { slotsUsed: 1, loaded: true };
        }
      }
    }

    // URL missing or failed to load - try fallback
    if (fallbackImg) {
      const pos = getSlotPixelPosition(slotIndex);
      drawImageCropToFill(ctx, fallbackImg, pos.x, pos.y, ATLAS_SLOT_SIZE);
      const entry = atlasRegistry.registerStatic(id, atlasId, slotIndex, fallbackUrl);
      entries.push(entry);
      loadedCount++;
      return { slotsUsed: 1, loaded: true };
    }

    // No fallback - use placeholder color
    const color = getSeededGreyColor(tier, placeholderTypeIndex);
    const pos = getSlotPixelPosition(slotIndex);
    drawSolidColor(ctx, pos.x, pos.y, ATLAS_SLOT_SIZE, ATLAS_SLOT_SIZE, color);
    const entry = atlasRegistry.registerStatic(id, atlasId, slotIndex, undefined, color);
    entries.push(entry);
    placeholderCount++;
    return { slotsUsed: 1, loaded: false };
  }

  // Process each tree tier
  for (const source of treeSources) {
    const tier = source.tier;
    const trunkImg = trunkImageCache.get(tier);

    // Process trunk texture
    {
      const id = getTreeTextureId(tier, 'trunk');
      const result = await processTexture(id, source.trunkUrl, null, undefined, 0, tier);
      slotIndex += result.slotsUsed;
    }

    // Process branch texture (falls back to trunk)
    {
      const id = getTreeTextureId(tier, 'branch');
      const result = await processTexture(id, source.branchUrl, trunkImg ?? null, source.trunkUrl, 1, tier);
      slotIndex += result.slotsUsed;
    }

    // Process fruit texture (falls back to trunk)
    {
      const id = getTreeTextureId(tier, 'fruit');
      const result = await processTexture(id, source.fruitUrl, trunkImg ?? null, source.trunkUrl, 2, tier);
      slotIndex += result.slotsUsed;
    }
  }

  // Update registry's next slot index
  atlasRegistry.allocateSlots(atlasId, slotIndex);

  // Convert to WebP blob
  let blob: Blob | null = null;
  try {
    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.9);
    });
  } catch (e) {
    console.error('[AtlasGenerator] Failed to create WebP blob:', e);
  }

  return {
    atlasId,
    canvas,
    blob,
    entries,
    stats: {
      totalSlots: ATLAS_GRID_SIZE * ATLAS_GRID_SIZE,
      usedSlots: slotIndex,
      loadedTextures: loadedCount,
      placeholderTextures: placeholderCount,
    },
  };
}

/**
 * Generate atlas for all 30 tree tiers with placeholder fallbacks
 */
export async function generateFullTreeAtlas(
  atlasId: number,
  seedDefinitions?: Array<{
    tier: number;
    trunk_texture_url?: string | null;
    branch_texture_url?: string | null;
    fruit_texture_url?: string | null;
  }>
): Promise<AtlasGenerationResult> {
  // Build sources for all 30 tiers
  const sources: TreeTextureSource[] = [];

  for (let tier = 1; tier <= TREE_TIER_COUNT; tier++) {
    const def = seedDefinitions?.find((d) => d.tier === tier);
    sources.push({
      tier,
      trunkUrl: def?.trunk_texture_url || undefined,
      branchUrl: def?.branch_texture_url || undefined,
      fruitUrl: def?.fruit_texture_url || undefined,
    });
  }

  return generateTreeAtlas(atlasId, sources);
}

/**
 * Download atlas as WebP file (for debugging/preview)
 */
export function downloadAtlas(canvas: HTMLCanvasElement, filename: string = 'atlas_1.webp'): void {
  canvas.toBlob((blob) => {
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, 'image/webp', 0.9);
}

/**
 * Create a preview thumbnail of the atlas (512x512)
 */
export function createAtlasPreview(atlasCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const preview = document.createElement('canvas');
  preview.width = 512;
  preview.height = 512;
  const ctx = preview.getContext('2d')!;
  ctx.drawImage(atlasCanvas, 0, 0, ATLAS_PIXEL_SIZE, ATLAS_PIXEL_SIZE, 0, 0, 512, 512);
  return preview;
}
