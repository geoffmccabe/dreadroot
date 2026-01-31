/**
 * Universal Animation-to-Strip Converter
 * Converts GIF, MP4, WebM to horizontal strip textures for efficient GPU animation.
 * 
 * Frame size: 256x256 pixels
 * Max frames: 24
 * Output: WebP format
 * Filename convention: {prefix}_{frameCount}f_{delayMs}ms_{timestamp}.webp
 */

import { decompressFrames, parseGIF } from 'gifuct-js';

export interface StripResult {
  stripBlob: Blob;
  frameCount: number;
  frameDelay: number;
  originalFrameCount: number;
}

export interface ConversionOptions {
  frameSize?: number;   // Default: 256
  maxFrames?: number;   // Default: 24
  quality?: number;     // WebP quality 0-1, default: 0.9
}

const DEFAULT_FRAME_SIZE = 256;
const DEFAULT_MAX_FRAMES = 24;
const DEFAULT_QUALITY = 0.9;

/**
 * Check if a file is an animated format (GIF, video)
 * Note: For WebP files, use isAnimatedWebP() for async detection
 */
export function isAnimatedFile(file: File): boolean {
  const ext = file.name.toLowerCase().split('.').pop() || '';
  const animatedExts = ['gif', 'mp4', 'webm', 'mov', 'avi', 'm4v'];

  if (animatedExts.includes(ext)) return true;

  // Also check MIME type
  const animatedMimes = ['image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
  return animatedMimes.includes(file.type);
}

/**
 * Check if a WebP file is animated by reading its header
 * WebP animation is indicated by ANIM chunk in the file
 */
export async function isAnimatedWebP(file: File): Promise<boolean> {
  const ext = file.name.toLowerCase().split('.').pop() || '';
  if (ext !== 'webp' && file.type !== 'image/webp') return false;

  // Read the first 100 bytes to check for animation markers
  const buffer = await file.slice(0, 100).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Check for RIFF header
  if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) {
    return false;
  }

  // Check for WEBP
  if (bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50) {
    return false;
  }

  // Look for VP8X chunk with animation flag or ANIM chunk
  // VP8X chunk starts at byte 12, flag byte is at offset 20
  // Animation flag is bit 1 (0x02) of the flags byte
  if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58) {
    // VP8X chunk found, check animation flag at byte 20
    const flags = bytes[20];
    if (flags & 0x02) return true;
  }

  // Also search for ANIM chunk marker in the file
  const text = String.fromCharCode(...bytes);
  if (text.includes('ANIM')) return true;

  return false;
}

/**
 * Check if file needs animation processing (async version that handles WebP)
 */
export async function needsAnimationProcessing(file: File): Promise<boolean> {
  if (isAnimatedFile(file)) return true;
  return await isAnimatedWebP(file);
}

/**
 * Parse strip metadata from filename URL
 * Expects format: ..._24f_100ms_... 
 * Returns { frames, delay } or null if not a strip
 */
export function parseStripMetadata(url: string | null): { frames: number; delay: number } | null {
  if (!url) return null;
  
  // Match pattern like _24f_100ms_
  const match = url.match(/_(\d+)f_(\d+)ms_/);
  if (!match) return null;
  
  const frames = parseInt(match[1], 10);
  const delay = parseInt(match[2], 10);
  
  if (frames < 1 || frames > 24 || delay < 1) return null;
  
  return { frames, delay };
}

/**
 * Sample frame indices for animations with more frames than maxFrames.
 * Always includes first and last frame, with evenly distributed frames in between.
 */
function sampleFrameIndices(total: number, max: number = DEFAULT_MAX_FRAMES): number[] {
  if (total <= max) {
    return Array.from({ length: total }, (_, i) => i);
  }
  
  // Always include first and last
  const indices = [0, total - 1];
  
  // Pick (max - 2) evenly distributed frames in between
  const step = (total - 1) / (max - 1);
  for (let i = 1; i < max - 1; i++) {
    indices.push(Math.round(step * i));
  }
  
  return [...new Set(indices)].sort((a, b) => a - b);
}

/**
 * Main entry point - converts any animated file to a horizontal strip
 */
export async function convertAnimationToStrip(
  file: File,
  options: ConversionOptions = {}
): Promise<StripResult> {
  const ext = file.name.toLowerCase().split('.').pop() || '';

  if (ext === 'gif' || file.type === 'image/gif') {
    return convertGifToStrip(file, options);
  } else if (ext === 'webp' || file.type === 'image/webp') {
    // Animated WebP - use frame capture approach
    return convertAnimatedWebPToStrip(file, options);
  } else {
    return convertVideoToStrip(file, options);
  }
}

/**
 * Convert an animated WebP to horizontal strip by capturing frames
 * Uses requestAnimationFrame to capture frames as the browser renders them
 */
async function convertAnimatedWebPToStrip(
  file: File,
  options: ConversionOptions = {}
): Promise<StripResult> {
  const frameSize = options.frameSize ?? DEFAULT_FRAME_SIZE;
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const quality = options.quality ?? DEFAULT_QUALITY;

  const objectUrl = URL.createObjectURL(file);

  try {
    // Load the animated WebP
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load animated WebP'));
      image.src = objectUrl;
    });

    // Create a canvas to capture frames
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = img.width;
    captureCanvas.height = img.height;
    const captureCtx = captureCanvas.getContext('2d')!;

    // Capture frames over time
    // Animated WebP typically runs at ~10-30 fps, capture for up to 3 seconds
    const frames: ImageData[] = [];
    const frameHashes: Set<string> = new Set();
    const startTime = performance.now();
    const maxCaptureTime = 3000; // 3 seconds max
    const captureInterval = 50; // Capture every 50ms

    await new Promise<void>((resolve) => {
      const captureFrame = () => {
        const elapsed = performance.now() - startTime;

        // Draw current frame
        captureCtx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
        captureCtx.drawImage(img, 0, 0);

        // Get image data and create a simple hash to detect unique frames
        const imageData = captureCtx.getImageData(0, 0, captureCanvas.width, captureCanvas.height);
        const hash = hashImageData(imageData);

        // Only add if this is a new unique frame
        if (!frameHashes.has(hash) && frames.length < maxFrames) {
          frameHashes.add(hash);
          frames.push(imageData);
        }

        // Continue capturing or finish
        if (elapsed < maxCaptureTime && frames.length < maxFrames) {
          setTimeout(captureFrame, captureInterval);
        } else {
          resolve();
        }
      };

      captureFrame();
    });

    URL.revokeObjectURL(objectUrl);

    if (frames.length === 0) {
      throw new Error('Could not extract frames from animated WebP');
    }

    // If only 1 frame captured, it might not be animated - return as single frame
    const frameCount = frames.length;
    const estimatedDelay = Math.round(maxCaptureTime / Math.max(frameCount, 1) / 10) * 10; // Round to 10ms

    // Create output strip canvas
    const stripCanvas = document.createElement('canvas');
    stripCanvas.width = frameSize * frameCount;
    stripCanvas.height = frameSize;
    const stripCtx = stripCanvas.getContext('2d')!;

    // Draw each frame to the strip with crop-to-fill
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    const tempCtx = tempCanvas.getContext('2d')!;

    for (let i = 0; i < frameCount; i++) {
      tempCtx.putImageData(frames[i], 0, 0);

      // Center crop and scale to frameSize
      const srcSize = Math.min(tempCanvas.width, tempCanvas.height);
      const srcX = (tempCanvas.width - srcSize) / 2;
      const srcY = (tempCanvas.height - srcSize) / 2;

      stripCtx.drawImage(
        tempCanvas,
        srcX, srcY, srcSize, srcSize,
        i * frameSize, 0, frameSize, frameSize
      );
    }

    // Convert to WebP blob
    const stripBlob = await new Promise<Blob>((resolve, reject) => {
      stripCanvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create strip blob'));
        },
        'image/webp',
        quality
      );
    });

    return {
      stripBlob,
      frameCount,
      frameDelay: estimatedDelay || 100,
      originalFrameCount: frameCount,
    };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

/**
 * Create a simple hash of image data for detecting unique frames
 */
function hashImageData(imageData: ImageData): string {
  // Sample pixels at regular intervals to create a fast hash
  const data = imageData.data;
  const step = Math.max(1, Math.floor(data.length / 100));
  let hash = 0;
  for (let i = 0; i < data.length; i += step) {
    hash = ((hash << 5) - hash + data[i]) | 0;
  }
  return hash.toString(16);
}

/**
 * Convert a GIF to horizontal strip using gifuct-js
 */
async function convertGifToStrip(
  file: File,
  options: ConversionOptions = {}
): Promise<StripResult> {
  const frameSize = options.frameSize ?? DEFAULT_FRAME_SIZE;
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const quality = options.quality ?? DEFAULT_QUALITY;
  
  const arrayBuffer = await file.arrayBuffer();
  const gif = parseGIF(arrayBuffer);
  const rawFrames = decompressFrames(gif, true);
  
  if (rawFrames.length === 0) {
    throw new Error('GIF has no frames');
  }
  
  const originalFrameCount = rawFrames.length;
  const selectedIndices = sampleFrameIndices(originalFrameCount, maxFrames);
  const frameCount = selectedIndices.length;
  
  // Calculate average delay from selected frames
  let totalDelay = 0;
  for (const idx of selectedIndices) {
    totalDelay += (rawFrames[idx].delay || 100);
  }
  const frameDelay = Math.round(totalDelay / frameCount);
  
  // Create canvases for rendering
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = gif.lsd.width;
  fullCanvas.height = gif.lsd.height;
  const fullCtx = fullCanvas.getContext('2d')!;
  
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = gif.lsd.width;
  tempCanvas.height = gif.lsd.height;
  const tempCtx = tempCanvas.getContext('2d')!;
  
  // Output strip canvas
  const stripCanvas = document.createElement('canvas');
  stripCanvas.width = frameSize * frameCount;
  stripCanvas.height = frameSize;
  const stripCtx = stripCanvas.getContext('2d')!;
  
  // Process each frame with proper disposal
  let lastImageData: ImageData | null = null;
  
  for (let frameIdx = 0; frameIdx <= selectedIndices[selectedIndices.length - 1]; frameIdx++) {
    const frame = rawFrames[frameIdx];
    const { dims, patch, disposalType } = frame;
    
    // Save state before drawing if needed for disposal
    if (disposalType === 3 && !lastImageData) {
      lastImageData = fullCtx.getImageData(0, 0, fullCanvas.width, fullCanvas.height);
    }
    
    // Draw frame patch to temp canvas
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    const patchData = tempCtx.createImageData(dims.width, dims.height);
    patchData.data.set(patch);
    tempCtx.putImageData(patchData, 0, 0);
    
    // Draw temp to full canvas at frame position
    fullCtx.drawImage(tempCanvas, 0, 0, dims.width, dims.height, dims.left, dims.top, dims.width, dims.height);
    
    // If this is a selected frame, copy to strip
    const stripIdx = selectedIndices.indexOf(frameIdx);
    if (stripIdx !== -1) {
      // Center crop and scale to frameSize
      const srcSize = Math.min(fullCanvas.width, fullCanvas.height);
      const srcX = (fullCanvas.width - srcSize) / 2;
      const srcY = (fullCanvas.height - srcSize) / 2;
      
      stripCtx.drawImage(
        fullCanvas,
        srcX, srcY, srcSize, srcSize,
        stripIdx * frameSize, 0, frameSize, frameSize
      );
    }
    
    // Handle disposal for next frame
    if (disposalType === 2) {
      // Clear the frame area
      fullCtx.clearRect(dims.left, dims.top, dims.width, dims.height);
    } else if (disposalType === 3 && lastImageData) {
      // Restore previous state
      fullCtx.putImageData(lastImageData, 0, 0);
    }
    
    // Save state for potential restore
    if (disposalType === 3) {
      lastImageData = fullCtx.getImageData(0, 0, fullCanvas.width, fullCanvas.height);
    }
  }
  
  // Convert to WebP blob
  const stripBlob = await new Promise<Blob>((resolve, reject) => {
    stripCanvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create strip blob'));
      },
      'image/webp',
      quality
    );
  });
  
  return { stripBlob, frameCount, frameDelay, originalFrameCount };
}

/**
 * Convert a video to horizontal strip by sampling frames
 */
async function convertVideoToStrip(
  file: File,
  options: ConversionOptions = {}
): Promise<StripResult> {
  const frameSize = options.frameSize ?? DEFAULT_FRAME_SIZE;
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const quality = options.quality ?? DEFAULT_QUALITY;
  
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    
    const objectUrl = URL.createObjectURL(file);
    
    video.onloadedmetadata = async () => {
      try {
        const duration = video.duration;
        if (!duration || !isFinite(duration)) {
          throw new Error('Could not determine video duration');
        }
        
        // Estimate frame count at 30fps
        const estimatedFrames = Math.ceil(duration * 30);
        const selectedIndices = sampleFrameIndices(estimatedFrames, maxFrames);
        const frameCount = selectedIndices.length;
        
        // Calculate timestamps for each frame
        const timestamps = selectedIndices.map(idx => (idx / estimatedFrames) * duration);
        
        // Frame delay based on duration spread across frames
        const frameDelay = Math.round((duration * 1000) / estimatedFrames);
        
        // Create strip canvas
        const stripCanvas = document.createElement('canvas');
        stripCanvas.width = frameSize * frameCount;
        stripCanvas.height = frameSize;
        const stripCtx = stripCanvas.getContext('2d')!;
        
        // Capture each frame
        for (let i = 0; i < timestamps.length; i++) {
          const timestamp = timestamps[i];
          await seekToTime(video, timestamp);
          
          // Center crop and scale
          const srcSize = Math.min(video.videoWidth, video.videoHeight);
          const srcX = (video.videoWidth - srcSize) / 2;
          const srcY = (video.videoHeight - srcSize) / 2;
          
          stripCtx.drawImage(
            video,
            srcX, srcY, srcSize, srcSize,
            i * frameSize, 0, frameSize, frameSize
          );
        }
        
        URL.revokeObjectURL(objectUrl);
        
        // Convert to WebP blob
        stripCanvas.toBlob(
          (blob) => {
            if (blob) {
              resolve({
                stripBlob: blob,
                frameCount,
                frameDelay,
                originalFrameCount: estimatedFrames,
              });
            } else {
              reject(new Error('Failed to create strip blob'));
            }
          },
          'image/webp',
          quality
        );
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load video'));
    };
    
    video.src = objectUrl;
  });
}

/**
 * Seek video to a specific time and wait for frame to be ready
 */
function seekToTime(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      // Small delay to ensure frame is rendered
      setTimeout(resolve, 50);
    };
    
    const onError = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      reject(new Error('Failed to seek'));
    };
    
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = time;
  });
}
