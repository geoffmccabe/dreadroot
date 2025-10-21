import { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { blocksCacheDB } from './useBlocksCache';

interface GIFFrame {
  dims: { width: number; height: number; top: number; left: number };
  patch: Uint8ClampedArray;
  delay: number;
  disposalType: number;
}

export const useCachedTexture = (url: string) => {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const backupCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const framesRef = useRef<GIFFrame[]>([]);
  const currentFrameRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const isGifRef = useRef(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    const isGif = url.toLowerCase().endsWith('.gif');
    isGifRef.current = isGif;

    const loadTexture = async () => {
      try {
        // 1. Try to load from IndexedDB cache first
        const cachedBlob = await blocksCacheDB.getCachedTexture(url);
        
        if (cachedBlob) {
          console.log('⚡ Using cached texture:', url);
          const blobUrl = URL.createObjectURL(cachedBlob);
          
          if (isGif) {
            await loadAnimatedGifFromBlob(cachedBlob);
          } else {
            await loadStaticTextureFromUrl(blobUrl);
            URL.revokeObjectURL(blobUrl);
          }
          return;
        }

        // 2. Not in cache, fetch from network
        console.log('🌐 Downloading texture:', url);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
        
        const blob = await response.blob();
        
        // 3. Cache it for next time (don't await - do in background)
        blocksCacheDB.setCachedTexture(url, blob).catch(err => {
          console.warn('Failed to cache texture:', err);
        });
        
        // 4. Load the texture
        if (isGif) {
          await loadAnimatedGifFromBlob(blob);
        } else {
          const blobUrl = URL.createObjectURL(blob);
          await loadStaticTextureFromUrl(blobUrl);
          URL.revokeObjectURL(blobUrl);
        }
        
      } catch (error) {
        console.error('Failed to load texture:', url, error);
        // Fallback to direct loading
        if (isGif) {
          loadAnimatedGifFromUrl(url);
        } else {
          loadStaticTextureFromUrl(url);
        }
      } finally {
        loadingRef.current = false;
      }
    };

    loadTexture();

    return () => {
      if (texture) {
        texture.dispose();
      }
      if (canvasRef.current) {
        canvasRef.current = null;
      }
    };
  }, [url]);

  const loadStaticTextureFromUrl = async (url: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (loadedTexture) => {
          setTexture(loadedTexture);
          resolve();
        },
        undefined,
        (error) => {
          console.error('Failed to load static texture:', error);
          reject(error);
        }
      );
    });
  };

  const loadAnimatedGifFromBlob = async (blob: Blob): Promise<void> => {
    try {
      const buffer = await blob.arrayBuffer();
      const gif = parseGIF(buffer);
      const frames = decompressFrames(gif, true);
      
      if (frames.length === 0) {
        throw new Error('No frames in GIF');
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
      canvasTexture.needsUpdate = true;
      
      setTexture(canvasTexture);
    } catch (error) {
      console.error('Failed to load animated GIF from blob:', error);
      throw error;
    }
  };

  const loadAnimatedGifFromUrl = async (url: string): Promise<void> => {
    try {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const blob = new Blob([buffer]);
      await loadAnimatedGifFromBlob(blob);
    } catch (error) {
      console.error('Failed to load animated GIF from URL:', error);
    }
  };

  const renderFrame = (frameIndex: number) => {
    if (!canvasRef.current || framesRef.current.length === 0) return;

    const frame = framesRef.current[frameIndex];
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const left = frame.dims.left || 0;
    const top = frame.dims.top || 0;

    // Handle disposal of previous frame
    if (frameIndex > 0) {
      const prevFrame = framesRef.current[frameIndex - 1];
      const prevLeft = prevFrame.dims.left || 0;
      const prevTop = prevFrame.dims.top || 0;
      
      if (prevFrame.disposalType === 2) {
        ctx.clearRect(prevLeft, prevTop, prevFrame.dims.width, prevFrame.dims.height);
      } else if (prevFrame.disposalType === 3 && backupCanvasRef.current) {
        const backupCtx = backupCanvasRef.current.getContext('2d');
        if (backupCtx) {
          ctx.drawImage(backupCanvasRef.current, 0, 0);
        }
      }
    } else {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }

    // Backup current state if needed
    if (frame.disposalType === 3 && backupCanvasRef.current) {
      const backupCtx = backupCanvasRef.current.getContext('2d');
      if (backupCtx) {
        backupCtx.clearRect(0, 0, backupCanvasRef.current.width, backupCanvasRef.current.height);
        backupCtx.drawImage(canvasRef.current, 0, 0);
      }
    }

    // Render current frame
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = frame.dims.width;
    tempCanvas.height = frame.dims.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    if (tempCtx) {
      const imageData = tempCtx.createImageData(frame.dims.width, frame.dims.height);
      imageData.data.set(frame.patch);
      tempCtx.putImageData(imageData, 0, 0);
      ctx.drawImage(tempCanvas, left, top);
    }
  };

  // Animation update function
  const updateTexture = (deltaTime: number) => {
    if (!isGifRef.current || !texture || framesRef.current.length <= 1) return;

    const currentTime = performance.now();
    const currentFrame = framesRef.current[currentFrameRef.current];
    const frameDelay = currentFrame.delay || 100;

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
