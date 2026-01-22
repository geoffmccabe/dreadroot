import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { PlantedTree } from '@/features/trees/types';
import { worldCollisionGrid, entityCollisionGrid } from '@/lib/spatialHashGrid';
import type { ShnakeInstance } from '../types';

// Debug flag - disable in production for FPS
const DEBUG_SHNAKE = false;

const CHUNK_SIZE = 16;

function key(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

function chunkKey(x: number, z: number) {
  return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
}

function aabbForCell(x: number, y: number, z: number): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(x, y, z),
    new THREE.Vector3(x + 1, y + 1, z + 1)
  );
}

function treeBounds(tree: PlantedTree) {
  const tier = (tree as any).seed_tier ?? tree.seed_definition?.tier ?? 1;
  const maxSpread = tier * 2;
  const maxHeight = tier * 10;
  return {
    minX: tree.base_x - maxSpread,
    maxX: tree.base_x + maxSpread,
    minY: tree.base_y,
    maxY: tree.base_y + maxHeight,
    minZ: tree.base_z - maxSpread,
    maxZ: tree.base_z + maxSpread,
    tier,
  };
}

/** Get all chunk keys that a tree spans */
function getTreeChunkKeys(tree: PlantedTree): Set<string> {
  const b = treeBounds(tree);
  const chunks = new Set<string>();
  const minCx = Math.floor(b.minX / CHUNK_SIZE);
  const maxCx = Math.floor(b.maxX / CHUNK_SIZE);
  const minCz = Math.floor(b.minZ / CHUNK_SIZE);
  const maxCz = Math.floor(b.maxZ / CHUNK_SIZE);
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      chunks.add(`${cx},${cz}`);
    }
  }
  return chunks;
}

// Track shnake destinations and whether they've been attacked
interface ShnakeNavState {
  destinationX: number;
  destinationY: number;
  destinationZ: number;
  wasAttacked: boolean;
  attackedAt: number;
}

interface UseShnakeMovementOptions {
  shnakesRef: React.RefObject<ShnakeInstance[]>;
  cameraRef: React.RefObject<THREE.Camera>;
  plantedTrees: PlantedTree[] | undefined;
  blocksRef: React.RefObject<{ position_x: number; position_y: number; position_z: number }[]>;
  isEnabled: boolean;
  /** When true, AI system controls movement - legacy loop is disabled */
  aiControlled?: boolean;
  treeBlocksByTierRef: React.RefObject<Map<number, Map<string, string>>>;
  nonInvisTreeBlocksByTierRef: React.RefObject<Map<number, Set<string>>>;
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void;
  onHeadMoved?: (shnakeId: string) => void; // For fire propagation
}

export function useShnakeMovement({
  shnakesRef,
  cameraRef,
  plantedTrees,
  blocksRef,
  isEnabled,
  aiControlled = false,
  treeBlocksByTierRef,
  nonInvisTreeBlocksByTierRef,
  onPlayerHit,
  onHeadMoved,
}: UseShnakeMovementOptions) {
  const treesRef = useRef(plantedTrees);
  treesRef.current = plantedTrees;

  // Navigation state per shnake
  const navStateRef = useRef<Map<string, ShnakeNavState>>(new Map());

  // Shared temp vectors
  const tmpDir = useRef(new THREE.Vector3());
  const tmpPlayer = useRef(new THREE.Vector3());
  
  // Cache tree chunk keys to avoid recomputing Sets in hot loops
  const treeChunksCacheRef = useRef<Map<string, Set<string>>>(new Map());

  const isWorldOccupied = (x: number, y: number, z: number) => {
    const blocks = blocksRef.current || [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.position_x === x && b.position_y === y && b.position_z === z) return true;
    }
    return false;
  };

  /**
   * Check if position is adjacent to any tree block of this tier.
   */
  const isTouchingTree = (tier: number, x: number, y: number, z: number): boolean => {
    const tierMap = treeBlocksByTierRef.current?.get(tier);
    if (!tierMap) return false;

    const neighbors = [
      key(x + 1, y, z), key(x - 1, y, z),
      key(x, y + 1, z), key(x, y - 1, z),
      key(x, y, z + 1), key(x, y, z - 1),
    ];

    for (const nk of neighbors) {
      if (tierMap.has(nk)) return true;
    }
    return false;
  };

  /**
   * Get cached tree chunk keys (avoids recomputing Set in hot loops)
   */
  const getCachedTreeChunks = (tree: PlantedTree): Set<string> => {
    let chunks = treeChunksCacheRef.current.get(tree.id);
    if (!chunks) {
      chunks = getTreeChunkKeys(tree);
      treeChunksCacheRef.current.set(tree.id, chunks);
    }
    return chunks;
  };

  /**
   * Check if position is within tree's chunk bounds
   */
  const isInTreeChunks = (tree: PlantedTree, x: number, z: number): boolean => {
    const treeChunks = getCachedTreeChunks(tree);
    const ck = chunkKey(x, z);
    return treeChunks.has(ck);
  };

  /**
   * Get a random position within tree bounds for navigation (targeting tree blocks)
   */
  const getRandomTreePosition = (tree: PlantedTree, tier: number): { x: number; y: number; z: number } => {
    const tierMap = treeBlocksByTierRef.current?.get(tier);
    if (tierMap && tierMap.size > 0) {
      // Pick a random tree block position as destination
      const keys = [...tierMap.keys()];
      const randomKey = keys[Math.floor(Math.random() * keys.length)];
      const [x, y, z] = randomKey.split(',').map(Number);
      return { x, y, z };
    }
    
    // Fallback to random bounds position
    const b = treeBounds(tree);
    return {
      x: Math.floor(Math.random() * (b.maxX - b.minX + 1)) + b.minX,
      y: Math.floor(Math.random() * (b.maxY - b.minY + 1)) + b.minY,
      z: Math.floor(Math.random() * (b.maxZ - b.minZ + 1)) + b.minZ,
    };
  };

  /**
   * Check if shnake has reached its destination (within 2 blocks)
   */
  const hasReachedDestination = (head: { x: number; y: number; z: number }, dest: ShnakeNavState): boolean => {
    const dist = Math.abs(head.x - dest.destinationX) + Math.abs(head.y - dest.destinationY) + Math.abs(head.z - dest.destinationZ);
    return dist <= 2;
  };

  /** Mark shnake as attacked (so it can descend to ground to chase) */
  const markAttacked = (shnakeId: string) => {
    const state = navStateRef.current.get(shnakeId);
    if (state) {
      state.wasAttacked = true;
      state.attackedAt = performance.now();
    }
  };

  // Expose markAttacked through a global (hacky but works for now)
  (window as any).__markShnakeAttacked = markAttacked;

  useEffect(() => {
    // When AI controls movement, legacy loop is disabled
    if (!isEnabled || aiControlled) return;

    let raf: number;
    let lastTime = performance.now();
    let debugLogTimer = 0;

    const step = () => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      debugLogTimer += dt;

      if (!cameraRef.current) {
        raf = requestAnimationFrame(step);
        return;
      }

      tmpPlayer.current.copy(cameraRef.current.position);
      const playerChunk = chunkKey(tmpPlayer.current.x, tmpPlayer.current.z);

      const trees = treesRef.current || [];
      if (!trees.length || shnakesRef.current.length === 0) {
        raf = requestAnimationFrame(step);
        return;
      }

      const treeById = new Map(trees.map(t => [t.id, t] as const));

      for (const s of shnakesRef.current) {
        if (!s.isActive) continue;
        const tree = treeById.get(s.treeId);
        if (!tree) continue;

        const px = tmpPlayer.current.x;
        const py = tmpPlayer.current.y;
        const pz = tmpPlayer.current.z;
        const treeChunks = getCachedTreeChunks(tree);
        const playerInTreeChunks = treeChunks.has(playerChunk);
        
        // Get or create nav state
        let navState = navStateRef.current.get(s.id);
        if (!navState) {
          const dest = getRandomTreePosition(tree, s.tier);
          navState = {
            destinationX: dest.x,
            destinationY: dest.y,
            destinationZ: dest.z,
            wasAttacked: false,
            attackedAt: 0,
          };
          navStateRef.current.set(s.id, navState);
        }

        const headSeg = s.segments[0];
        const distToPlayer = Math.sqrt(
          Math.pow(px - headSeg.x, 2) + 
          Math.pow(py - headSeg.y, 2) + 
          Math.pow(pz - headSeg.z, 2)
        );
        
        // Attack timeout - reset wasAttacked after 30 seconds
        if (navState.wasAttacked && now - navState.attackedAt > 30000) {
          navState.wasAttacked = false;
        }

        // Determine behavior:
        // - If player in tree chunks -> chase player
        // - If attacked and player in tree chunks -> can descend to ground
        // - Always must stay within tree's chunks
        const shouldChase = playerInTreeChunks;
        const canGoToGround = navState.wasAttacked && playerInTreeChunks;

        // Attack if adjacent (within tree chunks only)
        const head = s.segments[0];
        const dxp = (head.x + 0.5) - px;
        const dyp = (head.y + 0.5) - py;
        const dzp = (head.z + 0.5) - pz;
        const distSq = dxp * dxp + dyp * dyp + dzp * dzp;
        if (distSq < 1.5 * 1.5 && playerInTreeChunks) {
          const cooldown = 600; // ms
          if (now - s.lastAttackAt > cooldown) {
            s.lastAttackAt = now;
            tmpDir.current.set(-dxp, -dyp, -dzp).normalize();
            onPlayerHit?.(s.definition.damage_per_hit, s.definition.knockback, tmpDir.current);
          }
        }

        // Movement accumulator
        s.moveAcc += dt * (s.definition.speed || 2);
        const steps = Math.floor(s.moveAcc);
        if (steps <= 0) continue;
        s.moveAcc -= steps;

        // Check if reached destination - pick new one
        if (!shouldChase && hasReachedDestination(headSeg, navState)) {
          const dest = getRandomTreePosition(tree, s.tier);
          navState.destinationX = dest.x;
          navState.destinationY = dest.y;
          navState.destinationZ = dest.z;
        }

        // Debug log every 2 seconds (guarded for FPS)
        if (DEBUG_SHNAKE && debugLogTimer > 2) {
          const mode = shouldChase ? 'CHASE' : 'WANDER';
          console.log(`[Shnake ${s.id.slice(-6)}] ${mode} segs=${s.segments.length} dist=${distToPlayer.toFixed(1)} canGround=${canGoToGround}`);
        }

        for (let si = 0; si < steps; si++) {
          const headSeg = s.segments[0];
          const length = s.segments.length;
          const tail = s.segments[length - 1];
          const occupied = new Set<string>(s.segments.map(seg => key(seg.x, seg.y, seg.z)));

          // Allow moving into current tail cell because it vacates this step
          occupied.delete(key(tail.x, tail.y, tail.z));

          const candidates = [
            [1, 0, 0], [-1, 0, 0],
            [0, 0, 1], [0, 0, -1],
            [0, 1, 0], [0, -1, 0],
          ] as const;

          // Determine target position
          let targetX: number, targetY: number, targetZ: number;
          if (shouldChase) {
            targetX = Math.floor(px);
            targetY = Math.floor(py);
            targetZ = Math.floor(pz);
          } else {
            targetX = navState.destinationX;
            targetY = navState.destinationY;
            targetZ = navState.destinationZ;
          }

          const scored: Array<{ dx: number; dy: number; dz: number; score: number }> = [];
          
          for (const [dx, dy, dz] of candidates) {
            const nx = headSeg.x + dx;
            const ny = headSeg.y + dy;
            const nz = headSeg.z + dz;
            
            // CHUNK CONSTRAINT: Must stay within tree's chunks
            if (!isInTreeChunks(tree, nx, nz)) continue;
            
            // GROUND CONSTRAINT: Only allowed at y=0 or below if attacked and chasing
            if (ny < 0 && !canGoToGround) continue;
            if (ny < -1) continue; // Never below -1 (ground level)
            
            const k = key(nx, ny, nz);
            if (occupied.has(k)) continue;
            if (isWorldOccupied(nx, ny, nz)) continue;
            
            // TREE CONNECTION CONSTRAINT: At least one segment must touch tree after move
            // Check if new head would touch, or if any remaining body segment touches
            const newHeadTouchesTree = isTouchingTree(s.tier, nx, ny, nz);
            const anyBodyTouchesTree = s.segments.slice(0, -1).some(
              seg => isTouchingTree(s.tier, seg.x, seg.y, seg.z)
            );
            
            // When wandering: must always stay connected to tree
            // When chasing on ground after attack: can temporarily leave tree vicinity
            if (!canGoToGround) {
              if (!newHeadTouchesTree && !anyBodyTouchesTree) continue;
            }
            
            // Score: Manhattan distance to target (lower = better)
            const score = Math.abs(nx - targetX) + Math.abs(ny - targetY) + Math.abs(nz - targetZ);
            scored.push({ dx, dy, dz, score });
          }

          if (scored.length === 0) {
            // Stuck - try to find any valid move that maintains tree connection
            for (const [dx, dy, dz] of candidates) {
              const nx = headSeg.x + dx;
              const ny = headSeg.y + dy;
              const nz = headSeg.z + dz;
              
              // Must stay in chunks
              if (!isInTreeChunks(tree, nx, nz)) continue;
              if (ny < 0) continue;
              
              const k = key(nx, ny, nz);
              if (occupied.has(k)) continue;
              if (isWorldOccupied(nx, ny, nz)) continue;
              
              // Must touch tree
              const newHeadTouchesTree = isTouchingTree(s.tier, nx, ny, nz);
              const anyBodyTouchesTree = s.segments.slice(0, -1).some(
                seg => isTouchingTree(s.tier, seg.x, seg.y, seg.z)
              );
              if (!newHeadTouchesTree && !anyBodyTouchesTree) continue;
              
              scored.push({ dx, dy, dz, score: Math.random() * 100 });
            }
          }

          // BACKTRACK: If still stuck, allow head to move INTO a body segment 
          // (causes the shnake to "fold" back on itself to escape dead ends)
          if (scored.length === 0 && s.segments.length > 2) {
            // Try to move toward segment[1] position - this "reverses" the shnake
            const seg1 = s.segments[1];
            for (const [dx, dy, dz] of candidates) {
              const nx = headSeg.x + dx;
              const ny = headSeg.y + dy;
              const nz = headSeg.z + dz;
              
              // Only allow backtracking to segment[1] specifically
              if (nx !== seg1.x || ny !== seg1.y || nz !== seg1.z) continue;
              
              // Must stay in tree chunks
              if (!isInTreeChunks(tree, nx, nz)) continue;
              
              // For backtrack, we're "absorbing" seg1, so check if resulting body still touches tree
              const remainingBody = s.segments.slice(2, -1);
              const anyRemainingTouchesTree = remainingBody.some(
                seg => isTouchingTree(s.tier, seg.x, seg.y, seg.z)
              );
              const headTouchesTree = isTouchingTree(s.tier, nx, ny, nz);
              
              if (headTouchesTree || anyRemainingTouchesTree || remainingBody.length === 0) {
                // Valid backtrack - move head to seg1 position, effectively "shrinking" temporarily
                scored.push({ dx, dy, dz, score: 1000 }); // Low priority but valid
                break;
              }
            }
          }

          if (scored.length === 0) {
            // Truly stuck - pick new destination and wait for next tick
            const dest = getRandomTreePosition(tree, s.tier);
            navState.destinationX = dest.x;
            navState.destinationY = dest.y;
            navState.destinationZ = dest.z;
            break;
          }

          // Sort by score (lower is better for chasing, random otherwise)
          scored.sort((a, b) => a.score - b.score);
          
          // Add some randomness to top choices to prevent linear movement
          const topN = Math.min(3, scored.length);
          const choice = scored[Math.floor(Math.random() * topN)];

          const newHead = { x: headSeg.x + choice.dx, y: headSeg.y + choice.dy, z: headSeg.z + choice.dz };
          s.headDir.set(choice.dx, choice.dy, choice.dz);

          // Update entity collision grid: remove tail collider, insert new head collider
          const oldTailCollider = s.colliders[s.colliders.length - 1];
          if (oldTailCollider) entityCollisionGrid.remove(oldTailCollider);
          const newHeadCollider = aabbForCell(newHead.x, newHead.y, newHead.z);
          entityCollisionGrid.insert(newHeadCollider);

          // Shift arrays (worm)
          const newSegments = [newHead, ...s.segments.slice(0, -1)];
          const newColliders = [newHeadCollider, ...s.colliders.slice(0, -1)];
          s.segments = newSegments;
          s.colliders = newColliders;
          
          // Notify that head moved (for fire propagation)
          onHeadMoved?.(s.id);
        }
      }

      // Reset debug timer
      if (debugLogTimer > 2) debugLogTimer = 0;

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [
    isEnabled,
    aiControlled,
    cameraRef,
    shnakesRef,
    blocksRef,
    treeBlocksByTierRef,
    nonInvisTreeBlocksByTierRef,
    onPlayerHit,
    onHeadMoved,
  ]);
}
