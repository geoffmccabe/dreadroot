import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useBillboardData } from '@/hooks/useBillboardData';
import * as THREE from 'three';

interface BillboardWallsProps {
  wallPositions?: Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>;
}

const BillboardWalls: React.FC<BillboardWallsProps> = ({ wallPositions }) => {
  const { walls, screenUrls, mediaItems } = useBillboardData();
  const [activeScreenUrl, setActiveScreenUrl] = useState(1);

  // Get wall positions from local control or fallback to database
  const getWallPositionAndRotation = (wallNumber: number) => {
    // Use local positions if available, otherwise fallback to database
    if (wallPositions && wallPositions[wallNumber]) {
      const pos = wallPositions[wallNumber];
      return {
        position: [pos.x, pos.y, pos.z] as [number, number, number],
        rotation: [pos.rotX, pos.rotY, pos.rotZ] as [number, number, number]
      };
    }
    
    const wall = walls.find(w => w.wall_number === wallNumber);
    if (!wall) return { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
    
    return {
      position: [
        wall.position_x ?? 0,
        wall.position_y ?? 0,
        wall.position_z ?? 0
      ] as [number, number, number],
      rotation: [
        wall.rotation_x ?? 0,
        wall.rotation_y ?? 0,
        wall.rotation_z ?? 0
      ] as [number, number, number]
    };
  };

  const wall1 = walls.find(w => w.wall_number === 1);
  const wall1Urls = screenUrls.filter(url => url.wall_id === wall1?.id);
  const currentUrl = wall1Urls.find(url => url.slot_number === activeScreenUrl);

  const getMediaItemsForWall = (wallNumber: number) => {
    const wall = walls.find(w => w.wall_number === wallNumber);
    if (!wall) return [];
    return mediaItems
      .filter(item => item.wall_id === wall.id)
      .sort((a, b) => a.slot_number - b.slot_number);
  };

  // Wall 1 - Screen with URL buttons (front wall inner)
  const Wall1Screen = () => {
    const { position, rotation } = getWallPositionAndRotation(1);
    const [posX, posY, posZ] = position;
    const [rotX, rotY, rotZ] = rotation;

    console.log('Wall1Screen rendering with position:', [posX, posY, posZ]);

    // Create iframe texture for live website content
    const [iframeTexture, setIframeTexture] = useState<THREE.Texture | null>(null);
    
    useEffect(() => {
      const urlString = currentUrl?.url;
      if (!urlString) {
        setIframeTexture(null);
        return;
      }

      // Check if URL is valid
      try {
        new URL(urlString);
      } catch {
        console.warn('Invalid URL:', urlString);
        setIframeTexture(null);
        return;
      }

      console.log('Creating iframe texture for:', urlString);
      
      // Create iframe element
      const iframe = document.createElement('iframe');
      iframe.src = urlString;
      iframe.width = '1024';
      iframe.height = '768';
      iframe.style.border = 'none';
      iframe.style.position = 'absolute';
      iframe.style.left = '-9999px';
      iframe.style.top = '-9999px';
      
      // Add iframe to document
      document.body.appendChild(iframe);

      // Create canvas and texture after iframe loads
      const handleLoad = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 1024;
          canvas.height = 768;
          const context = canvas.getContext('2d')!;
          
          // Create a simple loading/placeholder texture
          context.fillStyle = '#1e293b';
          context.fillRect(0, 0, canvas.width, canvas.height);
          
          // Add URL text
          context.fillStyle = '#ffffff';
          context.font = 'bold 40px Arial';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText('Loading...', canvas.width / 2, canvas.height / 2 - 50);
          context.font = '30px Arial';
          context.fillText(urlString, canvas.width / 2, canvas.height / 2 + 50);
          
          const texture = new THREE.CanvasTexture(canvas);
          texture.needsUpdate = true;
          setIframeTexture(texture);
        } catch (error) {
          console.error('Error creating iframe texture:', error);
        } finally {
          // Clean up iframe
          if (iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          }
        }
      };

      iframe.onload = handleLoad;
      
      // Fallback if iframe doesn't load in 3 seconds
      setTimeout(() => {
        handleLoad();
      }, 3000);

      return () => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      };
    }, [currentUrl?.url]);

    // Fallback texture for when no URL is set
    const fallbackTexture = useMemo(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 768;
      const context = canvas.getContext('2d')!;
      
      context.fillStyle = '#1e293b';
      context.fillRect(0, 0, canvas.width, canvas.height);
      
      context.fillStyle = '#6b7280';
      context.font = 'bold 48px Arial';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('No URL Selected', canvas.width / 2, canvas.height / 2);
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      return texture;
    }, []);

    return (
      <group position={[posX, posY, posZ]} rotation={[rotX, rotY, rotZ]}>
        {/* Main screen plane - visible from both sides */}
        <mesh position={[0, 0, 0.01]}>
          <planeGeometry args={[18, 12]} />
          <meshBasicMaterial color="#000000" side={THREE.DoubleSide} />
        </mesh>
        
        {/* Screen content - Live website or fallback - visible from both sides */}
        <mesh position={[0, 1, 0.02]}>
          <planeGeometry args={[17, 10]} />
          <meshBasicMaterial 
            map={iframeTexture || fallbackTexture}
            side={THREE.DoubleSide}
          />
        </mesh>
        
        {/* URL buttons at bottom - visible from both sides */}
        <group position={[-6.75, -4.5, 0.03]}>
          {wall1Urls.slice(0, 4).map((urlData, index) => (
            <group key={urlData.slot_number}>
              <mesh
                position={[index * 4.5, 0, 0]}
                onClick={() => {
                  console.log('Switching to URL slot:', urlData.slot_number);
                  setActiveScreenUrl(urlData.slot_number);
                }}
              >
                <planeGeometry args={[4, 2]} />
                <meshBasicMaterial 
                  color={activeScreenUrl === urlData.slot_number ? "#4f46e5" : "#6b7280"}
                  side={THREE.DoubleSide}
                />
              </mesh>
              {/* Button label */}
              <mesh position={[index * 4.5, 0, 0.01]}>
                <planeGeometry args={[3.8, 1.8]} />
                <meshBasicMaterial 
                  color="#ffffff"
                  transparent
                  opacity={0.9}
                  side={THREE.DoubleSide}
                />
              </mesh>
            </group>
          ))}
        </group>
      </group>
    );
  };

  // Media Grid Wall Component
  const MediaGridWall = ({ wallNumber, wallType }: { 
    wallNumber: number; 
    wallType: 'side' | 'back';
  }) => {
    const mediaItems = getMediaItemsForWall(wallNumber);
    const { position, rotation } = getWallPositionAndRotation(wallNumber);
    const [posX, posY, posZ] = position;
    const [rotX, rotY, rotZ] = rotation;

    console.log(`Wall${wallNumber} rendering with position:`, [posX, posY, posZ]);
    
    // Calculate dimensions based on wall type
    const wallWidth = wallType === 'back' ? 40 : 30; // Back wall: 40 units, Side walls: 30 units
    const wallHeight = 20; // All walls are 20 units high
    const slotWidth = wallWidth / 3; // 3 columns
    const slotHeight = wallHeight / 2; // 2 rows
    
    return (
      <group position={[posX, posY, posZ]} rotation={[rotX, rotY, rotZ]}>
        {/* Grid: 3 columns x 2 rows - no gaps, fill entire wall */}
        {Array.from({ length: 6 }, (_, index) => {
          const col = index % 3;
          const row = Math.floor(index / 3);
          
          // Position slots to fill entire wall without gaps
          const x = (col - 1) * slotWidth; // -slotWidth, 0, slotWidth
          const y = (0.5 - row) * slotHeight; // slotHeight/2, -slotHeight/2
          
          const mediaItem = mediaItems.find(item => item.slot_number === index + 1);
          
          return (
            <MediaSlot 
              key={`${wallNumber}-slot-${index + 1}`} 
              position={[x, y, 0.01]} 
              dimensions={[slotWidth, slotHeight]}
              mediaUrl={mediaItem?.media_url} 
              mediaType={mediaItem?.media_type}
            />
          );
        })}
      </group>
    );
  };

  // Individual media slot component with completely stable texture loading
  const MediaSlot = React.memo(({ position, dimensions, mediaUrl, mediaType }: { 
    position: [number, number, number]; 
    dimensions: [number, number];
    mediaUrl?: string | null; 
    mediaType?: string | null; 
  }) => {
    const textureRef = useRef<THREE.Texture | null>(null);
    const currentUrlRef = useRef<string | null>(null);
    
    // Use useMemo for completely stable texture - only changes when URL actually changes
    const stableTexture = useMemo(() => {
      // If no URL or not an image, return null
      if (!mediaUrl || mediaType !== 'image') {
        currentUrlRef.current = null;
        textureRef.current = null;
        return null;
      }
      
      // If URL hasn't changed, return existing texture
      if (currentUrlRef.current === mediaUrl && textureRef.current) {
        return textureRef.current;
      }
      
      // Only create new texture if URL actually changed
      if (currentUrlRef.current !== mediaUrl) {
        console.log('Creating stable texture for:', mediaUrl);
        currentUrlRef.current = mediaUrl;
        
        const loader = new THREE.TextureLoader();
        loader.load(
          mediaUrl,
          (loadedTexture) => {
            loadedTexture.needsUpdate = true;
            loadedTexture.wrapS = THREE.ClampToEdgeWrapping;
            loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
            loadedTexture.minFilter = THREE.LinearFilter;
            loadedTexture.magFilter = THREE.LinearFilter;
            textureRef.current = loadedTexture;
            console.log('Stable texture loaded:', mediaUrl);
          },
          undefined,
          (error) => {
            console.warn('Failed to load stable texture:', mediaUrl, error);
            textureRef.current = null;
          }
        );
      }
      
      return textureRef.current;
    }, [mediaUrl, mediaType]);
    
    return (
      <mesh position={position}>
        <planeGeometry args={dimensions} />
        <meshBasicMaterial 
          map={stableTexture}
          color={stableTexture ? "#ffffff" : "#374151"}
          transparent={true}
          opacity={stableTexture ? 1 : 0.25}
          side={THREE.DoubleSide}
        />
      </mesh>
    );
  });

  return (
    <>
      {/* Wall 1 - Screen (front wall inner) */}
      <Wall1Screen />
      
      {/* Wall 2 - Media Grid (right wall inner) */}
      <MediaGridWall 
        wallNumber={2} 
        wallType="side"
      />
      
      {/* Wall 3 - Media Grid (back wall inner) */}
      <MediaGridWall 
        wallNumber={3} 
        wallType="back"
      />
      
      {/* Wall 4 - Media Grid (left wall inner) */}
      <MediaGridWall 
        wallNumber={4} 
        wallType="side"
      />
    </>
  );
};

// Export the BillboardWalls component
export { BillboardWalls };
export default BillboardWalls;