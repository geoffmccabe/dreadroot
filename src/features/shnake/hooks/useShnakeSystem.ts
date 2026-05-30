import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PlantedTree } from '@/features/trees/types';
import { decodeBlockType, getBaseTreeBlockType, isTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';
import { entityCollisionGrid, numPosKey } from '@/lib/spatialHashGrid';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import type { ShnakeDefinition, ShnakeInstance, ShnakeSegment } from '../types';

// Debug flag - disable in production for FPS
const DEBUG_SHNAKE = false;

const LENGTH_BASE = 2; // length = 2 + tier
const CHUNK_SIZE = 16;
const SPAWN_COOLDOWN_MS = 30000; // 30 second cooldown after failed spawn
const REBUILD_INTERVAL_MS = 5000; // Rebuild index every 5 seconds (was 1s)

const key = numPosKey;

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

function insideBounds(b: ReturnType<typeof treeBounds>, x: number, y: number, z: number) {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ;
}

/** Get all chunk keys that a tree spans */
function getTreeChunkKeys(tree: PlantedTree): Set<string> {
  const b = treeBounds(tree);
  const chunks = new Set<string>();
  for (let x = b.minX; x <= b.maxX; x++) {
    for (let z = b.minZ; z <= b.maxZ; z++) {
      chunks.add(chunkKey(x, z));
    }
  }
  return chunks;
}

interface UseShnakeSystemOptions {
  definitions: ShnakeDefinition[] | undefined;
  plantedTrees: PlantedTree[] | undefined;
  blocksRef: React.RefObject<{ position_x: number; position_y: number; position_z: number; block_type?: string }[]>;
  isEnabled: boolean;
  playerChunkRef?: React.RefObject<string>;
}

/**
 * Manages shnake spawning + lifecycle.
 * Guarantees one shnake per tree at all times.
 */
export function useShnakeSystem({
  definitions,
  plantedTrees,
  blocksRef,
  isEnabled,
  playerChunkRef,
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

  // Create a stable key from texture URLs for comparison
  const defKey = useCallback((d: ShnakeDefinition) => 
    `${d.head_texture_url || ''}|${d.body_texture_url || ''}|${d.face_texture_url || ''}`,
  []);

  // Keep shnake definitions in sync with database - enables immediate texture updates
  useEffect(() => {
    if (!definitions || definitions.length === 0) return;
    
    let updated = false;
    const newShnakes = shnakesRef.current.map(shnake => {
      const latestDef = defsByTier.get(shnake.tier);
      // Compare by texture URL content, not object reference
      if (latestDef && defKey(latestDef) !== defKey(shnake.definition)) {
        updated = true;
        return { ...shnake, definition: latestDef };
      }
      return shnake;
    });
    
    if (updated) {
      shnakesRef.current = newShnakes;
      setShnakes(newShnakes);
    }
  }, [definitions, defsByTier, defKey]);

  /** Global per-tier tree block index for movement cling checks */
  const treeBlocksByTierRef = useRef<Map<number, Map<number, string>>>(new Map());
  const nonInvisTreeBlocksByTierRef = useRef<Map<number, Set<number>>>(new Map());
  /** All tree block positions by tier for spawn adjacency check */
  const allTreeBlockPositionsByTierRef = useRef<Map<number, Set<number>>>(new Map());
  /** O(1) world occupancy check - rebuilt with tree block indices */
  const worldOccupiedSetRef = useRef<Set<number>>(new Set());
  /** Failed spawn tracking for cooldown */
  const failedSpawnAttemptsRef = useRef<Map<string, number>>(new Map());
  /** Last block count for change detection */
  const lastBlockCountRef = useRef(0);

  // Rebuild global tree-block position indices periodically
  // OPTIMIZATION: 5 second interval with change detection
  useEffect(() => {
    if (!isEnabled) return;
    let timer: number | null = null;

    const rebuild = () => {
      const blocks = blocksRef.current || [];
      
      // Skip rebuild if block count unchanged
      if (blocks.length === lastBlockCountRef.current) return;
      lastBlockCountRef.current = blocks.length;
      
      const byTier = new Map<number, Map<number, string>>();
      const nonInvisByTier = new Map<number, Set<number>>();
      const allPosByTier = new Map<number, Set<number>>();
      const occupied = new Set<number>();

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i] as any;
        
        // Add ALL blocks to occupancy set for O(1) lookups
        occupied.add(key(b.position_x, b.position_y, b.position_z));
        
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
        const posKey = key(b.position_x, b.position_y, b.position_z);
        tierMap.set(posKey, baseType);
        
        // Track all positions for spawn adjacency
        let allPos = allPosByTier.get(tier);
        if (!allPos) {
          allPos = new Set();
          allPosByTier.set(tier, allPos);
        }
        allPos.add(posKey);
        
        if (baseType !== 'invisiblock') {
          let s = nonInvisByTier.get(tier);
          if (!s) {
            s = new Set();
            nonInvisByTier.set(tier, s);
          }
          s.add(posKey);
        }
      }

      treeBlocksByTierRef.current = byTier;
      nonInvisTreeBlocksByTierRef.current = nonInvisByTier;
      allTreeBlockPositionsByTierRef.current = allPosByTier;
      worldOccupiedSetRef.current = occupied;
    };

    rebuild();
    timer = window.setInterval(rebuild, REBUILD_INTERVAL_MS);
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [isEnabled, blocksRef]);

  const countShnakesOnTree = useCallback((treeId: string) => {
    return shnakesRef.current.filter(s => s.isActive && s.treeId === treeId).length;
  }, []);

  // O(1) occupancy check using prebuilt Set
  const isCellOccupiedByWorld = useCallback((x: number, y: number, z: number) => {
    return worldOccupiedSetRef.current.has(key(x, y, z));
  }, []);

  /** Check if a cell is adjacent to any tree block of this tier */
  const isAdjacentToTreeBlock = useCallback((tier: number, x: number, y: number, z: number) => {
    const positions = allTreeBlockPositionsByTierRef.current.get(tier);
    if (!positions) return false;
    
    const neighbors = [
      key(x + 1, y, z), key(x - 1, y, z),
      key(x, y + 1, z), key(x, y - 1, z),
      key(x, y, z + 1), key(x, y, z - 1),
    ];
    
    return neighbors.some(n => positions.has(n));
  }, []);

  const spawnOnTree = useCallback((tree: PlantedTree): ShnakeInstance | null => {
    // Skip fungal trees - shnakes only spawn on ordinary trees
    if (tree.seed_definition?.tree_type === 'fungal') return null;

    const tier = (tree as any).seed_tier ?? tree.seed_definition?.tier ?? 1;
    const def = defsByTier.get(tier);

    if (!def) {
      if (DEBUG_SHNAKE) console.log(`[Shnake Spawn] No definition found for tier ${tier}`);
      return null;
    }
    
    // EARLY EXIT: Check if tier has any tree blocks before expensive iteration
    const tierPositions = allTreeBlockPositionsByTierRef.current.get(tier);
    if (!tierPositions || tierPositions.size === 0) {
      // Don't log - this is a normal case during loading
      return null;
    }

    const len = LENGTH_BASE + tier;
    const b = treeBounds(tree);

    // Use the prebuilt tier positions instead of scanning all blocks
    // Filter to positions within tree bounds
    const treeBlockPositions: Array<{ x: number; y: number; z: number }> = [];
    for (const posKey of tierPositions) {
      const [x, y, z] = posKey.split(',').map(Number);
      if (insideBounds(b, x, y, z)) {
        treeBlockPositions.push({ x, y, z });
      }
    }

    if (treeBlockPositions.length === 0) {
      if (DEBUG_SHNAKE) console.log(`[Shnake Spawn] No tree blocks in bounds for tier ${tier}`);
      return null;
    }

    // Shuffle to randomize spawn location
    for (let i = treeBlockPositions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [treeBlockPositions[i], treeBlockPositions[j]] = [treeBlockPositions[j], treeBlockPositions[i]];
    }

    // Find an empty cell adjacent to any tree block
    let head: ShnakeSegment | null = null;
    const directions = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1],
    ];

    for (const treeBlock of treeBlockPositions) {
      if (head) break;
      for (const [dx, dy, dz] of directions) {
        const nx = treeBlock.x + dx;
        const ny = treeBlock.y + dy;
        const nz = treeBlock.z + dz;
        if (!insideBounds(b, nx, ny, nz)) continue;
        if (isCellOccupiedByWorld(nx, ny, nz)) continue;
        head = { x: nx, y: ny, z: nz };
        break;
      }
    }

    if (!head) {
      if (DEBUG_SHNAKE) console.log(`[Shnake Spawn] No empty adjacent cell found`);
      return null;
    }

    // Extend segments
    const segments: ShnakeSegment[] = [head];
    const occupied = new Set<number>([key(head.x, head.y, head.z)]);
    
    for (let i = 1; i < len; i++) {
      const prev = segments[i - 1];
      let placed = false;
      
      // Shuffle directions for variety
      const shuffledDirs = [...directions].sort(() => Math.random() - 0.5);
      
      for (const [dx, dy, dz] of shuffledDirs) {
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
      if (!placed) {
        // Can't place all segments, but continue with what we have
        break;
      }
    }

    // Need at least 3 segments
    if (segments.length < 3) {
      if (DEBUG_SHNAKE) console.log(`[Shnake Spawn] Only ${segments.length} segments placed, need at least 3`);
      return null;
    }

    if (DEBUG_SHNAKE) console.log(`[Shnake Spawn] Success! ${segments.length} segments at (${head.x}, ${head.y}, ${head.z})`);

    const id = `shnake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const colliders = segments.map(s => {
      const box = aabbForCell(s.x, s.y, s.z);
      // Tag colliders as shnake segments so player can stand on them
      (box as any).isShnakeSegment = true;
      (box as any).shnakeId = id;
      return box;
    });
    colliders.forEach(c => entityCollisionGrid.insert(c));

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
      velocityY: 0, // Start with no vertical velocity
    };

    shnakesRef.current = [...shnakesRef.current, inst];
    setShnakes(shnakesRef.current);
    return inst;
  // Note: blocksRef and isTreeBlockType/decodeBlockType removed from deps - now uses prebuilt indices
  }, [defsByTier, isCellOccupiedByWorld]);

  // GUARANTEED SPAWN: Ensure every tree always has exactly one shnake
  // OPTIMIZATION: Respects cooldown for failed spawns to prevent infinite retry loops
  useEffect(() => {
    if (!isEnabled) return;
    if (!plantedTrees || plantedTrees.length === 0) return;
    if (!definitions || definitions.length === 0) return;

    // Stagger spawn attempts across calls — at most N spawns per tick.
    // Previously this synchronously called spawnOnTree() for every empty
    // tree in one tick, which caused 826ms main-thread blocking when the
    // player walked into new territory and many trees had no shnakes
    // (real-world trace 2026-May-19, Trace-20260519T210931, timerId=2399).
    // Capping at MAX_SPAWNS_PER_TICK means the cost spreads over multiple
    // 3-second ticks; trees not spawned this tick are still iterated next
    // tick (failedSpawnAttempts cooldown handles re-tries naturally).
    const MAX_SPAWNS_PER_TICK = 3;
    const ensureOneShnakePerTree = () => {
      const trees = treesRef.current || [];
      const now = Date.now();
      let spawnedThisTick = 0;

      for (const tree of trees) {
        if (spawnedThisTick >= MAX_SPAWNS_PER_TICK) break;

        // Skip fungal trees - shnakes only spawn on ordinary trees
        if (tree.seed_definition?.tree_type === 'fungal') continue;

        const count = countShnakesOnTree(tree.id);
        if (count === 0) {
          // Check cooldown for this tree
          const lastFail = failedSpawnAttemptsRef.current.get(tree.id) || 0;
          if (now - lastFail < SPAWN_COOLDOWN_MS) {
            continue; // Still in cooldown, skip
          }

          if (DEBUG_SHNAKE) console.log(`[Shnake Ensure] Tree ${tree.id} has no shnake, spawning...`);
          const result = spawnOnTree(tree);
          spawnedThisTick++;

          if (!result) {
            // Spawn failed, set cooldown
            failedSpawnAttemptsRef.current.set(tree.id, now);
          } else {
            // Spawn succeeded, clear cooldown
            failedSpawnAttemptsRef.current.delete(tree.id);
          }
        }
      }
    };

    // Initial spawn after a short delay (let blocks load)
    const initialTimer = setTimeout(ensureOneShnakePerTree, 2000);
    
    // Check periodically to respawn if killed
    const interval = setInterval(ensureOneShnakePerTree, 3000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [isEnabled, plantedTrees, definitions, countShnakesOnTree, spawnOnTree]);

  const removeShnake = useCallback((id: string) => {
    const current = shnakesRef.current;
    const target = current.find(s => s.id === id);
    if (target) {
      target.colliders.forEach(c => entityCollisionGrid.remove(c));
    }
    shnakesRef.current = current.filter(s => s.id !== id);
    setShnakes(shnakesRef.current);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const current = shnakesRef.current;
      for (const s of current) {
        for (const c of s.colliders) entityCollisionGrid.remove(c);
      }
      shnakesRef.current = [];
      setShnakes([]);
    };
  }, []);

  /**
   * Damage head only.
   * Returns { killedHead, killedEntire }
   */
  /**
   * Damage head only.
   * Returns { killedHead, killedEntire, tier, definitionName }
   */
  const damageHead = useCallback((shnakeId: string, damage: number) => {
    let killedHead = false;
    let killedEntire = false;
    let tier = 0;
    let definitionName = '';

    const updated = shnakesRef.current.map(s => {
      if (s.id !== shnakeId || !s.isActive) return s;
      
      tier = s.tier;
      definitionName = s.definition.name || `Shnake T${s.tier}`;
      
      const armor = s.definition.armor ?? 0;
      const actual = Math.max(0, damage - armor);
      const newHealth = s.headHealth - actual;
      
      if (DEBUG_SHNAKE) console.log(`[Shnake Damage] id=${shnakeId.slice(-6)} dmg=${damage} armor=${armor} actual=${actual} health=${s.headHealth}->${newHealth}`);
      
      if (newHealth > 0) {
        return { ...s, headHealth: newHealth };
      }

      // Head killed: remove segment[0], promote segment[1] to new head
      killedHead = true;
      const newSegments = s.segments.slice(1);
      const newColliders = s.colliders.slice(1);

      // Remove old head collider from entity collision grid
      if (s.colliders[0]) entityCollisionGrid.remove(s.colliders[0]);

      if (newSegments.length === 0) {
        killedEntire = true;
        if (DEBUG_SHNAKE) console.log(`[Shnake Kill] Shnake ${shnakeId.slice(-6)} killed entirely! tier=${tier}`);
        // Remove remaining colliders too
        newColliders.forEach(c => entityCollisionGrid.remove(c));
        return { ...s, isActive: false, segments: [], colliders: [], headHealth: 0 };
      }

      if (DEBUG_SHNAKE) console.log(`[Shnake Head Lost] Shnake ${shnakeId.slice(-6)} lost head, ${newSegments.length} segments remain`);

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
    return { killedHead, killedEntire, tier, definitionName };
  }, [removeShnake]);

  const getTreeBlockIndexRefs = useCallback(() => {
    return {
      treeBlocksByTierRef,
      nonInvisTreeBlocksByTierRef,
    };
  }, []);

  /** Check if player is in any chunk that the tree spans */
  const isPlayerInTreeChunks = useCallback((tree: PlantedTree, playerX: number, playerZ: number) => {
    const playerCk = chunkKey(playerX, playerZ);
    const treeChunks = getTreeChunkKeys(tree);
    return treeChunks.has(playerCk);
  }, []);

  // EnemyCombatRegistry adapter — head-only hitbox at segments[0].
  useEffect(() => {
    return enemyCombatRegistry.register({
      type: 'shnake',
      petAttackable: false,
      getActiveEnemies: () => shnakesRef.current,
      getId: (s) => s.id,
      getHitbox: (s) => {
        if (!s.isActive || s.segments.length === 0) return null;
        const head = s.segments[0];
        return {
          centerX: head.x + 0.5,
          centerZ: head.z + 0.5,
          bottomY: head.y,
          topY: head.y + 1,
          radius: 0.5,
        };
      },
      applyDamage: (s, info) => {
        // Shnakes don't have horizontal velocity (segments are tile-
        // discrete), but they DO have velocityY for falling physics.
        // Apply the Y component of the impulse so grenade blasts and
        // similar effects can flip a shnake upward. X/Z are intentional
        // no-ops here — see the shnake movement model.
        if (s.isActive && info.knockbackDirY > 0 && info.bulletSpeed > 0) {
          s.velocityY = Math.max(s.velocityY, info.knockbackDirY * info.bulletSpeed);
        }
        const result = damageHead(s.id, info.damage);
        return result.killedEntire;
      },
      getHitSoundUrl: () => '/bullet_impact_1.mp3',
    });
  }, [damageHead]);

  return {
    shnakes,
    shnakesRef,
    removeShnake,
    damageHead,
    spawnOnTree,
    getTreeBlockIndexRefs,
    isPlayerInTreeChunks,
  };
}
