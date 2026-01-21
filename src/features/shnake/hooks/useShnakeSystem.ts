import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PlantedTree } from '@/features/trees/types';
import { decodeBlockType, getBaseTreeBlockType, isTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';
import { collisionGrid } from '@/lib/spatialHashGrid';
import type { ShnakeDefinition, ShnakeInstance, ShnakeSegment } from '../types';

const LENGTH_BASE = 10; // length = 10 + tier

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
  // These heuristics match the tree chopping bounds approach.
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

function insideBounds(b: ReturnType<typeof treeBounds>, x: number, y: number, z: number) {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ;
}

interface UseShnakeSystemOptions {
  definitions: ShnakeDefinition[] | undefined;
  plantedTrees: PlantedTree[] | undefined;
  blocksRef: React.RefObject<{ position_x: number; position_y: number; position_z: number; block_type?: string }[]>;
  isEnabled: boolean;
}

/**
 * Manages shnake spawning + lifecycle.
 * Movement + targeting happens in useShnakeMovement.
 */
export function useShnakeSystem({
  definitions,
  plantedTrees,
  blocksRef,
  isEnabled,
}: UseShnakeSystemOptions) {
  const [shnakes, setShnakes] = useState<ShnakeInstance[]>([]);
  const shnakesRef = useRef<ShnakeInstance[]>([]);
  const treesRef = useRef<PlantedTree[] | undefined>(plantedTrees);
  treesRef.current = plantedTrees;

  useEffect(() => {
    shnakesRef.current = shnakes;
  }, [shnakes]);

  const defsByTier = useMemo(() => {
    const m = new Map<number, ShnakeDefinition>();
    (definitions ?? []).forEach(d => m.set(d.tier, d));
    return m;
  }, [definitions]);

  /** Global per-tier tree block index for movement cling checks */
  const treeBlocksByTierRef = useRef<Map<number, Map<string, string>>>(new Map());
  const nonInvisTreeBlocksByTierRef = useRef<Map<number, Set<string>>>(new Map());

  // Rebuild global tree-block position indices periodically (cheap, avoids per-move scans)
  useEffect(() => {
    if (!isEnabled) return;
    let timer: number | null = null;

    const rebuild = () => {
      const blocks = blocksRef.current || [];
      const byTier = new Map<number, Map<string, string>>();
      const nonInvisByTier = new Map<number, Set<string>>();

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i] as any;
        const bt = b.block_type as string | undefined;
        if (!bt || !isTreeBlockType(bt)) continue;
        const decoded = decodeBlockType(bt);
        if (!decoded) continue;
        const tier = decoded.tier;
        const baseType = getBaseTreeBlockType(bt) || decoded.type;
        let tierMap = byTier.get(tier);
        if (!tierMap) {
          tierMap = new Map();
          byTier.set(tier, tierMap);
        }
        tierMap.set(key(b.position_x, b.position_y, b.position_z), baseType);
        if (baseType !== 'invisiblock') {
          let s = nonInvisByTier.get(tier);
          if (!s) {
            s = new Set();
            nonInvisByTier.set(tier, s);
          }
          s.add(key(b.position_x, b.position_y, b.position_z));
        }
      }

      treeBlocksByTierRef.current = byTier;
      nonInvisTreeBlocksByTierRef.current = nonInvisByTier;
    };

    rebuild();
    timer = window.setInterval(rebuild, 1000);
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [isEnabled, blocksRef]);

  const countShnakesOnTree = useCallback((treeId: string) => {
    return shnakesRef.current.filter(s => s.isActive && s.treeId === treeId).length;
  }, []);

  const isCellOccupiedByWorld = useCallback((x: number, y: number, z: number) => {
    const blocks = blocksRef.current || [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.position_x === x && b.position_y === y && b.position_z === z) return true;
    }
    return false;
  }, [blocksRef]);

  const spawnOnTree = useCallback((tree: PlantedTree): ShnakeInstance | null => {
    const tier = (tree as any).seed_tier ?? tree.seed_definition?.tier ?? 1;
    const def = defsByTier.get(tier);
    if (!def) return null;

    const len = LENGTH_BASE + tier;
    const b = treeBounds(tree);

    // Build trunk column candidates (same x/z as base, any y)
    const blocks = blocksRef.current || [];
    const trunkYs: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const bl: any = blocks[i];
      if (bl.position_x !== tree.base_x || bl.position_z !== tree.base_z) continue;
      const bt: string | undefined = bl.block_type;
      if (!bt || !isTreeBlockType(bt)) continue;
      const decoded = decodeBlockType(bt);
      if (!decoded || decoded.tier !== tier) continue;
      const baseType = getBaseTreeBlockType(bt);
      if (baseType !== 'trunk') continue;
      if (bl.position_y >= tree.base_y) trunkYs.push(bl.position_y);
    }
    if (trunkYs.length === 0) return null;
    trunkYs.sort((a, b) => a - b);

    // pick a spawn y somewhere above base
    const spawnY = trunkYs[Math.floor(Math.random() * trunkYs.length)];

    // Choose an initial head cell adjacent to trunk
    const candidates: Array<[number, number, number]> = [
      [tree.base_x + 1, spawnY, tree.base_z],
      [tree.base_x - 1, spawnY, tree.base_z],
      [tree.base_x, spawnY, tree.base_z + 1],
      [tree.base_x, spawnY, tree.base_z - 1],
      [tree.base_x, spawnY + 1, tree.base_z],
    ];

    let head: ShnakeSegment | null = null;
    for (const [x, y, z] of candidates) {
      const gx = Math.floor(x);
      const gy = Math.floor(y);
      const gz = Math.floor(z);
      if (!insideBounds(b, gx, gy, gz)) continue;
      if (isCellOccupiedByWorld(gx, gy, gz)) continue;
      head = { x: gx, y: gy, z: gz };
      break;
    }
    if (!head) return null;

    // Extend segments along -Y (downward) if possible; otherwise along +Y
    const segments: ShnakeSegment[] = [head];
    const dirOptions: Array<[number, number, number]> = [
      [0, -1, 0],
      [0, 1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];

    const occupied = new Set<string>([key(head.x, head.y, head.z)]);
    for (let i = 1; i < len; i++) {
      const prev = segments[i - 1];
      let placed = false;
      for (const [dx, dy, dz] of dirOptions) {
        const nx = prev.x + dx;
        const ny = prev.y + dy;
        const nz = prev.z + dz;
        const k = key(nx, ny, nz);
        if (occupied.has(k)) continue;
        if (!insideBounds(b, nx, ny, nz)) continue;
        if (isCellOccupiedByWorld(nx, ny, nz)) continue;
        segments.push({ x: nx, y: ny, z: nz });
        occupied.add(k);
        placed = true;
        break;
      }
      if (!placed) return null; // no space
    }

    const id = `shnake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const colliders = segments.map(s => aabbForCell(s.x, s.y, s.z));
    colliders.forEach(c => collisionGrid.insert(c));

    const inst: ShnakeInstance = {
      id,
      treeId: tree.id,
      tier,
      definition: def,
      segments,
      headHealth: def.health_per_segment,
      headDir: new THREE.Vector3(0, 0, 1),
      moveAcc: 0,
      lastAttackAt: 0,
      colliders,
      isActive: true,
    };

    shnakesRef.current = [...shnakesRef.current, inst];
    setShnakes(shnakesRef.current);
    return inst;
  }, [blocksRef, defsByTier, isCellOccupiedByWorld]);

  // Spawn loop: per minute per tree, based on definition.spawn_chance_per_minute
  useEffect(() => {
    if (!isEnabled) return;
    const t = window.setInterval(() => {
      const trees = treesRef.current || [];
      if (!trees.length) return;

      for (const tree of trees) {
        const tier = (tree as any).seed_tier ?? tree.seed_definition?.tier ?? 1;
        const def = defsByTier.get(tier);
        if (!def) continue;
        const currentCount = countShnakesOnTree(tree.id);
        if (currentCount >= def.max_spawn_per_tree) continue;
        const chance = (def.spawn_chance_per_minute ?? 1.0) / 100;
        if (Math.random() < chance) {
          spawnOnTree(tree);
        }
      }
    }, 60_000);
    return () => window.clearInterval(t);
  }, [isEnabled, defsByTier, countShnakesOnTree, spawnOnTree]);

  const removeShnake = useCallback((id: string) => {
    const current = shnakesRef.current;
    const target = current.find(s => s.id === id);
    if (target) {
      target.colliders.forEach(c => collisionGrid.remove(c));
    }
    shnakesRef.current = current.filter(s => s.id !== id);
    setShnakes(shnakesRef.current);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const current = shnakesRef.current;
      for (const s of current) {
        for (const c of s.colliders) collisionGrid.remove(c);
      }
      shnakesRef.current = [];
      setShnakes([]);
    };
  }, []);

  /**
   * Damage head only.
   * Returns { killedHead, killedEntire }
   */
  const damageHead = useCallback((shnakeId: string, damage: number) => {
    let killedHead = false;
    let killedEntire = false;

    const updated = shnakesRef.current.map(s => {
      if (s.id !== shnakeId || !s.isActive) return s;
      const armor = s.definition.armor ?? 0;
      const actual = Math.max(0, damage - armor);
      const newHealth = s.headHealth - actual;
      if (newHealth > 0) {
        return { ...s, headHealth: newHealth };
      }

      // head killed: remove segment[0]
      killedHead = true;
      const newSegments = s.segments.slice(1);
      const newColliders = s.colliders.slice(1);

      // Remove old head collider from collision grid
      if (s.colliders[0]) collisionGrid.remove(s.colliders[0]);

      if (newSegments.length === 0) {
        killedEntire = true;
        // Remove remaining colliders too
        newColliders.forEach(c => collisionGrid.remove(c));
        return { ...s, isActive: false, segments: [], colliders: [], headHealth: 0 };
      }

      return {
        ...s,
        segments: newSegments,
        colliders: newColliders,
        headHealth: s.definition.health_per_segment,
      };
    });

    shnakesRef.current = updated;
    setShnakes(updated);
    if (killedEntire) {
      // hard remove after state update so renderer can play 1-frame death if needed
      setTimeout(() => removeShnake(shnakeId), 0);
    }
    return { killedHead, killedEntire };
  }, [removeShnake]);

  const getTreeBlockIndexRefs = useCallback(() => {
    return {
      treeBlocksByTierRef,
      nonInvisTreeBlocksByTierRef,
    };
  }, []);

  return {
    shnakes,
    shnakesRef,
    removeShnake,
    damageHead,
    getTreeBlockIndexRefs,
  };
}
