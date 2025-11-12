import { useState, useEffect, useRef, useCallback } from 'react';
import { PlacedBlock, BlockType } from '@/types/blocks';
import * as THREE from 'three';

interface WispState {
  position: THREE.Vector3;
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
  const moveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lifetimeCheckRef = useRef<NodeJS.Timeout | null>(null);

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
    
    const newWisp: WispState = {
      position: generateRandomPosition(placedBlocks),
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

  // Move wisp in random direction by 1 block width (1m)
  const moveWisp = useCallback(() => {
    setWispState(prev => {
      if (!prev) return prev;
      
      const maxAttempts = 5;
      
      for (let i = 0; i < maxAttempts; i++) {
        // Random direction in XZ plane
        const angle = Math.random() * Math.PI * 2;
        const dx = Math.cos(angle);
        const dz = Math.sin(angle);
        
        // Random Y movement (-0.5 to +0.5)
        const dy = (Math.random() - 0.5);
        
        // Calculate destination (1 meter in random direction)
        const newPos = new THREE.Vector3(
          prev.position.x + dx,
          prev.position.y + dy,
          prev.position.z + dz
        );
        
        // Clamp to map bounds
        newPos.x = Math.max(MAP_BOUNDS.minX, Math.min(MAP_BOUNDS.maxX, newPos.x));
        newPos.y = Math.max(MAP_BOUNDS.minY, Math.min(MAP_BOUNDS.maxY, newPos.y));
        newPos.z = Math.max(MAP_BOUNDS.minZ, Math.min(MAP_BOUNDS.maxZ, newPos.z));
        
        // Check collision with placed blocks (only check nearby)
        const collides = placedBlocks.some(block => {
          const blockPos = new THREE.Vector3(block.position_x, block.position_y, block.position_z);
          // Only check blocks within 3m
          if (newPos.distanceTo(blockPos) > 3) return false;
          return newPos.distanceTo(blockPos) < 1.2; // Collision threshold
        });
        
        if (!collides) {
          return { ...prev, position: newPos };
        }
      }
      
      // If all attempts fail, don't move this cycle
      return prev;
    });
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
  }, [basicBlocks.length > 0]); // Only re-run if basicBlocks changes from empty to populated

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
    collectWisp
  };
};
