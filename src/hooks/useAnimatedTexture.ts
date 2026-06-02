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

  // v4.12.10: lazy strip composition. v4.12.9 composed every frame
  // synchronously at load — a single 32-frame GIF was 100+ canvas ops
  // in a tight loop. Multiplied across all animated textures it
  // produced 1.9-second main-thread stalls during chunk load.
  //
  // New scheme: render only frame 0 at load (so the texture is valid),
  // stash frame data in pendingComposeRef, then compose subsequent
  // frames JUST-IN-TIME inside the animation tick (one frame per
  // tick). Composition cost per tick is ~1-2ms instead of a single
  // multi-hundred-ms blocker. Once every frame has been composed
  // once, the pending data is released — the strip canvas alone
  // carries the rest of the animation forever after.
  const pendingComposeRef = useRef<{
    frames: any[];
    composed: boolean[];
    composeCtx: CanvasRenderingContext2D;
    backupCtx: CanvasRenderingContext2D | null;
    tmpCtx: CanvasRenderingContext2D;
    stripCtx: CanvasRenderingContext2D;
    W: number;
    H: number;
    composedCount: number;
  } | null>(null);

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
      pendingComposeRef.current = null;
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
      for (let i = 0; i < N; i++) delays[i] = frames[i].delay || 100;

      // Stash everything needed for incremental composition. Frame
      // data lives in JS heap UNTIL each frame is composed once;
      // composeFrameIfNeeded nulls patches as it goes so memory
      // drains gradually rather than peaking forever.
      const pending = {
        frames,
        composed: new Array(N).fill(false) as boolean[],
        composeCtx,
        backupCtx,
        tmpCtx,
        stripCtx,
        W, H,
        composedCount: 0,
      };
      pendingComposeRef.current = pending;
      stripCanvasRef.current = strip;
      frameDelaysRef.current = delays;

      // Compose frame 0 immediately so the texture has something to show.
      composeFrameIfNeeded(0);

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

  // Compose ONE frame from the cached gifuct-js patch into the strip
  // canvas if it hasn't already been composed. The frame is composed
  // sequentially — to render frame i correctly we need frames 0..i-1
  // composed first so the disposal-type chain is honored. The most
  // common access pattern (forward playback) is already sequential,
  // so this is fine in practice.
  //
  // After a frame is composed, its `.patch` is set to null so the
  // big pixel buffer can be garbage collected.
  const composeFrameIfNeeded = (target: number) => {
    const p = pendingComposeRef.current;
    if (!p) return;
    if (target < 0 || target >= p.frames.length) return;
    // Walk forward from the last composed frame to target.
    while (p.composedCount <= target) {
      const i = p.composedCount;
      const f = p.frames[i];
      if (!f) { p.composedCount++; continue; }

      // Disposal of previous frame
      if (i > 0) {
        const prev = p.frames[i - 1];
        if (prev) {
          const prevLeft = prev.dims.left || 0;
          const prevTop = prev.dims.top || 0;
          if (prev.disposalType === 2) {
            p.composeCtx.clearRect(prevLeft, prevTop, prev.dims.width, prev.dims.height);
          } else if (prev.disposalType === 3 && p.backupCtx) {
            p.composeCtx.clearRect(0, 0, p.W, p.H);
            p.composeCtx.drawImage(p.backupCtx.canvas, 0, 0);
          }
        }
      } else {
        p.composeCtx.clearRect(0, 0, p.W, p.H);
      }

      // Backup before drawing if this frame uses disposal 3
      if (f.disposalType === 3 && p.backupCtx) {
        p.backupCtx.clearRect(0, 0, p.W, p.H);
        p.backupCtx.drawImage(p.composeCtx.canvas, 0, 0);
      }

      // Stamp patch
      const fw = f.dims.width;
      const fh = f.dims.height;
      const fl = f.dims.left || 0;
      const ft = f.dims.top || 0;
      const id = p.tmpCtx.createImageData(fw, fh);
      id.data.set(f.patch);
      p.tmpCtx.clearRect(0, 0, fw, fh);
      p.tmpCtx.putImageData(id, 0, 0);
      p.composeCtx.drawImage(p.tmpCtx.canvas, 0, 0, fw, fh, fl, ft, fw, fh);

      // Stamp into strip
      p.stripCtx.clearRect(i * p.W, 0, p.W, p.H);
      p.stripCtx.drawImage(p.composeCtx.canvas, i * p.W, 0);

      p.composed[i] = true;
      // Drop the heaviest field (the pixel buffer). Disposal info on
      // this frame is still needed for the NEXT frame's compose, so
      // we keep the frame object — patch is what costs MB though.
      f.patch = null;
      p.composedCount++;
    }
    // Once every frame has been composed, release the pending state
    // entirely so frames + the helper canvases can be collected.
    if (p.composedCount >= p.frames.length) {
      pendingComposeRef.current = null;
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
      // Lazy compose: make sure this frame is in the strip before drawing.
      // Cost ~1ms; bounded by the animation rate (typically 10Hz).
      composeFrameIfNeeded(currentFrameRef.current);
      drawFrameFromStrip(currentFrameRef.current);

      if (textureRef.current instanceof THREE.CanvasTexture) {
        textureRef.current.needsUpdate = true;
      }

      scheduleNextFrame();
    }, frameDelay);
  };

  return { texture, isAnimated: isGifRef.current };
};
