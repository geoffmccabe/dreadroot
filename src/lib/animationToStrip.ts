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
  } else {
    return convertVideoToStrip(file, options);
  }
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
