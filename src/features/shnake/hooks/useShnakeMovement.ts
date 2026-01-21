import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { PlantedTree } from '@/features/trees/types';
import { collisionGrid } from '@/lib/spatialHashGrid';
import type { ShnakeInstance } from '../types';

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

interface UseShnakeMovementOptions {
  shnakesRef: React.RefObject<ShnakeInstance[]>;
  cameraRef: React.RefObject<THREE.Camera>;
  plantedTrees: PlantedTree[] | undefined;
  blocksRef: React.RefObject<{ position_x: number; position_y: number; position_z: number }[]>;
  isEnabled: boolean;
  treeBlocksByTierRef: React.RefObject<Map<number, Map<string, string>>>;
  nonInvisTreeBlocksByTierRef: React.RefObject<Map<number, Set<string>>>;
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void;
}

export function useShnakeMovement({
  shnakesRef,
  cameraRef,
  plantedTrees,
  blocksRef,
  isEnabled,
  treeBlocksByTierRef,
  nonInvisTreeBlocksByTierRef,
  onPlayerHit,
}: UseShnakeMovementOptions) {
  const treesRef = useRef(plantedTrees);
  treesRef.current = plantedTrees;

  // Shared temp vectors
  const tmpDir = useRef(new THREE.Vector3());
  const tmpPlayer = useRef(new THREE.Vector3());

  const isWorldOccupied = (x: number, y: number, z: number) => {
    const blocks = blocksRef.current || [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.position_x === x && b.position_y === y && b.position_z === z) return true;
    }
    return false;
  };

  /**
   * Check if position is adjacent to a tree block (including invisiblocks).
   * This is the PRIMARY constraint - shnake must always touch tree.
   */
  const isTouchingTree = (tier: number, x: number, y: number, z: number): boolean => {
    const tierMap = treeBlocksByTierRef.current?.get(tier);
    if (!tierMap) return false;

    // Check 6 neighbors for ANY tree block (including invisiblocks)
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
   * Check if at least one segment in the array would still be touching tree
   * after a potential move. This ensures shnake never completely detaches.
   */
  const wouldStayConnected = (
    tier: number,
    newHead: { x: number; y: number; z: number },
    existingSegments: { x: number; y: number; z: number }[],
  ): boolean => {
    // Check new head position
    if (isTouchingTree(tier, newHead.x, newHead.y, newHead.z)) return true;
    
    // Check all remaining segments (excluding tail which will be removed)
    // After move: [newHead, ...existingSegments.slice(0, -1)]
    for (let i = 0; i < existingSegments.length - 1; i++) {
      const seg = existingSegments[i];
      if (isTouchingTree(tier, seg.x, seg.y, seg.z)) return true;
    }
    
    return false;
  };

  useEffect(() => {
    if (!isEnabled) return;

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

        // Check if player is in any of the tree's chunks
        const treeChunks = getTreeChunkKeys(tree);
        const playerInTreeChunks = treeChunks.has(playerChunk);

        // Attack if adjacent (regardless of chunk)
        const head = s.segments[0];
        const dxp = (head.x + 0.5) - px;
        const dyp = (head.y + 0.5) - py;
        const dzp = (head.z + 0.5) - pz;
        const distSq = dxp * dxp + dyp * dyp + dzp * dzp;
        if (distSq < 1.2 * 1.2) {
          const cooldown = 600; // ms
          if (now - s.lastAttackAt > cooldown) {
            s.lastAttackAt = now;
            tmpDir.current.set(-dxp, -dyp, -dzp).normalize();
            onPlayerHit?.(s.definition.damage_per_hit, s.definition.knockback, tmpDir.current);
          }
        }

        // Movement accumulator - ALWAYS accumulate, shnakes always move
        s.moveAcc += dt * (s.definition.speed || 2);
        const steps = Math.floor(s.moveAcc);
        if (steps <= 0) continue;
        s.moveAcc -= steps;

        // Debug log every 2 seconds
        if (debugLogTimer > 2) {
          console.log(`[Shnake Move] id=${s.id.slice(-6)} steps=${steps} segments=${s.segments.length} playerInChunks=${playerInTreeChunks}`);
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

          const scored: Array<{ dx: number; dy: number; dz: number; score: number }> = [];
          
          for (const [dx, dy, dz] of candidates) {
            const nx = headSeg.x + dx;
            const ny = headSeg.y + dy;
            const nz = headSeg.z + dz;
            
            const k = key(nx, ny, nz);
            if (occupied.has(k)) continue;
            if (isWorldOccupied(nx, ny, nz)) continue;
            
            // CRITICAL: Check if this move would keep shnake connected to tree
            const newHead = { x: nx, y: ny, z: nz };
            if (!wouldStayConnected(s.tier, newHead, s.segments)) {
              continue;
            }
            
            let score: number;
            if (playerInTreeChunks) {
              // Move toward player
              const tx = Math.floor(px);
              const ty = Math.floor(py);
              const tz = Math.floor(pz);
              score = Math.abs(nx - tx) + Math.abs(ny - ty) + Math.abs(nz - tz);
            } else {
              // Random movement when no player nearby
              score = Math.random() * 100;
            }
            
            scored.push({ dx, dy, dz, score });
          }

          // Sort by score (lower is better)
          scored.sort((a, b) => a.score - b.score);
          
          let choice: { dx: number; dy: number; dz: number } | null = scored[0] || null;
          
          // BACKTRACK LOGIC: If stuck, try to bend back towards second segment with offset
          if (!choice && length >= 2) {
            const secondSeg = s.segments[1];
            // Try moving towards segment[1] position but offset by 1 on each axis
            const backtrackCandidates: Array<{ dx: number; dy: number; dz: number }> = [];
            
            // Calculate direction from head to second segment
            const toDx = secondSeg.x - headSeg.x;
            const toDy = secondSeg.y - headSeg.y;
            const toDz = secondSeg.z - headSeg.z;
            
            // Generate offset positions - move toward second segment but offset perpendicular
            for (const [ox, oy, oz] of candidates) {
              // Skip if this is the exact direction to second segment (would collide)
              if (ox === toDx && oy === toDy && oz === toDz) continue;
              
              const nx = headSeg.x + ox;
              const ny = headSeg.y + oy;
              const nz = headSeg.z + oz;
              const k = key(nx, ny, nz);
              
              // For backtracking, allow moving into any segment position except head
              // This lets the snake "fold" back on itself temporarily
              if (k === key(headSeg.x, headSeg.y, headSeg.z)) continue;
              if (isWorldOccupied(nx, ny, nz)) continue;
              
              // Relaxed tree connection for backtracking - just need to touch tree OR be near body
              const newHead = { x: nx, y: ny, z: nz };
              const touchesTree = isTouchingTree(s.tier, nx, ny, nz);
              const nearBody = s.segments.some((seg, idx) => {
                if (idx === 0) return false; // skip head
                const dist = Math.abs(seg.x - nx) + Math.abs(seg.y - ny) + Math.abs(seg.z - nz);
                return dist <= 1;
              });
              
              if (touchesTree || nearBody) {
                backtrackCandidates.push({ dx: ox, dy: oy, dz: oz });
              }
            }
            
            if (backtrackCandidates.length > 0) {
              // Pick random backtrack direction
              choice = backtrackCandidates[Math.floor(Math.random() * backtrackCandidates.length)];
              if (debugLogTimer > 2) {
                console.log(`[Shnake Move] Backtracking: chose (${choice.dx}, ${choice.dy}, ${choice.dz})`);
              }
            }
          }
          
          if (!choice) {
            if (debugLogTimer > 2) {
              console.log(`[Shnake Move] No valid move found for shnake at (${headSeg.x}, ${headSeg.y}, ${headSeg.z}) - truly stuck`);
            }
            break;
          }

          const newHead = { x: headSeg.x + choice.dx, y: headSeg.y + choice.dy, z: headSeg.z + choice.dz };
          s.headDir.set(choice.dx, choice.dy, choice.dz);

          // Update collision grid: remove tail collider, insert new head collider
          const oldTailCollider = s.colliders[s.colliders.length - 1];
          if (oldTailCollider) collisionGrid.remove(oldTailCollider);
          const newHeadCollider = aabbForCell(newHead.x, newHead.y, newHead.z);
          collisionGrid.insert(newHeadCollider);

          // Shift arrays (worm)
          const newSegments = [newHead, ...s.segments.slice(0, -1)];
          const newColliders = [newHeadCollider, ...s.colliders.slice(0, -1)];
          s.segments = newSegments;
          s.colliders = newColliders;
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
    cameraRef,
    shnakesRef,
    blocksRef,
    treeBlocksByTierRef,
    nonInvisTreeBlocksByTierRef,
    onPlayerHit,
  ]);
}
