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
import type { FlameColorMode, FlameType, UniversalFlameRendererHandle } from './UniversalFlameRenderer';
import type { BulletImpactsHandle } from './FortressImpacts';
import { enemyCombatRegistry, type BurnFollower } from '@/features/enemies/combat/EnemyCombatRegistry';
import type { EffectsHandle, EffectEmitter } from '@/effects/types';

// Reusable scratch vector for the registry-fallback entity lookup.
const _registryFallbackPos = new THREE.Vector3();
// Side-channel: the facing yaw of the entity last resolved by getEntityPosition
// (single-threaded, read immediately after the call). Lets hit-point fire rotate
// WITH the body as it turns instead of swinging around in world space.
let _anchorYaw = 0;

// Burn duration is per-entry now (passed in by the caller, derived
// from weapon tier). Defaults preserve old behaviour for callers that
// don't pass a value.
const DEFAULT_DOT_SECONDS = 5;
// Shrink curve: full → 0.15 over the full burn. Independent of total
// duration so longer burns shrink more gradually per second.
const shrinkAt = (currentSec: number, total: number) =>
  Math.max(0.3, 1 - 0.6 * (currentSec / Math.max(1, total - 1)));
// Damage multipliers: halves each second regardless of total duration.
const dmgMultAt = (currentSec: number) => Math.pow(0.5, currentSec);
const ACTIVE_TO_DOT_DELAY = 0.15; // seconds after last hit before DOT begins
const MAX_BURNS = 15; // cap burn entries to keep flame slot usage under control
const DEATH_LINGER_SECONDS = 1.5; // a killed enemy's fire lingers this long at its death spot

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
  /** Explosion burns: a fixed horizontal offset that biases the whole-body plumes
   *  onto the side of the body that FACED the blast (toward the impact center), so
   *  the fire wraps one side instead of the full circumference. Null = centered. */
  sideOffset?: THREE.Vector3 | null;
  /** SAFE death-linger: the entity's OWN last resolved position (an entry-owned
   *  vector — never the camera, never a shared scratch) and when it died, so a
   *  KILLED enemy's fire lingers briefly at the death spot instead of vanishing.
   *  Objects/ground never resolve to a position, so they never get a deathPos
   *  and can never linger/follow anything. */
  deathPos?: THREE.Vector3;
  deathAt?: number;
  /** Total burn duration in seconds (tier-derived). DOT phase ends here. */
  dotSeconds: number;
  /** Flame layout snapshot taken at burn-creation time (one entry per
   *  flame point). Cached on the burn so the frame loop never has to
   *  re-query FLAME_LAYOUTS or the registry per-tick. */
  layout: FlamePoint[];
  /** Particle style (UFR fallback path only). */
  flameType?: FlameType;
  /** When set, this burn's VISUAL is a sustained, following copy of the real
   *  7-fire bullet-impact effect (FortressImpacts), NOT a UniversalFlameRenderer
   *  flame. Used for bullet hit-point burns so the fire looks identical to the
   *  impact, just longer + tracking + shrinking. */
  trackedImpactId?: number;
  /** Body facing (yaw) at ignite. The hit offset is rotated by (currentYaw -
   *  igniteYaw) each frame so the fire stays on the SAME body spot as it turns.
   *  Used only as a fallback when no bone follower is available. */
  igniteYaw?: number;
  /** Best: a follower locked to the model's nearest BONE at the hit point, so the
   *  fire rides the full animation (gait bob + turn + walk). Overrides igniteYaw. */
  burnFollower?: BurnFollower;
  /** Smoke trail: a continuous effects emitter that drops fire-and-forget smoke
   *  puffs at the fire's current spot, and an entry-owned vector holding that
   *  spot (updated each frame). The puffs stay pinned where dropped, so a moving
   *  enemy trails smoke automatically. Null when no effects renderer is wired. */
  smokeEmitter?: EffectEmitter;
  smokePos?: THREE.Vector3;
}

interface UseBurnSystemOptions {
  universalFlameRef: React.RefObject<UniversalFlameRendererHandle>;
  cameraRef: React.RefObject<THREE.Camera>;
  takeDamage?: (damage: number, direction?: THREE.Vector3, knockback?: number) => void;
  /** The 7-fire bullet-impact renderer. When provided, bullet (hit-point) burns
   *  render as a sustained, following version of that exact effect. */
  bulletImpactsRef?: React.RefObject<BulletImpactsHandle>;
  /** Universal effects renderer. When provided, every burn trails smoke. */
  effectsRef?: React.RefObject<EffectsHandle | null>;
}

// Pre-allocated temp vectors
const _offsetPos = new THREE.Vector3();
// Pre-allocated array for removal keys (avoids per-frame allocation)
const _toRemove: string[] = [];

export function useBurnSystem({
  universalFlameRef,
  cameraRef,
  takeDamage,
  bulletImpactsRef,
  effectsRef,
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
      const pt = entry.layout[0];
      entry.flameIds[0] = renderer.spawnFlame({
        type: entry.flameType ?? 'point',
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
      // Multi-point layout — use the snapshot cached on the entry at
      // burn-creation time. Honors xOffset/zOffset so multi-part
      // shapes (spider legs around a body) get full surround coverage.
      const layout = entry.layout;
      const sx = entry.sideOffset?.x ?? 0;
      const sz = entry.sideOffset?.z ?? 0;
      for (let i = 0; i < layout.length; i++) {
        if (entry.flameIds[i]) {
          renderer.removeFlame(entry.flameIds[i]!);
        }
        const pt = layout[i];
        _offsetPos.set(
          basePos.x + (pt.xOffset ?? 0) + sx,
          basePos.y + pt.yOffset,
          basePos.z + (pt.zOffset ?? 0) + sz,
        );
        entry.flameIds[i] = renderer.spawnFlame({
          type: entry.flameType ?? 'point',
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

    entry.smokeEmitter?.stop();
    if (entry.trackedImpactId != null) {
      bulletImpactsRef?.current?.removeTracked(entry.trackedImpactId);
    }
    const renderer = universalFlameRef.current;
    if (renderer) {
      for (const fid of entry.flameIds) {
        if (fid) renderer.removeFlame(fid);
      }
    }
    burnsRef.current.delete(key);
  }, [universalFlameRef, bulletImpactsRef]);

  // Look up entity position; returns null if entity is dead/gone.
  // Player is the only special case — every other entity comes from
  // the EnemyCombatRegistry, including the compound-id shwarm blocks.
  const getEntityPosition = useCallback((entry: BurnEntry): THREE.Vector3 | null => {
    if (entry.entityType === 'player') {
      return cameraRef.current?.position ?? null;
    }
    const adapter = enemyCombatRegistry.getAdapter(entry.entityType);
    if (!adapter) return null;
    // Compound id for shwarm: "<shwarmId>::<blockId>". Match on getId().
    const lookupId = entry.entityType === 'shwarm' && entry.blockId
      ? `${entry.entityId}::${entry.blockId}`
      : entry.entityId;
    const list = adapter.getActiveEnemies();
    const enemy = list.find(e => adapter.getId(e) === lookupId);
    if (!enemy) return null; // truly gone (despawned/removed from the world)
    // Prefer the burn anchor: it gives the live body base + facing YAW and stays
    // valid through the death animation (getHitbox goes null at death). Falling
    // back to the hitbox for enemies that don't provide an anchor.
    const anchor = adapter.getBurnAnchor?.(enemy);
    if (anchor) {
      _anchorYaw = anchor.yaw ?? 0;
      _registryFallbackPos.set(anchor.x, anchor.y, anchor.z);
      return _registryFallbackPos;
    }
    const hb = adapter.getHitbox(enemy);
    if (!hb) return null;
    _anchorYaw = 0;
    _registryFallbackPos.set(hb.centerX, hb.bottomY, hb.centerZ);
    return _registryFallbackPos;
  }, [cameraRef]);

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
    opts?: { engulf?: boolean; size?: number; height?: number; sided?: boolean; flameType?: FlameType },
  ) => {
    // engulf=true → fire wraps the body (flamethrower / explosion splash).
    // engulf=false → ONE lasting flame at the exact hit point that tracks that
    // spot on the body (bullets — a persistent version of the impact fire).
    // sided=true → engulf, but biased onto the blast-FACING side of the body
    // (explosions: grenades/rockets/bombs scorch the side that saw the blast).
    const engulfMode = opts?.engulf ?? true;
    const sidedMode = opts?.sided ?? false;
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
    const igniteYaw = _anchorYaw; // body facing at ignite (set by getEntityPosition)

    let hitOff: THREE.Vector3 | null = null;
    if (hitPosition) {
      hitOff = new THREE.Vector3(
        hitPosition.x - entityPos.x,
        hitPosition.y - entityPos.y,
        hitPosition.z - entityPos.z,
      );
    }

    // BULLET (engulfMode=false, hit point given): ONE flame pinned to the impact
    // spot, sized like the impact fire, tracking that spot as the body moves.
    // AREA weapons (engulfMode=true): body-wrapping plumes from the adapter's
    // getFlameAttachPoints (or the legacy FLAME_LAYOUTS table), tracking the body.
    let engulf = false;
    let layout: FlamePoint[] | undefined;
    if (!engulfMode && hitOff) {
      layout = [{ yOffset: 0, size: opts?.size ?? 0.8, height: opts?.height ?? 1.2, particles: 64 }];
    } else {
      layout = FLAME_LAYOUTS[entityType as keyof typeof FLAME_LAYOUTS];
      if (!layout) {
        const adapter = enemyCombatRegistry.getAdapter(entityType);
        if (adapter?.getFlameAttachPoints) {
          const list = adapter.getActiveEnemies();
          const enemy = list.find(e => adapter.getId(e) === entityId);
          if (enemy) {
            const pts = adapter.getFlameAttachPoints(enemy);
            if (pts && pts.length > 0) {
              layout = pts.map(p => ({
                yOffset: p.yOffset, size: p.size, height: p.height, particles: p.particles,
                xOffset: p.xOffset ?? 0, zOffset: p.zOffset ?? 0,
              }) as FlamePoint);
              engulf = true;
            }
          }
        }
        if (!layout) layout = [{ yOffset: 0.5, size: 0.8, height: 1.2, particles: 14 }];
      } else {
        engulf = true;
      }
    }
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
      // Engulf enemies ignore the fixed hit offset and follow the body center.
      hitOffset: engulf ? null : hitOff,
      // Explosion (sided) burns: bias the whole-body plumes onto the blast-facing
      // side using the horizontal component of the hit direction.
      sideOffset: (engulf && sidedMode && hitOff)
        ? new THREE.Vector3(hitOff.x, 0, hitOff.z)
        : null,
      // Capture the linger position NOW, while the entity is provably alive.
      // (entityPos is a shared scratch — clone it so it's entry-owned.) Without
      // this, a one-shot kill dies before the frame loop ever sees it alive, so
      // the burn was removed instantly and showed no fire.
      deathPos: entityPos.clone(),
      dotSeconds,
      layout,
      igniteYaw,
      // Hit-point (bullet) burns are a SINGLE big flame at the impact spot — one
      // solid fire, not a spread-out cluster (the hex fanned out hand-to-hand).
      flameType: opts?.flameType ?? 'point',
    };

    if (!engulf && hitOff && bulletImpactsRef?.current) {
      // Bullet hit-point burn: render the REAL 7-fire impact effect, sustained +
      // following + shrinking. Same look as the impact, just extended. Size/height/
      // colors are the impact's own (passed via opts), so it's identical to frame 0.
      const startPos = _offsetPos.copy(entityPos).add(hitOff);
      entry.trackedImpactId = bulletImpactsRef.current.spawnTracked(startPos, {
        colors: entry.colors,
        size: opts?.size ?? 0.5,
        height: opts?.height ?? 1.0,
        duration: dotSeconds,
      });
      // Lock the fire to the model's nearest bone so it rides the animation
      // (gait bob + turn). Falls back to the yaw-rotated collider offset if the
      // enemy has no skinned model.
      if (hitPosition) {
        const ad = enemyCombatRegistry.getAdapter(entityType);
        const en = ad?.getActiveEnemies().find(e => ad.getId(e) === entityId);
        if (en && ad?.createBurnFollower) {
          entry.burnFollower = ad.createBurnFollower(en, hitPosition.x, hitPosition.y, hitPosition.z) ?? undefined;
        }
      }
    } else {
      spawnBurnFlames(entry, 1.0, (!engulf && hitOff)
        ? _offsetPos.copy(entityPos).add(hitOff)
        : entityPos);
    }

    // Smoke trail: attach a continuous emitter that drops fire-and-forget puffs
    // at the fire's current spot (entry.smokePos, refreshed each frame). The
    // puffs stay where dropped, so a moving enemy trails smoke. Visual only.
    if (effectsRef?.current) {
      entry.smokePos = (hitOff ? _offsetPos.copy(entityPos).add(hitOff) : entityPos).clone();
      entry.smokeEmitter = effectsRef.current.createEmitter(
        'fire-smoke',
        (out) => {
          if (!entry.smokePos) return false;
          out.copy(entry.smokePos);
          return true;
        },
        0.3,
      );
    }
    burnsRef.current.set(key, entry);
  }, [spawnBurnFlames, removeBurn, getEntityPosition, universalFlameRef, bulletImpactsRef, effectsRef]);

  // Apply burn damage. Player is the only non-enemy special case;
  // every monster routes through its EnemyCombatAdapter.
  // NOTE: No knockback direction passed — burn damage should not push enemies around.
  const applyBurnDamage = useCallback((entry: BurnEntry, damage: number) => {
    const actualDmg = Math.max(0, damage - entry.armor);
    if (actualDmg <= 0) return;

    if (entry.entityType === 'player') {
      takeDamage?.(actualDmg);
      return;
    }

    const adapter = enemyCombatRegistry.getAdapter(entry.entityType);
    if (!adapter) return;
    const lookupId = entry.entityType === 'shwarm' && entry.blockId
      ? `${entry.entityId}::${entry.blockId}`
      : entry.entityId;
    const list = adapter.getActiveEnemies();
    const enemy = list.find(e => adapter.getId(e) === lookupId);
    if (!enemy) return;
    adapter.applyDamage(enemy, {
      damage: actualDmg,
      bulletSpeed: 0,
      knockbackDirX: 0, knockbackDirY: 0, knockbackDirZ: 0,
      hitX: 0, hitY: 0, hitZ: 0,
      isHeadshot: false,
      source: 'flame',
    });
  }, [takeDamage]);

  // Main frame loop
  useFrame(() => {
    const now = performance.now() / 1000;
    const renderer = universalFlameRef.current;
    if (!renderer) return;

    _toRemove.length = 0;

    for (const [key, entry] of burnsRef.current) {
      // 1. Resolve the live position. While alive, remember the entity's OWN
      //    last position (entry-owned — never camera, never a shared scratch).
      //    When it dies (pos null), LINGER the fire at that death spot for
      //    DEATH_LINGER_SECONDS (a burning corpse), then remove. An entity that
      //    never resolved (objects/ground) is removed immediately, so it can
      //    never linger or follow anything.
      let pos = getEntityPosition(entry);
      const isLive = pos !== null; // enemy present this frame (alive or mid-death)
      if (pos) {
        if (!entry.deathPos) entry.deathPos = new THREE.Vector3();
        entry.deathPos.copy(pos);
        entry.deathAt = undefined;
      } else if (entry.deathPos) {
        if (entry.deathAt == null) entry.deathAt = now;
        if (now - entry.deathAt > DEATH_LINGER_SECONDS) {
          _toRemove.push(key);
          continue;
        }
        pos = entry.deathPos;
      } else {
        _toRemove.push(key);
        continue;
      }

      // Smoke trail emits from the body/anchor by default; the hit-point
      // branches below refine it to the exact fire spot.
      if (entry.smokePos) entry.smokePos.copy(pos);

      // 2. Update flame positions — use hit offset if available, else
      //    the layout cached on the entry at creation time. Honors
      //    xOffset/zOffset for multi-shape monsters (e.g. spider legs).
      if (entry.trackedImpactId != null) {
        if (entry.burnFollower && isLive) {
          // BEST: the fire is locked to the model's bone — it rides the full
          // animation (gait bob + turn + walk) automatically.
          entry.burnFollower(_offsetPos);
        } else {
          // Fallback (no skinned model, or lingering corpse): follow the collider
          // and rotate the hit offset by the body's facing change since ignite.
          const ho = entry.hitOffset!;
          const dYaw = _anchorYaw - (entry.igniteYaw ?? _anchorYaw);
          const c = Math.cos(dYaw), s = Math.sin(dYaw);
          _offsetPos.set(
            pos.x + (ho.x * c + ho.z * s),
            pos.y + ho.y,
            pos.z + (-ho.x * s + ho.z * c),
          );
        }
        bulletImpactsRef?.current?.updateTracked(entry.trackedImpactId, _offsetPos);
        entry.smokePos?.copy(_offsetPos);
      } else if (entry.hitOffset) {
        _offsetPos.copy(pos).add(entry.hitOffset);
        renderer.updateAttachedPosition(entry.attachIds[0], _offsetPos);
        entry.smokePos?.copy(_offsetPos);
      } else {
        const layout = entry.layout;
        const sx = entry.sideOffset?.x ?? 0;
        const sz = entry.sideOffset?.z ?? 0;
        for (let i = 0; i < layout.length; i++) {
          const pt = layout[i];
          _offsetPos.set(
            pos.x + (pt.xOffset ?? 0) + sx,
            pos.y + pt.yOffset,
            pos.z + (pt.zOffset ?? 0) + sz,
          );
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

        // Tracked-impact burns shrink themselves (FortressImpacts); only the UFR
        // flame path needs a per-second re-spawn at the new shrink size.
        if (entry.trackedImpactId == null) {
          const shrink = shrinkAt(currentSecond, entry.dotSeconds);
          const spawnPos = entry.hitOffset
            ? _offsetPos.copy(pos).add(entry.hitOffset)
            : pos;
          spawnBurnFlames(entry, shrink, spawnPos);
        }

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
