import { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { parseGIF, decompressFrames } from 'gifuct-js';

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

    if (isGif) {
      loadAnimatedGif(url);
    } else {
      loadStaticTexture(url);
    }

    return () => {
      if (texture) {
        texture.dispose();
      }
      if (canvasRef.current) {
        canvasRef.current = null;
      }
    };
  }, [url]);

  const loadStaticTexture = (url: string) => {
    console.log('📷 Loading static texture from:', url);
    const loader = new THREE.TextureLoader();
    loader.load(url, (loadedTexture) => {
      console.log('✅ Static texture loaded');
      setTexture(loadedTexture);
    });
  };

  const loadAnimatedGif = async (url: string) => {
    try {
      console.log('🎬 Starting GIF load from:', url);
      // Fetch the GIF
      const response = await fetch(url);
      console.log('📥 GIF fetch response:', response.status);
      const buffer = await response.arrayBuffer();
      console.log('📦 GIF buffer size:', buffer.byteLength);
      
      // Parse GIF
      const gif = parseGIF(buffer);
      const frames = decompressFrames(gif, true);
      
      if (frames.length === 0) {
        console.warn('No frames found in GIF, falling back to static texture');
        loadStaticTexture(url);
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
      loadStaticTexture(url);
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

    // Handle disposal of previous frame
    if (frameIndex > 0) {
      const prevFrame = framesRef.current[frameIndex - 1];
      const prevLeft = prevFrame.dims.left || 0;
      const prevTop = prevFrame.dims.top || 0;
      
      // Disposal Type:
      // 0 or 1: No disposal (leave as is)
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
    }

    // Backup current state if next frame might need it (disposal type 3)
    if (frame.disposalType === 3 && backupCanvasRef.current) {
      const backupCtx = backupCanvasRef.current.getContext('2d');
      if (backupCtx) {
        backupCtx.clearRect(0, 0, backupCanvasRef.current.width, backupCanvasRef.current.height);
        backupCtx.drawImage(canvasRef.current, 0, 0);
      }
    }

    // Create ImageData from frame patch
    const imageData = ctx.createImageData(frame.dims.width, frame.dims.height);
    imageData.data.set(frame.patch);
    
    // Draw the new frame at its position
    ctx.putImageData(imageData, left, top);
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
