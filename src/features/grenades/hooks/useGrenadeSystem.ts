// Grenade system — owns the active list, the throw API, the per-frame
// physics (gravity / bounce / roll), the fuse, and the explosion that
// damages every registered enemy in radius.
//
// Movement model is plain ballistic + bounce:
//   v.y -= g * dt
//   pos += v * dt
//   if (next pos would penetrate a voxel) → reflect & dampen
//   if (resting on ground AND |v| < ROLL_THRESHOLD) → switch to rolling
//   while rolling: friction decays horizontal velocity each second
//
// Explosion is registry-driven so adding a new monster automatically
// makes it damageable by grenades.

import { useCallback, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GrenadeInstance } from '../types';
import {
  GRENADE_FUSE_SEC,
  GRENADE_THROW_SPEED,
  GRENADE_THROW_UP,
  GRENADE_GRAVITY,
  GRENADE_BOUNCE_DAMP,
  GRENADE_ROLL_FRICTION_PER_SEC,
  GRENADE_ROLL_THRESHOLD,
  GRENADE_VISUAL_RADIUS,
  MAX_LIVE_GRENADES,
  grenadeDamage,
  grenadeRadius,
  grenadeKnockback,
  grenadeColors,
} from '../constants';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import { igniteExplosionBurn } from '@/features/enemies/combat/explosionBurn';
import { resolveBlastHit, stepGrenadePhysics, type VoxelCollider, type EnemyColliderSource } from '@/features/combat';
import { getActiveGame } from '@/config/activeGame';
import { sampleHeight } from '@/components/siege/terrainHeight';

// Pure-physics function adapters around our client-side singletons.
// On the L2 DO the same physics function will receive different
// implementations of these interfaces backed by server state.
const _voxelCollider: VoxelCollider = {
  hasVoxel: (ix, iy, iz) => worldCollisionGrid.hasVoxel(ix, iy, iz),
};
const _enemyColliderSource: EnemyColliderSource = {
  forEachHitbox(cb) {
    for (const adapter of enemyCombatRegistry.getAdapters()) {
      for (const enemy of adapter.getActiveEnemies()) {
        const hb = adapter.getHitbox(enemy);
        if (hb) cb(hb);
      }
    }
  },
};
// Siege Worlds collider: objects are Box3 colliders in the grid (not the voxel field), so a
// cell is "solid" if it's inside any box collider → grenades bounce off rocks/buildings/monsters.
// The heightmap GROUND is handled separately by a precise post-step clamp (below): treating
// terrain as integer voxel cells rested grenades ~1m into slopes and made phantom vertical walls.
const _siegeCollider: VoxelCollider = {
  hasVoxel(ix, iy, iz) {
    const cx = ix + 0.5, cy = iy + 0.5, cz = iz + 0.5;
    const cnt = worldCollisionGrid.getNearby(cx, cz, 1);
    const res = worldCollisionGrid.nearbyResult;
    for (let i = 0; i < cnt; i++) {
      const b = res[i] as { min: THREE.Vector3; max: THREE.Vector3 } | undefined;
      if (b && b.max && cx >= b.min.x && cx <= b.max.x && cy >= b.min.y && cy <= b.max.y && cz >= b.min.z && cz <= b.max.z) return true;
    }
    return false;
  },
};
import { playThrowSound } from '../lib/explosionSound';
import { playSpatialSound } from '@/lib/spatialAudio';
import type { UniversalFlameRendererHandle } from '@/components/fortress/UniversalFlameRenderer';

// Loose type so we don't depend on the full burn-system module from
// inside the grenade feature.
type ApplyBurnFn = (
  entityType: string,
  entityId: string,
  blockId: string | undefined,
  tier: number,
  colors: [string, string, string],
  colorMode: 'static' | 'gradient' | 'tier' | 'random',
  baseDamage: number,
  armor: number,
  hitPosition?: THREE.Vector3,
  burnSeconds?: number,
) => void;

interface UseGrenadeSystemOptions {
  /** Plays the explosion VFX (flame plumes). May be null until mounted. */
  universalFlameRef: React.RefObject<UniversalFlameRendererHandle>;
  /** Camera, used to derive throw direction and listener position. */
  cameraRef: React.RefObject<THREE.Camera>;
  /** Optional bridge to the burn system. When set, every enemy in the
   *  blast radius also gets a burn DOT, anchored at the surface point
   *  of the enemy that faces the explosion. The ref is populated by
   *  FortressScene after useBurnSystem runs — hook-order matters
   *  because the grenade system mounts earlier in the scene. */
  applyBurnRef?: React.RefObject<ApplyBurnFn | null>;
  /** Optional ref to the ExplosionFX renderer (shockwave + flash).
   *  When set, explode() also fires the concussion layer. */
  explosionFxRef?: React.RefObject<{ spawn: (p: THREE.Vector3, r: number, c: string) => void } | null>;
  /** Siege Worlds Synty rocket-blast VFX, played alongside the flame plumes. */
  siegeExplosionRef?: React.RefObject<{ burst: (x: number, y: number, z: number, scale?: number) => void } | null>;
  /** Optional bridge to the player damage pipeline. If the player is
   *  caught in the blast radius they take damage through the same
   *  exponential falloff curve as enemies. */
  applyPlayerDamageRef?: React.RefObject<((dmg: number, kbDir: THREE.Vector3, kbForce: number) => void) | null>;
  /** Optional bridge to the camera-shake controller. Called per
   *  nearby explosion with a normalized magnitude 0..1. */
  triggerShakeRef?: React.RefObject<((magnitude: number, durationSec: number) => void) | null>;
}

/** Result of a single explosion — handed to the caller for UI / stats. */
export interface ExplosionResult {
  position: THREE.Vector3;
  tier: number;
  killed: number;
}


export function useGrenadeSystem({
  universalFlameRef,
  siegeExplosionRef,
  cameraRef,
  applyBurnRef,
  explosionFxRef,
}: UseGrenadeSystemOptions) {
  // Ref-based list so the per-frame tick has zero React overhead.
  const grenadesRef = useRef<GrenadeInstance[]>([]);
  // Monotonic id generator — keeps React keys unique even across throws.
  const nextIdRef = useRef(1);

  /**
   * Throw a grenade of the given tier from the camera position along
   * its current look direction (with an upward kick for the arc).
   * Returns true if the grenade was queued (false if we've hit the
   * live cap).
   */
  const throwGrenade = useCallback((tier: number): boolean => {
    if (grenadesRef.current.length >= MAX_LIVE_GRENADES) return false;
    const cam = cameraRef.current;
    if (!cam) return false;

    // Throw ALONG the actual look direction so the grenade goes where you aim
    // (straight up, steep angles, downward — all follow the crosshair), plus a
    // small fixed upward kick for a natural arc. (Previously the horizontal was
    // normalized to full speed and vertical decoupled, so it always flew the
    // same forward distance no matter where you pointed.)
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); // unit
    const vx = lookDir.x * GRENADE_THROW_SPEED;
    const vy = lookDir.y * GRENADE_THROW_SPEED + GRENADE_THROW_UP;
    const vz = lookDir.z * GRENADE_THROW_SPEED;

    // Spawn slightly in front of the camera (along the aim) so it doesn't
    // poof inside the head.
    const spawn = new THREE.Vector3(
      cam.position.x + lookDir.x * 0.5,
      cam.position.y - 0.2 + lookDir.y * 0.5,
      cam.position.z + lookDir.z * 0.5,
    );

    const g: GrenadeInstance = {
      id: `g${nextIdRef.current++}`,
      tier,
      position: spawn,
      velocity: new THREE.Vector3(vx, vy, vz),
      spawnedAt: performance.now() / 1000,
      fuseSec: GRENADE_FUSE_SEC,
      throwYaw: Math.atan2(vx, vz),
      isRolling: false,
      exploded: false,
    };
    grenadesRef.current.push(g);
    playThrowSound();
    return true;
  }, [cameraRef]);

  /**
   * Advance physics + fuse for every live grenade. Call once per frame
   * with the frame delta in seconds. Returns the list of explosions
   * that fired this frame (for stats / VFX) — usually 0 or 1.
   */
  const tick = useCallback((dt: number): ExplosionResult[] => {
    const explosions: ExplosionResult[] = [];
    const now = performance.now() / 1000;
    const list = grenadesRef.current;

    // dt cap so a long stall doesn't punt grenades through walls.
    const stepDt = Math.min(dt, 0.05);

    // Siege Worlds uses the heightmap-terrain + Box3 collider; Dreadroot the voxel field.
    const isSiege = getActiveGame() === 'siege-worlds';
    const world = isSiege ? _siegeCollider : _voxelCollider;

    let writeIdx = 0;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];

      // Fuse check first — exploded grenades get cleaned up next tick.
      if (now - g.spawnedAt >= g.fuseSec || g.exploded) {
        if (!g.exploded) {
          const res = explode(g);
          if (res) explosions.push(res);
          g.exploded = true;
        }
        continue;
      }

      // Physics integration extracted to @/features/combat so the
      // same step function will run on the L2 DO. The voxel + entity
      // colliders are passed in as plain interfaces so we don't drag
      // the client-specific singletons across the boundary.
      const pvx = g.velocity.x, pvy = g.velocity.y, pvz = g.velocity.z;
      stepGrenadePhysics(
        g,
        stepDt,
        world,
        _enemyColliderSource,
        {
          gravity: GRENADE_GRAVITY,
          bounceDamp: GRENADE_BOUNCE_DAMP,
          rollFrictionPerSec: GRENADE_ROLL_FRICTION_PER_SEC,
          rollThreshold: GRENADE_ROLL_THRESHOLD,
          visualRadius: GRENADE_VISUAL_RADIUS,
        },
      );

      // Heightmap ground (siege): clamp to the EXACT terrain surface so grenades rest on the
      // ground instead of sinking into a coarse voxel cell / sticking to phantom slope walls.
      if (isSiege) {
        const th = sampleHeight(g.position.x, g.position.z);
        if (th != null) {
          const floor = th + GRENADE_VISUAL_RADIUS;
          if (g.position.y < floor) {
            g.position.y = floor;
            if (g.velocity.y < 0) { g.velocity.y = -g.velocity.y * GRENADE_BOUNCE_DAMP; g.velocity.x *= 0.8; g.velocity.z *= 0.8; }
          }
        }
      }

      // Bounce/landing SFX: a velocity component sharply reversed = it hit a collider or dropped
      // onto the terrain. Throttled so a rolling grenade doesn't buzz.
      const hit = (pvy < -2 && g.velocity.y > 0.3) || Math.abs(g.velocity.x - pvx) > 2 || Math.abs(g.velocity.z - pvz) > 2;
      if (isSiege && hit) {
        const tnow = performance.now();
        if (tnow - (g.lastBounceAt ?? 0) > 130) {
          g.lastBounceAt = tnow;
          const cam = cameraRef.current;
          const d = cam ? Math.hypot(cam.position.x - g.position.x, cam.position.y - g.position.y, cam.position.z - g.position.z) : 0;
          void playSpatialSound('/wooden_thud_sound.mp3', d, { baseVolume: 0.4 });
        }
      }

      // Keep the grenade.
      list[writeIdx++] = g;
    }
    list.length = writeIdx;

    return explosions;
  }, []);

  /**
   * Apply the AoE damage and spawn the VFX for one grenade. Returns
   * an ExplosionResult or null if the VFX renderer wasn't mounted.
   */
  const explode = useCallback((g: GrenadeInstance): ExplosionResult | null => {
    const center = g.position.clone();
    const radius = grenadeRadius(g.tier);
    const baseDmg = grenadeDamage(g.tier);
    const baseKb = grenadeKnockback(g.tier);
    // Tier color triplet — used for both the burn flame and the
    // explosion VFX so they visually match.
    const colors = grenadeColors(g.tier);

    // ── Damage every registered enemy inside the radius ────────────
    let killed = 0;
    for (const adapter of enemyCombatRegistry.getAdapters()) {
      for (const enemy of adapter.getActiveEnemies()) {
        const hb = adapter.getHitbox(enemy);
        if (!hb) continue;
        // Nearest point on the hitbox cylinder to the blast (NOT the center) —
        // so a ground blast still reaches a 20m-tall giant whose center sits
        // ~11m up. Clamp Y into the body's vertical span; pull X/Z onto the
        // cylinder surface if the blast is outside its radius.
        const ey = Math.max(hb.bottomY, Math.min(hb.topY, center.y));
        const _hdx = center.x - hb.centerX;
        const _hdz = center.z - hb.centerZ;
        const _hlen = Math.hypot(_hdx, _hdz);
        let ex = center.x, ez = center.z;
        if (_hlen > hb.radius) {
          ex = hb.centerX + (_hdx / _hlen) * hb.radius;
          ez = hb.centerZ + (_hdz / _hlen) * hb.radius;
        }
        // Pure resolver — falloff + damage + 0–45° upward-tilted
        // knockback all in one place, shared with the future L2 DO.
        const blast = resolveBlastHit({
          blastX: center.x, blastY: center.y, blastZ: center.z,
          hitX: ex, hitY: ey, hitZ: ez,
          radius,
          baseDamage: baseDmg,
          baseKnockback: baseKb,
        });
        if (!blast.inRange) continue;
        const died = adapter.applyDamage(enemy, {
          damage: blast.damage,
          bulletSpeed: blast.bulletSpeed,
          knockbackDirX: blast.knockbackDirX,
          knockbackDirY: blast.knockbackDirY,
          knockbackDirZ: blast.knockbackDirZ,
          hitX: ex,
          hitY: ey,
          hitZ: ez,
          isHeadshot: false,
          source: 'explosion',
        });
        if (died) killed++;

        // Ignite survivors with a shared explosion burn (directional, biased onto
        // the blast-facing side; lasts longer the closer they were; follows the
        // body through the knockback flight). Reused by any AoE weapon — see
        // igniteExplosionBurn. Compound shwarm id "shwarmId::blockId" splits out.
        if (!died && applyBurnRef?.current) {
          const compoundId = adapter.getId(enemy);
          let burnEntityId = compoundId;
          let burnBlockId: string | undefined;
          if (adapter.type === 'shwarm') {
            const idx = compoundId.indexOf('::');
            if (idx >= 0) {
              burnEntityId = compoundId.slice(0, idx);
              burnBlockId = compoundId.slice(idx + 2);
            }
          }
          igniteExplosionBurn({
            applyBurn: applyBurnRef.current,
            type: adapter.type,
            entityId: burnEntityId,
            blockId: burnBlockId,
            hitbox: hb,
            blastX: center.x, blastY: center.y, blastZ: center.z,
            blastRadius: radius,
            tier: g.tier,
            colors,
            impactDamage: blast.damage,
          });
        }
      }
    }

    // ── Concussion: shockwave ring + bright flash ─────────────────
    // The brightest of the three tier colors (last entry) reads best
    // on top of bright daylight. Falls through gracefully if the FX
    // renderer hasn't mounted yet.
    if (explosionFxRef?.current) {
      explosionFxRef.current.spawn(center, radius, colors[2]);
    }

    // Siege Worlds: also play the Synty rocket-blast VFX, alongside (not instead of) the above.
    if (siegeExplosionRef?.current && getActiveGame() === 'siege-worlds') {
      siegeExplosionRef.current.burst(center.x, center.y, center.z, radius / 8);
    }

    // ── VFX: a big central flame + a ring of smaller plumes ────────
    // (colors already computed above for the burn anchor)
    //
    // Numbers bumped 2026-May-27: central plume +50% size,
    // +particles, longer life so the fire blast carries through
    // after the shockwave dissipates. The shockwave is the punchy
    // initial moment; the plumes are the lingering fireball.
    const renderer = universalFlameRef.current;
    if (renderer) {
      const centralFlame = renderer.spawnFlame({
        type: 'point',
        position: center,
        colors,
        size: radius * 0.9,
        height: radius * 1.3,
        duration: 0.9,
        particleCount: 160,
        colorMode: 'static',
      });
      // Ring of side plumes for visual coverage.
      const ringCount = 6;
      const ringIds: (string | null)[] = [centralFlame];
      for (let i = 0; i < ringCount; i++) {
        const ang = (i / ringCount) * Math.PI * 2;
        const dx = Math.cos(ang) * radius * 0.4;
        const dz = Math.sin(ang) * radius * 0.4;
        const ringPos = new THREE.Vector3(center.x + dx, center.y + 0.3, center.z + dz);
        const id = renderer.spawnFlame({
          type: 'plume',
          position: ringPos,
          colors,
          size: radius * 0.35,
          height: radius * 0.7,
          duration: 0.7,
          colorMode: 'static',
        });
        ringIds.push(id);
      }
      // Renderer manages auto-cleanup via duration, no follow-up needed.
    }

    // ── Sound: recorded boom played through the shared spatial-audio
    //    module so it shares the project's inverse-distance falloff
    //    with every other world SFX. Higher tier → slightly louder
    //    base volume so a T10 thumps harder than a T1.
    const cam = cameraRef.current;
    const distFromCam = cam ? center.distanceTo(cam.position) : 0;
    const tierVol = 0.6 + Math.min(0.35, (g.tier - 1) * 0.04);
    void playSpatialSound('/grenade_explosion.mp3', distFromCam, { baseVolume: tierVol });

    return { position: center, tier: g.tier, killed };
  }, [universalFlameRef, cameraRef, applyBurnRef, explosionFxRef, siegeExplosionRef]);

  // Register the physics tick so the consumer doesn't have to plumb
  // it through the main frame loop. Explosion results are dropped on
  // the floor here; if a future system needs them (achievements, etc.)
  // it can subscribe via a ref-based callback.
  useFrame((_, dt) => { tick(dt); });

  return {
    grenadesRef,
    throwGrenade,
  };
}
