import React, { useEffect, useRef, useMemo, useState } from 'react';
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

// Component to load and display a single image slot
const ImageSlot: React.FC<{
  mediaUrl: string | null;
  slotWidth: number;
  slotHeight: number;
  position: [number, number, number];
  isMoveMode: boolean;
}> = ({ mediaUrl, slotWidth, slotHeight, position, isMoveMode }) => {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);

  useEffect(() => {
    if (!mediaUrl || isMoveMode) {
      if (textureRef.current) {
        textureRef.current.dispose();
        textureRef.current = null;
        setTexture(null);
      }
      return;
    }

    const loader = new THREE.TextureLoader();
    loader.load(
      mediaUrl,
      (loadedTexture) => {
        loadedTexture.colorSpace = THREE.SRGBColorSpace;
        loadedTexture.needsUpdate = true;
        textureRef.current = loadedTexture;
        setTexture(loadedTexture);
      },
      undefined,
      (error) => {
        console.warn('Failed to load texture:', mediaUrl, error);
      }
    );

    return () => {
      if (textureRef.current) {
        textureRef.current.dispose();
        textureRef.current = null;
      }
    };
  }, [mediaUrl, isMoveMode]);

  return (
    <mesh position={position} renderOrder={50}>
      <planeGeometry args={[slotWidth, slotHeight]} />
      <meshBasicMaterial
        map={texture}
        color={isMoveMode ? "#ff0000" : (texture ? "#ffffff" : "#374151")}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

export const AtlasMediaWall: React.FC<AtlasMediaWallProps> = React.memo(({
  wallNumber,
  wallType,
  position,
  rotation,
  mediaItems,
  isMoveMode = false
}) => {
  // Calculate wall dimensions - 3x2 aspect ratio for square slots
  const wallWidth = 30;
  const wallHeight = 20;
  const slotWidth = wallWidth / 3;  // 10 units wide
  const slotHeight = wallHeight / 2; // 10 units tall

  return (
    <group position={position} rotation={rotation}>
      {/* Render 6 slots */}
      {Array.from({ length: 6 }, (_, index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);

        // Position slots to fill entire wall without gaps
        const x = (col - 1) * slotWidth;
        const y = (0.5 - row) * slotHeight;

        const mediaItem = mediaItems.find(item => item.slot_number === index + 1);
        const mediaUrl = mediaItem?.media_type === 'image' ? mediaItem.media_url || null : null;

        return (
          <ImageSlot
            key={`${wallNumber}-slot-${index + 1}`}
            mediaUrl={mediaUrl}
            slotWidth={slotWidth}
            slotHeight={slotHeight}
            position={[x, y, 0.5]}
            isMoveMode={isMoveMode}
          />
        );
      })}
    </group>
  );
});
