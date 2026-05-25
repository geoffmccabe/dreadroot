// Shpider system — active instance list, admin/debug spawn commands,
// and the natural-spawn loop. The per-frame hop AI lives in the
// renderer (one pass over the active list does both AI tick + matrix
// building).

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ShpiderDefinition, ShpiderInstance } from '../types';
import {
  LEGS_PER_SHPIDER,
  CHUNK_SIZE,
  MAX_SHPIDERS_PER_CHUNK,
  SPAWN_CHECK_INTERVAL_MS,
} from '../constants';
import {
  createDeathFragments,
  type DeathFragment,
  DEATH_FRAGMENT_MAX,
} from '../lib/deathFragments';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import { isPointInFSZ } from '@/features/enemies/ai/fortressSafeZone';

// Capped at 50 because per-frame AI cost is O(N²) in the active spider
// count (stepShpiderHopAI iterates the full `others` list for spacing
// and stack checks). Profile trace 2026-May-24 (Trace-20260524T175147)
// showed the consolidated useFrame body burning 222s of 374s profile
// time (59%) when this cap was 200, with spider count >100. 50²/200²
// = 6.25% of the old work; ~16× less per-frame.
const MAX_TOTAL_SHPIDERS = 50;
const GROUP_SPREAD_RADIUS = 6;
const DEFAULT_GROUP_SIZE = 5;

// Every eligible tier rolls independently in the natural-spawn loop;
// rarity comes from each tier's own spawn_chance_per_minute column.
const NATURAL_SPAWN_CHUNK_RADIUS = 5;

interface UseShpiderSystemOptions {
  definitions: ShpiderDefinition[];
  cameraRef: React.RefObject<THREE.Camera | null>;
  isEnabled: boolean;
  userRoles: string[];
}

function getDefinitionByTier(defs: ShpiderDefinition[], tier: number): ShpiderDefinition | null {
  return defs.find(d => d.tier === tier) ?? null;
}

export function useShpiderSystem({
  definitions,
  cameraRef,
  isEnabled,
  userRoles,
}: UseShpiderSystemOptions) {
  const [shpiders, setShpiders] = useState<ShpiderInstance[]>([]);
  const shpidersRef = useRef<ShpiderInstance[]>([]);
  const [spawningEnabled, setSpawningEnabled] = useState(true);
  // Death-explosion fragments. Ref-only (rendered every frame from a
  // useFrame loop in the renderer; doesn't need React re-renders).
  const fragmentsRef = useRef<DeathFragment[]>([]);

  // Keep ref in sync with state for cheap reads from frame loops.
  useEffect(() => {
    shpidersRef.current = shpiders;
  }, [shpiders]);

  const isAdmin = userRoles.includes('admin') || userRoles.includes('superadmin');

  /** Count active shpiders in a chunk (used by the spawn cap). */
  const countInChunk = useCallback((chunkX: number, chunkZ: number): number => {
    let n = 0;
    for (const s of shpidersRef.current) {
      if (s.isActive && s.spawnChunkX === chunkX && s.spawnChunkZ === chunkZ) n++;
    }
    return n;
  }, []);

  /** Current chunk the player is standing in. */
  const getPlayerChunk = useCallback(() => {
    const cam = cameraRef.current;
    if (!cam) return null;
    return {
      x: Math.floor(cam.position.x / CHUNK_SIZE),
      z: Math.floor(cam.position.z / CHUNK_SIZE),
    };
  }, [cameraRef]);

  /** Spawn one shpider at an exact world position. */
  const spawnShpiderAt = useCallback((
    definition: ShpiderDefinition,
    worldX: number,
    worldZ: number,
  ): ShpiderInstance | null => {
    if (shpidersRef.current.length >= MAX_TOTAL_SHPIDERS) {
      console.warn('[Shpider] Max total reached');
      return null;
    }
    const id = `shpider_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const scale = 1 + (Math.random() * 2 - 1) * 0.15;
    // Per-leg random gait — wide ranges so two shpiders rarely twitch
    // in the same way. Phase 0-2π, frequency 0.6–2.4× base, lift 24–96%
    // of halfBody (3× the earlier range per user playtest feedback).
    const legPhaseOffsets   = Array.from({ length: LEGS_PER_SHPIDER }, () => Math.random() * Math.PI * 2);
    const legFrequencies    = Array.from({ length: LEGS_PER_SHPIDER }, () => 0.6 + Math.random() * 1.8);
    const legLiftAmplitudes = Array.from({ length: LEGS_PER_SHPIDER }, () => 0.24 + Math.random() * 0.72);

    const now = Date.now();
    const instance: ShpiderInstance = {
      id,
      definition,
      position: new THREE.Vector3(worldX, 0, worldZ),
      rotation: Math.random() * Math.PI * 2,
      currentHealth: definition.health,
      maxHealth: definition.health,
      isActive: true,
      spawnedAt: now,
      velocity: new THREE.Vector3(0, 0, 0),
      spawnChunkX: Math.floor(worldX / CHUNK_SIZE),
      spawnChunkZ: Math.floor(worldZ / CHUNK_SIZE),
      scale,
      legPhaseOffsets,
      legFrequencies,
      legLiftAmplitudes,
      headSlidePhase: Math.random() * Math.PI * 2,
      nextMandibleClickAt: now + 500 + Math.random() * 1500,
      mandibleClickStartedAt: 0,
      lastAttackAt: 0,
      eyeTargetX: 0,
      eyeTargetY: 0,
      eyePupilX: 0,
      eyePupilY: 0,
      eyeLastRandomLookAt: now,
      hop: {
        phase: 'idle',
        nextHopAt: now + definition.hop_interval_min_ms + Math.random() * (definition.hop_interval_max_ms - definition.hop_interval_min_ms),
        crawlStartAt: 0, crawlDurationMs: 0,
        crawlStartX: worldX, crawlStartZ: worldZ,
        crawlEndX:   worldX, crawlEndZ:   worldZ,
        hopStartAt: 0,
        hopDurationMs: definition.hop_duration_ms,
        startX: worldX, startY: 0, startZ: worldZ,
        endX: worldX,   endY: 0, endZ: worldZ,
        arcHeight: 0,
        endNormalX: 0, endNormalY: 1, endNormalZ: 0,
      },
      surfaceNormal: new THREE.Vector3(0, 1, 0),
    };

    shpidersRef.current = [...shpidersRef.current, instance];
    setShpiders(shpidersRef.current);
    return instance;
  }, []);

  /** Spawn a group near the player camera (admin/debug). */
  const spawnShpiderGroup = useCallback((tier: number, count: number = DEFAULT_GROUP_SIZE) => {
    const definition = getDefinitionByTier(definitions, tier);
    if (!definition) {
      console.warn('[Shpider] No definition for tier', tier);
      return;
    }
    const camera = cameraRef.current;
    if (!camera) return;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0;
    forward.normalize();

    const baseX = camera.position.x + forward.x * 8;
    const baseZ = camera.position.z + forward.z * 8;

    for (let i = 0; i < count; i++) {
      const angle = (Math.random() - 0.5) * Math.PI;
      const radius = Math.random() * GROUP_SPREAD_RADIUS;
      spawnShpiderAt(definition, baseX + Math.cos(angle) * radius, baseZ + Math.sin(angle) * radius);
    }
    console.log(`[Shpider] Spawned ${count} tier-${tier} shpiders`);
  }, [definitions, cameraRef, spawnShpiderAt]);

  /** Remove a shpider by id (used by combat). */
  const removeShpider = useCallback((id: string) => {
    shpidersRef.current = shpidersRef.current.filter(s => s.id !== id);
    setShpiders(shpidersRef.current);
  }, []);

  /**
   * Apply damage + knockback. Returns true if the shpider died.
   * `knockbackDir` should be the bullet's horizontal direction; we
   * scale by knockback_received (already < 1 for shpiders by default)
   * so they get budged but not punted across the map.
   */
  const damageShpider = useCallback((
    id: string,
    damage: number,
    knockbackDir: THREE.Vector3,
    bulletSpeed: number,
    isHeadshot: boolean = false,
  ): boolean => {
    const s = shpidersRef.current.find(x => x.id === id);
    if (!s || !s.isActive) return false;
    s.currentHealth -= damage;

    // Tier-scaled knockback. T1 (knockback_received ≈ 2.5) travels
    // ~10m before decaying; T10 (≈0.25) travels ~1m. Average is 25%
    // of a shombie's punt, per design. velocity decays in hopAI step.
    const kbScale = s.definition.knockback_received ?? 1;
    // hopAI's halflife = 0.25s, so total distance ≈ v0 × 0.36s.
    // 10m at kbScale=2.5 → v0=28 → coefficient ~11.
    const v0 = 11 * kbScale * Math.max(1, bulletSpeed / 60);
    s.velocity.x = knockbackDir.x * v0;
    s.velocity.z = knockbackDir.z * v0;

    // ANY damage interrupts the current hop/crawl so velocity-based
    // knockback can actually move the shpider. Without this, hop and
    // crawl lerp their position each frame and overwrite the kick.
    if (s.hop.phase === 'hopping' || s.hop.phase === 'crawling') {
      s.hop.phase = 'idle';
      s.hop.nextHopAt = Date.now() + 400;
    }

    if (s.currentHealth <= 0) {
      s.isActive = false;
      // Death explosion is ONLY for headshot kills — a body/leg kill
      // is supposed to just make the shpider vanish quietly. Per
      // 2026-May-24 user feedback: "Make the shpiders only explode if
      // they are killed by a headshot. If they are killed with a
      // body/leg shot then they just disappear."
      if (isHeadshot) {
        const newFrags = createDeathFragments(s, Date.now());
        const combined = fragmentsRef.current.concat(newFrags);
        if (combined.length > DEATH_FRAGMENT_MAX) {
          fragmentsRef.current = combined.slice(combined.length - DEATH_FRAGMENT_MAX);
        } else {
          fragmentsRef.current = combined;
        }
      }
      removeShpider(s.id);
      return true;
    }
    return false;
  }, [removeShpider]);

  /** Admin keybind: Ctrl+P spawns a group of T1 shpiders. */
  useEffect(() => {
    if (!isEnabled || !isAdmin) return;
    const handler = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (e.ctrlKey && e.code === 'KeyP') {
        e.preventDefault();
        spawnShpiderGroup(1, DEFAULT_GROUP_SIZE);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isEnabled, isAdmin, spawnShpiderGroup]);

  /**
   * Window-global hooks for the browser console — same convenience the
   * other enemy systems offer.
   *   window.__spawnShpiders(tier, count) — admin only
   *   window.__toggleShpiderSpawning() — admin only
   */
  useEffect(() => {
    if (!isAdmin) return;
    (window as any).__spawnShpiders = (tier = 1, count = DEFAULT_GROUP_SIZE) => {
      spawnShpiderGroup(tier, count);
    };
    (window as any).__toggleShpiderSpawning = () => {
      setSpawningEnabled(v => {
        console.log(`[Shpider] Natural spawning: ${!v ? 'ON' : 'OFF'}`);
        return !v;
      });
    };
    return () => {
      delete (window as any).__spawnShpiders;
      delete (window as any).__toggleShpiderSpawning;
    };
  }, [isAdmin, spawnShpiderGroup]);

  /**
   * Stack collapse loop. Every 500 ms, scan for vertical columns of
   * ≥ 4 shpiders. When found, remove all 4 and replace with a single
   * shpider at the bottom position, tier = max(tiers) + 2 (capped to
   * 10). Same-column = horizontal distance < body_size × 0.9.
   */
  useEffect(() => {
    if (!isEnabled) return;
    const collapseCheck = () => {
      const list = shpidersRef.current;
      if (list.length < 4) return;
      // Find columns of 4+ active shpiders. Pick a "base" candidate
      // and gather everyone in its XZ neighbourhood. Greedy — each
      // shpider is consumed by at most one collapse per tick.
      const consumed = new Set<string>();
      for (const base of list) {
        if (!base.isActive || consumed.has(base.id)) continue;
        const r = base.definition.body_size * 0.9;
        const r2 = r * r;
        const column: ShpiderInstance[] = [base];
        for (const o of list) {
          if (o === base || !o.isActive || consumed.has(o.id)) continue;
          const dx = o.position.x - base.position.x;
          const dz = o.position.z - base.position.z;
          if (dx * dx + dz * dz <= r2) column.push(o);
        }
        if (column.length < 4) continue;

        // Sort by Y so bottom comes first; take exactly 4.
        column.sort((a, b) => a.position.y - b.position.y);
        const group = column.slice(0, 4);
        const maxTier = group.reduce((m, x) => Math.max(m, x.definition.tier), 0);
        const newTier = Math.min(10, maxTier + 2);
        const bottom = group[0];
        const newDef = getDefinitionByTier(definitions, newTier);

        // Remove the 4 originals.
        for (const g of group) {
          g.isActive = false;
          consumed.add(g.id);
        }
        // Spawn the replacement at the bottom's XZ if a definition exists.
        // Without a valid definition, the column simply collapses into
        // nothing (rare — only when no higher tier exists at all).
        shpidersRef.current = shpidersRef.current.filter(s => !consumed.has(s.id));
        if (newDef) {
          spawnShpiderAt(newDef, bottom.position.x, bottom.position.z);
          console.log(`[Shpider] Stack of 4 collapsed → T${newTier} at (${bottom.position.x.toFixed(1)}, ${bottom.position.z.toFixed(1)})`);
        }
      }
      if (consumed.size > 0) setShpiders([...shpidersRef.current]);
    };
    const interval = setInterval(collapseCheck, 500);
    return () => clearInterval(interval);
  }, [isEnabled, definitions, spawnShpiderAt]);

  /**
   * Natural spawning loop. Every SPAWN_CHECK_INTERVAL_MS we look at
   * each chunk around the player and roll EACH eligible tier
   * independently. A tier's per-check chance is
   *   chance = def.spawn_chance_per_minute
   *          × distFalloff(chunkDist)            // halves per chunk
   *          × (CHECK_INTERVAL_MS / 60000)       // 2 s window
   *
   * Rarity comes from the per-tier `spawn_chance_per_minute` column:
   * T1 spawns often, T10 spawns rarely. Same distance-falloff curve
   * as Shombie.
   */
  useEffect(() => {
    if (!isEnabled || !spawningEnabled) return;
    if (!definitions || definitions.length === 0) return;

    const eligibleDefs = definitions.filter(d => (d.spawn_chance_per_minute ?? 0) > 0);
    if (eligibleDefs.length === 0) return;
    console.log(`[Shpider] Natural spawning started — ${eligibleDefs.length} eligible tiers (T${eligibleDefs.map(d => d.tier).join(',T')}), radius ${NATURAL_SPAWN_CHUNK_RADIUS} chunks`);

    const spawnCheck = () => {
      if (shpidersRef.current.length >= MAX_TOTAL_SHPIDERS) return;
      const player = getPlayerChunk();
      if (!player) return;

      for (let dx = -NATURAL_SPAWN_CHUNK_RADIUS; dx <= NATURAL_SPAWN_CHUNK_RADIUS; dx++) {
        for (let dz = -NATURAL_SPAWN_CHUNK_RADIUS; dz <= NATURAL_SPAWN_CHUNK_RADIUS; dz++) {
          const chunkDist = Math.max(Math.abs(dx), Math.abs(dz));
          if (chunkDist === 0) continue;
          const chunkX = player.x + dx;
          const chunkZ = player.z + dz;
          if (countInChunk(chunkX, chunkZ) >= MAX_SHPIDERS_PER_CHUNK) continue;

          const distMul = Math.pow(0.5, chunkDist - 1);
          for (const def of eligibleDefs) {
            const chance = (def.spawn_chance_per_minute ?? 0) * distMul * (SPAWN_CHECK_INTERVAL_MS / 60000);
            if (Math.random() < chance) {
              const worldX = chunkX * CHUNK_SIZE + Math.random() * CHUNK_SIZE;
              const worldZ = chunkZ * CHUNK_SIZE + Math.random() * CHUNK_SIZE;
              // Block spawns inside the Fortress Safe Zone — every
              // other enemy adapter respects it, shpiders shouldn't
              // be the exception. (User report 2026-May-24.)
              if (isPointInFSZ(worldX, 0, worldZ)) continue;
              spawnShpiderAt(def, worldX, worldZ);
              break; // one new spawn per chunk per check
            }
          }
        }
      }
    };

    // Initial check after a short delay so the world has settled.
    const initial = setTimeout(spawnCheck, 2000);
    const interval = setInterval(spawnCheck, SPAWN_CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [isEnabled, spawningEnabled, definitions, getPlayerChunk, countInChunk, spawnShpiderAt]);

  // Register with the universal EnemyCombatRegistry so every weapon
  // (bullets, flamethrower, future explosions) can damage shpiders
  // without per-type code in the weapon.
  useEffect(() => {
    // Reused per hit — avoids allocating a Vector3 every bullet impact.
    const dirScratch = new THREE.Vector3();
    return enemyCombatRegistry.register({
      type: 'shpider',
      getActiveEnemies: () => shpidersRef.current,
      getId: (s) => s.id,
      getHitbox: (s) => {
        if (!s.isActive) return null;
        const bodySize = s.definition.body_size * s.scale;
        const headSize = s.definition.head_size * s.scale;
        return {
          centerX: s.position.x,
          centerZ: s.position.z,
          bottomY: s.position.y,
          topY: s.position.y + bodySize + headSize,
          radius: bodySize * 0.85,
        };
      },
      applyDamage: (s, info) => {
        dirScratch.set(info.knockbackDirX, 0, info.knockbackDirZ);
        return damageShpider(s.id, info.damage, dirScratch, info.bulletSpeed || 0, info.isHeadshot);
      },
      getHitSoundUrl: () => '/bullet_impact_2.mp3',
      // Head zone = full headSize / (bodySize+headSize). Matches the
      // legacy rule "hitY > bodySize counts as head" — anything above
      // the body cube is the spider's head cube.
      getHeadshotZoneFraction: (s) => {
        const bodySize = s.definition.body_size * s.scale;
        const headSize = s.definition.head_size * s.scale;
        const total = bodySize + headSize;
        return total > 0 ? headSize / total : 0.25;
      },
      // Multiple flame anchors so fire wraps the whole spider —
      // body cube, head cube, and 4 leg-spread points. Sizes scale
      // with bodySize × scale.
      getFlameAttachPoints: (s) => {
        const bodySize = s.definition.body_size * s.scale;
        const headSize = s.definition.head_size * s.scale;
        const half = bodySize * 0.5;
        return [
          // Body cube — large center flame.
          { yOffset: half,              size: bodySize * 0.7, height: bodySize, particles: 16 },
          // Head — smaller flame on top.
          { yOffset: bodySize + headSize * 0.5,
            size: headSize * 0.8, height: headSize, particles: 10 },
          // Four leg-tip flames around the body (front/back/left/right).
          { xOffset:  half * 1.6, yOffset: 0,              size: half, height: half * 1.2, particles: 6 },
          { xOffset: -half * 1.6, yOffset: 0,              size: half, height: half * 1.2, particles: 6 },
          { zOffset:  half * 1.6, yOffset: 0,              size: half, height: half * 1.2, particles: 6 },
          { zOffset: -half * 1.6, yOffset: 0,              size: half, height: half * 1.2, particles: 6 },
        ];
      },
    });
  }, [damageShpider]);

  return {
    shpiders,
    shpidersRef,
    fragmentsRef,
    spawnShpiderAt,
    spawnShpiderGroup,
    removeShpider,
    damageShpider,
    spawningEnabled,
    setSpawningEnabled,
  };
}
