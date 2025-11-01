import React, { useEffect, useRef, useMemo } from 'react';
import { useStoredTextureAtlas } from '@/hooks/useStoredTextureAtlas';
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
  isMoveMode?: boolean;
}

export const AtlasMediaWall: React.FC<AtlasMediaWallProps> = React.memo(({
  wallNumber,
  wallType,
  position,
  rotation,
  mediaItems,
  isMoveMode = false
}) => {
  const materialsRef = useRef<THREE.MeshBasicMaterial[]>([]);
  
  // Extract image URLs in slot order (1-6)
  const imageUrls = useMemo(() => Array.from({ length: 6 }, (_, index) => {
    const slotNumber = index + 1;
    const mediaItem = mediaItems.find(item => item.slot_number === slotNumber);
    return mediaItem?.media_type === 'image' ? mediaItem.media_url : null;
  }), [mediaItems]);
  
  const { atlasTexture, isLoading, error } = useStoredTextureAtlas(wallNumber, imageUrls);
  
  useEffect(() => {
    if (atlasTexture && !isMoveMode) {
      materialsRef.current.forEach((material) => {
        if (material) {
          material.map = atlasTexture;
          material.color.setHex(0xffffff);
          material.opacity = 1;
          material.needsUpdate = true;
        }
      });
    }
  }, [atlasTexture, isMoveMode]);
  
  // Calculate wall dimensions - 3x2 aspect ratio for square slots
  const wallWidth = 30;  // 3x2 aspect ratio: 30:20 = 3:2
  const wallHeight = 20;
  const slotWidth = wallWidth / 3;  // 10 units wide
  const slotHeight = wallHeight / 2; // 10 units tall (making each slot square)
  
  // UV coordinates for each slot in the 3x2 grid
  // Canvas layout: [0][1][2]  <- row 0 (top)
  //               [3][4][5]  <- row 1 (bottom)
  // With flipY = false: Canvas (0,0) maps to UV (0,1), Canvas (w,h) maps to UV (1,0)
  const getSlotUVs = (slotIndex: number): [number, number, number, number] => {
    const col = slotIndex % 3;
    const row = Math.floor(slotIndex / 3);
    
    // console.log(`Slot ${slotIndex + 1}: col=${col}, row=${row}`);
    
    const uMin = col / 3;
    const uMax = (col + 1) / 3;
    
    // Fix: Invert the V coordinate mapping to match actual canvas layout
    // Canvas row 0 (top) should map to V=0.0 to V=0.5  
    // Canvas row 1 (bottom) should map to V=0.5 to V=1.0
    const vMin = row === 0 ? 0.0 : 0.5;    // Bottom edge of slot
    const vMax = row === 0 ? 0.5 : 1.0;    // Top edge of slot
    
    // console.log(`UV mapping: u(${uMin}, ${uMax}), v(${vMin}, ${vMax})`);
    
    return [uMin, vMin, uMax, vMax];
  };
  
  // Memoize slot geometries - only create once
  const slotGeometries = useMemo(() => {
    const geometries: THREE.PlaneGeometry[] = [];
    for (let slotIndex = 0; slotIndex < 6; slotIndex++) {
      const geometry = new THREE.PlaneGeometry(slotWidth, slotHeight);
      const [uMin, vMin, uMax, vMax] = getSlotUVs(slotIndex);
      
      const uvs = geometry.attributes.uv;
      uvs.setXY(0, uMin, vMin);
      uvs.setXY(1, uMax, vMin);
      uvs.setXY(2, uMin, vMax);
      uvs.setXY(3, uMax, vMax);
      uvs.needsUpdate = true;
      
      geometries.push(geometry);
    }
    return geometries;
  }, []);
  
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
        
        // CRITICAL FIX: Atlas texture contains ALL 6 slots, apply it to all meshes
        const shouldShowAtlas = !isMoveMode && atlasTexture && !isLoading;
        
        return (
          <mesh 
            key={`${wallNumber}-slot-${index + 1}`}
            position={[x, y, 0.5]}
            geometry={slotGeometries[index]}
          >
            <meshBasicMaterial
              ref={(mat) => {
                if (mat) materialsRef.current[index] = mat;
              }}
              map={shouldShowAtlas ? atlasTexture : null}
              color={isMoveMode ? "#ff0000" : (shouldShowAtlas ? "#ffffff" : "#374151")}
              transparent={true}
              opacity={isMoveMode ? 0.8 : (shouldShowAtlas ? 1 : (hasImage ? 0.5 : 0.25))}
              side={THREE.DoubleSide}
              blending={THREE.NormalBlending}
              depthWrite={false}
              alphaTest={0.01}
              needsUpdate={true}
            />
          </mesh>
        );
      })}
      
      {/* Loading indicator */}
      {isLoading && (
        <mesh position={[0, 0, 0.6]}>
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
});