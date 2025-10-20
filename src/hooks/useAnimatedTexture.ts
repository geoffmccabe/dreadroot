import { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { parseGIF, decompressFrames } from 'gifuct-js';

interface GIFFrame {
  dims: { width: number; height: number };
  patch: Uint8ClampedArray;
  delay: number;
}

export const useAnimatedTexture = (url: string) => {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const framesRef = useRef<GIFFrame[]>([]);
  const currentFrameRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const isGifRef = useRef(false);

  useEffect(() => {
    const isGif = url.toLowerCase().endsWith('.gif');
    isGifRef.current = isGif;

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
    const loader = new THREE.TextureLoader();
    loader.load(url, (loadedTexture) => {
      setTexture(loadedTexture);
    });
  };

  const loadAnimatedGif = async (url: string) => {
    try {
      // Fetch the GIF
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      
      // Parse GIF
      const gif = parseGIF(buffer);
      const frames = decompressFrames(gif, true);
      
      if (frames.length === 0) {
        console.warn('No frames found in GIF, falling back to static texture');
        loadStaticTexture(url);
        return;
      }

      framesRef.current = frames as GIFFrame[];
      
      // Create canvas for rendering frames
      const canvas = document.createElement('canvas');
      canvas.width = frames[0].dims.width;
      canvas.height = frames[0].dims.height;
      canvasRef.current = canvas;

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

    // Create ImageData from frame patch
    const imageData = ctx.createImageData(frame.dims.width, frame.dims.height);
    imageData.data.set(frame.patch);
    
    ctx.putImageData(imageData, 0, 0);
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
