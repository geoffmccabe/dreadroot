import { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { blockDB } from './useIndexedDB';

interface GIFFrame {
  dims: { width: number; height: number; top: number; left: number };
  patch: Uint8ClampedArray;
  delay: number;
  disposalType: number;
}

// Track ongoing background refreshes to prevent duplicates
const refreshTimers = new Map<string, number>();

export const useAnimatedTexture = (url: string) => {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null); // Track current texture for cleanup
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const backupCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tempCanvasRef = useRef<HTMLCanvasElement | null>(null); // REUSABLE temp canvas - no allocation per frame!
  const tempCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const imageDataRef = useRef<ImageData | null>(null); // REUSABLE ImageData - no allocation per frame!
  const framesRef = useRef<GIFFrame[]>([]);
  const currentFrameRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const isGifRef = useRef(false);
  const isMountedRef = useRef(true);
  const backgroundRefreshTimerRef = useRef<number | null>(null);
  const animationTimerRef = useRef<number | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    const isGif = url.toLowerCase().endsWith('.gif');
    isGifRef.current = isGif;

    loadTextureWithCache(url, isGif);

    return () => {
      isMountedRef.current = false;
      
      // Clear background refresh timer and remove from module-level map
      // FIX: Properly clean up refreshTimers map entry to prevent memory leak
      if (backgroundRefreshTimerRef.current) {
        const timerId = backgroundRefreshTimerRef.current;
        clearTimeout(timerId);
        backgroundRefreshTimerRef.current = null;
        
        // Only delete if we own the map entry (prevents removing another component's timer)
        if (refreshTimers.get(url) === timerId) {
          refreshTimers.delete(url);
        }
      }
      
      // Clear animation timer
      if (animationTimerRef.current) {
        clearTimeout(animationTimerRef.current);
        animationTimerRef.current = null;
      }
      
      // Dispose texture using ref to get current value
      if (textureRef.current) {
        textureRef.current.dispose();
        textureRef.current = null;
      }
      
      // Clean up canvases
      if (canvasRef.current) {
        canvasRef.current = null;
      }
      if (backupCanvasRef.current) {
        backupCanvasRef.current = null;
      }
      if (tempCanvasRef.current) {
        tempCanvasRef.current = null;
        tempCtxRef.current = null;
      }
      imageDataRef.current = null;
    };
  }, [url]);

  const loadTextureWithCache = async (url: string, isGif: boolean) => {
    // Removed console.log spam for texture loading
    try {
      // 1. Check IndexedDB cache first
      const cachedBlob = await blockDB.getTextureBlob(url);
      
      if (cachedBlob) {
        // Load from cache immediately
        if (isGif) {
          await loadAnimatedGifFromBlob(cachedBlob);
        } else {
          loadStaticTextureFromBlob(cachedBlob);
        }
        
        // 2. Schedule background refresh only if not already scheduled
        // This prevents duplicate refreshes when multiple blocks use same texture
        if (!refreshTimers.has(url)) {
          backgroundRefreshTimerRef.current = window.setTimeout(() => {
            if (isMountedRef.current) {
              refreshTextureInBackground(url, isGif, cachedBlob.size);
            }
            refreshTimers.delete(url);
          }, 1000);
          refreshTimers.set(url, backgroundRefreshTimerRef.current);
        }
      } else {
        // Load from network
        await loadFromNetwork(url, isGif);
      }
    } catch (error) {
      console.error('Error loading texture with cache:', error);
      if (isMountedRef.current) {
        loadFromNetwork(url, isGif);
      }
    }
  };

  const refreshTextureInBackground = async (url: string, isGif: boolean, cachedSize: number) => {
    if (!isMountedRef.current) return;
    
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      
      if (!isMountedRef.current) return;
      
      // Simple check: if size is different, it's been updated
      if (blob.size !== cachedSize) {
        // Hot-swap texture silently
        
        // Dispose old texture before creating new one
        if (textureRef.current) {
          textureRef.current.dispose();
          textureRef.current = null;
        }
        
        // Load the new texture
        if (isGif) {
          await loadAnimatedGifFromBlob(blob);
        } else {
          loadStaticTextureFromBlob(blob);
        }
        
        // Update cache
        await blockDB.saveTextureBlob(url, blob);
      }
    } catch (error) {
      console.error('Background refresh failed:', error);
    }
  };

  const loadFromNetwork = async (url: string, isGif: boolean) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      
      if (isGif) {
        await loadAnimatedGifFromBlob(blob);
      } else {
        loadStaticTextureFromBlob(blob);
      }
      
      // Save to cache
      await blockDB.saveTextureBlob(url, blob);
    } catch (error) {
      console.error('Failed to load from network:', error);
    }
  };

  const loadStaticTextureFromBlob = (blob: Blob) => {
    const blobUrl = URL.createObjectURL(blob);
    const loader = new THREE.TextureLoader();
    loader.load(
      blobUrl, 
      (loadedTexture) => {
        if (isMountedRef.current) {
          textureRef.current = loadedTexture;
          setTexture(loadedTexture);
        } else {
          loadedTexture.dispose();
        }
        URL.revokeObjectURL(blobUrl);
      },
      undefined,
      (error) => {
        console.error('❌ Failed to load texture:', error);
        URL.revokeObjectURL(blobUrl);
      }
    );
  };

  const loadAnimatedGifFromBlob = async (blob: Blob) => {
    try {
      const buffer = await blob.arrayBuffer();
      
      if (!isMountedRef.current) return;
      
      // Parse GIF
      const gif = parseGIF(buffer);
      const frames = decompressFrames(gif, true);
      
      if (frames.length === 0) {
        console.warn('No frames found in GIF');
        return;
      }

      framesRef.current = frames as GIFFrame[];
      
      // Create canvas for rendering frames
      const canvas = document.createElement('canvas');
      canvas.width = frames[0].dims.width;
      canvas.height = frames[0].dims.height;
      canvasRef.current = canvas;

      // Create backup canvas for disposal type 3
      const backupCanvas = document.createElement('canvas');
      backupCanvas.width = frames[0].dims.width;
      backupCanvas.height = frames[0].dims.height;
      backupCanvasRef.current = backupCanvas;

      // Create REUSABLE temp canvas for frame rendering (avoid allocation per frame!)
      const tempCanvas = document.createElement('canvas');
      // Size to GIF full dimensions (frames may have smaller patches)
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      tempCanvasRef.current = tempCanvas;
      tempCtxRef.current = tempCanvas.getContext('2d');
      
      // ImageData will be created on-demand in renderFrame when we know the actual frame size
      imageDataRef.current = null;

      // Initialize with transparent background
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      // Render first frame BEFORE creating texture
      renderFrame(0);

      // Create texture from canvas AFTER first frame is rendered
      const canvasTexture = new THREE.CanvasTexture(canvas);
      canvasTexture.minFilter = THREE.LinearFilter;
      canvasTexture.magFilter = THREE.LinearFilter;
      canvasTexture.needsUpdate = true; // Mark for initial upload
      
      if (isMountedRef.current) {
        textureRef.current = canvasTexture;
        setTexture(canvasTexture);
        
        // Start animation loop for GIFs
        scheduleNextFrame();
      } else {
        canvasTexture.dispose();
      }
    } catch (error) {
      console.error('Failed to load animated GIF:', error);
    }
  };

  const renderFrame = (frameIndex: number) => {
    if (!canvasRef.current || framesRef.current.length === 0) return;

    const frame = framesRef.current[frameIndex];
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Default position to 0,0 if not specified
    const left = frame.dims.left || 0;
    const top = frame.dims.top || 0;

    // Handle disposal of previous frame FIRST (before drawing new frame)
    if (frameIndex > 0) {
      const prevFrame = framesRef.current[frameIndex - 1];
      const prevLeft = prevFrame.dims.left || 0;
      const prevTop = prevFrame.dims.top || 0;
      
      // Disposal Type:
      // 0 or 1: No disposal (leave as is, stack frames)
      // 2: Restore to background color (clear the frame area)
      // 3: Restore to previous (restore the area to what it was before the last frame)
      
      if (prevFrame.disposalType === 2) {
        // Clear the previous frame's area
        ctx.clearRect(
          prevLeft,
          prevTop,
          prevFrame.dims.width,
          prevFrame.dims.height
        );
      } else if (prevFrame.disposalType === 3 && backupCanvasRef.current) {
        // Restore from backup
        const backupCtx = backupCanvasRef.current.getContext('2d');
        if (backupCtx) {
          ctx.drawImage(backupCanvasRef.current, 0, 0);
        }
      }
      // Disposal type 0 or 1: Do nothing, keep previous frame
    } else {
      // First frame - clear canvas
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }

    // Backup current state if this frame will need restoration later
    if (frame.disposalType === 3 && backupCanvasRef.current) {
      const backupCtx = backupCanvasRef.current.getContext('2d');
      if (backupCtx) {
        backupCtx.clearRect(0, 0, backupCanvasRef.current.width, backupCanvasRef.current.height);
        backupCtx.drawImage(canvasRef.current, 0, 0);
      }
    }

    // REUSE temp canvas and ImageData instead of creating new ones per frame!
    const tempCanvas = tempCanvasRef.current;
    const tempCtx = tempCtxRef.current;
    
    if (tempCtx && tempCanvas) {
      // Resize temp canvas only if frame dims are larger
      if (frame.dims.width > tempCanvas.width || frame.dims.height > tempCanvas.height) {
        tempCanvas.width = Math.max(tempCanvas.width, frame.dims.width);
        tempCanvas.height = Math.max(tempCanvas.height, frame.dims.height);
      }
      
      // Clear just the area we need
      tempCtx.clearRect(0, 0, frame.dims.width, frame.dims.height);
      
      // Create or reuse ImageData - ensure it matches the exact frame dimensions
      let imageData = imageDataRef.current;
      if (!imageData || imageData.width !== frame.dims.width || imageData.height !== frame.dims.height) {
        imageData = tempCtx.createImageData(frame.dims.width, frame.dims.height);
        imageDataRef.current = imageData;
      }
      
      // Copy patch data directly - sizes now match exactly
      imageData.data.set(frame.patch);
      tempCtx.putImageData(imageData, 0, 0);
      
      // Draw temp canvas onto main canvas (respects alpha/transparency)
      ctx.drawImage(tempCanvas, 0, 0, frame.dims.width, frame.dims.height, left, top, frame.dims.width, frame.dims.height);
    }
  };

  // Self-scheduling animation loop - each GIF animates on its own timer
  const scheduleNextFrame = () => {
    if (!isMountedRef.current || !isGifRef.current || framesRef.current.length <= 1) return;
    
    const currentFrame = framesRef.current[currentFrameRef.current];
    const frameDelay = currentFrame.delay || 100;
    
    animationTimerRef.current = window.setTimeout(() => {
      if (!isMountedRef.current || !textureRef.current) return;
      
      // Advance to next frame
      currentFrameRef.current = (currentFrameRef.current + 1) % framesRef.current.length;
      renderFrame(currentFrameRef.current);
      
      if (textureRef.current instanceof THREE.CanvasTexture) {
        textureRef.current.needsUpdate = true;
      }
      
      // Schedule next frame
      scheduleNextFrame();
    }, frameDelay);
  };

  return { texture, isAnimated: isGifRef.current };
};
