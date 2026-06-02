import { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { blockDB } from './useIndexedDB';

// v4.12.9: GIF storage rewritten to drop the decoded-frame array
// after a one-time composition into a horizontal strip canvas.
// Previously framesRef held every frame's raw RGBA bytes in JS heap
// forever (~1 MB/frame); heap snapshots showed 1.1 GB of GIFFrame
// objects ({pixels, dims, colorTable, delay, disposalType, patch}).
// The strip canvas pixels live in browser graphics memory, not JS
// heap, so the JS retention goes to roughly zero per animated GIF.
//
// Trade-off: strip composition runs once at load (cost = same as
// rendering all frames anyway, just done eagerly). Animation cost
// per tick is one drawImage from strip → texture canvas.

// Track ongoing background refreshes to prevent duplicates
const refreshTimers = new Map<string, number>();

export const useAnimatedTexture = (url: string) => {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null); // Track current texture for cleanup
  const canvasRef = useRef<HTMLCanvasElement | null>(null); // Texture-backing canvas
  const stripCanvasRef = useRef<HTMLCanvasElement | null>(null); // All frames composed horizontally
  const frameDelaysRef = useRef<number[]>([]); // Per-frame timing in ms (numbers only — no pixel data)
  const frameWidthRef = useRef(0);
  const frameHeightRef = useRef(0);
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

      // Drop canvases. The browser will release the underlying graphics
      // memory once nothing references them. frameDelaysRef is a tiny
      // number array — no special handling needed.
      canvasRef.current = null;
      stripCanvasRef.current = null;
      frameDelaysRef.current = [];
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

      // Parse + decompress. The `frames` array is held LOCALLY only —
      // not stored on a ref — so it becomes garbage as soon as this
      // function returns. Only the strip canvas survives.
      const gif = parseGIF(buffer);
      const frames = decompressFrames(gif, true);

      if (frames.length === 0) {
        console.warn('No frames found in GIF');
        return;
      }

      const W = frames[0].dims.width;
      const H = frames[0].dims.height;
      const N = frames.length;
      frameWidthRef.current = W;
      frameHeightRef.current = H;

      // Composition canvas: builds each frame's full visible state
      // (honoring disposal types) before stamping it into the strip.
      const compose = document.createElement('canvas');
      compose.width = W;
      compose.height = H;
      const composeCtx = compose.getContext('2d');
      if (!composeCtx) return;

      // Backup canvas for disposal type 3 (restore previous)
      const backup = document.createElement('canvas');
      backup.width = W;
      backup.height = H;
      const backupCtx = backup.getContext('2d');

      // Temp canvas for stamping each frame's patch
      const tmp = document.createElement('canvas');
      tmp.width = W;
      tmp.height = H;
      const tmpCtx = tmp.getContext('2d');
      if (!tmpCtx) return;

      // Strip canvas: N frames laid out horizontally. This is the ONLY
      // surface kept after load. Browser graphics memory, not JS heap.
      const strip = document.createElement('canvas');
      strip.width = W * N;
      strip.height = H;
      const stripCtx = strip.getContext('2d');
      if (!stripCtx) return;

      const delays: number[] = new Array(N);

      for (let i = 0; i < N; i++) {
        const f = frames[i];
        delays[i] = f.delay || 100;

        // Apply disposal of the PREVIOUS frame
        if (i > 0) {
          const prev = frames[i - 1];
          const prevLeft = prev.dims.left || 0;
          const prevTop = prev.dims.top || 0;
          if (prev.disposalType === 2) {
            composeCtx.clearRect(prevLeft, prevTop, prev.dims.width, prev.dims.height);
          } else if (prev.disposalType === 3 && backupCtx) {
            composeCtx.clearRect(0, 0, W, H);
            composeCtx.drawImage(backup, 0, 0);
          }
        } else {
          composeCtx.clearRect(0, 0, W, H);
        }

        // Back up pre-state if this frame uses disposal 3
        if (f.disposalType === 3 && backupCtx) {
          backupCtx.clearRect(0, 0, W, H);
          backupCtx.drawImage(compose, 0, 0);
        }

        // Stamp this frame's patch onto the compose canvas
        const fw = f.dims.width;
        const fh = f.dims.height;
        const fl = f.dims.left || 0;
        const ft = f.dims.top || 0;
        const imageData = tmpCtx.createImageData(fw, fh);
        imageData.data.set(f.patch);
        tmpCtx.clearRect(0, 0, fw, fh);
        tmpCtx.putImageData(imageData, 0, 0);
        composeCtx.drawImage(tmp, 0, 0, fw, fh, fl, ft, fw, fh);

        // Copy the composed frame into the strip at position i
        stripCtx.clearRect(i * W, 0, W, H);
        stripCtx.drawImage(compose, i * W, 0);
      }

      // `frames` and all its {pixels, patch, colorTable, ...} objects
      // are now unreachable and eligible for GC. The strip canvas
      // alone carries the entire animation.
      stripCanvasRef.current = strip;
      frameDelaysRef.current = delays;

      // Texture-backing canvas: one frame size, painted per tick
      // from a strip viewport. THREE samples this canvas as a texture.
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      canvasRef.current = canvas;
      drawFrameFromStrip(0);

      const canvasTexture = new THREE.CanvasTexture(canvas);
      canvasTexture.minFilter = THREE.LinearFilter;
      canvasTexture.magFilter = THREE.LinearFilter;
      canvasTexture.needsUpdate = true;

      if (isMountedRef.current) {
        textureRef.current = canvasTexture;
        setTexture(canvasTexture);
        scheduleNextFrame();
      } else {
        canvasTexture.dispose();
      }
    } catch (error) {
      console.error('Failed to load animated GIF:', error);
    }
  };

  // Paint frame N onto the texture canvas by copying the matching
  // slice of the strip canvas. Single drawImage; no pixel allocations.
  const drawFrameFromStrip = (frameIndex: number) => {
    const canvas = canvasRef.current;
    const strip = stripCanvasRef.current;
    if (!canvas || !strip) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = frameWidthRef.current;
    const H = frameHeightRef.current;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(strip, frameIndex * W, 0, W, H, 0, 0, W, H);
  };

  // Self-scheduling animation loop — each GIF animates on its own
  // timer. Reads delay from the per-frame numbers array (tiny) and
  // paints from the strip canvas (no pixel allocations).
  const scheduleNextFrame = () => {
    const delays = frameDelaysRef.current;
    if (!isMountedRef.current || !isGifRef.current || delays.length <= 1) return;

    const frameDelay = delays[currentFrameRef.current] || 100;

    animationTimerRef.current = window.setTimeout(() => {
      if (!isMountedRef.current || !textureRef.current) return;

      currentFrameRef.current = (currentFrameRef.current + 1) % delays.length;
      drawFrameFromStrip(currentFrameRef.current);

      if (textureRef.current instanceof THREE.CanvasTexture) {
        textureRef.current.needsUpdate = true;
      }

      scheduleNextFrame();
    }, frameDelay);
  };

  return { texture, isAnimated: isGifRef.current };
};
