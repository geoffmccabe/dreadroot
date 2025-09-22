import React, { useState } from 'react';
import { useBillboardData } from '@/hooks/useBillboardData';
import { Button } from '@/components/ui/button';

interface BillboardWallsProps {
  // These props will be passed from the 3D scene to position the walls
}

export const BillboardWalls: React.FC<BillboardWallsProps> = () => {
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

  // Wall 1 - Screen with URL buttons
  const Wall1Screen = () => (
    <group position={[0, 0, -4.8]}>
      {/* Main screen plane */}
      <mesh position={[0, 1, 0.01]}>
        <planeGeometry args={[8, 4]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      
      {/* Screen content - iframe simulation */}
      {currentUrl?.url && (
        <mesh position={[0, 1, 0.02]}>
          <planeGeometry args={[7.8, 3.8]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
      
      {/* URL buttons at bottom left */}
      <group position={[-3, -1.5, 0.03]}>
        {wall1Urls.slice(0, 4).map((urlData, index) => (
          <mesh
            key={urlData.slot_number}
            position={[index * 0.8, 0, 0]}
            onClick={() => setActiveScreenUrl(urlData.slot_number)}
          >
            <planeGeometry args={[0.6, 0.3]} />
            <meshBasicMaterial 
              color={activeScreenUrl === urlData.slot_number ? "#4f46e5" : "#6b7280"} 
            />
          </mesh>
        ))}
      </group>
    </group>
  );

  // Media Grid Wall Component
  const MediaGridWall = ({ wallNumber, position }: { wallNumber: number; position: [number, number, number] }) => {
    const mediaItems = getMediaItemsForWall(wallNumber);
    
    return (
      <group position={position}>
        {/* Grid: 3 columns x 2 rows */}
        {Array.from({ length: 6 }, (_, index) => {
          const col = index % 3;
          const row = Math.floor(index / 3);
          const x = (col - 1) * 2.6; // Spacing between columns
          const y = (1 - row) * 2; // Spacing between rows (top to bottom)
          
          const mediaItem = mediaItems.find(item => item.slot_number === index + 1);
          
          return (
            <mesh key={index} position={[x, y, 0.01]}>
              <planeGeometry args={[2.4, 1.8]} />
              <meshBasicMaterial 
                color={mediaItem?.media_url ? "#ffffff" : "#374151"} 
              />
              {/* TODO: Add actual texture loading for images/videos */}
            </mesh>
          );
        })}
      </group>
    );
  };

  return (
    <>
      {/* Wall 1 - Screen */}
      <Wall1Screen />
      
      {/* Wall 2 - Media Grid (right wall) */}
      <MediaGridWall wallNumber={2} position={[4.8, 0, 0]} />
      
      {/* Wall 3 - Media Grid (back wall) */}
      <MediaGridWall wallNumber={3} position={[0, 0, 4.8]} />
      
      {/* Wall 4 - Media Grid (left wall) */}
      <MediaGridWall wallNumber={4} position={[-4.8, 0, 0]} />
    </>
  );
};

// Screen URL Control Buttons (rendered in HTML overlay)
export const ScreenControls: React.FC = () => {
  const { walls, screenUrls } = useBillboardData();
  const [activeScreenUrl, setActiveScreenUrl] = useState(1);

  const wall1 = walls.find(w => w.wall_number === 1);
  const wall1Urls = screenUrls.filter(url => url.wall_id === wall1?.id);

  return (
    <div className="absolute bottom-4 left-4 z-10">
      <div className="bg-background/80 backdrop-blur-sm rounded-lg p-2 space-y-2">
        <p className="text-sm font-medium">Screen URLs</p>
        <div className="flex flex-col gap-1">
          {wall1Urls.slice(0, 4).map((urlData) => (
            <Button
              key={urlData.slot_number}
              variant={activeScreenUrl === urlData.slot_number ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveScreenUrl(urlData.slot_number)}
              disabled={!urlData.url}
              className="text-xs"
            >
              URL {urlData.slot_number}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
};