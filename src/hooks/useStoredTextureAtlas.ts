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
  
  const atlasFileName = `wall-${wallNumber}-atlas-v2.webp`;
  
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
          loadedTexture.colorSpace = THREE.SRGBColorSpace;
          loadedTexture.format = THREE.RGBAFormat;
          loadedTexture.premultiplyAlpha = false;
          loadedTexture.needsUpdate = true;
          
          console.log(`✅ Loaded stored atlas for wall ${wallNumber}`, {
            width: loadedTexture.image?.width,
            height: loadedTexture.image?.height,
            format: loadedTexture.format,
            type: loadedTexture.type,
            colorSpace: loadedTexture.colorSpace
          });
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
      console.log(`🔨 Rebuilding atlas for wall ${wallNumber}`, {
        imageUrls: imageUrls.filter(url => url).length + ' images'
      });
      
      // Dispose previous texture
      if (atlasTexture) {
        atlasTexture.dispose();
      }
      
      // Create canvas for atlas - 2400x1600 for 800x800 pixel slots
      const canvas = document.createElement('canvas');
      canvas.width = 2400;
      canvas.height = 1600;
      const ctx = canvas.getContext('2d', { 
        alpha: true,
        willReadFrequently: false,
        desynchronized: false
      });
      
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }
      
      // Ensure proper alpha compositing
      ctx.globalCompositeOperation = 'source-over';
      
      // Clear canvas to transparent to preserve alpha channel
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Each slot is 800x800 (2400/3 = 800, 1600/2 = 800)
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
      
      console.log(`✅ All images processed for wall ${wallNumber} atlas`);
      
      // Convert to WebP blob with high quality to preserve alpha channel
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('Failed to create blob')),
          'image/webp',
          1.0  // Use lossless quality for perfect alpha preservation
        );
      });
      
      console.log(`📦 Created blob for wall ${wallNumber}:`, {
        size: blob.size,
        type: blob.type
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
          loadedTexture.colorSpace = THREE.SRGBColorSpace;
          loadedTexture.format = THREE.RGBAFormat;
          loadedTexture.premultiplyAlpha = false;
          loadedTexture.needsUpdate = true;
          
          console.log(`✅ Created and saved new atlas for wall ${wallNumber}`, {
            width: loadedTexture.image?.width,
            height: loadedTexture.image?.height,
            blobSize: blob.size,
            colorSpace: loadedTexture.colorSpace
          });
          
          // Dispatch success event
          window.dispatchEvent(new CustomEvent('atlasRebuildComplete', {
            detail: { wallNumber, success: true }
          }));
          
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
      
      // Dispatch failure event
      window.dispatchEvent(new CustomEvent('atlasRebuildComplete', {
        detail: { wallNumber, success: false, error: err }
      }));
    }
  };
  
  // Initialize atlas on mount - load stored or rebuild if needed
  useEffect(() => {
    let hasLoadedStored = false;
    
    const initializeAtlas = async () => {
      console.log(`🔧 Initializing atlas for wall ${wallNumber}`);
      
      // First try to load stored atlas
      const storedAtlas = await loadStoredAtlas();
      if (storedAtlas) {
        hasLoadedStored = true;
        console.log(`✅ Using stored atlas for wall ${wallNumber}`);
        return;
      }
      
      // Only rebuild if no stored atlas and we have images
      if (imageUrls.some(url => url)) {
        console.log(`🔨 No stored atlas found, rebuilding for wall ${wallNumber}`);
        await rebuildAtlas();
      }
    };
    
    initializeAtlas();
    
    // Listen for manual rebuild events from BCP
    const handleRebuildAtlas = (event: CustomEvent) => {
      if (event.detail.wallNumber === wallNumber) {
        console.log(`🔔 Manual rebuild requested for wall ${wallNumber}`);
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
  }, [wallNumber, imageUrlsHash]); // Depend on both wallNumber and imageUrlsHash
  
  return { atlasTexture, isLoading, error, rebuildAtlas };
};