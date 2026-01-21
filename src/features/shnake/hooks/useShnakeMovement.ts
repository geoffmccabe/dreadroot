import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { PlantedTree } from '@/features/trees/types';
import { collisionGrid } from '@/lib/spatialHashGrid';
import type { ShnakeInstance } from '../types';

function key(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
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

function inside(b: ReturnType<typeof treeBounds>, x: number, y: number, z: number) {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ;
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

  const isClingable = (tier: number, x: number, y: number, z: number) => {
    const tierMap = treeBlocksByTierRef.current?.get(tier);
    if (!tierMap) return false;

    // Check 6 neighbors
    const neighbors = [
      key(x + 1, y, z), key(x - 1, y, z),
      key(x, y + 1, z), key(x, y - 1, z),
      key(x, y, z + 1), key(x, y, z - 1),
    ];

    let hasNeighbor = false;
    let hasNonInvisNearby = false;
    const nonInvis = nonInvisTreeBlocksByTierRef.current?.get(tier);

    for (const nk of neighbors) {
      if (tierMap.has(nk)) {
        hasNeighbor = true;
        const bt = tierMap.get(nk);
        if (bt !== 'invisiblock') {
          hasNonInvisNearby = true;
          break;
        }
      }
    }

    if (!hasNeighbor) return false;
    if (hasNonInvisNearby) return true;

    // Adjacent only to invisiblocks => check if there's a non-invis within 2 Manhattan
    if (!nonInvis) return false;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
          if (nonInvis.has(key(x + dx, y + dy, z + dz))) return true;
        }
      }
    }
    return false;
  };

  useEffect(() => {
    if (!isEnabled) return;

    let raf: number;
    let lastTime = performance.now();

    const step = () => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (!cameraRef.current) {
        raf = requestAnimationFrame(step);
        return;
      }

      tmpPlayer.current.copy(cameraRef.current.position);

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

        const b = treeBounds(tree);
        // Shnake always pursues player - no longer restricted to tree bounds
        const px = tmpPlayer.current.x;
        const py = tmpPlayer.current.y;
        const pz = tmpPlayer.current.z;

        // Attack if adjacent
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

        // Movement accumulator
        s.moveAcc += dt * (s.definition.speed || 1);
        const steps = Math.floor(s.moveAcc);
        if (steps <= 0) continue;
        s.moveAcc -= steps;

        for (let si = 0; si < steps; si++) {
          const headSeg = s.segments[0];
          const length = s.segments.length;
          const tail = s.segments[length - 1];
          const occupied = new Set<string>(s.segments.map(seg => key(seg.x, seg.y, seg.z)));

          // Allow moving into current tail cell because it vacates this step
          occupied.delete(key(tail.x, tail.y, tail.z));

          const tx = Math.floor(px);
          const ty = Math.floor(py);
          const tz = Math.floor(pz);

          const candidates = [
            [1, 0, 0], [-1, 0, 0],
            [0, 0, 1], [0, 0, -1],
            [0, 1, 0], [0, -1, 0],
          ] as const;

          // Sort by heuristic (distance reduction)
          const scored: Array<{ dx: number; dy: number; dz: number; score: number }> = [];
          for (const [dx, dy, dz] of candidates) {
            const nx = headSeg.x + dx;
            const ny = headSeg.y + dy;
            const nz = headSeg.z + dz;
            if (!inside(b, nx, ny, nz)) continue;
            const k = key(nx, ny, nz);
            if (occupied.has(k)) continue;
            if (isWorldOccupied(nx, ny, nz)) continue;
            if (!isClingable(s.tier, nx, ny, nz)) continue;
            const dist = Math.abs(nx - tx) + Math.abs(ny - ty) + Math.abs(nz - tz);
            scored.push({ dx, dy, dz, score: dist });
          }

          scored.sort((a, b) => a.score - b.score);
          const choice = scored[0] || null;
          if (!choice) break;

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
