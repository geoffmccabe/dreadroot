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

export const useAnimatedTexture = (url: string) => {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const backupCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const framesRef = useRef<GIFFrame[]>([]);
  const currentFrameRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const isGifRef = useRef(false);

  useEffect(() => {
    console.log('🎨 Loading texture:', url);
    const isGif = url.toLowerCase().endsWith('.gif');
    isGifRef.current = isGif;
    console.log('🎬 Is GIF?', isGif);

    loadTextureWithCache(url, isGif);

    return () => {
      if (texture) {
        texture.dispose();
      }
      if (canvasRef.current) {
        canvasRef.current = null;
      }
    };
  }, [url]);

  const loadTextureWithCache = async (url: string, isGif: boolean) => {
    try {
      // 1. Check IndexedDB cache first
      const cachedBlob = await blockDB.getTextureBlob(url);
      
      if (cachedBlob) {
        console.log('✅ Found texture in cache, loading instantly');
        // Load from cache immediately
        if (isGif) {
          await loadAnimatedGifFromBlob(cachedBlob);
        } else {
          loadStaticTextureFromBlob(cachedBlob);
        }
        
        // 2. Quietly re-download in background to check for updates
        setTimeout(() => {
          refreshTextureInBackground(url, isGif, cachedBlob.size);
        }, 1000);
      } else {
        console.log('❌ Not in cache, loading from network');
        // Load from network
        await loadFromNetwork(url, isGif);
      }
    } catch (error) {
      console.error('Error loading texture with cache:', error);
      // Fallback to direct network load
      loadFromNetwork(url, isGif);
    }
  };

  const refreshTextureInBackground = async (url: string, isGif: boolean, cachedSize: number) => {
    try {
      console.log('🔄 Background refresh check for:', url);
      const response = await fetch(url);
      const blob = await response.blob();
      
      // Simple check: if size is different, it's been updated
      if (blob.size !== cachedSize) {
        console.log('🆕 Texture updated, hot-swapping');
        
        // Load the new texture
        if (isGif) {
          await loadAnimatedGifFromBlob(blob);
        } else {
          loadStaticTextureFromBlob(blob);
        }
        
        // Update cache
        await blockDB.saveTextureBlob(url, blob);
      } else {
        console.log('✅ Texture is current');
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
      console.log('💾 Saved texture to cache');
    } catch (error) {
      console.error('Failed to load from network:', error);
    }
  };

  const loadStaticTextureFromBlob = (blob: Blob) => {
    console.log('📷 Loading static texture from blob');
    const blobUrl = URL.createObjectURL(blob);
    const loader = new THREE.TextureLoader();
    loader.load(blobUrl, (loadedTexture) => {
      console.log('✅ Static texture loaded');
      setTexture(loadedTexture);
      URL.revokeObjectURL(blobUrl);
    });
  };

  const loadAnimatedGifFromBlob = async (blob: Blob) => {
    try {
      console.log('🎬 Starting GIF load from blob');
      const buffer = await blob.arrayBuffer();
      console.log('📦 GIF buffer size:', buffer.byteLength);
      
      // Parse GIF
      const gif = parseGIF(buffer);
      const frames = decompressFrames(gif, true);
      
      if (frames.length === 0) {
        console.warn('No frames found in GIF');
        return;
      }

      framesRef.current = frames as GIFFrame[];
      
      // Debug: Log frame info
      console.log('GIF Frames loaded:', frames.length);
      console.log('First frame disposal type:', frames[0].disposalType);
      console.log('Frame disposal types:', frames.map((f: any) => f.disposalType));
      console.log('Sample frame dims:', frames[0].dims);
      
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

      // Initialize with transparent background
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      // Create texture from canvas
      const canvasTexture = new THREE.CanvasTexture(canvas);
      canvasTexture.minFilter = THREE.LinearFilter;
      canvasTexture.magFilter = THREE.LinearFilter;
      
      // Render first frame
      renderFrame(0);
      
      setTexture(canvasTexture);
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

    // Create temporary canvas for this frame
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = frame.dims.width;
    tempCanvas.height = frame.dims.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    if (tempCtx) {
      // Put frame data on temp canvas
      const imageData = tempCtx.createImageData(frame.dims.width, frame.dims.height);
      imageData.data.set(frame.patch);
      tempCtx.putImageData(imageData, 0, 0);
      
      // Draw temp canvas onto main canvas (respects alpha/transparency)
      ctx.drawImage(tempCanvas, left, top);
    }
  };

  // Animation update function to be called in useFrame
  const updateTexture = (deltaTime: number) => {
    if (!isGifRef.current || !texture || framesRef.current.length <= 1) return;

    const currentTime = performance.now();
    const currentFrame = framesRef.current[currentFrameRef.current];
    const frameDelay = currentFrame.delay || 100; // Default 100ms if no delay

    if (currentTime - lastFrameTimeRef.current >= frameDelay) {
      currentFrameRef.current = (currentFrameRef.current + 1) % framesRef.current.length;
      renderFrame(currentFrameRef.current);
      
      if (texture instanceof THREE.CanvasTexture) {
        texture.needsUpdate = true;
      }
      
      lastFrameTimeRef.current = currentTime;
    }
  };

  return { texture, updateTexture, isAnimated: isGifRef.current };
};
