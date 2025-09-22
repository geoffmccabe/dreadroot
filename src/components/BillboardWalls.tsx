import React, { useState } from 'react';
import { useBillboardData } from '@/hooks/useBillboardData';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

interface BillboardWallsProps {
  // These props will be passed from the 3D scene to position the walls
}

const BillboardWalls: React.FC<BillboardWallsProps> = () => {
  const { walls, screenUrls, mediaItems } = useBillboardData();
  const [activeScreenUrl, setActiveScreenUrl] = useState(1);

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
  const Wall1Screen = () => (
    <group position={[0, 10, -7]} rotation={[0, 0, 0]}>
      {/* Main screen plane */}
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[18, 12]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      
      {/* Screen content - URL display */}
      {currentUrl?.url && (
        <mesh position={[0, 0, 0.02]}>
          <planeGeometry args={[17.8, 11.8]} />
          <meshBasicMaterial color="#1e293b" />
          {/* URL text would be rendered here in a real implementation */}
        </mesh>
      )}
      
      {/* URL buttons at bottom */}
      <group position={[-6, -4.5, 0.03]}>
        {wall1Urls.slice(0, 4).map((urlData, index) => (
          <mesh
            key={urlData.slot_number}
            position={[index * 3, 0, 0]}
            onClick={() => setActiveScreenUrl(urlData.slot_number)}
          >
            <planeGeometry args={[2.8, 1.5]} />
            <meshBasicMaterial 
              color={activeScreenUrl === urlData.slot_number ? "#4f46e5" : "#6b7280"} 
            />
          </mesh>
        ))}
      </group>
    </group>
  );

  // Media Grid Wall Component
  const MediaGridWall = ({ wallNumber, position, rotation }: { wallNumber: number; position: [number, number, number]; rotation: [number, number, number] }) => {
    const mediaItems = getMediaItemsForWall(wallNumber);
    
    return (
      <group position={position} rotation={rotation}>
        {/* Grid: 3 columns x 2 rows - no gaps */}
        {Array.from({ length: 6 }, (_, index) => {
          const col = index % 3;
          const row = Math.floor(index / 3);
          const x = (col - 1) * 6; // No gaps: 18/3 = 6
          const y = (1 - row) * 6; // No gaps: 12/2 = 6
          
          const mediaItem = mediaItems.find(item => item.slot_number === index + 1);
          
          return (
            <MediaSlot 
              key={index} 
              position={[x, y, 0.01]} 
              mediaUrl={mediaItem?.media_url} 
              mediaType={mediaItem?.media_type}
            />
          );
        })}
      </group>
    );
  };

  // Individual media slot component with texture loading
  const MediaSlot = ({ position, mediaUrl, mediaType }: { 
    position: [number, number, number]; 
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
        <planeGeometry args={[6, 6]} />
        <meshBasicMaterial 
          map={texture}
          color={mediaUrl ? "#ffffff" : "#374151"} 
          transparent={!mediaUrl}
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
        position={[18, 10, -23]} 
        rotation={[0, -Math.PI/2, 0]} 
      />
      
      {/* Wall 3 - Media Grid (back wall inner) */}
      <MediaGridWall 
        wallNumber={3} 
        position={[0, 10, -39]} 
        rotation={[0, Math.PI, 0]} 
      />
      
      {/* Wall 4 - Media Grid (left wall inner) */}
      <MediaGridWall 
        wallNumber={4} 
        position={[-18, 10, -23]} 
        rotation={[0, Math.PI/2, 0]} 
      />
    </>
  );
};

// Export the BillboardWalls component
export { BillboardWalls };
export default BillboardWalls;