/**
 * DroppedItemRenderer - Renders dropped loot items as bobbing/rotating sandwich sprites.
 * Each item is two planes 0.07m apart, 1m wide, centered 0.5m above ground.
 * Shows "Press F to pick up" text when player is within pickup range.
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import type { DroppedWorldItem } from '@/features/shwarm/types';

const EXCLUSIVITY_MS = 30_000;
const PICKUP_RANGE = 2.0; // must match useLootPickup
const PLANE_SPACING = 0.07; // distance between the two sandwich planes
const BOB_AMPLITUDE = 0.1;
const BOB_FREQUENCY = (2 * Math.PI) / 1.2; // rad/s — 1.2 second organic cycle
const ROTATE_SPEED = 1.0; // rad/s
const BASE_HEIGHT = 0.5; // center height above ground

// Shared geometry (1m x 1m plane)
const planeGeometry = new THREE.PlaneGeometry(1, 1);

// Texture cache: item_number → texture
const textureCache = new Map<number, THREE.Texture>();
const textureLoader = new THREE.TextureLoader();

function getItemTexture(itemNumber: number): THREE.Texture {
  if (textureCache.has(itemNumber)) {
    return textureCache.get(itemNumber)!;
  }

  const url = `/item-sprites/${itemNumber}.webp`;
  const texture = textureLoader.load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  textureCache.set(itemNumber, texture);
  return texture;
}

interface DroppedItemSpriteProps {
  item: DroppedWorldItem;
  userId: string | null;
  cameraRef: React.RefObject<THREE.Camera>;
}

function DroppedItemSprite({ item, userId, cameraRef }: DroppedItemSpriteProps) {
  const groupRef = useRef<THREE.Group>(null);
  const textRef = useRef<THREE.Object3D>(null);
  const isNearRef = useRef(false);

  const material = useMemo(() => {
    const texture = getItemTexture(item.itemNumber);
    return new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }, [item.itemNumber]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;

    const now = Date.now();
    const t = clock.elapsedTime;

    // Visibility: hidden from non-killers during exclusivity window
    const inExclusivity = now - item.droppedAt < EXCLUSIVITY_MS;
    group.visible = !inExclusivity || item.killerUserId === userId;

    if (!group.visible) return;

    // Bob up and down
    group.position.y = item.position.y + BASE_HEIGHT + Math.sin(t * BOB_FREQUENCY) * BOB_AMPLITUDE;

    // Rotate
    group.rotation.y = t * ROTATE_SPEED;

    // Check distance for pickup prompt
    const cam = cameraRef.current;
    if (cam && textRef.current) {
      const dx = item.position.x - cam.position.x;
      const dy = item.position.y - cam.position.y;
      const dz = item.position.z - cam.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const near = dist < PICKUP_RANGE;
      isNearRef.current = near;
      textRef.current.visible = near;

      // Billboard the text to face camera (counter-rotate against group)
      if (near) {
        textRef.current.rotation.y = -group.rotation.y;
      }
    }
  });

  return (
    <group
      ref={groupRef}
      position={[item.position.x, item.position.y + BASE_HEIGHT, item.position.z]}
    >
      {/* Front plane */}
      <mesh geometry={planeGeometry} material={material} position={[0, 0, PLANE_SPACING / 2]} />
      {/* Back plane */}
      <mesh geometry={planeGeometry} material={material} position={[0, 0, -PLANE_SPACING / 2]} />
      {/* Pickup prompt - positioned above the item */}
      <Text
        ref={textRef as any}
        position={[0, 0.8, 0]}
        fontSize={0.15}
        color="white"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="black"
        visible={false}
      >
        Press F to pick up
      </Text>
    </group>
  );
}

interface DroppedItemRendererProps {
  items: DroppedWorldItem[];
  userId: string | null;
  cameraRef: React.RefObject<THREE.Camera>;
}

export function DroppedItemRenderer({ items, userId, cameraRef }: DroppedItemRendererProps) {
  const visibleItems = items.filter(item => !item.pickedUp);

  if (visibleItems.length === 0) return null;

  return (
    <>
      {visibleItems.map(item => (
        <DroppedItemSprite key={item.id} item={item} userId={userId} cameraRef={cameraRef} />
      ))}
    </>
  );
}
