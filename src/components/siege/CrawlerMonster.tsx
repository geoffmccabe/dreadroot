// CrawlerMonster — a small, very FLAT "bloody skeleton" (skeletonflesh.glb) that CRAWLS along any
// surface toward the player: floors, walls, AND upside-down on the undersides of overhangs (e.g. the
// giant mushroom caps). Self-contained like GhostMonster: registers a DemonInstance so the shared
// combat registry (bullets/flames/scoring/death) handles it with no weapon-code changes.
//
// HOW THE SURFACE-CRAWL WORKS (no new physics): every world object already has BOX colliders (city,
// rocks, and the mushrooms' many small stem/cap boxes). Each box face has a clean outward normal
// (top +Y, sides ±X/±Z, UNDERSIDE −Y). The crawler simply (1) sticks to the NEAREST box face, taking
// that face's normal as its "up", then (2) steps along the surface tangent toward the player. Climbing
// a wall and flipping onto an underside both fall out of this for free: as it moves into a wall's
// footprint the side face becomes nearest (up tips horizontal); as it passes a cap's lower lip the
// underside face becomes nearest (up flips to −Y → it hangs upside-down). With no box nearby it falls
// to the terrain and crawls the ground. They're flat and DON'T collide with each other (can overlap/
// stack). The "Fast Crawler" prone animation is a separate asset (see note in CrawlerMonster docs);
// until it's retargeted onto this rig we squash + prone-tilt the idle clip as a stand-in.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { addDemon, removeDemon, type DemonInstance } from './siegeHorde';
import { dealPlayerDamage } from './spray/sprayAttackSystem';
import { sampleHeight } from './terrainHeight';
import { worldCollisionGrid, monsterColliderGrid } from '@/lib/spatialHashGrid';
import type { MonsterMods } from './siegeMonsterCatalog';

const URL = '/siege/monsters/skeletonflesh.glb';
const MODEL_H = 1.803;        // intrinsic skeletonflesh height
const BASE_H = 0.85;          // small crawler (m, head-to-toe of the source rig)
const FLAT = 0.7;             // mild squash along the surface normal (true "flat/prone" arrives with the crawl clip)
const HOVER = 0.12;           // body-centre lift off the surface
const HP = 40;
const SPEED = 3.4;            // crawl speed along the surface (m/s)
const CLING = 0.85;           // a box face within this distance (m) is grippable
const ATTACK_R = 1.3;         // bite range
const ATTACK_MS = 1100;       // bite cooldown

const rnd = ([a, b]: [number, number]) => a + Math.random() * (b - a);
let _cid = 0;

// Nearest point + outward face-normal of box `b` to point (px,py,pz). Writes into `out`.
// Snaps the normal to the dominant axis so curved-by-boxes shapes give clean ±axis faces.
function nearestFace(
  px: number, py: number, pz: number, b: THREE.Box3,
  out: { d: number; sx: number; sy: number; sz: number; nx: number; ny: number; nz: number },
): void {
  const cx = px < b.min.x ? b.min.x : px > b.max.x ? b.max.x : px;
  const cy = py < b.min.y ? b.min.y : py > b.max.y ? b.max.y : py;
  const cz = pz < b.min.z ? b.min.z : pz > b.max.z ? b.max.z : pz;
  const dx = px - cx, dy = py - cy, dz = pz - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > 1e-6) {
    // Outside the box: the clamp point is on the surface. Face = the axis we travelled farthest along.
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    out.nx = 0; out.ny = 0; out.nz = 0;
    if (ax >= ay && ax >= az) out.nx = Math.sign(dx);
    else if (ay >= az) out.ny = Math.sign(dy);
    else out.nz = Math.sign(dz);
    out.sx = cx; out.sy = cy; out.sz = cz; out.d = Math.sqrt(d2);
  } else {
    // Inside the box: pop out the nearest of the 6 faces.
    const xn = px - b.min.x, xp = b.max.x - px, yn = py - b.min.y, yp = b.max.y - py, zn = pz - b.min.z, zp = b.max.z - pz;
    let m = xn; out.nx = -1; out.ny = 0; out.nz = 0; out.sx = b.min.x; out.sy = py; out.sz = pz;
    if (xp < m) { m = xp; out.nx = 1; out.ny = 0; out.nz = 0; out.sx = b.max.x; out.sy = py; out.sz = pz; }
    if (yn < m) { m = yn; out.nx = 0; out.ny = -1; out.nz = 0; out.sx = px; out.sy = b.min.y; out.sz = pz; }
    if (yp < m) { m = yp; out.nx = 0; out.ny = 1; out.nz = 0; out.sx = px; out.sy = b.max.y; out.sz = pz; }
    if (zn < m) { m = zn; out.nx = 0; out.ny = 0; out.nz = -1; out.sx = px; out.sy = py; out.sz = b.min.z; }
    if (zp < m) { m = zp; out.nx = 0; out.ny = 0; out.nz = 1; out.sx = px; out.sy = py; out.sz = b.max.z; }
    out.d = 0;
  }
}

const _face = { d: 0, sx: 0, sy: 0, sz: 0, nx: 0, ny: 0, nz: 0 };
const _best = { d: Infinity, sx: 0, sy: 0, sz: 0, nx: 0, ny: 1, nz: 0 };

// Find the nearest grippable surface (box face, else terrain) to (px,py,pz). Returns true + writes _best.
function findSurface(px: number, py: number, pz: number): boolean {
  _best.d = Infinity;
  for (const grid of [worldCollisionGrid, monsterColliderGrid]) {
    const cnt = grid.getNearby(px, pz, CLING + 0.5);
    const res = grid.nearbyResult;
    for (let i = 0; i < cnt; i++) {
      const b = res[i];
      if (!b || !b.max) continue;
      nearestFace(px, py, pz, b, _face);
      if (_face.d < _best.d) { _best.d = _face.d; _best.sx = _face.sx; _best.sy = _face.sy; _best.sz = _face.sz; _best.nx = _face.nx; _best.ny = _face.ny; _best.nz = _face.nz; }
    }
  }
  if (_best.d <= CLING) return true;
  // No object face in reach → cling to the terrain ground (flat, up normal).
  const g = sampleHeight(px, pz);
  if (g != null && py - g <= CLING + 1.0) {
    _best.d = Math.abs(py - g); _best.sx = px; _best.sy = g; _best.sz = pz; _best.nx = 0; _best.ny = 1; _best.nz = 0;
    return true;
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
  if (!V.current) V.current = { size: 1 + (Math.random() * 2 - 1) * 0.18, speed: 1 + (Math.random() * 2 - 1) * 0.18 };
  const CH = BASE_H * V.current.size * (mods?.sizeMul ?? 1);
  const scale = CH / MODEL_H;

  // Clone the rig + self-light it (bright on dark maps), bloody-red tinted so it reads as the
  // "bloody skeleton" base.
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

  // Idle clip (no crawl clip on this rig yet) — see the "Fast Crawler" asset note. Play it fast so
  // the limbs scrabble; the prone tilt + flat squash sell the crawl until the real clip is retargeted.
  const { actions, names } = useAnimations(animations, inner);
  useEffect(() => {
    const n = names.find((x) => /crawl/i.test(x)) ?? names.find((x) => /walk|run/i.test(x)) ?? names.find((x) => /idle/i.test(x)) ?? names[0];
    const a = n ? actions[n] : null;
    a?.reset().fadeIn(0.2).play();
    if (a) a.timeScale = 1.6;
    return () => { a?.fadeOut(0.2); };
  }, [actions, names]);

  const inst = useRef<DemonInstance>({
    id: id ?? `crawler_${_cid++}`, x: spawn[0], y: spawn[1], z: spawn[2],
    height: CH, radius: Math.max(0.35, CH * 0.5), hp: HP * (mods?.healthMul ?? 1), maxHp: HP * (mods?.healthMul ?? 1),
    dead: false, deadAt: 0, despawned: false, kvx: 0, kvz: 0, kvy: 0, stunUntil: 0, hitAt: 0,
    headFrac: 0.5, noStun: true, noKnockback: true, yaw: 0, opacity: 1,
  }).current;
  useEffect(() => { addDemon(inst); return () => removeDemon(inst); }, [inst]);

  // Crawl state: body centre C + surface normal N (smoothed). Reusable temp vectors (no per-frame GC).
  const st = useRef({
    cx: spawn[0], cy: spawn[1], cz: spawn[2], nx: 0, ny: 1, nz: 0,
    nextBite: 0, deathT: 0, vy: 0,
  }).current;
  const up = useMemo(() => new THREE.Vector3(), []);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const basis = useMemo(() => new THREE.Matrix4(), []);

  useFrame((_, dt) => {
    const g = group.current; if (!g) return;
    const now = performance.now();
    dt = Math.min(dt, 0.05);

    // Death: drop off the surface, fall, despawn.
    if (inst.dead) {
      if (st.deathT === 0) st.deathT = now;
      st.vy -= 18 * dt; st.cy += st.vy * dt;
      const ground = sampleHeight(st.cx, st.cz) ?? spawn[1];
      g.position.set(st.cx, st.cy, st.cz);
      g.scale.set(scale, scale * FLAT, scale);
      if (!inst.despawned && (st.cy <= ground + HOVER || now - st.deathT > 4000)) {
        inst.despawned = true; onDespawn?.(inst.id);
      }
      return;
    }

    const px = camera.position.x, py = camera.position.y - 0.4, pz = camera.position.z;

    // 1) Stick to the nearest surface (object face, else terrain).
    if (findSurface(st.cx, st.cy, st.cz)) {
      st.nx += (_best.nx - st.nx) * Math.min(1, dt * 8);   // smooth the normal so edges don't snap
      st.ny += (_best.ny - st.ny) * Math.min(1, dt * 8);
      st.nz += (_best.nz - st.nz) * Math.min(1, dt * 8);
      const nl = Math.hypot(st.nx, st.ny, st.nz) || 1; st.nx /= nl; st.ny /= nl; st.nz /= nl;
      // Re-seat the centre at hover distance off the surface point.
      st.cx = _best.sx + st.nx * HOVER; st.cy = _best.sy + st.ny * HOVER; st.cz = _best.sz + st.nz * HOVER;
    } else {
      st.ny += (1 - st.ny) * Math.min(1, dt * 4); st.nx -= st.nx * Math.min(1, dt * 4); st.nz -= st.nz * Math.min(1, dt * 4);
    }

    // 2) Step along the surface tangent toward the player (project the chase dir onto the tangent plane).
    let dxp = px - st.cx, dyp = py - st.cy, dzp = pz - st.cz;
    const pdist = Math.hypot(dxp, dyp, dzp) || 1;
    dxp /= pdist; dyp /= pdist; dzp /= pdist;
    const dn = dxp * st.nx + dyp * st.ny + dzp * st.nz;            // component along the normal
    let tx = dxp - dn * st.nx, ty = dyp - dn * st.ny, tz = dzp - dn * st.nz;
    const tl = Math.hypot(tx, ty, tz);
    const spd = SPEED * V.current!.speed * (mods?.speedMul ?? 1);
    if (tl > 1e-3 && pdist > ATTACK_R * 0.7) {
      tx /= tl; ty /= tl; tz /= tl;
      const step = spd * dt;
      st.cx += tx * step; st.cy += ty * step; st.cz += tz * step;
      // Re-cling after moving so a step off an edge immediately grabs the next face (wrap-around).
      if (findSurface(st.cx, st.cy, st.cz)) {
        const nl2 = Math.hypot(_best.nx, _best.ny, _best.nz) || 1;
        st.cx = _best.sx + (_best.nx / nl2) * HOVER; st.cy = _best.sy + (_best.ny / nl2) * HOVER; st.cz = _best.sz + (_best.nz / nl2) * HOVER;
      }
    } else if (tl <= 1e-3) { tx = 1; ty = 0; tz = 0; }   // degenerate (player straight along normal) → arbitrary fwd

    // 3) Bite when in range.
    if (pdist <= ATTACK_R && now >= st.nextBite) {
      st.nextBite = now + ATTACK_MS;
      dealPlayerDamage(rnd([4, 14]) * (mods?.damageMul ?? 1), -dxp, -dyp, -dzp, rnd([1, 3]) * 4);
    }

    // Publish hitbox at the body centre.
    inst.x = st.cx; inst.y = st.cy - CH * 0.25; inst.z = st.cz; inst.yaw = Math.atan2(tx, tz);

    // 4) Orient: local up = surface normal, local forward = travel tangent; lie the rig prone + squash flat.
    up.set(st.nx, st.ny, st.nz);
    fwd.set(tx, ty, tz);
    right.crossVectors(fwd, up).normalize();
    fwd.crossVectors(up, right).normalize();            // re-orthogonalise
    basis.makeBasis(right, up, fwd);
    g.position.set(st.cx, st.cy, st.cz);
    g.quaternion.setFromRotationMatrix(basis);
    g.scale.set(scale, scale * FLAT, scale);
  });

  return <group ref={group}><group ref={inner}><primitive object={cloned} /></group></group>;
}

useGLTF.preload(URL);
