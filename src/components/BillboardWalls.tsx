import React, { useState, useMemo, useCallback } from 'react';
import { useBillboardData } from '@/hooks/useBillboardData';
import { AtlasMediaWall } from '@/components/AtlasMediaWall';
import * as THREE from 'three';

interface BillboardWallsProps {
  wallPositions?: Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>;
  isMoveMode?: boolean;
}

const BillboardWalls: React.FC<BillboardWallsProps> = ({ wallPositions, isMoveMode = false }) => {
  const { walls, screenUrls, mediaItems, loading } = useBillboardData();
  const [activeScreenUrl, setActiveScreenUrl] = useState(1);

  const getWallPositionAndRotation = useCallback((wallNumber: number) => {
    // Use local positions if available, otherwise fallback to database
    if (wallPositions && wallPositions[wallNumber]) {
      const pos = wallPositions[wallNumber];
      return {
        position: [pos.x, pos.y, pos.z] as [number, number, number],
        rotation: [pos.rotX, pos.rotY, pos.rotZ] as [number, number, number]
      };
    } else {
      const wall = walls.find(w => w.wall_number === wallNumber);
      if (!wall) {
        return { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };
      } else {
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
      }
    }
  }, [walls, wallPositions]);

  const getMediaItemsForWall = useCallback((wallNumber: number) => {
    const wall = walls.find(w => w.wall_number === wallNumber);
    if (!wall) return [];
    
    return mediaItems
      .filter(item => item.wall_id === wall.id)
      .sort((a, b) => a.slot_number - b.slot_number);
  }, [walls, mediaItems]);

  const wall1 = walls.find(w => w.wall_number === 1);
  const wall1Urls = screenUrls.filter(url => url.wall_id === wall1?.id);
  const currentUrl = wall1Urls.find(url => url.slot_number === activeScreenUrl);

  // Don't render anything until data is loaded to prevent position jumping
  if (loading || walls.length === 0) {
    return null;
  }

  // Wall 1 - Screen with URL buttons (front wall inner)
  const Wall1Screen = () => {
    const { position, rotation } = getWallPositionAndRotation(1);
    const [posX, posY, posZ] = position;
    const [rotX, rotY, rotZ] = rotation;

    // Stable texture creation - only create once per URL
    const iframeTexture = useMemo(() => {
      const urlString = currentUrl?.url;
      if (!urlString) return null;

      // Check if URL is valid
      try {
        new URL(urlString);
      } catch {
        console.warn('Invalid URL:', urlString);
        return null;
      }

      // Create a simple placeholder texture with URL info
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 768;
      const context = canvas.getContext('2d')!;
      
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
      
      return new THREE.CanvasTexture(canvas);
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
      
      return new THREE.CanvasTexture(canvas);
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


  return (
    <>
      {/* Wall 1 - Screen (front wall inner) */}
      <Wall1Screen />
      
      {/* Wall 2 - Media Grid (right wall inner) */}
      <AtlasMediaWall 
        wallNumber={2} 
        wallType="side"
        position={getWallPositionAndRotation(2).position}
        rotation={getWallPositionAndRotation(2).rotation}
        mediaItems={getMediaItemsForWall(2)}
        isMoveMode={isMoveMode}
      />
      
      {/* Wall 3 - Media Grid (back wall inner) */}
      <AtlasMediaWall 
        wallNumber={3} 
        wallType="back"
        position={getWallPositionAndRotation(3).position}
        rotation={getWallPositionAndRotation(3).rotation}
        mediaItems={getMediaItemsForWall(3)}
        isMoveMode={isMoveMode}
      />
      
      {/* Wall 4 - Media Grid (left wall inner) */}
      <AtlasMediaWall 
        wallNumber={4} 
        wallType="side"
        position={getWallPositionAndRotation(4).position}
        rotation={getWallPositionAndRotation(4).rotation}
        mediaItems={getMediaItemsForWall(4)}
        isMoveMode={isMoveMode}
      />
    </>
  );
};

// Export the BillboardWalls component
export { BillboardWalls };
export default BillboardWalls;