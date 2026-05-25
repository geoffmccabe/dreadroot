/**
 * useBurnSystem - Universal burn-over-time system for all entity types.
 *
 * Imports the enemy combat registry so any registered adapter can
 * receive flame damage without per-type code here.
 *
 * When an entity is hit by the flamethrower, it catches fire visually
 * (same colors as flamethrower tier). After the flamethrower stops hitting,
 * a 5-second DOT applies with shrinking flames and halving damage each second.
 *
 * Each entity type has a multi-point flame layout so fire engulfs the entity:
 * - Shwarm blocks (0.5m): 1 flame sized to cover the block
 * - Shnake head (1m): 1 flame covering the head segment
 * - Shombie (2.2m): 2 flames — lower body + upper body
 * - Walapa (3-5m tall, wide): 2 flames at different heights
 * - Shtickman (22-40m!): 4 flames spread up the lower body (flamethrower range)
 * - Player: 1 large body flame
 *
 * Damage schedule (example 20 base, 0 armor):
 *   Second 1: 20  |  Second 2: 10  |  Second 3: 5  |  Second 4: 2  |  Second 5: 1
 * Armor subtracts from each tick: max(0, scheduledDamage - armor)
 * Flames always show for the full 5 seconds regardless of armor.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { FlameColorMode, UniversalFlameRendererHandle } from './UniversalFlameRenderer';
import type { ShwarmInstance } from '@/features/shwarm/hooks/useShwarmSystem';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';

// Reusable scratch vector for the registry-fallback entity lookup.
const _registryFallbackPos = new THREE.Vector3();

// Burn duration is per-entry now (passed in by the caller, derived
// from weapon tier). Defaults preserve old behaviour for callers that
// don't pass a value.
const DEFAULT_DOT_SECONDS = 5;
// Shrink curve: full → 0.15 over the full burn. Independent of total
// duration so longer burns shrink more gradually per second.
const shrinkAt = (currentSec: number, total: number) =>
  Math.max(0.15, 1 - 0.8 * (currentSec / Math.max(1, total - 1)));
// Damage multipliers: halves each second regardless of total duration.
const dmgMultAt = (currentSec: number) => Math.pow(0.5, currentSec);
const ACTIVE_TO_DOT_DELAY = 0.15; // seconds after last hit before DOT begins
const MAX_BURNS = 15; // cap burn entries to keep flame slot usage under control

// Per-entity-type flame point layouts
// Each flame point has a Y offset from entity position, size, height, and particle count
interface FlamePoint {
  yOffset: number;
  /** Optional XZ offsets — required when wrapping multi-part shapes
   *  (e.g. spider legs around a central body). Default 0. */
  xOffset?: number;
  zOffset?: number;
  size: number;
  height: number;
  particles: number;
}

// Volumetric flame layouts — flames start BELOW entity center and rise up through
// the body so the entity appears engulfed inside the fire volume.
// Particles rise from (position.y + yOffset) upward by (height) units,
// spreading horizontally by (size * 0.4) at full rise.
//
// Shwarm blocks are 0.5m cubes — flame starts below block, rises through it
// Shnake head is 1m — flame envelops the head
// Shombie is ~2.2m — two overlapping flames covering full body height
// Walapa is 3-5m tall, wide — two large flames engulfing the body
// Shtickman is 22-40m — 4 tall flames overlapping up the lower body
// Player is ~1.8m — large flame centered on body
const FLAME_LAYOUTS: Record<string, FlamePoint[]> = {
  shwarm: [
    { yOffset: -0.3, size: 0.8, height: 0.9, particles: 18 },
  ],
  shnake: [
    { yOffset: -0.3, size: 1.0, height: 1.2, particles: 20 },
  ],
  shombie: [
    { yOffset: -0.2, size: 0.8, height: 1.5, particles: 18 },
    { yOffset: 0.8, size: 0.7, height: 1.4, particles: 15 },
  ],
  walapa: [
    { yOffset: -0.3, size: 1.4, height: 2.0, particles: 18 },
    { yOffset: 1.0, size: 1.2, height: 1.8, particles: 16 },
  ],
  shtickman: [
    { yOffset: -0.3, size: 1.0, height: 3.5, particles: 12 },
    { yOffset: 2.5, size: 1.0, height: 3.5, particles: 12 },
    { yOffset: 5.5, size: 0.9, height: 3.0, particles: 10 },
    { yOffset: 8.0, size: 0.8, height: 2.5, particles: 10 },
  ],
  player: [
    { yOffset: -1.0, size: 1.0, height: 2.0, particles: 22 },
  ],
};

// Legacy named types still get hardcoded layouts in FLAME_LAYOUTS;
// any string is allowed so adapter-registered enemies (e.g. shpider)
// can route their entity type through the same API and pull their
// layout from the EnemyCombatRegistry instead.
type EntityType = string;

interface BurnEntry {
  key: string;
  entityType: EntityType;
  entityId: string;
  blockId?: string;
  tier: number;
  colors: [string, string, string];
  colorMode: FlameColorMode;
  baseDamage: number;
  armor: number;
  lastHitTime: number;       // performance.now()/1000
  burnPhase: 'active' | 'dot';
  burnStartTime: number;     // when DOT phase began (seconds)
  lastDamageSecond: number;  // last second# damage was applied (-1 = none yet)
  flameIds: (string | null)[];  // one per flame point in layout
  attachIds: string[];           // one per flame point
  hitOffset: THREE.Vector3 | null; // offset from entity base to hit point (for positioned burns)
  /** Total burn duration in seconds (tier-derived). DOT phase ends here. */
  dotSeconds: number;
}

interface UseBurnSystemOptions {
  universalFlameRef: React.RefObject<UniversalFlameRendererHandle>;
  shwarmsRef: React.RefObject<ShwarmInstance[]>;
  shnakesRef: React.RefObject<any[]>;
  shombiesRef: React.RefObject<any[]>;
  walapasRef: React.RefObject<any[]>;
  shtickmenRef: React.RefObject<any[]>;
  cameraRef: React.RefObject<THREE.Camera>;
  damageBlock: (shwarmId: string, blockId: string, damage: number) => any;
  damageShnakeHead: (shnakeId: string, damage: number) => any;
  damageShombie: (shombieId: string, damage: number, dir: THREE.Vector3, isHeadshot: boolean, bulletDir: THREE.Vector3) => any;
  damageWalapa: (walapaId: string, damage: number) => any;
  damageShtickman: (shtickmanId: string, damage: number, dir: THREE.Vector3) => any;
  takeDamage?: (damage: number, direction?: THREE.Vector3, knockback?: number) => void;
}

// Pre-allocated temp vectors
const _burnDir = new THREE.Vector3(0, 0, 1);
const _offsetPos = new THREE.Vector3();
const _shnakeHeadPos = new THREE.Vector3();
// Pre-allocated array for removal keys (avoids per-frame allocation)
const _toRemove: string[] = [];

export function useBurnSystem({
  universalFlameRef,
  shwarmsRef,
  shnakesRef,
  shombiesRef,
  walapasRef,
  shtickmenRef,
  cameraRef,
  damageBlock,
  damageShnakeHead,
  damageShombie,
  damageWalapa,
  damageShtickman,
  takeDamage,
}: UseBurnSystemOptions) {
  const burnsRef = useRef<Map<string, BurnEntry>>(new Map());

  // Spawn (or replace) all flame points for a burn entry at the given base position
  // When hitOffset is set, basePos should already be entity pos + hitOffset (single flame)
  const spawnBurnFlames = useCallback((entry: BurnEntry, shrinkMult: number, basePos: THREE.Vector3) => {
    const renderer = universalFlameRef.current;
    if (!renderer) return;

    if (entry.hitOffset) {
      // Single flame at hit position
      if (entry.flameIds[0]) {
        renderer.removeFlame(entry.flameIds[0]!);
      }
      const pt = FLAME_LAYOUTS[entry.entityType][0];
      entry.flameIds[0] = renderer.spawnFlame({
        type: 'point',
        position: basePos,
        colors: entry.colors,
        size: pt.size * shrinkMult,
        height: pt.height * shrinkMult,
        duration: 999999,
        particleCount: pt.particles,
        attachTo: entry.attachIds[0],
        colorMode: entry.colorMode,
      });
    } else {
      // Multi-point layout — pull from legacy table OR from the
      // registered adapter's getFlameAttachPoints. Honors xOffset/zOffset
      // so multi-part shapes (spider legs around a body) get full
      // surround coverage.
      let layout: FlamePoint[] | undefined = FLAME_LAYOUTS[entry.entityType];
      if (!layout) {
        const adapter = enemyCombatRegistry.getAdapter(entry.entityType);
        if (adapter?.getFlameAttachPoints) {
          const list = adapter.getActiveEnemies();
          const enemy = list.find(e => adapter.getId(e) === entry.entityId);
          if (enemy) {
            const pts = adapter.getFlameAttachPoints(enemy);
            if (pts && pts.length > 0) {
              layout = pts.map(p => ({
                yOffset: p.yOffset,
                xOffset: p.xOffset ?? 0,
                zOffset: p.zOffset ?? 0,
                size: p.size,
                height: p.height,
                particles: p.particles,
              }));
            }
          }
        }
      }
      if (!layout) layout = [{ yOffset: 0.5, size: 0.8, height: 1.2, particles: 14 }];
      for (let i = 0; i < layout.length; i++) {
        if (entry.flameIds[i]) {
          renderer.removeFlame(entry.flameIds[i]!);
        }
        const pt = layout[i];
        _offsetPos.set(
          basePos.x + (pt.xOffset ?? 0),
          basePos.y + pt.yOffset,
          basePos.z + (pt.zOffset ?? 0),
        );
        entry.flameIds[i] = renderer.spawnFlame({
          type: 'point',
          position: _offsetPos,
          colors: entry.colors,
          size: pt.size * shrinkMult,
          height: pt.height * shrinkMult,
          duration: 999999,
          particleCount: pt.particles,
          attachTo: entry.attachIds[i],
          colorMode: entry.colorMode,
        });
      }
    }
  }, [universalFlameRef]);

  // Remove a burn entry and all its flames
  const removeBurn = useCallback((key: string) => {
    const entry = burnsRef.current.get(key);
    if (!entry) return;

    const renderer = universalFlameRef.current;
    if (renderer) {
      for (const fid of entry.flameIds) {
        if (fid) renderer.removeFlame(fid);
      }
    }
    burnsRef.current.delete(key);
  }, [universalFlameRef]);

  // Look up entity position; returns null if entity is dead/gone
  const getEntityPosition = useCallback((entry: BurnEntry): THREE.Vector3 | null => {
    switch (entry.entityType) {
      case 'shwarm': {
        const shwarm = shwarmsRef.current?.find(s => s.id === entry.entityId);
        if (!shwarm) return null;
        const block = shwarm.blocks.find(b => b.id === entry.blockId && b.isAlive);
        return block?.position ?? null;
      }
      case 'shnake': {
        const shnake = shnakesRef.current?.find(s => s.id === entry.entityId);
        if (!shnake || !shnake.isActive || shnake.segments.length === 0) return null;
        // Segments store grid coords (integers), convert to world center
        const seg = shnake.segments[0];
        return _shnakeHeadPos.set(seg.x + 0.5, seg.y + 0.5, seg.z + 0.5);
      }
      case 'shombie': {
        const shombie = shombiesRef.current?.find(s => s.id === entry.entityId);
        if (!shombie || !shombie.isActive) return null;
        return shombie.position;
      }
      case 'walapa': {
        const walapa = walapasRef.current?.find(w => w.id === entry.entityId);
        if (!walapa || !walapa.isActive) return null;
        return walapa.position;
      }
      case 'shtickman': {
        const shtickman = shtickmenRef.current?.find(s => s.id === entry.entityId);
        if (!shtickman || !shtickman.isActive) return null;
        return shtickman.position;
      }
      case 'player': {
        return cameraRef.current?.position ?? null;
      }
      default: {
        // Fall through to the EnemyCombatRegistry — any registered
        // adapter exposes the enemy's hitbox we can use for flame anchor.
        const adapter = enemyCombatRegistry.getAdapter(entry.entityType);
        if (!adapter) return null;
        const list = adapter.getActiveEnemies();
        const enemy = list.find(e => adapter.getId(e) === entry.entityId);
        if (!enemy) return null;
        const hb = adapter.getHitbox(enemy);
        if (!hb) return null;
        return _registryFallbackPos.set(hb.centerX, hb.bottomY, hb.centerZ);
      }
    }
  }, [shwarmsRef, shnakesRef, shombiesRef, walapasRef, shtickmenRef, cameraRef]);

  // Public: apply or refresh a burn on an entity
  // hitPosition: world-space point where flame actually hit (for positioned burns on large entities)
  const applyBurn = useCallback((
    entityType: EntityType,
    entityId: string,
    blockId: string | undefined,
    tier: number,
    colors: [string, string, string],
    colorMode: FlameColorMode,
    baseDamage: number,
    armor: number,
    hitPosition?: THREE.Vector3,
    burnSeconds?: number,
  ) => {
    const dotSeconds = Math.max(1, Math.floor(burnSeconds ?? DEFAULT_DOT_SECONDS));
    const key = entityType === 'shwarm' && blockId
      ? `shwarm:${entityId}:${blockId}`
      : `${entityType}:${entityId}`;

    const now = performance.now() / 1000;

    const existing = burnsRef.current.get(key);
    if (existing) {
      // Refresh — keep burn in active phase, update damage/colors if tier changed
      existing.lastHitTime = now;
      existing.baseDamage = Math.max(existing.baseDamage, baseDamage);
      existing.armor = armor;
      existing.tier = tier;
      existing.colors = colors;
      existing.colorMode = colorMode;
      // Refreshing a burn with a longer-tier weapon extends the timer.
      existing.dotSeconds = Math.max(existing.dotSeconds, dotSeconds);

      // Update hit offset if new hit position provided
      if (hitPosition) {
        const ePos = getEntityPosition(existing);
        if (ePos) {
          if (!existing.hitOffset) existing.hitOffset = new THREE.Vector3();
          existing.hitOffset.set(
            hitPosition.x - ePos.x,
            hitPosition.y - ePos.y,
            hitPosition.z - ePos.z,
          );
        }
      }

      // If was in DOT phase, reset to active and respawn full-size flames
      if (existing.burnPhase === 'dot') {
        existing.burnPhase = 'active';
        existing.lastDamageSecond = -1;
        const pos = getEntityPosition(existing);
        if (pos) {
          const spawnPos = existing.hitOffset
            ? _offsetPos.copy(pos).add(existing.hitOffset)
            : pos;
          spawnBurnFlames(existing, 1.0, spawnPos);
        }
      }
      return;
    }

    // Cap concurrent burns to avoid exhausting flame slots
    if (burnsRef.current.size >= MAX_BURNS) {
      // Evict oldest DOT-phase burn
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, e] of burnsRef.current) {
        if (e.burnPhase === 'dot' && e.burnStartTime < oldestTime) {
          oldestTime = e.burnStartTime;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        removeBurn(oldestKey);
      } else {
        return; // all burns active, can't evict
      }
    }

    // New burn — if hitPosition provided, use single flame at hit offset from entity base
    const entityPos = getEntityPosition({ entityType, entityId, blockId } as BurnEntry);
    if (!entityPos) {
      console.warn(`[BurnSystem] Entity not found for burn: ${entityType}:${entityId}`);
      return;
    }

    let hitOff: THREE.Vector3 | null = null;
    if (hitPosition) {
      hitOff = new THREE.Vector3(
        hitPosition.x - entityPos.x,
        hitPosition.y - entityPos.y,
        hitPosition.z - entityPos.z,
      );
    }

    // When we have a hit offset, use a single flame at the hit point
    // Otherwise use the full multi-point layout. For entity types not
    // in the legacy FLAME_LAYOUTS table, fall back to the registered
    // EnemyCombatAdapter's getFlameAttachPoints — or a single-flame
    // default centered on the hitbox.
    const useHitPoint = hitOff !== null;
    let layout: FlamePoint[] | undefined = FLAME_LAYOUTS[entityType as keyof typeof FLAME_LAYOUTS];
    if (!layout) {
      const adapter = enemyCombatRegistry.getAdapter(entityType);
      if (adapter?.getFlameAttachPoints) {
        const list = adapter.getActiveEnemies();
        const enemy = list.find(e => adapter.getId(e) === entityId);
        if (enemy) {
          const pts = adapter.getFlameAttachPoints(enemy);
          if (pts && pts.length > 0) {
            layout = pts.map(p => ({
              yOffset: p.yOffset,
              size: p.size,
              height: p.height,
              particles: p.particles,
              // xOffset/zOffset honored via custom field below
              xOffset: p.xOffset ?? 0,
              zOffset: p.zOffset ?? 0,
            }) as FlamePoint);
          }
        }
      }
      if (!layout) {
        // Last-resort single-flame default at center.
        layout = [{ yOffset: 0.5, size: 0.8, height: 1.2, particles: 14 }];
      }
    }
    if (useHitPoint) layout = [layout[0]];
    const attachIds = layout.map((_, i) => `burn_${key}_${i}`);

    const entry: BurnEntry = {
      key,
      entityType,
      entityId,
      blockId,
      tier,
      colors,
      colorMode,
      baseDamage,
      armor,
      lastHitTime: now,
      burnPhase: 'active',
      burnStartTime: 0,
      lastDamageSecond: -1,
      flameIds: new Array(layout.length).fill(null),
      attachIds,
      hitOffset: hitOff,
      dotSeconds,
    };

    spawnBurnFlames(entry, 1.0, useHitPoint
      ? _offsetPos.copy(entityPos).add(hitOff!)
      : entityPos);
    burnsRef.current.set(key, entry);
  }, [spawnBurnFlames, removeBurn, getEntityPosition]);

  // Apply burn damage to the appropriate entity
  // NOTE: No knockback direction passed — burn damage should not push enemies around
  const applyBurnDamage = useCallback((entry: BurnEntry, damage: number) => {
    const actualDmg = Math.max(0, damage - entry.armor);
    if (actualDmg <= 0) return;

    switch (entry.entityType) {
      case 'shwarm':
        if (entry.blockId) {
          damageBlock(entry.entityId, entry.blockId, actualDmg);
        }
        break;
      case 'shnake':
        damageShnakeHead(entry.entityId, actualDmg);
        break;
      case 'shombie':
        // Pass undefined for knockbackDir so burn doesn't launch enemies
        damageShombie(entry.entityId, actualDmg, undefined as any, false, undefined as any);
        break;
      case 'walapa':
        damageWalapa(entry.entityId, actualDmg);
        break;
      case 'shtickman':
        // Pass undefined for knockbackDir so burn doesn't launch enemies
        damageShtickman(entry.entityId, actualDmg, undefined as any);
        break;
      case 'player':
        takeDamage?.(actualDmg);
        break;
      default: {
        // Universal dispatch via the enemy combat registry — works for
        // any monster that's registered an adapter (shpider, and any
        // future enemy not in the legacy switch above).
        const adapter = enemyCombatRegistry.getAdapter(entry.entityType);
        if (adapter) {
          const list = adapter.getActiveEnemies();
          const enemy = list.find(e => adapter.getId(e) === entry.entityId);
          if (enemy) {
            adapter.applyDamage(enemy, {
              damage: actualDmg,
              bulletSpeed: 0,
              knockbackDirX: 0, knockbackDirY: 0, knockbackDirZ: 0,
              hitX: 0, hitY: 0, hitZ: 0,
              isHeadshot: false,
              source: 'flame',
            });
          }
        }
        break;
      }
    }
  }, [damageBlock, damageShnakeHead, damageShombie, damageWalapa, damageShtickman, takeDamage]);

  // Main frame loop
  useFrame(() => {
    const now = performance.now() / 1000;
    const renderer = universalFlameRef.current;
    if (!renderer) return;

    _toRemove.length = 0;

    for (const [key, entry] of burnsRef.current) {
      // 1. Check if entity is still alive
      const pos = getEntityPosition(entry);
      if (!pos) {
        _toRemove.push(key);
        continue;
      }

      // 2. Update flame positions — use hit offset if available, else multi-point layout
      if (entry.hitOffset) {
        _offsetPos.copy(pos).add(entry.hitOffset);
        renderer.updateAttachedPosition(entry.attachIds[0], _offsetPos);
      } else {
        const layout = FLAME_LAYOUTS[entry.entityType];
        for (let i = 0; i < layout.length; i++) {
          _offsetPos.set(pos.x, pos.y + layout[i].yOffset, pos.z);
          renderer.updateAttachedPosition(entry.attachIds[i], _offsetPos);
        }
      }

      // 3. Phase management
      if (entry.burnPhase === 'active') {
        if (now - entry.lastHitTime > ACTIVE_TO_DOT_DELAY) {
          entry.burnPhase = 'dot';
          entry.burnStartTime = now;
          entry.lastDamageSecond = -1;
        }
        continue;
      }

      // 4. DOT phase
      const elapsed = now - entry.burnStartTime;
      const currentSecond = Math.floor(elapsed);

      if (currentSecond >= entry.dotSeconds) {
        _toRemove.push(key);
        continue;
      }

      // 5. On each new second boundary — shrink flames and apply damage
      if (currentSecond > entry.lastDamageSecond) {
        entry.lastDamageSecond = currentSecond;

        const shrink = shrinkAt(currentSecond, entry.dotSeconds);
        const spawnPos = entry.hitOffset
          ? _offsetPos.copy(pos).add(entry.hitOffset)
          : pos;
        spawnBurnFlames(entry, shrink, spawnPos);

        const rawDmg = Math.floor(entry.baseDamage * dmgMultAt(currentSecond));
        if (rawDmg > 0) {
          applyBurnDamage(entry, rawDmg);
        }
      }
    }

    // Cleanup dead/expired burns
    for (let i = 0; i < _toRemove.length; i++) {
      removeBurn(_toRemove[i]);
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const renderer = universalFlameRef.current;
      if (renderer) {
        for (const entry of burnsRef.current.values()) {
          for (const fid of entry.flameIds) {
            if (fid) renderer.removeFlame(fid);
          }
        }
      }
      burnsRef.current.clear();
    };
  }, [universalFlameRef]);

  return { applyBurn };
}
