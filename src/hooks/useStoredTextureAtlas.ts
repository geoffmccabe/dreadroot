import { useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { supabase } from '@/integrations/supabase/client';

interface UseStoredTextureAtlasReturn {
  atlasTexture: THREE.Texture | null;
  isLoading: boolean;
  error: string | null;
  rebuildAtlas: () => Promise<void>;
}

export const useStoredTextureAtlas = (
  wallNumber: number,
  imageUrls: (string | null | undefined)[]
): UseStoredTextureAtlasReturn => {
  const [atlasTexture, setAtlasTexture] = useState<THREE.Texture | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const atlasFileName = `wall-${wallNumber}-atlas.webp`;
  
  // Create a stable hash of image URLs to detect changes
  const imageUrlsHash = useMemo(() => {
    const urls = imageUrls.map(url => url || '').join('|');
    return btoa(urls).replace(/[/+=]/g, ''); // Simple hash for comparison
  }, [imageUrls]);
  
  // Load stored atlas from Supabase storage
  const loadStoredAtlas = async () => {
    try {
      console.log(`📥 Loading stored atlas: ${atlasFileName}`);
      
      const { data, error } = await supabase.storage
        .from('billboard-media')
        .download(atlasFileName);
      
      if (error) {
        console.log(`ℹ️ No stored atlas found for wall ${wallNumber}, will rebuild`);
        return null;
      }
      
      const blobUrl = URL.createObjectURL(data);
      const texture = new THREE.TextureLoader().load(
        blobUrl,
        (loadedTexture) => {
          loadedTexture.wrapS = THREE.ClampToEdgeWrapping;
          loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
          loadedTexture.minFilter = THREE.LinearFilter;
          loadedTexture.magFilter = THREE.LinearFilter;
          loadedTexture.flipY = false;
          
          console.log(`✅ Loaded stored atlas for wall ${wallNumber}`);
          setAtlasTexture(loadedTexture);
          URL.revokeObjectURL(blobUrl);
        },
        undefined,
        (error) => {
          console.error(`❌ Failed to load stored atlas for wall ${wallNumber}:`, error);
          URL.revokeObjectURL(blobUrl);
          setError('Failed to load stored atlas');
        }
      );
      
      return texture;
    } catch (err) {
      console.error(`❌ Error loading stored atlas for wall ${wallNumber}:`, err);
      return null;
    }
  };
  
  // Build new atlas and save to storage
  const rebuildAtlas = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      console.log(`🔨 Rebuilding atlas for wall ${wallNumber}`);
      
      // Dispose previous texture
      if (atlasTexture) {
        atlasTexture.dispose();
      }
      
      // Create canvas for atlas - 2048x1024 for good quality/performance balance
      const canvas = document.createElement('canvas');
      canvas.width = 2048;
      canvas.height = 1024;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }
      
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Each slot is ~683x512 (2048/3 ≈ 683, 1024/2 = 512)
      const slotWidth = Math.floor(canvas.width / 3);
      const slotHeight = Math.floor(canvas.height / 2);
      
      // Load and draw images with timeout
      const imagePromises = imageUrls.map(async (url, index) => {
        if (!url) return;
        
        console.log(`Loading image for wall ${wallNumber}, slot ${index + 1}:`, url);
        
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          
          const timeout = setTimeout(() => {
            console.warn(`⏰ Timeout loading image for wall ${wallNumber}, slot ${index + 1}`);
            resolve();
          }, 8000);
          
          img.onload = () => {
            clearTimeout(timeout);
            
            const col = index % 3;
            const row = Math.floor(index / 3);
            const x = col * slotWidth;
            const y = row * slotHeight;
            
            // Implement CSS "cover" behavior
            const imageAspect = img.width / img.height;
            const slotAspect = slotWidth / slotHeight;
            
            let sourceX = 0, sourceY = 0, sourceWidth = img.width, sourceHeight = img.height;
            
            if (imageAspect > slotAspect) {
              sourceWidth = img.height * slotAspect;
              sourceX = (img.width - sourceWidth) / 2;
            } else {
              sourceHeight = img.width / slotAspect;
              sourceY = (img.height - sourceHeight) / 2;
            }
            
            ctx.drawImage(
              img,
              sourceX, sourceY, sourceWidth, sourceHeight,
              x, y, slotWidth, slotHeight
            );
            
            resolve();
          };
          
          img.onerror = () => {
            clearTimeout(timeout);
            console.warn(`❌ Failed to load image for wall ${wallNumber}, slot ${index + 1}`);
            resolve();
          };
          
          img.src = url;
        });
      });
      
      await Promise.all(imagePromises);
      
      // Convert to WebP blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('Failed to create blob')),
          'image/webp',
          0.9
        );
      });
      
      // Save to Supabase storage
      console.log(`💾 Saving atlas for wall ${wallNumber} to storage`);
      const { error: uploadError } = await supabase.storage
        .from('billboard-media')
        .upload(atlasFileName, blob, { 
          upsert: true,
          contentType: 'image/webp'
        });
      
      if (uploadError) {
        console.error(`❌ Failed to save atlas for wall ${wallNumber}:`, uploadError);
        throw uploadError;
      }
      
      // Create texture from blob
      const blobUrl = URL.createObjectURL(blob);
      const texture = new THREE.TextureLoader().load(
        blobUrl,
        (loadedTexture) => {
          loadedTexture.wrapS = THREE.ClampToEdgeWrapping;
          loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
          loadedTexture.minFilter = THREE.LinearFilter;
          loadedTexture.magFilter = THREE.LinearFilter;
          loadedTexture.flipY = false;
          
          console.log(`✅ Created and saved new atlas for wall ${wallNumber}`);
          setAtlasTexture(loadedTexture);
          setIsLoading(false);
          URL.revokeObjectURL(blobUrl);
        },
        undefined,
        (error) => {
          setError('Failed to create texture from new atlas');
          setIsLoading(false);
          URL.revokeObjectURL(blobUrl);
        }
      );
      
    } catch (err) {
      console.error(`❌ Error rebuilding atlas for wall ${wallNumber}:`, err);
      setError(err instanceof Error ? err.message : 'Unknown error rebuilding atlas');
      setIsLoading(false);
    }
  };
  
  // On mount, load existing atlas (no rebuilding unless needed)
  useEffect(() => {
    const initializeAtlas = async () => {
      const storedAtlas = await loadStoredAtlas();
      if (!storedAtlas && imageUrls.some(url => url)) {
        // Only rebuild if we have images but no stored atlas
        await rebuildAtlas();
      }
    };
    
    initializeAtlas();
    
    // Listen for atlas rebuild events
    const handleRebuildAtlas = (event: CustomEvent) => {
      if (event.detail.wallNumber === wallNumber) {
        console.log(`🔔 Received rebuild request for wall ${wallNumber}`);
        rebuildAtlas();
      }
    };
    
    window.addEventListener('rebuildAtlas', handleRebuildAtlas as EventListener);
    
    // Cleanup
    return () => {
      if (atlasTexture) {
        atlasTexture.dispose();
      }
      window.removeEventListener('rebuildAtlas', handleRebuildAtlas as EventListener);
    };
  }, [wallNumber]); // Only depend on wallNumber, not imageUrlsHash
  
  // Rebuild atlas when image URLs change (for manual changes)
  useEffect(() => {
    if (imageUrls.some(url => url)) {
      console.log(`🔄 Image URLs changed for wall ${wallNumber}, rebuilding atlas`);
      rebuildAtlas();
    }
  }, [imageUrlsHash]);
  
  return { atlasTexture, isLoading, error, rebuildAtlas };
};