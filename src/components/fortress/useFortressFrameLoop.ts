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
import { initializeShnakeRevenge, markShnakeIndignant } from '@/features/enemies/ai/adapters/ShnakeAdapter';
import { enemyCombatRegistry, type RaycastResult } from '@/features/enemies/combat/EnemyCombatRegistry';
import { resolveBulletHit, BASE_BULLET_DAMAGE } from '@/features/combat';

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
      
      // Apply gravity to Y velocity
      bullet.velocityY -= BULLET_GRAVITY * delta;
      
      // Update position using projectile physics
      bullet.position.x += bullet.direction.x * bullet.speed * delta;
      bullet.position.z += bullet.direction.z * bullet.speed * delta;
      bullet.position.y += bullet.velocityY * delta;
      
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
      
      bullet.life -= delta;
      
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
          const BASE_BULLET_DAMAGE = 25;
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
                
                // Calculate damage based on current velocity vs original muzzle velocity
                // If bullet has slowed from ricochets, damage is proportionally reduced
                const velocityRatio = bullet.speed / originalMuzzleVelocity;
                const scaledDamage = Math.round(BASE_BULLET_DAMAGE * velocityRatio);
                
                // Apply damage and get actual damage dealt (capped at remaining health)
                const { actualDamage } = damageBlock(shwarm.id, block.id, scaledDamage);
                
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
          const BASE_BULLET_DAMAGE = 25;
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
                    
                    const velocityRatio = bullet.speed / originalMuzzleVelocity;
                    const scaledDamage = Math.round(BASE_BULLET_DAMAGE * velocityRatio);
                    
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

          if (enemyCombatRegistry.raycastBullet(prevBX, prevBY, prevBZ, bx, by, bz, _raycastResult)) {
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
              baseDamage: BASE_BULLET_DAMAGE,
            });
            const finalDamage = hitResolved.damage;
            const isHeadshot = hitResolved.isHeadshot;

            adapter.applyDamage(enemy, {
              damage: finalDamage,
              bulletSpeed: bullet.speed,
              knockbackDirX: hitResolved.knockbackDirX,
              knockbackDirY: hitResolved.knockbackDirY,
              knockbackDirZ: hitResolved.knockbackDirZ,
              hitX, hitY, hitZ,
              isHeadshot,
              source: 'bullet',
            });

            if (onPointsEarned) onPointsEarned(finalDamage);

            // Impact fire — same config the legacy blocks built.
            const pentaMul = bullet.isPentabullet ? 3.0 : 1.0;
            const hitPos = new THREE.Vector3(hitX, hitY, hitZ);
            const fireConfig = {
              colors: tierDef.colors,
              size: tierDef.burn_width * pentaMul,
              height: tierDef.burn_height * pentaMul,
              duration: tierDef.burn_time * pentaMul,
            };
            if (useNebulaForBulletImpacts && nebulaImpactsRef?.current) {
              nebulaImpactsRef.current.spawnImpact(hitPos, fireConfig);
            } else if (bulletImpactsRef?.current) {
              bulletImpactsRef.current.spawnImpact(hitPos, fireConfig);
            }

            // Per-adapter hit sound (falls back to generic thud).
            const hitSound = adapter.getHitSoundUrl?.(enemy) ?? '/wooden_thud_sound.mp3';
            const sdx = hitX - prevBX;
            const sdy = hitY - prevBY;
            const sdz = hitZ - prevBZ;
            const sdist = Math.hypot(sdx, sdy, sdz);
            void playSpatialSound(hitSound, sdist, { baseVolume: 0.7 });

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
          
          // Also check ground collision (y <= 0)
          if (!hit && bullet.position.y <= 0) {
            hit = true;
            needsBulletRender = true;
            
            // Spawn impact effect at ground level with bullet tier settings from context
            // Spawn impact effect at ground level - use Nebula for sky-friendly alpha blending
            _scratchGroundPos.copy(bullet.position);
            _scratchGroundPos.y = 0.1; // Slightly above ground
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

  // Record total frame time for diagnostics
  const frameTime = performance.now() - frameStart;
  diagnostics.recordFrameTime(frameTime);
  });
}
