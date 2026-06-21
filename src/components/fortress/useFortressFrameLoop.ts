import { useFrame } from '@react-three/fiber';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useRef, useEffect } from 'react';
import * as THREE from 'three';

import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';
import { tickBudgetedWork } from '@/lib/budgetedWork';
import { playSpatialSound } from '@/lib/spatialAudio';
import { getSoundUrl } from '@/hooks/useGameSounds';
import { entityCollisionGrid, worldCollisionGrid } from '@/lib/spatialHashGrid';
import { raycastMesh } from '@/components/siege/meshColliderSystem';
import { initializeShnakeRevenge, markShnakeIndignant } from '@/features/enemies/ai/adapters/ShnakeAdapter';
import { enemyCombatRegistry, type RaycastResult } from '@/features/enemies/combat/EnemyCombatRegistry';
import { resolveBulletHit, BASE_BULLET_DAMAGE, stepBulletPhysics } from '@/features/combat';
import { emitBlood } from '@/features/blood/bloodSystem';
import { getActiveWeapon } from '@/config/activeWeapon';

const _raycastResult: RaycastResult = { adapter: null, enemy: null, t: 0, hitX: 0, hitY: 0, hitZ: 0 };
import { startPerfStallObservers, stopPerfStallObservers } from '@/lib/perfStallObservers';

import {
  BULLET_GRAVITY,
  BULLET_RENDER_THROTTLE,
  WISP_RENDER_THROTTLE,
  calculateHitNormal,
  type BulletLocal,
} from './fortressScene.constants';

// Pre-allocated scratch objects for per-frame use (avoid GC stutter)
const _scratchBulletDir = new THREE.Vector3();
const _scratchHitPos = new THREE.Vector3();
const _scratchCoinPos = new THREE.Vector3();
const _scratchGroundPos = new THREE.Vector3();

export function useFortressFrameLoop({
  camera,
  skyRef,
  lightingRef,
  bulletsComponentRef,
  wispParticlesMeshRef,
  fpsCounterRef,
  tracersRef,

  wispParticlesRef,
  setWispRenderTrigger,
  lastWispRender,

  bulletsRef,
  bulletPoolRef,
  setBulletRenderTrigger,
  lastBulletRender,

  bulletImpactsRef,
  nebulaImpactsRef,
  applyBurnRef,
  groundHeightFn,
  getDefinitionRef,
  onCoinHit,
  playAudio,
  audioRefs,

  blocksMapRef,
  blocks,

  shwarmsRef,
  shwarmRendererRef,
  damageBlock,
  onPointsEarned,

  shnakesRef,
  shnakeRendererRef,
  damageShnakeHead,
  onShnakeKilled,

  shombiesRef,
  shombieRendererRef,
  damageShombie,

  shroomersRef,
  shroomerRendererRef,
  damageShroomer,

  vortaxesRef,
  vortaxRendererRef,

  walapasRef,
  updateWalapaMovement,

  shtickmenRef,
  damageShtickman,
  updateShtickmanMovement,

  shpidersRef,
  damageShpider,

  isAIControlled,
  useNebulaForBulletImpacts,
  debugBullets,
}: {
  camera: any;
  skyRef: MutableRefObject<any>;
  lightingRef: MutableRefObject<any>;
  bulletsComponentRef: MutableRefObject<any>;
  wispParticlesMeshRef: MutableRefObject<any>;
  fpsCounterRef: MutableRefObject<any>;
  tracersRef: MutableRefObject<any>;

  wispParticlesRef: MutableRefObject<any[]>;
  setWispRenderTrigger: Dispatch<SetStateAction<number>>;
  lastWispRender: MutableRefObject<number>;

  bulletsRef: MutableRefObject<BulletLocal[]>;
  bulletPoolRef: MutableRefObject<BulletLocal[]>;
  setBulletRenderTrigger: Dispatch<SetStateAction<number>>;
  lastBulletRender: MutableRefObject<number>;

  bulletImpactsRef: MutableRefObject<any>;
  nebulaImpactsRef: MutableRefObject<any>;
  applyBurnRef: MutableRefObject<((...args: any[]) => void) | null>;
  groundHeightFn?: (x: number, z: number) => number | null;
  getDefinitionRef: MutableRefObject<(tier: number) => any>;
  onCoinHit: (pos: any) => void;
  playAudio: (audioEl?: HTMLAudioElement | null) => void;
  audioRefs: MutableRefObject<any>;

  blocksMapRef: MutableRefObject<any>;
  blocks: any[];

  shwarmsRef: MutableRefObject<any[]>;
  shwarmRendererRef: MutableRefObject<any>;
  damageBlock: (...args: any[]) => any;
  onPointsEarned?: (points: number) => void;

  shnakesRef: MutableRefObject<any[]>;
  shnakeRendererRef: MutableRefObject<any>;
  damageShnakeHead: (...args: any[]) => any;
  onShnakeKilled?: (tier: number) => void;

  shombiesRef: MutableRefObject<any[]>;
  shombieRendererRef: MutableRefObject<any>;
  damageShombie: (...args: any[]) => any;

  shroomersRef: MutableRefObject<any[]>;
  shroomerRendererRef: MutableRefObject<any>;
  damageShroomer: (...args: any[]) => any;

  vortaxesRef: MutableRefObject<any[]>;
  vortaxRendererRef: MutableRefObject<any>;

  walapasRef: MutableRefObject<any[]>;
  updateWalapaMovement: (delta: number) => void;

  shtickmenRef: MutableRefObject<any[]>;
  damageShtickman: (id: string, damage: number, knockbackDir?: THREE.Vector3) => boolean;
  updateShtickmanMovement: (delta: number, playerPosition: THREE.Vector3) => void;

  shpidersRef: MutableRefObject<any[]>;
  damageShpider: (id: string, damage: number, knockbackDir: THREE.Vector3, bulletSpeed: number) => boolean;

  isAIControlled: boolean;
  useNebulaForBulletImpacts: boolean;
  debugBullets: boolean;
}) {
  // keep args values referenced so TS doesn't tree-shake them in dev builds
  void debugBullets;

  // Track previous frame time for real frame time measurement
  const lastFrameNowRef = useRef<number>(performance.now());
  // Throttle expensive diagnostics captures to the DF sample interval (100ms)
  // instead of running them every frame. See useFrame body below.
  const lastDiagCaptureRef = useRef<number>(0);

  // Start/stop performance stall observers (longtask, event loop lag)
  useEffect(() => {
    startPerfStallObservers();
    return () => stopPerfStallObservers();
  }, []);

  useFrame((state, delta) => {
  // CRITICAL: Measure real frame time FIRST - this is what D-Flow needs to detect freezes
  const now = performance.now();
  const frameMs = now - lastFrameNowRef.current;
  lastFrameNowRef.current = now;
  diagnostics.recordFrameTime(frameMs);

  const frameStart = now;

  // D1B: Reset per-frame diagnostic counters ONCE at start of frame
  // This allows InstancedBlockGroup to ACCUMULATE visibleBlocks
  diagnostics.visibleBlocks = 0;
  diagnostics.particleCount = 0;
  diagnostics.coinCount = 0;
  
  // Update diagnostics metrics (per-frame counter resets stay above; these
  // are cheap reads of position/length so leave them per-frame).
  diagnostics.cameraX = camera.position.x;
  diagnostics.cameraY = camera.position.y;
  diagnostics.cameraZ = camera.position.z;
  diagnostics.particleCount = wispParticlesRef.current.length;

  // EXPENSIVE captures — throttled to the DF sample interval (~100ms).
  // Real-world trace 2026-May-19 (Trace-20260519T204124): this useFrame
  // callback was the #1 hot spot at 4.3s/12% of profile time, with the
  // per-enemy-type iteration loops + renderer/grid stat reads burning
  // CPU every frame even though `diagnostics.tick()` only WRITES a
  // sample every 100ms. At 60fps that's ~5/6 frames of pure waste. Also
  // bypass entirely when DF isn't recording — the enemy for-loops below
  // ran unconditionally before, which is why FPS was bad even without
  // a DF report being captured.
  const nowDiag = now;
  if (
    diagnostics.enabled &&
    nowDiag - (lastDiagCaptureRef.current || 0) >= 100
  ) {
    lastDiagCaptureRef.current = nowDiag;

    diagnostics.captureRendererStats(state.gl);
    diagnostics.captureGridStats(worldCollisionGrid.size, entityCollisionGrid.size);

    const activeShwarms = shwarmsRef.current;
    let shwarmBlockCount = 0;
    for (let i = 0; i < activeShwarms.length; i++) {
      const shwarm = activeShwarms[i];
      for (let j = 0; j < shwarm.blocks.length; j++) {
        if (shwarm.blocks[j].isAlive) shwarmBlockCount++;
      }
    }
    diagnostics.captureShwarmStats(activeShwarms.length, shwarmBlockCount);

    const activeShnakes = shnakesRef.current;
    let shnakeSegmentCount = 0;
    for (let i = 0; i < activeShnakes.length; i++) {
      shnakeSegmentCount += activeShnakes[i].segments.length;
    }
    diagnostics.captureShnakeStats(activeShnakes.length, shnakeSegmentCount);

    diagnostics.captureShombieStats(shombiesRef.current.length);
  }
  
  // Call consolidated component updates (eliminates 5 separate useFrame hooks)
  diagnostics.startTiming('render');
  skyRef.current?.update(delta);
  lightingRef.current?.update();
  bulletsComponentRef.current?.update();
  wispParticlesMeshRef.current?.update();
  fpsCounterRef.current?.update();
  tracersRef.current?.update();
  diagnostics.recordTiming('render');

  // Tick the centralized frame loop registry (runs all registered callbacks)
  diagnostics.startTiming('frame');
  frameLoop.tick(delta, state.clock.elapsedTime);
  diagnostics.recordTiming('frame');

  // Process budgeted work (distant chunk collider creation + unload collider removal)
  tickBudgetedWork(3.0);

  // Tick the diagnostics system (writes sample every 100ms)
  diagnostics.tick();

  const nowMs = Date.now();
  let needsBulletRender = false;
  let needsWispRender = false;
  
  // Update bullets directly in ref - IN-PLACE filtering (no new arrays!)
  diagnostics.startTiming('bullets');
  const bullets = bulletsRef.current;
  if (bullets.length > 0) {
    const coins = (window as any).getCoins ? (window as any).getCoins() : [];
    const activeShwarms = shwarmsRef.current || [];
    let writeIndex = 0;
    
    for (let i = 0; i < bullets.length; i++) {
      const bullet = bullets[i];
      
      // Store previous position BEFORE updating (for ray collision)
      const prevX = bullet.position.x;
      const prevY = bullet.position.y;
      const prevZ = bullet.position.z;
      
      // Physics integration extracted to @/features/combat so the
      // same step function will run on the L2 DO. life is decremented
      // here too; the caller still owns the dead-bullet filter below.
      stepBulletPhysics(bullet, delta, { gravity: BULLET_GRAVITY });
      
      // Add tracer segment only if bullet moved at least 2 meters since last segment
      const lastTracerPos = (bullet as any).lastTracerPos;
      if (!lastTracerPos) {
        (bullet as any).lastTracerPos = { x: prevX, y: prevY, z: prevZ };
        tracersRef.current?.addSegment(
          prevX, prevY, prevZ,
          bullet.position.x, bullet.position.y, bullet.position.z,
          bullet.color
        );
      } else {
        const dx = bullet.position.x - lastTracerPos.x;
        const dy = bullet.position.y - lastTracerPos.y;
        const dz = bullet.position.z - lastTracerPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        
        if (distSq >= 25.0) { // 5 meters squared
          tracersRef.current?.addSegment(
            lastTracerPos.x, lastTracerPos.y, lastTracerPos.z,
            bullet.position.x, bullet.position.y, bullet.position.z,
            bullet.color
          );
          lastTracerPos.x = bullet.position.x;
          lastTracerPos.y = bullet.position.y;
          lastTracerPos.z = bullet.position.z;
        }
      }
      
      // (life decremented inside stepBulletPhysics above)

      // Store previous pos in bullet for collision check later
      (bullet as any).prevX = prevX;
      (bullet as any).prevY = prevY;
      (bullet as any).prevZ = prevZ;
      
      if (bullet.life > 0) {
        let hit = false;
        
        // Check coin collisions
        for (const coin of coins) {
          if (coin.visible) {
            const distance = bullet.position.distanceTo(coin.position);
            if (distance < 0.8) {
              if ((window as any).createCoinExplosion) {
                _scratchCoinPos.copy(coin.position);
              (window as any).createCoinExplosion(_scratchCoinPos, coin.velocity);
              }
              coin.visible = false;
              if (coin.mesh) coin.mesh.visible = false;
              onCoinHit(coin.position);
              playAudio(audioRefs.current.coinHit);
              hit = true;
              needsBulletRender = true;
              break;
            }
          }
        }
        
        // Check shwarm collisions (if not already hit something)
        if (!hit) {
          // Use ray-AABB intersection to prevent bullets tunneling through targets
          // Check the bullet's travel path this frame, not just its current position
          const SHWARM_HALF_SIZE = 0.35; // Slightly larger for forgiving hit detection
          // Get the tier's original muzzle velocity for damage scaling
          const tierDef = getDefinitionRef.current(bullet.tier);
          const originalMuzzleVelocity = tierDef.velocity;
          
          // Calculate bullet's actual displacement this frame (not direction-based)
          const moveDistanceXZ = bullet.speed * delta;
          const moveDistanceY = bullet.velocityY * delta + 0.5 * BULLET_GRAVITY * delta * delta; // Include gravity in prev calc
          const prevX = bullet.position.x - bullet.direction.x * moveDistanceXZ;
          const prevY = bullet.position.y - moveDistanceY;
          const prevZ = bullet.position.z - bullet.direction.z * moveDistanceXZ;
          
          // Total displacement vector for ray intersection
          const dispX = bullet.position.x - prevX;
          const dispY = bullet.position.y - prevY;
          const dispZ = bullet.position.z - prevZ;
          const dispLen = Math.sqrt(dispX * dispX + dispY * dispY + dispZ * dispZ);
          
          // Normalized direction for this frame's movement
          const ndx = dispLen > 0.0001 ? dispX / dispLen : 0;
          const ndy = dispLen > 0.0001 ? dispY / dispLen : 0;
          const ndz = dispLen > 0.0001 ? dispZ / dispLen : 0;
          
          for (const shwarm of activeShwarms) {
            if (!shwarm.isActive || hit) break;

            // Broad-phase: skip whole shwarm if no block can be reached this frame.
            // Real-world trace 2026-May-19: bullet x enemy x part inner loops were
            // dominating useFrame self-time. Use first alive block as representative;
            // bail if bullet is farther than shwarm spread + dispLen.
            const rep0 = shwarm.blocks.find(b => b.isAlive);
            if (!rep0) continue;
            const BAIL = 15 + dispLen; // shwarm groups span ~5-10 blocks
            const bdx = bullet.position.x - rep0.position.x;
            const bdy = bullet.position.y - rep0.position.y;
            const bdz = bullet.position.z - rep0.position.z;
            if (bdx*bdx + bdy*bdy + bdz*bdz > BAIL*BAIL) continue;

            for (const block of shwarm.blocks) {
              if (!block.isAlive) continue;

              // AABB bounds centered on block
              const bx = block.position.x;
              const by = block.position.y;
              const bz = block.position.z;
              const minX = bx - SHWARM_HALF_SIZE;
              const maxX = bx + SHWARM_HALF_SIZE;
              const minY = by - SHWARM_HALF_SIZE;
              const maxY = by + SHWARM_HALF_SIZE;
              const minZ = bz - SHWARM_HALF_SIZE;
              const maxZ = bz + SHWARM_HALF_SIZE;
              
              // Ray-AABB intersection (slab method)
              let tMin = 0;
              let tMax = dispLen;
              
              // X slab
              if (Math.abs(ndx) > 0.0001) {
                const t1 = (minX - prevX) / ndx;
                const t2 = (maxX - prevX) / ndx;
                const tNear = Math.min(t1, t2);
                const tFar = Math.max(t1, t2);
                tMin = Math.max(tMin, tNear);
                tMax = Math.min(tMax, tFar);
              } else if (prevX < minX || prevX > maxX) {
                continue;
              }
              
              // Y slab
              if (Math.abs(ndy) > 0.0001) {
                const t1 = (minY - prevY) / ndy;
                const t2 = (maxY - prevY) / ndy;
                const tNear = Math.min(t1, t2);
                const tFar = Math.max(t1, t2);
                tMin = Math.max(tMin, tNear);
                tMax = Math.min(tMax, tFar);
              } else if (prevY < minY || prevY > maxY) {
                continue;
              }
              
              // Z slab
              if (Math.abs(ndz) > 0.0001) {
                const t1 = (minZ - prevZ) / ndz;
                const t2 = (maxZ - prevZ) / ndz;
                const tNear = Math.min(t1, t2);
                const tFar = Math.max(t1, t2);
                tMin = Math.max(tMin, tNear);
                tMax = Math.min(tMax, tFar);
              } else if (prevZ < minZ || prevZ > maxZ) {
                continue;
              }
              
              // If tMin <= tMax, ray intersects the box
              if (tMin <= tMax) {
                // Hit shwarm block!
                hit = true;
                needsBulletRender = true;

                // Damage from the canonical pure resolver — same formula as
                // the universal registry path + the future L2 DO validator.
                // Shwarm blocks are point-targets (no sub-zone headshots), so
                // headFrac = 0; the block's 1m AABB is the hitbox bounds.
                const hitResolved = resolveBulletHit({
                  hitX: bx, hitY: by, hitZ: bz,
                  hitboxBottomY: by - SHWARM_HALF_SIZE,
                  hitboxTopY:    by + SHWARM_HALF_SIZE,
                  headFrac: 0,
                  bulletDirX: bullet.direction.x,
                  bulletDirY: bullet.direction.y,
                  bulletDirZ: bullet.direction.z,
                  bulletSpeed: bullet.speed,
                  tierMaxSpeed: originalMuzzleVelocity,
                  baseDamage: getActiveWeapon()?.maxDamage ?? BASE_BULLET_DAMAGE,
                });

                // Apply damage and get actual damage dealt (capped at remaining health)
                const { actualDamage } = damageBlock(shwarm.id, block.id, hitResolved.damage);
                
                // Award points based on actual damage dealt
                if (actualDamage > 0 && onPointsEarned) {
                  onPointsEarned(actualDamage);
                }
                
                // Create particle effect at hit position using the shwarm's texture
                if (shwarmRendererRef.current) {
                  _scratchHitPos.copy(block.position);
                  shwarmRendererRef.current.createHitEffect(
                    _scratchHitPos,
                    shwarm.definition.texture_url
                  );
                }
                
                // Play hit sound directly (bypass throttle for combat feedback)
                const hitSound = audioRefs.current.shwarmHit;
                if (hitSound) {
                  hitSound.currentTime = 0;
                  hitSound.play().catch(() => {});
                }
                
                break;
              }
            }
          }
        }
        
        // Check SHNAKE collisions (if not already hit something)
        // Head takes damage, body ricochets like building blocks
        if (!hit) {
          const SHNAKE_HALF_SIZE = 0.5;
          const tierDef = getDefinitionRef.current(bullet.tier);
          const originalMuzzleVelocity = tierDef.velocity;
          
          // Use stored previous position
          const prevX = (bullet as any).prevX ?? bullet.position.x;
          const prevY = (bullet as any).prevY ?? bullet.position.y;
          const prevZ = (bullet as any).prevZ ?? bullet.position.z;
          
          const dispX = bullet.position.x - prevX;
          const dispY = bullet.position.y - prevY;
          const dispZ = bullet.position.z - prevZ;
          const dispLen = Math.sqrt(dispX * dispX + dispY * dispY + dispZ * dispZ);
          
          if (dispLen > 0.001) {
            const ndx = dispX / dispLen;
            const ndy = dispY / dispLen;
            const ndz = dispZ / dispLen;
            
            // Check all shnakes' segments
            const shnakes = shnakesRef.current || [];
            for (const shnake of shnakes) {
              if (!shnake.isActive || hit) break;

              // Broad-phase: distance from bullet to head, bail with segments+dispLen.
              // Real-world trace 2026-May-19: this inner loop was a hot spot.
              const head = shnake.segments[0];
              if (!head) continue;
              const SHNAKE_BAIL = shnake.segments.length + dispLen + 2;
              const sdx = bullet.position.x - head.x;
              const sdy = bullet.position.y - head.y;
              const sdz = bullet.position.z - head.z;
              if (sdx*sdx + sdy*sdy + sdz*sdz > SHNAKE_BAIL*SHNAKE_BAIL) continue;

              for (let segIdx = 0; segIdx < shnake.segments.length; segIdx++) {
                const seg = shnake.segments[segIdx];
                const isHead = segIdx === 0;
                
                // AABB for this segment
                const minX = seg.x;
                const maxX = seg.x + 1;
                const minY = seg.y;
                const maxY = seg.y + 1;
                const minZ = seg.z;
                const maxZ = seg.z + 1;
                
                // Ray-AABB intersection (slab method)
                let tMin = 0;
                let tMax = dispLen;
                
                // X slab
                if (Math.abs(ndx) > 0.0001) {
                  const t1 = (minX - prevX) / ndx;
                  const t2 = (maxX - prevX) / ndx;
                  tMin = Math.max(tMin, Math.min(t1, t2));
                  tMax = Math.min(tMax, Math.max(t1, t2));
                } else if (prevX < minX || prevX > maxX) continue;
                
                // Y slab
                if (Math.abs(ndy) > 0.0001) {
                  const t1 = (minY - prevY) / ndy;
                  const t2 = (maxY - prevY) / ndy;
                  tMin = Math.max(tMin, Math.min(t1, t2));
                  tMax = Math.min(tMax, Math.max(t1, t2));
                } else if (prevY < minY || prevY > maxY) continue;
                
                // Z slab
                if (Math.abs(ndz) > 0.0001) {
                  const t1 = (minZ - prevZ) / ndz;
                  const t2 = (maxZ - prevZ) / ndz;
                  tMin = Math.max(tMin, Math.min(t1, t2));
                  tMax = Math.min(tMax, Math.max(t1, t2));
                } else if (prevZ < minZ || prevZ > maxZ) continue;
                
                if (tMin <= tMax) {
                  // HIT a shnake segment!
                  const hitX = prevX + ndx * tMin;
                  const hitY = prevY + ndy * tMin;
                  const hitZ = prevZ + ndz * tMin;
                  const hitPos = new THREE.Vector3(hitX, hitY, hitZ);
                  
                  if (isHead) {
                    // HEAD: takes damage, bullet destroyed
                    hit = true;
                    needsBulletRender = true;

                    // Damage from the canonical pure resolver — same formula
                    // as the universal registry path + the future L2 DO
                    // validator. Shnake head is the entire top segment, so
                    // headFrac = 0 (no sub-zone bonus).
                    const hitResolved = resolveBulletHit({
                      hitX, hitY, hitZ,
                      hitboxBottomY: seg.y,
                      hitboxTopY:    seg.y + 1,
                      headFrac: 0,
                      bulletDirX: bullet.direction.x,
                      bulletDirY: bullet.direction.y,
                      bulletDirZ: bullet.direction.z,
                      bulletSpeed: bullet.speed,
                      tierMaxSpeed: originalMuzzleVelocity,
                      baseDamage: getActiveWeapon()?.maxDamage ?? BASE_BULLET_DAMAGE,
                    });
                    const scaledDamage = hitResolved.damage;

                    const { killedHead, killedEntire, tier: shnakeTier } = damageShnakeHead(shnake.id, scaledDamage);

                    // Initialize revenge tracking - shnake will chase player until it deals this damage back
                    initializeShnakeRevenge(shnake.id, scaledDamage);

                    // Trigger damage flash (3 flashes over 1 second)
                    shnakeRendererRef.current?.triggerDamageFlash(shnake.id);

                    // Award points for damage
                    if (onPointsEarned) {
                      onPointsEarned(scaledDamage);
                    }
                    
                    // Track shnake kill if entire snake died
                    if (killedEntire && onShnakeKilled) {
                      onShnakeKilled(shnakeTier);
                      // Play death sound
                      shnakeRendererRef.current?.playDeathSound(hitPos, shnakeTier);
                    }
                    
                    // Add tracking fire to the new head (segment 0 after damage)
                    // Fire tracks with shnake movement via ShnakeRenderer
                    const shnakePentaMultiplier = bullet.isPentabullet ? 3.0 : 1.0;
                    shnakeRendererRef.current?.addFireToSegment(
                      shnake.id, 0, tierDef.burn_time * shnakePentaMultiplier * 1000, tierDef.colors
                    );
                    
                    console.log(`[Shnake Hit] Head hit! damage=${scaledDamage} killed=${killedHead} revenge=${scaledDamage}`);
                  } else {
                    // BODY: ricochet like building block
                    if (bullet.ricochetScale > 0.1) {
                      // Play ricochet sound
                      const distToCamera = hitPos.distanceTo(camera.position);
                      playSpatialSound(getSoundUrl('ricochet', '/ricochet_sound.mp3'), distToCamera, { baseVolume: 0.6 });
                      
                      // Calculate hit normal
                      const normal = calculateHitNormal(hitX, hitY, hitZ, seg.x, seg.y, seg.z);

                      // Add tracking fire to this segment (tracks with shnake movement)
                      shnakeRendererRef.current?.addFireToSegment(
                        shnake.id, segIdx, tierDef.burn_time * 1000, tierDef.colors
                      );
                      
                      // Apply reflection physics: R = D - 2(D·N)N
                      const dot = ndx * normal.x + ndy * normal.y + ndz * normal.z;
                      bullet.direction.set(
                        ndx - 2 * dot * normal.x,
                        0,
                        ndz - 2 * dot * normal.z
                      ).normalize();
                      
                      bullet.velocityY = bullet.velocityY - 2 * dot * normal.y * bullet.speed;
                      bullet.speed *= 0.75;
                      bullet.velocityY *= 0.75;
                      bullet.ricochetScale *= 0.5;
                      
                      bullet.position.set(
                        hitX + normal.x * 0.05,
                        hitY + normal.y * 0.05,
                        hitZ + normal.z * 0.05
                      );
                      
                      needsBulletRender = true;
                      // Mark shnake as indignant - will trigger wiggle animation and 2x volume roar
                      markShnakeIndignant(shnake.id);
                      console.log(`[Shnake Hit] Body ricochet at segment ${segIdx} - shnake indignant!`);
                    } else {
                      // Too weak to ricochet, just destroy bullet
                      hit = true;
                      needsBulletRender = true;
                    }
                  }
                  break;
                }
              }
            }
          }
        }
        
        // === UNIVERSAL ENEMY COMBAT REGISTRY ===
        // Any enemy type registered with enemyCombatRegistry gets hit
        // tested in a single pass. Per-type inline blocks below are
        // kept as a fallback for enemies not yet ported into the
        // registry (currently: shtickman).
        if (!hit) {
          const tierDef = getDefinitionRef.current(bullet.tier);
          const bx = bullet.position.x;
          const by = bullet.position.y;
          const bz = bullet.position.z;
          const prevBX = (bullet as any).prevX ?? bx;
          const prevBY = (bullet as any).prevY ?? by;
          const prevBZ = (bullet as any).prevZ ?? bz;

          // World mesh wall (buildings / rocks via BVH) — the bullet stops at the
          // REAL surface instead of flying through. Returns null on non-mesh worlds.
          const _segDX = bx - prevBX, _segDY = by - prevBY, _segDZ = bz - prevBZ;
          const _segLen = Math.sqrt(_segDX * _segDX + _segDY * _segDY + _segDZ * _segDZ);
          const wallDist = _segLen > 1e-4
            ? raycastMesh(prevBX, prevBY, prevBZ, _segDX / _segLen, _segDY / _segLen, _segDZ / _segLen, _segLen)
            : null;

          // Resolve enemy vs wall: a wall only blocks the shot if it's CLOSER than
          // the enemy along this step (so you can't shoot a monster through a wall,
          // and a monster in front of a wall still takes the hit).
          const _enemyHit = enemyCombatRegistry.raycastBullet(prevBX, prevBY, prevBZ, bx, by, bz, _raycastResult);
          // Per-monster box refinement (siege): narrow the broad-phase cylinder hit to
          // the real boxes. A box MISS turns this into a non-hit (bullet flies on); a
          // hit carries the authoritative headshot flag (overrides the headFrac rule).
          let _enemyHit2 = _enemyHit;
          let _refinedZone: 'body' | 'headshot' | 'bullseye' | null = null;
          if (_enemyHit) {
            const _rf = _raycastResult.adapter?.refineBulletHit?.(
              _raycastResult.enemy, prevBX, prevBY, prevBZ, bx - prevBX, by - prevBY, bz - prevBZ);
            if (_rf) { if (!_rf.hit) _enemyHit2 = false; else _refinedZone = _rf.zone; }
          }
          let _wallBlocks = wallDist !== null;
          if (_enemyHit2 && _wallBlocks) {
            const _eX = _raycastResult.hitX - prevBX, _eY = _raycastResult.hitY - prevBY, _eZ = _raycastResult.hitZ - prevBZ;
            _wallBlocks = (wallDist as number) < Math.sqrt(_eX * _eX + _eY * _eY + _eZ * _eZ);
          }
          if (_wallBlocks) {
            // Bullet hits a building/rock surface → impact + die.
            hit = true;
            needsBulletRender = true;
            const _inv = (wallDist as number) / _segLen;
            _scratchGroundPos.set(prevBX + _segDX * _inv, prevBY + _segDY * _inv, prevBZ + _segDZ * _inv);
            const _twd = getDefinitionRef.current(bullet.tier);
            const _pw = bullet.isPentabullet ? 3.0 : 1.0;
            const _wc = { colors: _twd.colors, size: _twd.burn_width * _pw, height: _twd.burn_height * _pw, duration: _twd.burn_time * _pw, tier: bullet.tier };
            if (useNebulaForBulletImpacts && nebulaImpactsRef.current) nebulaImpactsRef.current.spawnImpact(_scratchGroundPos, _wc);
            else if (bulletImpactsRef.current) bulletImpactsRef.current.spawnImpact(_scratchGroundPos, _wc);
          } else if (_enemyHit2) {
            const adapter = _raycastResult.adapter!;
            const enemy = _raycastResult.enemy!;
            const hitX = _raycastResult.hitX;
            const hitY = _raycastResult.hitY;
            const hitZ = _raycastResult.hitZ;

            // Damage + headshot + knockback resolved by the pure
            // combat-math module so the same formula runs client-side
            // (here) and on the future L2 DO. Adapter can override
            // head zone fraction (default 25% matches shombie legacy).
            const hb = adapter.getHitbox(enemy);
            const headFrac = adapter.getHeadshotZoneFraction?.(enemy) ?? 0.25;
            const hitResolved = resolveBulletHit({
              hitX, hitY, hitZ,
              hitboxBottomY: hb?.bottomY ?? 0,
              hitboxTopY: hb?.topY ?? 0,
              headFrac,
              bulletDirX: bullet.direction.x,
              bulletDirY: bullet.direction.y,
              bulletDirZ: bullet.direction.z,
              bulletSpeed: bullet.speed,
              tierMaxSpeed: tierDef.velocity,
              baseDamage: getActiveWeapon()?.maxDamage ?? BASE_BULLET_DAMAGE,
            });
            // Zone → damage multiplier (body 1× / headshot 2× / bullseye 4×). Recompute
            // the base so a box-refined zone scales correctly (the headFrac-based
            // hitResolved.damage may disagree with the box zone).
            const zone = _refinedZone ?? (hitResolved.isHeadshot ? 'headshot' : 'body');
            const isBullseye = zone === 'bullseye';
            const isHeadshot = zone === 'headshot' || isBullseye;
            const _velRatio = bullet.speed / Math.max(1, tierDef.velocity);
            const _baseScaled = Math.round((getActiveWeapon()?.maxDamage ?? BASE_BULLET_DAMAGE) * _velRatio);
            const finalDamage = _baseScaled * (isBullseye ? 4 : isHeadshot ? 2 : 1);

            // Bullseye → blood erupts out the EXIT side: from the far side of the
            // head, continuing in the bullet's travel direction (away from the
            // shooter), at half the bullet speed.
            if (isBullseye) {
              const _bd = bullet.direction;
              emitBlood(hitX + _bd.x * 0.3, hitY + _bd.y * 0.3, hitZ + _bd.z * 0.3, _bd.x, _bd.y, _bd.z, bullet.speed);
            }

            const bulletDamageInfo = {
              damage: finalDamage,
              bulletSpeed: bullet.speed,
              knockbackDirX: hitResolved.knockbackDirX,
              knockbackDirY: hitResolved.knockbackDirY,
              knockbackDirZ: hitResolved.knockbackDirZ,
              hitX, hitY, hitZ,
              isHeadshot,
              isBullseye,
              source: 'bullet' as const,
              bulletTier: bullet.tier,
            };
            const hitPos = new THREE.Vector3(hitX, hitY, hitZ);

            // Ignite the attached, FOLLOWING burn BEFORE applying damage, so a
            // one-shot KILL still creates it while the enemy is alive (the fire
            // then lingers at its OWN death spot via the safe deathPos linger in
            // useBurnSystem). This branch is reached ONLY for a confirmed-alive
            // registered enemy, so the burn resolves to that enemy's live hitbox
            // and follows it; ground/object hits are separate branches and never
            // get here, so object fire can never follow. shnake/shwarm own their
            // own tracking fire — skip them.
            if (applyBurnRef?.current && adapter.type !== 'shnake' && adapter.type !== 'shwarm') {
              // ONE unified burn — no separate impact stamp. It starts at FULL
              // impact size (chunky hex fire at the hit point) and shrinks over its
              // lifetime. Size / color / duration all come from the bullet tier
              // (burn_width, colors, burn_time). It tracks the hit spot as the
              // enemy moves. Pentabullet scales it up.
              const pMul = bullet.isPentabullet ? 3.0 : 1.0;
              applyBurnRef.current(
                adapter.type, adapter.getId(enemy), undefined,
                bullet.tier, tierDef.colors, (tierDef.colorMode ?? 'static'),
                Math.max(1, Math.round(finalDamage * 0.25)), 0,
                hitPos, Math.max(2, tierDef.burn_time),
                {
                  // The burn renders as the REAL 7-fire impact effect — use its
                  // OWN native size/height (the design you made), just extended.
                  engulf: false,
                  size: tierDef.burn_width * pMul,
                  height: tierDef.burn_height * pMul,
                },
              );
            }
            adapter.applyDamage(enemy, bulletDamageInfo);

            // Skip score on a harmless bounce (e.g. sub-T7 bullet off a walapa).
            const bounced = adapter.bulletBounces?.(enemy, bulletDamageInfo) ?? false;
            if (onPointsEarned && !bounced) onPointsEarned(finalDamage);

            // Per-adapter hit sound (falls back to generic thud).
            const hitSound = adapter.getHitSoundUrl?.(enemy) ?? '/wooden_thud_sound.mp3';
            const sdx = hitX - prevBX;
            const sdy = hitY - prevBY;
            const sdz = hitZ - prevBZ;
            const sdist = Math.hypot(sdx, sdy, sdz);
            // Headshot: impact sound rings 30% higher-pitched.
            void playSpatialSound(hitSound, sdist, { baseVolume: 0.7, playbackRate: isHeadshot ? 1.3 : 1 });

            hit = true;
            needsBulletRender = true;
          }
        }

        // (Legacy shombie / shpider / shtickman inline bullet blocks
        // were removed — the universal EnemyCombatRegistry pass above
        // now handles all three with the same hitbox dimensions,
        // damage formula, fire spawn, and hit sound. Adding a new
        // monster type no longer requires editing this file.)


        // Check block collisions (if not already hit something)
        if (!hit) {
          // Use stored previous position for accurate ray collision
          const prevX = (bullet as any).prevX ?? bullet.position.x;
          const prevY = (bullet as any).prevY ?? bullet.position.y;
          const prevZ = (bullet as any).prevZ ?? bullet.position.z;
          
          const dispX = bullet.position.x - prevX;
          const dispY = bullet.position.y - prevY;
          const dispZ = bullet.position.z - prevZ;
          const dispLen = Math.sqrt(dispX * dispX + dispY * dispY + dispZ * dispZ);
          
          // Skip collision if bullet barely moved
          if (dispLen < 0.001) continue;
          
          const ndx = dispX / dispLen;
          const ndy = dispY / dispLen;
          const ndz = dispZ / dispLen;
          
          // Only check blocks within reasonable distance of bullet path
          const checkRadius = dispLen + 2;
          
          for (const block of blocks) {
            // Quick bounding sphere check first
            const centerX = block.position_x + 0.5;
            const centerY = block.position_y + 0.5;
            const centerZ = block.position_z + 0.5;
            
            const toBulletX = bullet.position.x - centerX;
            const toBulletY = bullet.position.y - centerY;
            const toBulletZ = bullet.position.z - centerZ;
            const distSq = toBulletX * toBulletX + toBulletY * toBulletY + toBulletZ * toBulletZ;
            
            if (distSq > checkRadius * checkRadius) continue;
            
            // Ray-AABB intersection (block goes from position to position+1)
            const minX = block.position_x;
            const maxX = block.position_x + 1;
            const minY = block.position_y;
            const maxY = block.position_y + 1;
            const minZ = block.position_z;
            const maxZ = block.position_z + 1;
            
            let tMin = 0;
            let tMax = dispLen;
            
            // X slab
            if (Math.abs(ndx) > 0.0001) {
              const t1 = (minX - prevX) / ndx;
              const t2 = (maxX - prevX) / ndx;
              tMin = Math.max(tMin, Math.min(t1, t2));
              tMax = Math.min(tMax, Math.max(t1, t2));
            } else if (prevX < minX || prevX > maxX) continue;
            
            // Y slab
            if (Math.abs(ndy) > 0.0001) {
              const t1 = (minY - prevY) / ndy;
              const t2 = (maxY - prevY) / ndy;
              tMin = Math.max(tMin, Math.min(t1, t2));
              tMax = Math.min(tMax, Math.max(t1, t2));
            } else if (prevY < minY || prevY > maxY) continue;
            
            // Z slab
            if (Math.abs(ndz) > 0.0001) {
              const t1 = (minZ - prevZ) / ndz;
              const t2 = (maxZ - prevZ) / ndz;
              tMin = Math.max(tMin, Math.min(t1, t2));
              tMax = Math.min(tMax, Math.max(t1, t2));
            } else if (prevZ < minZ || prevZ > maxZ) continue;
            
            // If tMin <= tMax, ray intersects the block
            if (tMin <= tMax) {
              // Calculate hit position
              const hitX = prevX + ndx * tMin;
              const hitY = prevY + ndy * tMin;
              const hitZ = prevZ + ndz * tMin;
              
              // Check if this block is a "building" category for ricochet
              const blockDef = blocksMapRef.current?.get(block.block_type);
              const isBuilding = blockDef?.category === 'building';
              
              // Ricochet off building blocks if scale is still meaningful
              if (isBuilding && bullet.ricochetScale > 0.1) {
                // Calculate distance from camera for spatial audio
                const hitPos = new THREE.Vector3(hitX, hitY, hitZ);
                const distToCamera = hitPos.distanceTo(camera.position);
                
                // Play ricochet sound with distance-based falloff
                playSpatialSound(getSoundUrl('ricochet', '/ricochet_sound.mp3'), distToCamera, {
                  baseVolume: 0.6,
                });
                
                // Calculate which face was hit for reflection normal
                const normal = calculateHitNormal(
                  hitX, hitY, hitZ,
                  block.position_x, block.position_y, block.position_z
                );
                
                // Spawn scaled impact effect
                // Spawn scaled impact effect - use Nebula for sky-friendly alpha blending
                const ricochetHitPos = new THREE.Vector3(hitX, hitY, hitZ);
                const tierDefRicochet = getDefinitionRef.current(bullet.tier);
                const pentaMultiplierRicochet = bullet.isPentabullet ? 3.0 : 1.0;
                const ricochetBlockConfig = {
                  colors: tierDefRicochet.colors,
                  size: tierDefRicochet.burn_width * bullet.ricochetScale * pentaMultiplierRicochet,
                  height: tierDefRicochet.burn_height * bullet.ricochetScale * pentaMultiplierRicochet,
                  duration: tierDefRicochet.burn_time * pentaMultiplierRicochet,
                  tier: bullet.tier,
                };
                if (useNebulaForBulletImpacts && nebulaImpactsRef.current) {
                  nebulaImpactsRef.current.spawnImpact(ricochetHitPos, ricochetBlockConfig);
                } else if (bulletImpactsRef.current) {
                  bulletImpactsRef.current.spawnImpact(ricochetHitPos, ricochetBlockConfig);
                }
                
                // Apply reflection physics: R = D - 2(D·N)N
                const dot = ndx * normal.x + ndy * normal.y + ndz * normal.z;
                bullet.direction.set(
                  ndx - 2 * dot * normal.x,
                  0, // Y handled via velocityY
                  ndz - 2 * dot * normal.z
                ).normalize();
                
                // Reflect Y velocity component
                bullet.velocityY = bullet.velocityY - 2 * dot * normal.y * bullet.speed;
                
                // Reduce velocity by 25%
                bullet.speed *= 0.75;
                bullet.velocityY *= 0.75;
                
                // Reduce impact scale by 50% for next ricochet
                bullet.ricochetScale *= 0.5;
                
                // Reposition bullet slightly outside block to prevent re-collision
                bullet.position.set(
                  hitX + normal.x * 0.05,
                  hitY + normal.y * 0.05,
                  hitZ + normal.z * 0.05
                );
                
                needsBulletRender = true;
                // Don't remove bullet - continue to next frame
              } else {
                // Non-building block or too weak: destroy bullet with impact
                hit = true;
                needsBulletRender = true;
                
                // Spawn impact effect at hit position with bullet tier settings from context
                // Spawn impact effect at hit position - use Nebula for sky-friendly alpha blending
                const destroyHitPos = new THREE.Vector3(hitX, hitY, hitZ);
                const tierDefDestroy = getDefinitionRef.current(bullet.tier);
                const destroyBlockConfig = {
                  colors: tierDefDestroy.colors,
                  size: tierDefDestroy.burn_width * bullet.ricochetScale,
                  height: tierDefDestroy.burn_height * bullet.ricochetScale,
                  duration: tierDefDestroy.burn_time,
                  tier: bullet.tier,
                };
                if (useNebulaForBulletImpacts && nebulaImpactsRef.current) {
                  nebulaImpactsRef.current.spawnImpact(destroyHitPos, destroyBlockConfig);
                } else if (bulletImpactsRef.current) {
                  bulletImpactsRef.current.spawnImpact(destroyHitPos, destroyBlockConfig);
                }
              }
              break;
            }
          }
          
          // Ground collision. Dreadroot uses the flat y=0 floor; SWW passes a
          // terrain-height fn so bullets hit the raised heightmap terrain you see
          // (otherwise they fall THROUGH it and burn at y=0 far below the map).
          const groundY = groundHeightFn
            ? (groundHeightFn(bullet.position.x, bullet.position.z) ?? 0)
            : 0;
          if (!hit && bullet.position.y <= groundY) {
            hit = true;
            needsBulletRender = true;

            // Spawn impact effect at ground level with bullet tier settings from context
            // Spawn impact effect at ground level - use Nebula for sky-friendly alpha blending
            _scratchGroundPos.copy(bullet.position);
            if (groundHeightFn) {
              // The bullet steps several metres per frame, so once its y dips
              // below the terrain it has already OVERSHOT the real crossing —
              // spawning at the current x,z lands the fire past where you aimed.
              // Binary-search along prev->current for where the path actually
              // pierces the (sloped) terrain, so the fire lands at the hit point.
              const p0x = (bullet as any).prevX ?? bullet.position.x;
              const p0y = (bullet as any).prevY ?? bullet.position.y;
              const p0z = (bullet as any).prevZ ?? bullet.position.z;
              const h0 = groundHeightFn(p0x, p0z) ?? 0;
              if (p0y > h0) {
                let lo = 0, hi = 1;
                for (let i = 0; i < 8; i++) {
                  const mid = (lo + hi) * 0.5;
                  const mx = p0x + (bullet.position.x - p0x) * mid;
                  const my = p0y + (bullet.position.y - p0y) * mid;
                  const mz = p0z + (bullet.position.z - p0z) * mid;
                  if (my <= (groundHeightFn(mx, mz) ?? 0)) hi = mid; else lo = mid;
                }
                _scratchGroundPos.set(
                  p0x + (bullet.position.x - p0x) * hi,
                  p0y + (bullet.position.y - p0y) * hi,
                  p0z + (bullet.position.z - p0z) * hi,
                );
              }
            }
            // Sit the fire just above the surface at the (corrected) hit x,z.
            _scratchGroundPos.y = (groundHeightFn
              ? (groundHeightFn(_scratchGroundPos.x, _scratchGroundPos.z) ?? 0)
              : 0) + 0.1;
            const groundPos = _scratchGroundPos;
            const tierDefGround = getDefinitionRef.current(bullet.tier);
            const pentaMultiplierGround = bullet.isPentabullet ? 3.0 : 1.0;
            const groundConfig = {
              colors: tierDefGround.colors,
              size: tierDefGround.burn_width * pentaMultiplierGround,
              height: tierDefGround.burn_height * pentaMultiplierGround,
              duration: tierDefGround.burn_time * pentaMultiplierGround,
              tier: bullet.tier,
            };
            if (useNebulaForBulletImpacts && nebulaImpactsRef.current) {
              nebulaImpactsRef.current.spawnImpact(groundPos, groundConfig);
            } else if (bulletImpactsRef.current) {
              bulletImpactsRef.current.spawnImpact(groundPos, groundConfig);
            }
          }
        }
        
        if (!hit) {
          // In-place keep: write to writeIndex position
          bullets[writeIndex] = bullet;
          writeIndex++;
        } else {
          // Return bullet to pool for reuse
          bulletPoolRef.current.push(bullet);
        }
      } else {
        // Bullet expired - return to pool
        bulletPoolRef.current.push(bullet);
        needsBulletRender = true;
      }
    }

    // Truncate array in-place (no new array allocation)
    bullets.length = writeIndex;
  }
  diagnostics.recordTiming('bullets');

  // Update wisp particles directly in ref - IN-PLACE filtering
  const particles = wispParticlesRef.current;
  if (particles.length > 0) {
    let writeIndex = 0;
    
    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i];
      // Use addScaledVector to avoid clone() allocation
      particle.position.addScaledVector(particle.velocity, delta);
      particle.velocity.y -= 9.8 * delta;
      particle.life -= delta;
      
      if (particle.life > 0 && particle.position.y > 0) {
        // In-place keep
        particles[writeIndex] = particle;
        writeIndex++;
      } else {
        needsWispRender = true;
      }
    }
    
    // Truncate array in-place
    particles.length = writeIndex;
  }
  
  // NOTE: Render triggers removed — bullets and wisps update via imperative handles
  // (bulletsComponentRef.current.update() and wispParticlesMeshRef.current.update())
  // called directly from the frame loop. The setState triggers only caused unnecessary
  // React re-renders of FortressScene (~20/sec).
  
  // Update shwarm renderer (always, since movement is continuous)
  shwarmRendererRef.current?.update();

  // Note: Shombie movement is now handled entirely by the AI system (ShombieAdapter.applyResult)
  // The legacy updateShombieMovement has been removed

  // Update walapa movement - always run (walapas are friendly NPCs, not AI-controlled enemies)
  if (updateWalapaMovement) {
    updateWalapaMovement(delta);
  }

  // Update shtickman movement - always run (shtickmen use their own tree-patrol state machine)
  if (updateShtickmanMovement) {
    updateShtickmanMovement(delta, camera.position);
  }

  // Update shombie renderer
  shombieRendererRef.current?.update(camera.position, delta);

  // Update shroomer renderer
  shroomerRendererRef.current?.update(camera.position, delta);

  // Update vortax renderer
  vortaxRendererRef.current?.update(camera.position, delta);

  // Record this frame's CPU work time as the HEADROOM metric (not the FPS frame-time — that's
  // the real inter-frame delta recorded once at the top). 1000 / avg-work = the uncapped FPS
  // ceiling, so we can see how far above the vsync-capped 60 we really are.
  const frameWorkMs = performance.now() - frameStart;
  diagnostics.recordFrameWork(frameWorkMs);
  });
}
