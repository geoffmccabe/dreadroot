// CrawlerMonster — a small, flat "bloody skeleton" (skeletonflesh_crawl.glb) horde unit that crawls
// along the GROUND toward the player. Self-contained like GhostMonster: registers a DemonInstance so
// the shared combat registry (bullets/flames/scoring/death) handles it with no weapon-code changes.
//
// LOCOMOTION (ground navigation, NOT surface-cling):
//  • It always rests on a horizontal surface — the real mesh ground (streets/rocks via meshGroundHeight),
//    terrain, or a LOW platform/peer top it can step onto (≤ STEP). It never clings to vertical faces,
//    so it doesn't "climb objects for no reason".
//  • It walks toward the player; a TALL obstacle (building/tree/rock) is a wall to go AROUND, not climb —
//    it steers to the side that still heads at the player.
//  • Stuck (no progress ~1s) → commit a perpendicular DETOUR heading for a few seconds to get around,
//    then resume. The detour never detaches it from the ground (so it can't drop through the floor).
//  • Crawlies pile by standing on each other's low tops (faster = higher climb-priority, so faster ones
//    end up on top), but they never climb each other's vertical sides — on a pile they keep crawling
//    toward the player and come down off the far edge. The player doesn't collide with the pile.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { addDemon, removeDemon, type DemonInstance } from './siegeHorde';
import { dealPlayerDamage } from './spray/sprayAttackSystem';
import { sampleHeight } from './terrainHeight';
import { meshGroundHeight } from './meshColliderSystem';
import { startLoopSound, updateLoopSound, stopLoopSound, play3DPositionalSound, type LoopSound } from '@/lib/spatialAudio';
import { worldCollisionGrid, monsterColliderGrid } from '@/lib/spatialHashGrid';
import type { MonsterMods } from './siegeMonsterCatalog';

const URL = '/siege/monsters/skeletonflesh_crawl.glb';  // skeletonflesh + retargeted "Running Crawl" clip ('crawl')
const MODEL_H = 1.803;        // intrinsic skeletonflesh height
const BASE_H = 1.4;           // crawler body length (m) — small but clearly visible
const HEADING = 0;            // yaw offset of the rig vs travel direction (flip to Math.PI if it crawls backward)
const SCUTTLE = '/scuttle_monster.mp3';  // looped movement sound, audible only while crawling
const BITE = '/Bite_hiss.mp3';           // one-shot bite sound on a successful hit (layers OVER the scuttle)
const HP = 40;
const SPEED = 3.4;            // crawl speed (m/s)
const STEP = 0.5;            // max height it can step UP onto; anything taller is a wall to go around
const GRAV = 24;             // fall acceleration when above the ground
const BODY_R = 0.3;          // body radius for wall checks
const ATTACK_R = 1.3;        // bite range
const ATTACK_MS = 1100;      // bite cooldown

const rnd = ([a, b]: [number, number]) => a + Math.random() * (b - a);
let _cid = 0;

// Live Crawlie body boxes → { priority, supported }. Used so Crawlies can pile on each other: a
// Crawlie may stand on a peer that is LOWER priority (speed-based: faster ends up on top) AND itself
// supported (not falling). The player never reads this set, so a swarm never walls the player.
const crawlerBoxes = new Map<THREE.Box3, { pri: number; supported: boolean }>();
let _pri = 0;
let _onPeer = false;   // set by standableY: true if the chosen surface was another Crawlie's top

const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

// Highest standable surface at (cx,cz) reachable from cy (≤ cy+STEP) — mesh/terrain ground, a low box
// top, or a lower-priority peer top. Returns its Y, or null if nothing. Lower-than-cy results are fine
// (the caller falls onto them). Tall walls (top > cy+STEP) are intentionally NOT standable.
function standableY(cx: number, cz: number, cy: number, self?: THREE.Box3, selfPri = Infinity): number | null {
  let best = -Infinity; _onPeer = false;
  const cap = cy + STEP;
  const mg = meshGroundHeight(cx, cz, cy + 2.0);
  if (mg != null && mg <= cap && mg > best) best = mg;
  const tg = sampleHeight(cx, cz);
  if (tg != null && tg <= cap && tg > best) best = tg;
  for (const grid of [worldCollisionGrid, monsterColliderGrid]) {
    const cnt = grid.getNearby(cx, cz, 1.0);
    const res = grid.nearbyResult;
    for (let i = 0; i < cnt; i++) {
      const b = res[i];
      if (!b || !b.max) continue;
      if (within(cx, b.min.x, b.max.x) && within(cz, b.min.z, b.max.z) && b.max.y <= cap && b.max.y > best) { best = b.max.y; _onPeer = false; }
    }
  }
  for (const [b, info] of crawlerBoxes) {
    if (b === self || info.pri >= selfPri || !info.supported) continue;
    if (within(cx, b.min.x, b.max.x) && within(cz, b.min.z, b.max.z) && b.max.y <= cap && b.max.y > best) { best = b.max.y; _onPeer = true; }
  }
  return best > -Infinity ? best : null;
}

// Is (nx,nz) blocked by a WALL at body height cy? (a collider whose top is too tall to step onto and
// whose body spans the crawler's level). Peer boxes are short → never walls, so Crawlies don't treat
// each other as walls.
function blockedByWall(nx: number, nz: number, cy: number): boolean {
  const cap = cy + STEP, low = cy + 0.5;
  for (const grid of [worldCollisionGrid, monsterColliderGrid]) {
    const cnt = grid.getNearby(nx, nz, BODY_R + 0.4);
    const res = grid.nearbyResult;
    for (let i = 0; i < cnt; i++) {
      const b = res[i];
      if (!b || !b.max) continue;
      if (b.max.y > cap && b.min.y < low &&
          within(nx, b.min.x - BODY_R, b.max.x + BODY_R) && within(nz, b.min.z - BODY_R, b.max.z + BODY_R)) return true;
    }
  }
  return false;
}

export function CrawlerMonster({ spawn, id, onDespawn, mods }: {
  spawn: [number, number, number]; id?: string; onDespawn?: (id: string) => void; mods?: MonsterMods;
}) {
  const camera = useThree((s) => s.camera);
  const { scene, animations } = useGLTF(URL);
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);

  const V = useRef<{ size: number; speed: number } | null>(null);
  if (!V.current) V.current = { size: 1 + (Math.random() * 2 - 1) * 0.15, speed: 1 + (Math.random() * 2 - 1) * 0.15 };  // ±15% size + ±15% speed
  const CH = BASE_H * V.current.size * (mods?.sizeMul ?? 1);
  const scale = CH / MODEL_H;
  const priRef = useRef(0);
  if (priRef.current === 0) priRef.current = V.current.speed * 1000 + ++_pri;   // faster ⇒ higher climb priority ⇒ ends up on top

  // Clone the rig + self-light it (bright on dark maps), bloody-red tinted.
  const cloned = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.frustumCulled = false;
      if (!mesh.isMesh) return;
      const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mats = src.map((mm) => (mm as THREE.Material).clone());
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
      mats.forEach((mm) => {
        const m = mm as THREE.MeshStandardMaterial;
        if ('metalness' in m) m.metalness = 0;
        if ('roughness' in m) m.roughness = 0.85;
        if ('emissive' in m) {
          if (m.map) { m.emissive = new THREE.Color(0xff6a5a); m.emissiveMap = m.map; }
          else m.emissive = new THREE.Color(0x884436);
          m.emissiveIntensity = 0.8;
        }
        m.needsUpdate = true;
      });
    });
    return c;
  }, [scene]);

  // Crawl clip — rate driven per-frame by actual speed (faster crawl = faster scrabble).
  const { actions, names } = useAnimations(animations, inner);
  const actRef = useRef<THREE.AnimationAction | null>(null);
  useEffect(() => {
    const n = names.find((x) => /crawl/i.test(x)) ?? names.find((x) => /walk|run/i.test(x)) ?? names.find((x) => /idle/i.test(x)) ?? names[0];
    const a = n ? actions[n] : null;
    a?.reset().fadeIn(0.2).play();
    actRef.current = a ?? null;
    return () => { a?.fadeOut(0.2); actRef.current = null; };
  }, [actions, names]);

  const inst = useRef<DemonInstance>({
    id: id ?? `crawler_${_cid++}`, x: spawn[0], y: spawn[1], z: spawn[2],
    height: CH, radius: Math.max(0.35, CH * 0.5), hp: HP * (mods?.healthMul ?? 1), maxHp: HP * (mods?.healthMul ?? 1),
    dead: false, deadAt: 0, despawned: false, kvx: 0, kvz: 0, kvy: 0, stunUntil: 0, hitAt: 0,
    headFrac: 0.5, noStun: true, noKnockback: true, yaw: 0, opacity: 1,
  }).current;
  useEffect(() => { addDemon(inst); return () => removeDemon(inst); }, [inst]);

  // Ground-nav state: position, yaw, vertical velocity, detour heading + stuck timer.
  const st = useRef({
    cx: spawn[0], cy: spawn[1], cz: spawn[2], yaw: 0, vy: 0,
    nextBite: 0, deathT: 0,
    lastX: spawn[0], lastZ: spawn[2], stuckT: 0, detourX: 0, detourZ: 0, detourUntil: 0,
  }).current;
  const box = useMemo(() => new THREE.Box3(), []);
  const boxInfo = useRef({ pri: 0, supported: false });
  boxInfo.current.pri = priRef.current;
  useEffect(() => { crawlerBoxes.set(box, boxInfo.current); return () => { crawlerBoxes.delete(box); }; }, [box]);
  const camDir = useMemo(() => new THREE.Vector3(), []);
  const aSrc = useMemo(() => new THREE.Vector3(), []);
  const scuttle = useRef<LoopSound | null>(null);
  useEffect(() => () => { stopLoopSound(scuttle.current); scuttle.current = null; }, []);

  useFrame((_, dt) => {
    const g = group.current; if (!g) return;
    const now = performance.now();
    dt = Math.min(dt, 0.05);

    // Death: fall, despawn.
    if (inst.dead) {
      if (scuttle.current) { stopLoopSound(scuttle.current); scuttle.current = null; }
      if (crawlerBoxes.has(box)) crawlerBoxes.delete(box);
      if (st.deathT === 0) st.deathT = now;
      st.vy -= 18 * dt; st.cy += st.vy * dt;
      const ground = meshGroundHeight(st.cx, st.cz, st.cy + 2.0) ?? sampleHeight(st.cx, st.cz) ?? spawn[1];
      g.position.set(st.cx, st.cy, st.cz);
      g.scale.setScalar(scale);
      if (!inst.despawned && (st.cy <= ground || now - st.deathT > 4000)) { inst.despawned = true; onDespawn?.(inst.id); }
      return;
    }

    const px = camera.position.x, py = camera.position.y - 0.4, pz = camera.position.z;
    const pdist = Math.hypot(px - st.cx, py - st.cy, pz - st.cz);

    // Heading toward the player (horizontal).
    let dx = px - st.cx, dz = pz - st.cz;
    const dxz = Math.hypot(dx, dz) || 1; dx /= dxz; dz /= dxz;

    // Move direction — a committed detour overrides the straight line (to get around an obstacle).
    let mvx = dx, mvz = dz;
    if (now < st.detourUntil) { mvx = st.detourX; mvz = st.detourZ; }

    // 1) Step toward the player on the ground; a tall wall is steered AROUND (not climbed).
    let moving = false, wantsMove = false;
    if (pdist > ATTACK_R * 0.7) {
      wantsMove = true;
      const step = SPEED * V.current!.speed * (mods?.speedMul ?? 1) * dt;
      let nx = st.cx + mvx * step, nz = st.cz + mvz * step;
      if (blockedByWall(nx, nz, st.cy)) {
        // Try a perpendicular slide — prefer the side still pointing most at the player.
        const lpx = -mvz, lpz = mvx, rpx = mvz, rpz = -mvx;
        const first = (lpx * dx + lpz * dz) >= (rpx * dx + rpz * dz) ? [lpx, lpz] : [rpx, rpz];
        const second = first[0] === lpx && first[1] === lpz ? [rpx, rpz] : [lpx, lpz];
        if (!blockedByWall(st.cx + first[0] * step, st.cz + first[1] * step, st.cy)) { nx = st.cx + first[0] * step; nz = st.cz + first[1] * step; mvx = first[0]; mvz = first[1]; }
        else if (!blockedByWall(st.cx + second[0] * step, st.cz + second[1] * step, st.cy)) { nx = st.cx + second[0] * step; nz = st.cz + second[1] * step; mvx = second[0]; mvz = second[1]; }
        else { nx = st.cx; nz = st.cz; }   // boxed in → hold (stuck-detour kicks in below)
      }
      if (nx !== st.cx || nz !== st.cz) { st.cx = nx; st.cz = nz; moving = true; }
    }

    // 2) Settle onto the ground / a low platform / a peer top. Step UP (≤ STEP) instantly; otherwise
    //    fall under gravity. No vertical clinging, no detaching — so it never drops through the floor.
    const gy = standableY(st.cx, st.cz, st.cy, box, priRef.current);
    if (gy != null) {
      if (st.cy <= gy + 0.02) { st.cy = gy; st.vy = 0; }
      else { st.vy -= GRAV * dt; st.cy += st.vy * dt; if (st.cy < gy) { st.cy = gy; st.vy = 0; } }
      boxInfo.current.supported = true;
    } else {
      st.vy -= GRAV * dt; st.cy += st.vy * dt; boxInfo.current.supported = false;
    }

    // 3) Stuck recovery: if it wants to move but makes ~no horizontal progress for >1s, commit a
    //    perpendicular DETOUR for 2.5s to route around the obstacle. (Just a heading change — it stays
    //    on the ground, so no popping through terrain.)
    if (wantsMove) {
      const prog = Math.hypot(st.cx - st.lastX, st.cz - st.lastZ);
      if (prog > 0.03) { st.stuckT = now; st.lastX = st.cx; st.lastZ = st.cz; }
      else if (st.stuckT === 0) { st.stuckT = now; }
      else if (now - st.stuckT > 1000 && now >= st.detourUntil) {
        const sgn = ((priRef.current | 0) % 2 === 0) ? 1 : -1;   // stable per-Crawlie side choice
        st.detourX = -dz * sgn; st.detourZ = dx * sgn; st.detourUntil = now + 2500; st.stuckT = now;
        st.lastX = st.cx; st.lastZ = st.cz;
      }
    } else { st.stuckT = now; st.lastX = st.cx; st.lastZ = st.cz; }

    // 4) Bite when in range — small damage (10-25); hiss layers OVER the scuttle.
    if (pdist <= ATTACK_R && now >= st.nextBite) {
      st.nextBite = now + ATTACK_MS;
      const inv = 1 / (pdist || 1);
      dealPlayerDamage(rnd([10, 25]) * (mods?.damageMul ?? 1), -dx, -(py - st.cy) * inv, -dz, rnd([1, 3]) * 4);
      camera.getWorldDirection(camDir);
      void play3DPositionalSound(BITE, aSrc.set(st.cx, st.cy, st.cz), camera.position, camDir, { baseVolume: 0.7 });
    }

    // 5) Face the way it's heading (toward the player, or along the detour), smoothed.
    const wantYaw = Math.atan2(mvx, mvz);
    let dyaw = wantYaw - st.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    st.yaw += dyaw * Math.min(1, dt * 8);

    inst.x = st.cx; inst.y = st.cy; inst.z = st.cz; inst.yaw = st.yaw;

    // Low, flat body box so OTHER Crawlies can stand on this one (piling).
    const br = Math.max(0.35, CH * 0.35);
    box.min.set(st.cx - br, st.cy - 0.05, st.cz - br);
    box.max.set(st.cx + br, st.cy + 0.25, st.cz + br);

    g.position.set(st.cx, st.cy, st.cz);
    g.rotation.set(0, st.yaw + HEADING, 0);
    g.scale.setScalar(scale);

    // Animation rate ∝ actual speed (faster Crawlie → faster scrabble; near-idle when biting).
    if (actRef.current) {
      const rate = (moving ? 1 : 0.3) * V.current!.speed * (mods?.speedMul ?? 1);
      actRef.current.timeScale = Math.max(0.3, Math.min(3, rate * 1.3));
    }

    // Scuttle loop — only audible while moving.
    if (!scuttle.current) scuttle.current = startLoopSound(SCUTTLE, { x: st.cx, y: st.cy, z: st.cz, baseVolume: 0 });
    camera.getWorldDirection(camDir);
    updateLoopSound(scuttle.current, st.cx, st.cy, st.cz, camera.position, camDir, 1, moving ? 0.5 : 0);
  });

  return <group ref={group}><group ref={inner}><primitive object={cloned} /></group></group>;
}

useGLTF.preload(URL);
