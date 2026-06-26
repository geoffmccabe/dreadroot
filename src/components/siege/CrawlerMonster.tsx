// CrawlerMonster — a small "bloody skeleton" (skeletonflesh_crawl.glb) horde unit that CRAWLS along
// real surfaces toward the player: floors, UP vertical walls, over edges, upside-down, through holes,
// and up LARGE enemies. Self-contained like GhostMonster (registers a DemonInstance → shared combat).
//
// LOCOMOTION = a goal-directed surface walker (the standard "wall-walking spider" recipe), raycasting
// the ACTUAL MESH (not blocky box colliders) so it looks right:
//   1. Tangent: the direction to the player projected onto the current surface plane → it always heads
//      at the player ALONG whatever surface it's on.
//   2. WallCheck: a short ray FORWARD along that tangent. If it hits a surface angled away from the
//      current one (a wall in its path), it transitions onto it = climbs. Because this only fires when
//      a wall is between it and the player, it never climbs "for no reason" — only when that's the way.
//   3. Move along the tangent, then a downward StickCast (-normal) re-snaps it to the surface and
//      follows curvature. If that misses (convex edge / cresting a wall top) a wrap probe finds the
//      surface around the corner; if nothing's there it falls (fake gravity) until it lands.
//   4. Stuck >1s on a concave corner → a brief sideways DETOUR (heading change only, never detaches) to
//      route around, then resumes.
// Mesh = world (city/rocks). Box-casts add LARGE ENEMIES (climb a big skeleton's body) and PEERS
// (pile on each other; faster = higher priority = ends up on top). The player never collides with peers.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { addDemon, removeDemon, type DemonInstance } from './siegeHorde';
import { monsterBoxes } from './MonsterEnemy';
import { dealPlayerDamage } from './spray/sprayAttackSystem';
import { sampleHeight } from './terrainHeight';
import { meshGroundHeight, raycastMeshHit, meshHitResult } from './meshColliderSystem';
import { startLoopSound, updateLoopSound, stopLoopSound, play3DPositionalSound, type LoopSound } from '@/lib/spatialAudio';
import { monsterColliderGrid } from '@/lib/spatialHashGrid';
import type { MonsterMods } from './siegeMonsterCatalog';
import { injectRecolor, setRecolor } from './challenge/colorMods';
import type { ColorMods } from './challenge/challengeTypes';

const URL = '/siege/monsters/skeletonflesh_crawl.glb';
const MODEL_H = 1.803;
const BASE_H = 1.4;
const HEADING = 0;            // yaw offset of the rig vs travel direction (flip to Math.PI if reversed)
const SCUTTLE = '/scuttle_monster.mp3';
const BITE = '/Bite_hiss.mp3';
const HP = 40;
const SPEED = 3.4;
const HOVER = 0.06;           // ride height above the surface
const BODY_R = 0.28;          // body radius (wall-check reach, hole squeeze)
const WALL_AHEAD = BODY_R + 0.3;
const STICK_UP = 0.25;        // stick-cast starts this far above the body
const STICK_DOWN = 0.7;       // ...and reaches this far below (step-down tolerance)
const CLIMB_DOT = 0.55;       // a forward hit whose normal differs from ours by > ~57° = a wall to climb
const GRAV = 22;
const ATTACK_R = 1.3;
const ATTACK_MS = 1100;

const rnd = ([a, b]: [number, number]) => a + Math.random() * (b - a);
let _cid = 0;

// Peer body boxes → { priority, supported } for piling (faster = higher pri = ends up on top).
const crawlerBoxes = new Map<THREE.Box3, { pri: number; supported: boolean }>();
let _pri = 0;

// ── Surface raycast (the heart of it) ────────────────────────────────────────
// Cast a world-space ray and return the nearest surface hit (point + outward normal) among: the real
// MESH (city/rocks), LARGE-enemy body boxes, and lower-priority supported PEER boxes. Writes _cast.
const _cast = { px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, dist: 0 };
const _bn = { nx: 0, ny: 0, nz: 0 };
// Ray vs AABB (entry). Returns entry distance t (≥0) or -1; writes the entry face normal into _bn.
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: THREE.Box3, maxDist: number): number {
  let tmin = 0, tmax = maxDist; let nax = 0, nsign = 0;
  // X
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? ox : a === 1 ? oy : oz;
    const d = a === 0 ? dx : a === 1 ? dy : dz;
    const mn = a === 0 ? b.min.x : a === 1 ? b.min.y : b.min.z;
    const mx = a === 0 ? b.max.x : a === 1 ? b.max.y : b.max.z;
    if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) return -1; continue; }
    let t1 = (mn - o) / d, t2 = (mx - o) / d, sgn = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sgn = 1; }
    if (t1 > tmin) { tmin = t1; nax = a; nsign = sgn; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  _bn.nx = nax === 0 ? nsign : 0; _bn.ny = nax === 1 ? nsign : 0; _bn.nz = nax === 2 ? nsign : 0;
  return tmin;
}
function castSurface(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, self?: THREE.Box3, selfPri = Infinity): boolean {
  let best = maxDist, found = false;
  const tryBox = (b: THREE.Box3) => {
    const t = rayBox(ox, oy, oz, dx, dy, dz, b, best);
    if (t >= 0 && t <= best) {
      best = t; found = true;
      _cast.px = ox + dx * t; _cast.py = oy + dy * t; _cast.pz = oz + dz * t;
      _cast.nx = _bn.nx; _cast.ny = _bn.ny; _cast.nz = _bn.nz; _cast.dist = t;
    }
  };
  const meshHit = raycastMeshHit(ox, oy, oz, dx, dy, dz, maxDist);
  if (meshHit && meshHitResult.dist <= best) {
    best = meshHitResult.dist; found = true;
    _cast.px = meshHitResult.px; _cast.py = meshHitResult.py; _cast.pz = meshHitResult.pz;
    _cast.nx = meshHitResult.nx; _cast.ny = meshHitResult.ny; _cast.nz = meshHitResult.nz; _cast.dist = best;
  }
  // World-object BOX colliders (rocks, mushrooms, towns) — the climbable surface where there's no BVH
  // mesh (e.g. Bleakrock) or mesh colliders are off. Only consulted when the mesh didn't already give a
  // surface here, so meshed worlds (SciFi City) keep their nicer mesh hits.
  if (!meshHit) {
    const cnt = monsterColliderGrid.getNearby(ox, oz, maxDist + 0.5);
    const res = monsterColliderGrid.nearbyResult;
    for (let i = 0; i < cnt; i++) { const b = res[i]; if (b && b.max) tryBox(b); }
  }
  for (const b of monsterBoxes) tryBox(b);                               // large enemies (always)
  for (const [b, info] of crawlerBoxes) { if (b !== self && info.pri < selfPri && info.supported) tryBox(b); }  // peers
  return found;
}

export function CrawlerMonster({ spawn, id, onDespawn, mods, color }: {
  spawn: [number, number, number]; id?: string; onDespawn?: (id: string) => void; mods?: MonsterMods; color?: ColorMods;
}) {
  const camera = useThree((s) => s.camera);
  const { scene, animations } = useGLTF(URL);
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);

  // Per-Crawlie variety derived from a UNIQUE index (golden-ratio hash → well spread, guaranteed
  // distinct per spawn — so no two crawl identically). size ±15%, speed ±25% (clearly visible).
  const V = useRef<{ size: number; speed: number; idx: number } | null>(null);
  if (!V.current) { const idx = ++_pri; V.current = { idx, size: 0.85 + ((idx * 0.7548776662) % 1) * 0.30, speed: 0.75 + ((idx * 0.6180339887) % 1) * 0.50 }; }
  const CH = BASE_H * V.current.size * (mods?.sizeMul ?? 1);
  const scale = CH / MODEL_H;
  const priRef = useRef(0);
  if (priRef.current === 0) priRef.current = V.current.speed * 1000 + V.current.idx;   // faster ⇒ higher climb priority

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
        // Authored Challenge recolour (sat/hue/tint/blend) — SAME shader as every other monster.
        // Runs at the FINAL fragment stage, so it overrides the red emissive above: tinting a
        // Crawlie white (or any colour) now works instead of being lost under the red glow.
        if (color) setRecolor(injectRecolor(m), color);
        m.needsUpdate = true;
      });
    });
    return c;
  }, [scene, color]);

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

  // Surface state: position P, up-normal N, tangent facing T, fall velocity.
  const st = useRef({
    cx: spawn[0], cy: spawn[1], cz: spawn[2], nx: 0, ny: 1, nz: 0, tx: 0, ty: 0, tz: 1, vy: 0,
    nextBite: 0, deathT: 0, lastX: spawn[0], lastY: spawn[1], lastZ: spawn[2], stuckT: 0, detourUntil: 0, detourSgn: 1,
  }).current;
  const box = useMemo(() => new THREE.Box3(), []);
  const boxInfo = useRef({ pri: 0, supported: false });
  boxInfo.current.pri = priRef.current;
  useEffect(() => { crawlerBoxes.set(box, boxInfo.current); return () => { crawlerBoxes.delete(box); }; }, [box]);
  const up = useMemo(() => new THREE.Vector3(), []);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const basis = useMemo(() => new THREE.Matrix4(), []);
  const camDir = useMemo(() => new THREE.Vector3(), []);
  const aSrc = useMemo(() => new THREE.Vector3(), []);
  const scuttle = useRef<LoopSound | null>(null);
  useEffect(() => () => { stopLoopSound(scuttle.current); scuttle.current = null; }, []);

  useFrame((_, dt) => {
    const g = group.current; if (!g) return;
    const now = performance.now();
    dt = Math.min(dt, 0.05);

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
    const self = box, sp = priRef.current;

    // Goal direction (3D) + the tangent of it on the current surface.
    let gx = px - st.cx, gy = py - st.cy, gz = pz - st.cz;
    const pdist = Math.hypot(gx, gy, gz) || 1; gx /= pdist; gy /= pdist; gz /= pdist;
    // Optional detour: rotate the goal dir ~70° about the surface normal to slip past a concave jam.
    if (now < st.detourUntil) {
      const a = 1.2 * st.detourSgn, c = Math.cos(a), s = Math.sin(a);   // rotate about N (Rodrigues, g⟂N≈ok)
      const dotn = gx * st.nx + gy * st.ny + gz * st.nz;
      const crx = st.ny * gz - st.nz * gy, cry = st.nz * gx - st.nx * gz, crz = st.nx * gy - st.ny * gx;
      gx = gx * c + crx * s + st.nx * dotn * (1 - c);
      gy = gy * c + cry * s + st.ny * dotn * (1 - c);
      gz = gz * c + crz * s + st.nz * dotn * (1 - c);
    }
    const projTangent = () => {
      const d = gx * st.nx + gy * st.ny + gz * st.nz;
      let tx = gx - d * st.nx, ty = gy - d * st.ny, tz = gz - d * st.nz;
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-3) { st.tx = tx / tl; st.ty = ty / tl; st.tz = tz / tl; }   // else keep last tangent
    };
    projTangent();

    const spd = SPEED * V.current!.speed * (mods?.speedMul ?? 1);
    let moving = false;
    if (pdist > ATTACK_R * 0.7) {
      // WALL CHECK — climb a surface that's in the path to the player.
      if (castSurface(st.cx, st.cy, st.cz, st.tx, st.ty, st.tz, WALL_AHEAD, self, sp)) {
        const dotn = _cast.nx * st.nx + _cast.ny * st.ny + _cast.nz * st.nz;
        if (dotn < CLIMB_DOT) {                                  // a real wall (angled away) → transition onto it
          st.nx = _cast.nx; st.ny = _cast.ny; st.nz = _cast.nz;
          st.cx = _cast.px + st.nx * HOVER; st.cy = _cast.py + st.ny * HOVER; st.cz = _cast.pz + st.nz * HOVER;
          projTangent();
        }
      }
      // MOVE along the surface tangent.
      const step = spd * dt;
      st.cx += st.tx * step; st.cy += st.ty * step; st.cz += st.tz * step;
      moving = true;
    }

    // STICK — re-snap to the surface beneath us (follow curvature, step down).
    const ox = st.cx + st.nx * STICK_UP, oy = st.cy + st.ny * STICK_UP, oz = st.cz + st.nz * STICK_UP;
    if (castSurface(ox, oy, oz, -st.nx, -st.ny, -st.nz, STICK_UP + STICK_DOWN, self, sp)) {
      st.nx += (_cast.nx - st.nx) * Math.min(1, dt * 12); st.ny += (_cast.ny - st.ny) * Math.min(1, dt * 12); st.nz += (_cast.nz - st.nz) * Math.min(1, dt * 12);
      const nl = Math.hypot(st.nx, st.ny, st.nz) || 1; st.nx /= nl; st.ny /= nl; st.nz /= nl;
      st.cx = _cast.px + st.nx * HOVER; st.cy = _cast.py + st.ny * HOVER; st.cz = _cast.pz + st.nz * HOVER;
      st.vy = 0; boxInfo.current.supported = true;
    } else {
      // EDGE WRAP — went past a convex edge: probe forward-and-down to grab the surface around it.
      const wx = st.tx - st.nx, wy = st.ty - st.ny, wz = st.tz - st.nz, wl = Math.hypot(wx, wy, wz) || 1;
      if (castSurface(st.cx, st.cy, st.cz, wx / wl, wy / wl, wz / wl, STICK_DOWN + 0.5, self, sp)) {
        st.nx = _cast.nx; st.ny = _cast.ny; st.nz = _cast.nz;
        st.cx = _cast.px + st.nx * HOVER; st.cy = _cast.py + st.ny * HOVER; st.cz = _cast.pz + st.nz * HOVER;
        st.vy = 0; boxInfo.current.supported = true; projTangent();
      } else if (castSurface(st.cx, st.cy + 0.1, st.cz, 0, -1, 0, 4.0, self, sp)) {
        // FALL straight down toward whatever ground is below (re-grounding after a drop).
        st.vy -= GRAV * dt; st.cy += st.vy * dt;
        if (st.cy <= _cast.py) { st.cy = _cast.py + HOVER; st.vy = 0; st.nx = _cast.nx; st.ny = _cast.ny; st.nz = _cast.nz; }
        boxInfo.current.supported = false;
        // ease normal back toward up while airborne
        st.ny += (1 - st.ny) * Math.min(1, dt * 3); st.nx -= st.nx * Math.min(1, dt * 3); st.nz -= st.nz * Math.min(1, dt * 3);
        const nl = Math.hypot(st.nx, st.ny, st.nz) || 1; st.nx /= nl; st.ny /= nl; st.nz /= nl;
      } else {
        st.vy -= GRAV * dt; st.cy += st.vy * dt; boxInfo.current.supported = false;
      }
    }

    // TERRAIN FLOOR — the heightfield isn't a raycast mesh, so guarantee Crawlies rest on it (flat,
    // up-normal) and catch any fall. Skipped where it's null (e.g. the meshed SciFi City).
    const ty = sampleHeight(st.cx, st.cz);
    if (ty != null && st.cy <= ty + HOVER + 0.05) {
      st.cy = ty + HOVER; st.vy = 0; boxInfo.current.supported = true;
      st.ny += (1 - st.ny) * Math.min(1, dt * 8); st.nx -= st.nx * Math.min(1, dt * 8); st.nz -= st.nz * Math.min(1, dt * 8);
      const nl = Math.hypot(st.nx, st.ny, st.nz) || 1; st.nx /= nl; st.ny /= nl; st.nz /= nl;
    }

    // STUCK → DETOUR (heading change only; never detaches → can't drop through the floor).
    if (moving) {
      const prog = Math.hypot(st.cx - st.lastX, st.cy - st.lastY, st.cz - st.lastZ);
      if (prog > 0.03) { st.stuckT = now; st.lastX = st.cx; st.lastY = st.cy; st.lastZ = st.cz; }
      else if (st.stuckT === 0) st.stuckT = now;
      else if (now - st.stuckT > 1000 && now >= st.detourUntil) {
        st.detourSgn = ((priRef.current | 0) % 2 === 0) ? 1 : -1;
        st.detourUntil = now + 2000; st.stuckT = now; st.lastX = st.cx; st.lastY = st.cy; st.lastZ = st.cz;
      }
    } else { st.stuckT = now; st.lastX = st.cx; st.lastY = st.cy; st.lastZ = st.cz; }

    // Finite guard (no NaN explosions).
    if (!Number.isFinite(st.cx + st.cy + st.cz + st.nx + st.tx)) {
      st.cx = spawn[0]; st.cy = spawn[1]; st.cz = spawn[2]; st.nx = 0; st.ny = 1; st.nz = 0; st.tx = 0; st.ty = 0; st.tz = 1; st.vy = 0;
    }

    // BITE.
    if (pdist <= ATTACK_R && now >= st.nextBite) {
      st.nextBite = now + ATTACK_MS;
      dealPlayerDamage(rnd([10, 25]) * (mods?.damageMul ?? 1), -gx, -gy, -gz, rnd([1, 3]) * 4);
      camera.getWorldDirection(camDir);
      void play3DPositionalSound(BITE, aSrc.set(st.cx, st.cy, st.cz), camera.position, camDir, { baseVolume: 0.7 });
    }

    inst.x = st.cx; inst.y = st.cy - CH * 0.2; inst.z = st.cz; inst.yaw = Math.atan2(st.tx, st.tz);

    const br = Math.max(0.32, CH * 0.32);
    box.min.set(st.cx - br, st.cy - 0.05, st.cz - br);
    box.max.set(st.cx + br, st.cy + 0.25, st.cz + br);

    // Orient: right-handed basis (up = surface normal, forward = tangent).
    up.set(st.nx, st.ny, st.nz);
    fwd.set(st.tx, st.ty, st.tz);
    right.crossVectors(up, fwd);
    if (right.lengthSq() < 1e-8) { fwd.set(1, 0, 0); right.crossVectors(up, fwd); }
    if (right.lengthSq() < 1e-8) { fwd.set(0, 0, 1); right.crossVectors(up, fwd); }
    right.normalize();
    fwd.crossVectors(right, up).normalize();
    basis.makeBasis(right, up, fwd);
    g.position.set(st.cx, st.cy, st.cz);
    g.quaternion.setFromRotationMatrix(basis);
    if (!Number.isFinite(g.quaternion.x + g.quaternion.y + g.quaternion.z + g.quaternion.w)) g.quaternion.identity();
    if (HEADING) g.rotateY(HEADING);
    g.scale.setScalar(scale);

    if (actRef.current) {
      const rate = (moving ? 1 : 0.3) * V.current!.speed * (mods?.speedMul ?? 1);
      actRef.current.timeScale = Math.max(0.3, Math.min(3, rate * 1.3));
    }
    if (!scuttle.current) scuttle.current = startLoopSound(SCUTTLE, { x: st.cx, y: st.cy, z: st.cz, baseVolume: 0 });
    camera.getWorldDirection(camDir);
    updateLoopSound(scuttle.current, st.cx, st.cy, st.cz, camera.position, camDir, 1, moving ? 0.5 : 0);
  });

  return <group ref={group}><group ref={inner}><primitive object={cloned} /></group></group>;
}

useGLTF.preload(URL);
