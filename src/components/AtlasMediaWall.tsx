import React from 'react';
import { useTextureAtlas } from '@/hooks/useTextureAtlas';
import * as THREE from 'three';

interface MediaItem {
  slot_number: number;
  media_url?: string | null;
  media_type?: string | null;
}

interface AtlasMediaWallProps {
  wallNumber: number;
  wallType: 'side' | 'back';
  position: [number, number, number];
  rotation: [number, number, number];
  mediaItems: MediaItem[];
}

export const AtlasMediaWall: React.FC<AtlasMediaWallProps> = ({
  wallNumber,
  wallType,
  position,
  rotation,
  mediaItems
}) => {
  // Extract image URLs in slot order (1-6)
  const imageUrls = Array.from({ length: 6 }, (_, index) => {
    const slotNumber = index + 1;
    const mediaItem = mediaItems.find(item => item.slot_number === slotNumber);
    return mediaItem?.media_type === 'image' ? mediaItem.media_url : null;
  });
  
  const { atlasTexture, isLoading, error } = useTextureAtlas(imageUrls);
  
  // Calculate wall dimensions
  const wallWidth = wallType === 'back' ? 40 : 30;
  const wallHeight = 20;
  const slotWidth = wallWidth / 3;
  const slotHeight = wallHeight / 2;
  
  // UV coordinates for each slot in the 3x2 grid
  // Canvas layout: [0][1][2]  <- row 0 (top)
  //               [3][4][5]  <- row 1 (bottom)
  // But Three.js UV (0,0) is bottom-left, so we need to map correctly
  const getSlotUVs = (slotIndex: number): [number, number, number, number] => {
    const col = slotIndex % 3;
    const row = Math.floor(slotIndex / 3);
    
    console.log(`Slot ${slotIndex + 1} -> col=${col}, row=${row}`);
    
    const uMin = col / 3;
    const uMax = (col + 1) / 3;
    // Canvas row 0 maps to Three.js V top (1-0.5 to 1)
    // Canvas row 1 maps to Three.js V bottom (1-1 to 0.5) 
    const vMin = 1 - (row + 1) * 0.5;  // Bottom of slot in Three.js coords
    const vMax = 1 - row * 0.5;        // Top of slot in Three.js coords
    
    console.log(`UV mapping: u(${uMin}, ${uMax}), v(${vMin}, ${vMax})`);
    
    return [uMin, vMin, uMax, vMax];
  };
  
  // Create geometry with custom UV mapping for each slot
  const createSlotGeometry = (slotIndex: number) => {
    const geometry = new THREE.PlaneGeometry(slotWidth, slotHeight);
    const [uMin, vMin, uMax, vMax] = getSlotUVs(slotIndex);
    
    // Update UV coordinates
    const uvs = geometry.attributes.uv;
    uvs.setXY(0, uMin, vMin); // Bottom-left
    uvs.setXY(1, uMax, vMin); // Bottom-right
    uvs.setXY(2, uMin, vMax); // Top-left
    uvs.setXY(3, uMax, vMax); // Top-right
    uvs.needsUpdate = true;
    
    return geometry;
  };
  
  if (error) {
    console.warn(`Atlas error for wall ${wallNumber}:`, error);
  }
  
  return (
    <group position={position} rotation={rotation}>
      {/* Render 6 slots with atlas texture */}
      {Array.from({ length: 6 }, (_, index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        
        // Position slots to fill entire wall without gaps
        const x = (col - 1) * slotWidth;
        const y = (0.5 - row) * slotHeight;
        
        const mediaItem = mediaItems.find(item => item.slot_number === index + 1);
        const hasImage = mediaItem?.media_type === 'image' && mediaItem.media_url;
        
        return (
          <mesh 
            key={`${wallNumber}-slot-${index + 1}`}
            position={[x, y, 0.01]}
            geometry={createSlotGeometry(index)}
          >
            <meshBasicMaterial
              map={hasImage && atlasTexture ? atlasTexture : null}
              color={hasImage && atlasTexture ? "#ffffff" : "#374151"}
              transparent={true}
              opacity={hasImage && atlasTexture && !isLoading ? 1 : 0.25}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
      
      {/* Loading indicator */}
      {isLoading && (
        <mesh position={[0, 0, 0.02]}>
          <planeGeometry args={[wallWidth * 0.8, wallHeight * 0.1]} />
          <meshBasicMaterial 
            color="#4f46e5" 
            transparent 
            opacity={0.7}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
};