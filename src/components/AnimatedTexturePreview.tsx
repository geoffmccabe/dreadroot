/**
 * AnimatedTexturePreview
 *
 * Displays texture previews that animate if the texture is an animation strip.
 * Detects strip metadata from URL (e.g., _8f_100ms_) and cycles through frames.
 */

import React, { useRef, useEffect, useState } from 'react';
import { parseStripMetadata } from '@/lib/animationToStrip';

interface AnimatedTexturePreviewProps {
  url: string | null | undefined;
  size?: number;
  className?: string;
  fallback?: React.ReactNode;
}

export function AnimatedTexturePreview({
  url,
  size = 40,
  className = '',
  fallback,
}: AnimatedTexturePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isAnimated, setIsAnimated] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const frameIndexRef = useRef(0);
  const lastFrameTimeRef = useRef(0);

  useEffect(() => {
    if (!url) {
      setIsLoaded(false);
      setIsAnimated(false);
      return;
    }

    // Check if this is an animation strip
    const stripMeta = parseStripMetadata(url);
    setIsAnimated(!!stripMeta);

    // Load the image
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      imageRef.current = img;
      setIsLoaded(true);

      if (stripMeta && canvasRef.current) {
        // Start animation loop
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d')!;
        const frameWidth = img.width / stripMeta.frames;
        const frameHeight = img.height;

        const animate = (timestamp: number) => {
          if (!imageRef.current || !canvasRef.current) return;

          // Check if enough time has passed for next frame
          if (timestamp - lastFrameTimeRef.current >= stripMeta.delay) {
            lastFrameTimeRef.current = timestamp;
            frameIndexRef.current = (frameIndexRef.current + 1) % stripMeta.frames;

            // Draw current frame with crop-to-fill
            const srcX = frameIndexRef.current * frameWidth;
            const srcSize = Math.min(frameWidth, frameHeight);
            const srcCropX = srcX + (frameWidth - srcSize) / 2;
            const srcCropY = (frameHeight - srcSize) / 2;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(
              imageRef.current,
              srcCropX, srcCropY, srcSize, srcSize,
              0, 0, canvas.width, canvas.height
            );
          }

          animationRef.current = requestAnimationFrame(animate);
        };

        // Draw first frame immediately
        const srcSize = Math.min(frameWidth, frameHeight);
        const srcCropX = (frameWidth - srcSize) / 2;
        const srcCropY = (frameHeight - srcSize) / 2;
        ctx.drawImage(img, srcCropX, srcCropY, srcSize, srcSize, 0, 0, canvas.width, canvas.height);

        // Start animation
        frameIndexRef.current = 0;
        lastFrameTimeRef.current = 0;
        animationRef.current = requestAnimationFrame(animate);
      } else if (canvasRef.current) {
        // Static image - just draw it once with crop-to-fill
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d')!;
        const srcSize = Math.min(img.width, img.height);
        const srcX = (img.width - srcSize) / 2;
        const srcY = (img.height - srcSize) / 2;
        ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, canvas.width, canvas.height);
      }
    };

    img.onerror = () => {
      setIsLoaded(false);
      imageRef.current = null;
    };

    img.src = url;

    // Cleanup
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      imageRef.current = null;
    };
  }, [url]);

  if (!url) {
    return (
      <div
        className={`rounded border bg-muted flex items-center justify-center overflow-hidden ${className}`}
        style={{ width: size, height: size }}
      >
        {fallback}
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={size * 2} // Higher resolution for quality
      height={size * 2}
      className={`rounded border bg-muted ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export default AnimatedTexturePreview;
