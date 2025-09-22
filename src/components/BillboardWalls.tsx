import React, { useState, useMemo } from 'react';
import { useBillboardData } from '@/hooks/useBillboardData';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

interface BillboardWallsProps {
  // These props will be passed from the 3D scene to position the walls
}

const BillboardWalls: React.FC<BillboardWallsProps> = () => {
  const { walls, screenUrls, mediaItems } = useBillboardData();
  const [activeScreenUrl, setActiveScreenUrl] = useState(1);

  // Get wall positions from Supabase data
  const getWallPositionAndRotation = (wallNumber: number) => {
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
    // Create URL text texture
    const urlTexture = useMemo(() => {
      if (!currentUrl?.url) return null;
      
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 512;
      const context = canvas.getContext('2d')!;
      
      // Black background
      context.fillStyle = '#1e293b';
      context.fillRect(0, 0, canvas.width, canvas.height);
      
      // White text
      context.fillStyle = '#ffffff';
      context.font = 'bold 60px Arial';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(currentUrl.url, canvas.width / 2, canvas.height / 2);
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      return texture;
    }, [currentUrl?.url]);

    const { position, rotation } = getWallPositionAndRotation(1);

    return (
      <group position={position} rotation={rotation}>
        {/* Main screen plane */}
        <mesh position={[0, 0, 0.01]}>
          <planeGeometry args={[18, 12]} />
          <meshBasicMaterial color="#000000" />
        </mesh>
        
        {/* Screen content - URL display */}
        <mesh position={[0, 1, 0.02]}>
          <planeGeometry args={[17, 8]} />
          <meshBasicMaterial 
            map={urlTexture}
            color={currentUrl?.url ? "#ffffff" : "#1e293b"} 
          />
        </mesh>
        
        {/* URL buttons at bottom */}
        <group position={[-6.75, -4, 0.03]}>
          {wall1Urls.slice(0, 4).map((urlData, index) => (
            <mesh
              key={urlData.slot_number}
              position={[index * 4.5, 0, 0]}
              onClick={() => setActiveScreenUrl(urlData.slot_number)}
            >
              <planeGeometry args={[4, 2]} />
              <meshBasicMaterial 
                color={activeScreenUrl === urlData.slot_number ? "#4f46e5" : "#6b7280"} 
              />
            </mesh>
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
    const { position, rotation } = getWallPositionAndRotation(wallNumber);
    const mediaItems = getMediaItemsForWall(wallNumber);
    
    // Calculate dimensions based on wall type
    const wallWidth = wallType === 'back' ? 40 : 30; // Back wall: 40 units, Side walls: 30 units
    const wallHeight = 20; // All walls are 20 units high
    const slotWidth = wallWidth / 3; // 3 columns
    const slotHeight = wallHeight / 2; // 2 rows
    
    return (
      <group position={position} rotation={rotation}>
        {/* Grid: 3 columns x 2 rows - no gaps, fill entire wall */}
        {Array.from({ length: 6 }, (_, index) => {
          const col = index % 3;
          const row = Math.floor(index / 3);
          const x = (col - 1) * slotWidth; // Center the grid
          const y = (1 - row) * slotHeight; // Center the grid vertically
          
          const mediaItem = mediaItems.find(item => item.slot_number === index + 1);
          
          return (
            <MediaSlot 
              key={index} 
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

  // Individual media slot component with texture loading
  const MediaSlot = ({ position, dimensions, mediaUrl, mediaType }: { 
    position: [number, number, number]; 
    dimensions: [number, number];
    mediaUrl?: string | null; 
    mediaType?: string | null; 
  }) => {
    let texture = null;
    
    try {
      if (mediaUrl && mediaType === 'image') {
        texture = useLoader(THREE.TextureLoader, mediaUrl);
      }
    } catch (error) {
      console.warn('Failed to load texture:', mediaUrl);
    }
    
    return (
      <mesh position={position}>
        <planeGeometry args={dimensions} />
        <meshBasicMaterial 
          map={texture}
          color={mediaUrl ? "#ffffff" : "#374151"} 
          transparent={true}
          opacity={mediaUrl ? 1 : 0.25}
        />
      </mesh>
    );
  };

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