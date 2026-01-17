// Hook for tree collision detection
// Self-contained - exports a simple collision check function

import { useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { TreeBlock, TreeFruit, TreeCollisionResult } from '../types';
import { TREE_CONFIG } from '../constants';

// Reusable objects for collision checks
const _box = new THREE.Box3();
const _min = new THREE.Vector3();
const _max = new THREE.Vector3();

interface UseTreeCollisionOptions {
  treeBlocks: TreeBlock[];
  treeFruits: TreeFruit[];
}

export function useTreeCollision({ treeBlocks, treeFruits }: UseTreeCollisionOptions) {
  // Build spatial index for fast lookups
  const blockIndex = useMemo(() => {
    if (!TREE_CONFIG.ENABLED) return new Map<string, TreeBlock>();
    
    const index = new Map<string, TreeBlock>();
    for (const block of treeBlocks) {
      const key = `${block.position_x},${block.position_y},${block.position_z}`;
      index.set(key, block);
    }
    return index;
  }, [treeBlocks]);

  const fruitIndex = useMemo(() => {
    if (!TREE_CONFIG.ENABLED) return new Map<string, TreeFruit>();
    
    const index = new Map<string, TreeFruit>();
    for (const fruit of treeFruits) {
      const key = `${fruit.position_x},${fruit.position_y},${fruit.position_z}`;
      index.set(key, fruit);
    }
    return index;
  }, [treeFruits]);

  // Check collision at a specific grid position
  const checkTreeCollisionAt = useCallback((
    x: number, y: number, z: number
  ): TreeCollisionResult => {
    if (!TREE_CONFIG.ENABLED) {
      return { collides: false };
    }

    const gridX = Math.floor(x);
    const gridY = Math.floor(y);
    const gridZ = Math.floor(z);
    const key = `${gridX},${gridY},${gridZ}`;

    // Check blocks first
    const block = blockIndex.get(key);
    if (block) {
      return {
        collides: true,
        blockId: block.id,
        blockType: block.block_type as 'trunk' | 'fruit',
      };
    }

    // Check fruits
    const fruit = fruitIndex.get(key);
    if (fruit && !fruit.is_falling) {
      return {
        collides: true,
        blockId: fruit.id,
        blockType: 'fruit',
      };
    }

    return { collides: false };
  }, [blockIndex, fruitIndex]);

  // Check collision with a bounding box
  const checkTreeCollisionBox = useCallback((
    position: THREE.Vector3,
    halfWidth: number,
    halfHeight: number
  ): TreeCollisionResult => {
    if (!TREE_CONFIG.ENABLED) {
      return { collides: false };
    }

    // Check all grid cells the box overlaps
    const minX = Math.floor(position.x - halfWidth);
    const maxX = Math.floor(position.x + halfWidth);
    const minY = Math.floor(position.y);
    const maxY = Math.floor(position.y + halfHeight * 2);
    const minZ = Math.floor(position.z - halfWidth);
    const maxZ = Math.floor(position.z + halfWidth);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const result = checkTreeCollisionAt(x, y, z);
          if (result.collides) {
            return result;
          }
        }
      }
    }

    return { collides: false };
  }, [checkTreeCollisionAt]);

  // Get all tree collision boxes for integration with existing systems
  const getTreeCollisionBoxes = useCallback((): THREE.Box3[] => {
    if (!TREE_CONFIG.ENABLED) return [];

    const boxes: THREE.Box3[] = [];
    
    for (const block of treeBlocks) {
      _min.set(block.position_x, block.position_y, block.position_z);
      _max.set(block.position_x + 1, block.position_y + 1, block.position_z + 1);
      boxes.push(new THREE.Box3().copy(_box.set(_min, _max)));
    }

    return boxes;
  }, [treeBlocks]);

  return {
    checkTreeCollisionAt,
    checkTreeCollisionBox,
    getTreeCollisionBoxes,
    blockCount: treeBlocks.length,
    fruitCount: treeFruits.length,
  };
}
