import { useState, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

interface UseTextureAtlasReturn {
  atlasTexture: THREE.Texture | null;
  isLoading: boolean;
  error: string | null;
}

export const useTextureAtlas = (imageUrls: (string | null | undefined)[]): UseTextureAtlasReturn => {
  const [atlasTexture, setAtlasTexture] = useState<THREE.Texture | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const lastUrlsRef = useRef<string>('');
  
  // Create a stable array of URLs for comparison
  const urlsString = useMemo(() => {
    return JSON.stringify(imageUrls.map(url => url || ''));
  }, [imageUrls]);
  
  useEffect(() => {
    // Don't regenerate if URLs haven't actually changed
    if (lastUrlsRef.current === urlsString) {
      return;
    }
    
    lastUrlsRef.current = urlsString;
    
    const createAtlas = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // Dispose previous texture
        if (atlasTexture) {
          atlasTexture.dispose();
        }
        
        // Create high-resolution canvas for atlas - 4096x2048
        const canvas = document.createElement('canvas');
        canvas.width = 4096;
        canvas.height = 2048;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          throw new Error('Could not get canvas context');
        }
        
        // Clear canvas with transparent background
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Each slot is 1365x1024 (4096/3 ≈ 1365, 2048/2 = 1024)
        const slotWidth = Math.floor(canvas.width / 3);
        const slotHeight = Math.floor(canvas.height / 2);
        
        // Load and draw images
        const imagePromises = imageUrls.map(async (url, index) => {
          if (!url) return; // Skip empty slots
          
          try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            return new Promise<void>((resolve, reject) => {
              img.onload = () => {
                // Calculate position in 3x2 grid
                const col = index % 3;
                const row = Math.floor(index / 3);
                const x = col * slotWidth;
                const y = row * slotHeight;
                
                // Draw image to fit slot while maintaining aspect ratio
                const imgAspect = img.width / img.height;
                const slotAspect = slotWidth / slotHeight;
                
                let drawWidth = slotWidth;
                let drawHeight = slotHeight;
                let drawX = x;
                let drawY = y;
                
                if (imgAspect > slotAspect) {
                  // Image is wider - fit to width
                  drawHeight = slotWidth / imgAspect;
                  drawY = y + (slotHeight - drawHeight) / 2;
                } else {
                  // Image is taller - fit to height
                  drawWidth = slotHeight * imgAspect;
                  drawX = x + (slotWidth - drawWidth) / 2;
                }
                
                ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
                resolve();
              };
              
              img.onerror = () => {
                console.warn(`Failed to load image: ${url}`);
                resolve(); // Continue even if image fails
              };
              
              img.src = url;
            });
          } catch (error) {
            console.warn(`Error loading image ${url}:`, error);
          }
        });
        
        // Wait for all images to load (or fail)
        await Promise.all(imagePromises);
        
        // Convert canvas to WebP blob for efficiency
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Failed to create blob'));
              }
            },
            'image/webp',
            0.9 // High quality WebP
          );
        });
        
        // Create texture from WebP blob
        const blobUrl = URL.createObjectURL(blob);
        const texture = new THREE.TextureLoader().load(
          blobUrl,
          (loadedTexture) => {
            // Set texture properties for best quality
            loadedTexture.wrapS = THREE.ClampToEdgeWrapping;
            loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
            loadedTexture.minFilter = THREE.LinearFilter;
            loadedTexture.magFilter = THREE.LinearFilter;
            loadedTexture.flipY = false; // Important for correct orientation
            
            setAtlasTexture(loadedTexture);
            setIsLoading(false);
            
            // Clean up blob URL
            URL.revokeObjectURL(blobUrl);
          },
          undefined,
          (error) => {
            setError('Failed to create texture from atlas');
            setIsLoading(false);
            URL.revokeObjectURL(blobUrl);
          }
        );
        
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error creating atlas');
        setIsLoading(false);
      }
    };
    
    createAtlas();
    
    // Cleanup function
    return () => {
      if (atlasTexture) {
        atlasTexture.dispose();
      }
    };
  }, [urlsString]);
  
  return { atlasTexture, isLoading, error };
};