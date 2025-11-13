import { useState, useEffect, useRef, useCallback } from 'react';
import { PlacedBlock, BlockType } from '@/types/blocks';
import * as THREE from 'three';

interface WispState {
  blockType: BlockType;
  spawnTime: number;
  lifetime: number; // 5-30 seconds
  isActive: boolean;
}

const MAP_BOUNDS = {
  minX: -130,
  maxX: 130,
  minZ: -130,
  maxZ: 130,
  minY: 0.5,
  maxY: 10.5
};

export const useWispBlock = (
  basicBlocks: BlockType[],
  placedBlocks: PlacedBlock[]
) => {
  const [wispState, setWispState] = useState<WispState | null>(null);
  const wispPositionRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const moveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lifetimeCheckRef = useRef<NodeJS.Timeout | null>(null);
  const reusableVector = useRef(new THREE.Vector3());
  
  // Spatial cache for nearby blocks to avoid filtering 10x per second
  const nearbyBlocksCache = useRef<PlacedBlock[]>([]);
  const cacheOriginPosition = useRef<THREE.Vector3 | null>(null);

  // Generate random position within bounds, avoiding existing blocks
  const generateRandomPosition = useCallback((blocks: PlacedBlock[]): THREE.Vector3 => {
    const maxAttempts = 20;
    
    for (let i = 0; i < maxAttempts; i++) {
      const x = Math.random() * (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) + MAP_BOUNDS.minX;
      const z = Math.random() * (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) + MAP_BOUNDS.minZ;
      const y = Math.random() * (MAP_BOUNDS.maxY - MAP_BOUNDS.minY) + MAP_BOUNDS.minY;
      
      const testPos = new THREE.Vector3(x, y, z);
      
      // Check if position collides with existing blocks
      const collides = blocks.some(block => {
        const blockPos = new THREE.Vector3(block.position_x, block.position_y, block.position_z);
        return testPos.distanceTo(blockPos) < 1.5; // 1.5m safety margin
      });
      
      if (!collides) {
        return testPos;
      }
    }
    
    // If all attempts fail, return position anyway (rare case)
    return new THREE.Vector3(
      Math.random() * (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) + MAP_BOUNDS.minX,
      5,
      Math.random() * (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) + MAP_BOUNDS.minZ
    );
  }, []);

  // Spawn new wisp
  const spawnWisp = useCallback(() => {
    if (basicBlocks.length === 0) return;
    
    // Select random basic block
    const randomBlock = basicBlocks[Math.floor(Math.random() * basicBlocks.length)];
    
    // Random lifetime between 5-30 seconds
    const lifetime = 5000 + Math.random() * 25000;
    
    // Set position in ref (no re-render)
    wispPositionRef.current = generateRandomPosition(placedBlocks);
    
    const newWisp: WispState = {
      blockType: randomBlock,
      spawnTime: Date.now(),
      lifetime,
      isActive: true
    };
    
    setWispState(newWisp);
    
    // Set up lifetime expiration
    if (lifetimeCheckRef.current) {
      clearTimeout(lifetimeCheckRef.current);
    }
    lifetimeCheckRef.current = setTimeout(() => {
      spawnWisp(); // Respawn at new location
    }, lifetime);
  }, [basicBlocks, placedBlocks, generateRandomPosition]);

  // Move wisp 2-4 blocks in random direction (jumps around quickly)
  const moveWisp = useCallback(() => {
    if (!wispState) return;
    
    const currentPos = wispPositionRef.current;
    const maxAttempts = 5;
    
    // Use spatial cache for nearby blocks to avoid filtering every 0.1s
    let nearbyBlocks: PlacedBlock[];
    
    if (cacheOriginPosition.current && 
        currentPos.distanceTo(cacheOriginPosition.current) < 10) {
      // Cache is still valid (wisp within 10m of cache origin), reuse it
      nearbyBlocks = nearbyBlocksCache.current;
    } else {
      // Cache invalid or doesn't exist, rebuild it
      nearbyBlocks = placedBlocks.filter(block => {
        const dx = block.position_x - currentPos.x;
        const dz = block.position_z - currentPos.z;
        return (dx * dx + dz * dz) < 100; // 10m radius squared
      });
      nearbyBlocksCache.current = nearbyBlocks;
      cacheOriginPosition.current = currentPos.clone();
    }
    
    for (let i = 0; i < maxAttempts; i++) {
      // Random direction (0-360 degrees)
      const angle = Math.random() * Math.PI * 2;
      
      // Random distance (2-4 blocks/meters)
      const distance = 2 + Math.random() * 2;
      
      // Calculate movement vector
      const dx = Math.cos(angle) * distance;
      const dz = Math.sin(angle) * distance;
      
      // Random Y movement (-1 to +1 for more vertical variation)
      const dy = (Math.random() - 0.5) * 2;
      
      // Calculate destination position (reuse vector to avoid allocation)
      const newX = currentPos.x + dx;
      const newY = currentPos.y + dy;
      const newZ = currentPos.z + dz;
      
      // Clamp to map bounds
      const clampedX = Math.max(MAP_BOUNDS.minX, Math.min(MAP_BOUNDS.maxX, newX));
      const clampedY = Math.max(MAP_BOUNDS.minY, Math.min(MAP_BOUNDS.maxY, newY));
      const clampedZ = Math.max(MAP_BOUNDS.minZ, Math.min(MAP_BOUNDS.maxZ, newZ));
      
      // Check collision with nearby blocks only (reuse vector)
      let collides = false;
      for (const block of nearbyBlocks) {
        reusableVector.current.set(block.position_x, block.position_y, block.position_z);
        const dx = clampedX - reusableVector.current.x;
        const dy = clampedY - reusableVector.current.y;
        const dz = clampedZ - reusableVector.current.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        
        if (distSq < 1.44) { // 1.2m threshold squared
          collides = true;
          break;
        }
      }
      
      if (!collides) {
        // Update position ref directly (no React re-render)
        wispPositionRef.current.set(clampedX, clampedY, clampedZ);
        return;
      }
    }
  }, [placedBlocks, wispState]);

  // Invalidate spatial cache when placedBlocks changes
  useEffect(() => {
    cacheOriginPosition.current = null;
  }, [placedBlocks]);

  // Initialize wisp on mount
  useEffect(() => {
    if (basicBlocks.length > 0) {
      spawnWisp();
    }
    
    return () => {
      if (moveIntervalRef.current) {
        clearInterval(moveIntervalRef.current);
      }
      if (lifetimeCheckRef.current) {
        clearTimeout(lifetimeCheckRef.current);
      }
    };
  }, [basicBlocks.length, spawnWisp]);

  // Set up movement interval
  useEffect(() => {
    if (!wispState) return;
    
    // Move every 0.1 seconds
    moveIntervalRef.current = setInterval(() => {
      moveWisp();
    }, 100);
    
    return () => {
      if (moveIntervalRef.current) {
        clearInterval(moveIntervalRef.current);
      }
    };
  }, [wispState?.isActive, moveWisp]);

  // Method to collect wisp (called when shot by player)
  const collectWisp = useCallback(() => {
    if (!wispState) return null;
    
    const collectedBlock = wispState.blockType;
    
    // Spawn new wisp immediately at different location
    spawnWisp();
    
    return collectedBlock;
  }, [wispState, spawnWisp]);

  return {
    wispState,
    wispPositionRef,
    collectWisp
  };
};
