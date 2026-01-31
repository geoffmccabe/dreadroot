/**
 * Texture Rotation Utility
 * Rotates textures 90 degrees clockwise, handling both static and animated strip textures.
 */

import { parseStripMetadata } from './animationToStrip';

export interface RotationResult {
  blob: Blob;
  fileName: string;
}

/**
 * Load an image from a URL
 */
async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

/**
 * Rotate a static image 90 degrees clockwise
 */
function rotateImageClockwise(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  destX: number,
  destY: number,
  size: number
): void {
  ctx.save();
  ctx.translate(destX + size / 2, destY + size / 2);
  ctx.rotate(Math.PI / 2); // 90 degrees clockwise
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/**
 * Rotate a texture 90 degrees clockwise
 * Handles both static images and animated strip textures
 *
 * @param imageUrl - URL of the texture to rotate
 * @param baseFileName - Base name for the output file (without extension)
 * @returns Rotated image blob and suggested filename
 */
export async function rotateTexture(
  imageUrl: string,
  baseFileName: string
): Promise<RotationResult> {
  const img = await loadImage(imageUrl);

  // Check if this is an animation strip
  const stripMeta = parseStripMetadata(imageUrl);

  if (stripMeta && stripMeta.frames > 1) {
    // Animated strip: rotate each frame
    return rotateAnimationStrip(img, stripMeta.frames, stripMeta.delay, baseFileName);
  } else {
    // Static image: simple rotation
    return rotateStaticImage(img, baseFileName);
  }
}

/**
 * Rotate a static image 90 degrees clockwise
 */
async function rotateStaticImage(
  img: HTMLImageElement,
  baseFileName: string
): Promise<RotationResult> {
  // For rotation, width and height swap
  const canvas = document.createElement('canvas');
  canvas.width = img.height;
  canvas.height = img.width;
  const ctx = canvas.getContext('2d')!;

  // Rotate around center
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('Failed to create blob')),
      'image/webp',
      0.9
    );
  });

  return {
    blob,
    fileName: `${baseFileName}_${Date.now()}.webp`,
  };
}

/**
 * Rotate an animation strip - each frame is rotated individually
 * Strip format: horizontal frames, each frame is (stripHeight x stripHeight) square
 */
async function rotateAnimationStrip(
  stripImg: HTMLImageElement,
  frameCount: number,
  frameDelay: number,
  baseFileName: string
): Promise<RotationResult> {
  const frameWidth = stripImg.width / frameCount;
  const frameHeight = stripImg.height;

  // Output strip: same dimensions (frames are square in atlas)
  const canvas = document.createElement('canvas');
  canvas.width = stripImg.width;
  canvas.height = stripImg.height;
  const ctx = canvas.getContext('2d')!;

  // Rotate each frame
  for (let i = 0; i < frameCount; i++) {
    const srcX = i * frameWidth;

    // Create temp canvas for this frame
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = frameHeight; // Swapped for rotation
    frameCanvas.height = frameWidth;
    const frameCtx = frameCanvas.getContext('2d')!;

    // Draw rotated frame
    frameCtx.translate(frameCanvas.width / 2, frameCanvas.height / 2);
    frameCtx.rotate(Math.PI / 2);
    frameCtx.drawImage(
      stripImg,
      srcX, 0, frameWidth, frameHeight,
      -frameWidth / 2, -frameHeight / 2, frameWidth, frameHeight
    );

    // Copy to output strip
    ctx.drawImage(frameCanvas, i * frameWidth, 0);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('Failed to create blob')),
      'image/webp',
      0.9
    );
  });

  // Preserve frame metadata in filename
  return {
    blob,
    fileName: `${baseFileName}_${frameCount}f_${frameDelay}ms_${Date.now()}.webp`,
  };
}
