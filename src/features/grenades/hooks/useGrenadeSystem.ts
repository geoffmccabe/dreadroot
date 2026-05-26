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
import { playThrowSound } from '../lib/explosionSound';
import { playSpatialSound } from '@/lib/spatialAudio';
import type { UniversalFlameRendererHandle } from '@/components/fortress/UniversalFlameRenderer';

interface UseGrenadeSystemOptions {
  /** Plays the explosion VFX (flame plumes). May be null until mounted. */
  universalFlameRef: React.RefObject<UniversalFlameRendererHandle>;
  /** Camera, used to derive throw direction and listener position. */
  cameraRef: React.RefObject<THREE.Camera>;
}

/** Result of a single explosion — handed to the caller for UI / stats. */
export interface ExplosionResult {
  position: THREE.Vector3;
  tier: number;
  killed: number;
}

const _scratchToEnemy = new THREE.Vector3();

export function useGrenadeSystem({
  universalFlameRef,
  cameraRef,
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

    // Look direction projected onto the XZ plane gives the horizontal
    // throw direction. Y comes from the upward kick + the camera's
    // own vertical look (so aiming up throws further).
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const horizMag = Math.hypot(lookDir.x, lookDir.z) || 1;

    const vx = (lookDir.x / horizMag) * GRENADE_THROW_SPEED;
    const vz = (lookDir.z / horizMag) * GRENADE_THROW_SPEED;
    // 60% of the look's y-component contributes — so looking up
    // throws higher but never straight at the player's feet.
    const vy = GRENADE_THROW_UP + lookDir.y * GRENADE_THROW_SPEED * 0.6;

    // Spawn slightly in front of the camera so the grenade doesn't
    // poof inside the head.
    const spawn = new THREE.Vector3(
      cam.position.x + (lookDir.x / horizMag) * 0.5,
      cam.position.y - 0.2,
      cam.position.z + (lookDir.z / horizMag) * 0.5,
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

      // Integrate.
      g.velocity.y -= GRENADE_GRAVITY * stepDt;
      const nextX = g.position.x + g.velocity.x * stepDt;
      const nextY = g.position.y + g.velocity.y * stepDt;
      const nextZ = g.position.z + g.velocity.z * stepDt;

      // Simple voxel collision: probe each axis independently so we
      // can bounce off walls and roll along floors without getting
      // stuck in corners.
      let px = nextX;
      let py = nextY;
      let pz = nextZ;

      const r = GRENADE_VISUAL_RADIUS;

      // Y first (most important — produces the bounce off floor).
      const yCellNext = Math.floor(nextY - r);
      if (g.velocity.y < 0 && worldCollisionGrid.hasVoxel(Math.floor(g.position.x), yCellNext, Math.floor(g.position.z))) {
        // Snap to top of voxel, dampen Y velocity.
        py = yCellNext + 1 + r + 0.001;
        g.velocity.y = -g.velocity.y * GRENADE_BOUNCE_DAMP;
        // Also dampen horizontal each bounce a bit.
        g.velocity.x *= 0.8;
        g.velocity.z *= 0.8;
      } else if (g.velocity.y > 0 && worldCollisionGrid.hasVoxel(Math.floor(g.position.x), Math.floor(nextY + r), Math.floor(g.position.z))) {
        // Hit a ceiling.
        py = Math.floor(nextY + r) - r - 0.001;
        g.velocity.y = -g.velocity.y * GRENADE_BOUNCE_DAMP;
      } else if (nextY - r < 0) {
        // World floor.
        py = r + 0.001;
        g.velocity.y = -g.velocity.y * GRENADE_BOUNCE_DAMP;
        g.velocity.x *= 0.8;
        g.velocity.z *= 0.8;
      }

      // X-axis wall.
      if (g.velocity.x !== 0) {
        const xCell = Math.floor(g.velocity.x > 0 ? nextX + r : nextX - r);
        if (worldCollisionGrid.hasVoxel(xCell, Math.floor(py), Math.floor(g.position.z))) {
          px = g.position.x;
          g.velocity.x = -g.velocity.x * GRENADE_BOUNCE_DAMP;
        }
      }
      // Z-axis wall.
      if (g.velocity.z !== 0) {
        const zCell = Math.floor(g.velocity.z > 0 ? nextZ + r : nextZ - r);
        if (worldCollisionGrid.hasVoxel(Math.floor(px), Math.floor(py), zCell)) {
          pz = g.position.z;
          g.velocity.z = -g.velocity.z * GRENADE_BOUNCE_DAMP;
        }
      }

      // Entity collision: bounce off enemy cylinders (shpiders,
      // shombies, walapas, etc.). World blocks already handled above;
      // this pass uses the EnemyCombatRegistry hitboxes as colliders
      // so a grenade can't pass through an enemy on its way to the
      // ground. Sphere-vs-cylinder horizontal test, reflect XZ
      // velocity outward, dampen the bounce.
      for (const adapter of enemyCombatRegistry.getAdapters()) {
        for (const enemy of adapter.getActiveEnemies()) {
          const hb = adapter.getHitbox(enemy);
          if (!hb) continue;
          // Vertical overlap check first.
          if (py + r < hb.bottomY || py - r > hb.topY) continue;
          // Horizontal distance vs. sum of radii.
          const dx = px - hb.centerX;
          const dz = pz - hb.centerZ;
          const distSq = dx * dx + dz * dz;
          const reach = hb.radius + r;
          if (distSq > reach * reach) continue;
          // Push grenade out along the outward normal, reflect XZ
          // velocity, dampen so the bounce isn't huge.
          const dist = Math.sqrt(distSq) || 0.001;
          const nx = dx / dist;
          const nz = dz / dist;
          px = hb.centerX + nx * (reach + 0.001);
          pz = hb.centerZ + nz * (reach + 0.001);
          // Reflect: v -= 2 * (v · n) * n
          const vDotN = g.velocity.x * nx + g.velocity.z * nz;
          if (vDotN < 0) {
            g.velocity.x -= 2 * vDotN * nx;
            g.velocity.z -= 2 * vDotN * nz;
            g.velocity.x *= GRENADE_BOUNCE_DAMP;
            g.velocity.z *= GRENADE_BOUNCE_DAMP;
          }
        }
      }

      g.position.set(px, py, pz);

      // Switch to "rolling" once we've come to rest vertically and
      // horizontal velocity is small — applies ground friction so
      // the grenade visibly comes to a stop instead of zooming.
      const grounded = Math.abs(g.velocity.y) < 1.5
        && (py - r <= 0.05
            || worldCollisionGrid.hasVoxel(Math.floor(px), Math.floor(py - r - 0.05), Math.floor(pz)));
      if (grounded) {
        const speed = Math.hypot(g.velocity.x, g.velocity.z);
        g.isRolling = speed < GRENADE_ROLL_THRESHOLD;
        if (g.isRolling) {
          // Friction: exponential decay at FRICTION_PER_SEC.
          const decay = Math.pow(GRENADE_ROLL_FRICTION_PER_SEC, stepDt);
          g.velocity.x *= decay;
          g.velocity.z *= decay;
          // Stop the bounce drift on Y while rolling.
          if (g.velocity.y < 0) g.velocity.y = 0;
        }
      } else {
        g.isRolling = false;
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

    // ── Damage every registered enemy inside the radius ────────────
    let killed = 0;
    for (const adapter of enemyCombatRegistry.getAdapters()) {
      for (const enemy of adapter.getActiveEnemies()) {
        const hb = adapter.getHitbox(enemy);
        if (!hb) continue;
        // Use hitbox center as the damage point.
        const ex = hb.centerX;
        const ey = (hb.bottomY + hb.topY) * 0.5;
        const ez = hb.centerZ;
        _scratchToEnemy.set(ex - center.x, ey - center.y, ez - center.z);
        const dist = _scratchToEnemy.length();
        if (dist > radius) continue;

        // Linear falloff: full damage at center, 0 at the edge.
        const falloff = 1 - dist / radius;
        const damage = Math.max(1, Math.round(baseDmg * falloff));
        // Knockback direction = away from center on XZ.
        const dHoriz = Math.max(0.01, Math.hypot(_scratchToEnemy.x, _scratchToEnemy.z));
        const kbX = _scratchToEnemy.x / dHoriz;
        const kbZ = _scratchToEnemy.z / dHoriz;
        const died = adapter.applyDamage(enemy, {
          damage,
          bulletSpeed: baseKb * falloff,
          knockbackDirX: kbX,
          knockbackDirY: 0,
          knockbackDirZ: kbZ,
          hitX: ex,
          hitY: ey,
          hitZ: ez,
          isHeadshot: false,
          source: 'explosion',
        });
        if (died) killed++;
      }
    }

    // ── VFX: a big central flame + a ring of smaller plumes ────────
    const renderer = universalFlameRef.current;
    const colors = grenadeColors(g.tier);
    if (renderer) {
      const centralFlame = renderer.spawnFlame({
        type: 'point',
        position: center,
        colors,
        size: radius * 0.6,
        height: radius * 0.9,
        duration: 0.6,
        particleCount: 80,
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
          size: radius * 0.25,
          height: radius * 0.5,
          duration: 0.5,
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
  }, [universalFlameRef, cameraRef]);

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
