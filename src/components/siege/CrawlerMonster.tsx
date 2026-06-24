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
import { meshGroundHeight } from './meshColliderSystem';
import { startLoopSound, updateLoopSound, stopLoopSound, play3DPositionalSound, type LoopSound } from '@/lib/spatialAudio';
import { worldCollisionGrid, monsterColliderGrid } from '@/lib/spatialHashGrid';
import type { MonsterMods } from './siegeMonsterCatalog';

const URL = '/siege/monsters/skeletonflesh_crawl.glb';  // skeletonflesh + retargeted "Running Crawl" clip ('crawl')
const MODEL_H = 1.803;        // intrinsic skeletonflesh height
const BASE_H = 1.4;           // crawler body length (m) — small but clearly visible
const FLAT = 1.0;             // the crawl clip is already prone/flat — no extra squash (would distort the rig)
const HOVER = 0.12;           // body-centre lift off the surface
const HEADING = 3 * Math.PI / 4;   // yaw offset: rig's crawl-forward is -135° off travel → +135° aligns the head to where it crawls
const SCUTTLE = '/scuttle_monster.mp3';  // looped movement sound, audible only while crawling
const BITE = '/Bite_hiss.mp3';           // one-shot bite sound on a successful hit (layers OVER the scuttle)
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
const _best = { d: Infinity, sx: 0, sy: 0, sz: 0, nx: 0, ny: 1, nz: 0, onCrawler: false };

// Live Crawlie body boxes → { priority, supported }. Each Crawlie clings to the OTHERS so they crawl
// ON TOP of each other (mushroom-grunt-horde style) instead of interpenetrating — multiple layers
// deep. Rules that keep it stable: a Crawlie only climbs onto a peer that is (a) LOWER priority and
// (b) itself SUPPORTED (resting on the world OR on another supported Crawlie — not mid-air). Priority
// is speed-based, so FASTER Crawlies crawl OVER slower ones. Unsupported Crawlies fall (checked every
// frame), so a tower collapses the instant its base moves out. The player never reads this set.
const crawlerBoxes = new Map<THREE.Box3, { pri: number; supported: boolean }>();
let _pri = 0;

// Find the nearest grippable surface (box face, other Crawlie, else ground) to (px,py,pz).
// Returns true + writes _best. `self`/`selfPri` exclude the caller + higher-priority/airborne peers.
function findSurface(px: number, py: number, pz: number, self?: THREE.Box3, selfPri = Infinity): boolean {
  _best.d = Infinity; _best.onCrawler = false;
  for (const grid of [worldCollisionGrid, monsterColliderGrid]) {
    const cnt = grid.getNearby(px, pz, CLING + 0.5);
    const res = grid.nearbyResult;
    for (let i = 0; i < cnt; i++) {
      const b = res[i];
      if (!b || !b.max) continue;
      nearestFace(px, py, pz, b, _face);
      if (_face.d < _best.d) { _best.d = _face.d; _best.sx = _face.sx; _best.sy = _face.sy; _best.sz = _face.sz; _best.nx = _face.nx; _best.ny = _face.ny; _best.nz = _face.nz; _best.onCrawler = false; }
    }
  }
  // Other Crawlies → climbable surfaces (crawl on top, many layers). Only LOWER-priority + SUPPORTED
  // peers (never climb a mid-air one), so towers only form on a real base and collapse when it leaves.
  for (const [b, info] of crawlerBoxes) {
    if (b === self || info.pri >= selfPri || !info.supported) continue;
    const bcx = (b.min.x + b.max.x) * 0.5, bcz = (b.min.z + b.max.z) * 0.5;
    if (Math.abs(px - bcx) > CLING + 1.0 || Math.abs(pz - bcz) > CLING + 1.0) continue;   // cheap cull
    nearestFace(px, py, pz, b, _face);
    if (_face.d < _best.d) { _best.d = _face.d; _best.sx = _face.sx; _best.sy = _face.sy; _best.sz = _face.sz; _best.nx = _face.nx; _best.ny = _face.ny; _best.nz = _face.nz; _best.onCrawler = true; }
  }
  if (_best.d <= CLING) return true;
  // BVH-mesh ground (SciFi City streets, rocks — they're triangle meshes, NOT box colliders, so the
  // grids above never see them; this is what stopped Crawlies from finding the city floor → floating).
  // Cast down from a bit above the body so it snaps onto the street below.
  const mg = meshGroundHeight(px, pz, py + 2.0);
  if (mg != null && py - mg <= CLING + 2.0 && py - mg >= -0.2) {
    _best.d = Math.abs(py - mg); _best.sx = px; _best.sy = mg; _best.sz = pz; _best.nx = 0; _best.ny = 1; _best.nz = 0; _best.onCrawler = false;
    return true;
  }
  // Terrain heightfield ground (flat, up normal).
  const g = sampleHeight(px, pz);
  if (g != null && py - g <= CLING + 2.0) {
    _best.d = Math.abs(py - g); _best.sx = px; _best.sy = g; _best.sz = pz; _best.nx = 0; _best.ny = 1; _best.nz = 0; _best.onCrawler = false;
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
  if (!V.current) V.current = { size: 1 + (Math.random() * 2 - 1) * 0.15, speed: 1 + (Math.random() * 2 - 1) * 0.35 };  // ±15% size, ±35% speed (wide spread)
  const CH = BASE_H * V.current.size * (mods?.sizeMul ?? 1);
  const scale = CH / MODEL_H;
  const priRef = useRef(0);
  // Climb-order priority: speed-dominant (faster Crawlies crawl OVER slower ones) + a unique counter
  // so two equal speeds still break the tie (never mutually climb).
  if (priRef.current === 0) priRef.current = V.current.speed * 1000 + ++_pri;

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

  // Crawl clip — its playback rate is driven per-frame by how fast this Crawlie is actually moving
  // (faster crawl = faster scrabble), so the ±speed spread reads visually.
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

  // Crawl state: body centre C + surface normal N (smoothed) + smoothed facing F (kept in the tangent
  // plane so it turns toward the player instead of snapping). Reusable temp vectors (no per-frame GC).
  const st = useRef({
    cx: spawn[0], cy: spawn[1], cz: spawn[2], nx: 0, ny: 1, nz: 0, fx: 0, fy: 0, fz: 1,
    nextBite: 0, deathT: 0, vy: 0,
    lastX: spawn[0], lastY: spawn[1], lastZ: spawn[2], stuckT: 0, detachUntil: 0,   // stuck-on-a-wall unstick
  }).current;
  // Body box for inter-Crawlie stacking — registered in the shared set so others can crawl on top.
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

    // Death: drop off the surface, fall, despawn.
    if (inst.dead) {
      if (scuttle.current) { stopLoopSound(scuttle.current); scuttle.current = null; }
      if (crawlerBoxes.has(box)) crawlerBoxes.delete(box);   // a corpse stops blocking other Crawlies
      if (st.deathT === 0) st.deathT = now;
      st.vy -= 18 * dt; st.cy += st.vy * dt;
      const ground = meshGroundHeight(st.cx, st.cz, st.cy + 2.0) ?? sampleHeight(st.cx, st.cz) ?? spawn[1];
      g.position.set(st.cx, st.cy, st.cz);
      g.scale.set(scale, scale * FLAT, scale);
      if (!inst.despawned && (st.cy <= ground + HOVER || now - st.deathT > 4000)) {
        inst.despawned = true; onDespawn?.(inst.id);
      }
      return;
    }

    const px = camera.position.x, py = camera.position.y - 0.4, pz = camera.position.z;
    const detached = now < st.detachUntil;   // briefly let go of the surface to un-stick from a wall

    // 1) Stick to the nearest surface (object face, other Crawlie, or ground — works on rock/mushroom
    //    tops + walls + ceilings, not just terrain). `supported` = we found a surface this frame →
    //    others may stack ON us; unsupported Crawlies fall. When the surface is another Crawlie we
    //    SINK in (nest) so piles pack tight instead of perching one body-height apart.
    if (!detached && findSurface(st.cx, st.cy, st.cz, box, priRef.current)) {
      boxInfo.current.supported = true;
      st.vy = 0;
      st.nx += (_best.nx - st.nx) * Math.min(1, dt * 8);   // smooth the normal so edges don't snap
      st.ny += (_best.ny - st.ny) * Math.min(1, dt * 8);
      st.nz += (_best.nz - st.nz) * Math.min(1, dt * 8);
      const nl = Math.hypot(st.nx, st.ny, st.nz) || 1; st.nx /= nl; st.ny /= nl; st.nz /= nl;
      const hov = _best.onCrawler ? HOVER * 0.4 : HOVER;
      st.cx = _best.sx + st.nx * hov; st.cy = _best.sy + st.ny * hov; st.cz = _best.sz + st.nz * hov;
    } else {
      // No surface in reach → FALL (gravity) until the downward ground search catches one. This is the
      // "bottom one must fall if nothing is under him, checked frequently" rule — runs every frame.
      boxInfo.current.supported = false;
      st.vy -= 24 * dt; st.cy += st.vy * dt;
      st.ny += (1 - st.ny) * Math.min(1, dt * 4); st.nx -= st.nx * Math.min(1, dt * 4); st.nz -= st.nz * Math.min(1, dt * 4);
      const nl = Math.hypot(st.nx, st.ny, st.nz) || 1; st.nx /= nl; st.ny /= nl; st.nz /= nl;
    }

    // 2) Direction to the player, projected onto the surface tangent plane.
    let dxp = px - st.cx, dyp = py - st.cy, dzp = pz - st.cz;
    const pdist = Math.hypot(dxp, dyp, dzp) || 1;
    dxp /= pdist; dyp /= pdist; dzp /= pdist;
    const dn = dxp * st.nx + dyp * st.ny + dzp * st.nz;
    const tx = dxp - dn * st.nx, ty = dyp - dn * st.ny, tz = dzp - dn * st.nz;
    const tl = Math.hypot(tx, ty, tz);
    const hasDir = tl > 1e-4;
    const dirx = hasDir ? tx / tl : 0, diry = hasDir ? ty / tl : 0, dirz = hasDir ? tz / tl : 0;

    // Step toward the player along the tangent.
    const spd = SPEED * V.current!.speed * (mods?.speedMul ?? 1);
    let moving = false;
    if (hasDir && pdist > ATTACK_R * 0.7 && !detached) {
      moving = true;
      const step = spd * dt;
      st.cx += dirx * step; st.cy += diry * step; st.cz += dirz * step;
      if (findSurface(st.cx, st.cy, st.cz, box, priRef.current)) {       // re-cling (wrap edges)
        boxInfo.current.supported = true; st.vy = 0;
        const hov = _best.onCrawler ? HOVER * 0.4 : HOVER;
        st.cx = _best.sx + _best.nx * hov; st.cy = _best.sy + _best.ny * hov; st.cz = _best.sz + _best.nz * hov;
      }
    }

    // Stuck-on-a-wall unstick: if it WANTS to move but has made almost no horizontal progress for a
    // while (jammed against a vertical face/concave corner), briefly let go of the surface so gravity
    // drops it off and it re-attaches + retries from a fresh spot.
    if (moving) {
      const prog = Math.hypot(st.cx - st.lastX, st.cy - st.lastY, st.cz - st.lastZ);   // 3D (climbing counts)
      if (prog > 0.04) { st.stuckT = now; st.lastX = st.cx; st.lastY = st.cy; st.lastZ = st.cz; }
      else if (st.stuckT === 0) st.stuckT = now;
      else if (now - st.stuckT > 1200) { st.detachUntil = now + 350; st.stuckT = now; st.vy = -1; }
    } else { st.stuckT = now; st.lastX = st.cx; st.lastY = st.cy; st.lastZ = st.cz; }

    // Drive the crawl animation rate from the ACTUAL speed (faster Crawlie → faster scrabble; near-
    // idle when biting), so the ±speed spread is visible in the animation too.
    if (actRef.current) {
      const rate = (moving ? 1 : 0.3) * (spd / SPEED);
      actRef.current.timeScale = Math.max(0.3, Math.min(3, rate * 1.3));
    }

    // 3) Bite when in range — small damage (10-25); the hiss layers OVER the scuttle loop.
    if (pdist <= ATTACK_R && now >= st.nextBite) {
      st.nextBite = now + ATTACK_MS;
      dealPlayerDamage(rnd([10, 25]) * (mods?.damageMul ?? 1), -dxp, -dyp, -dzp, rnd([1, 3]) * 4);
      camera.getWorldDirection(camDir);
      void play3DPositionalSound(BITE, aSrc.set(st.cx, st.cy, st.cz), camera.position, camDir, { baseVolume: 0.7 });
    }

    // 4) TURN to face the player: ease the stored facing toward the travel direction; keep it when
    //    there's no usable direction (player nearly overhead), so it never freezes on a fixed axis.
    if (hasDir) {
      const turn = Math.min(1, dt * 8);
      st.fx += (dirx - st.fx) * turn; st.fy += (diry - st.fy) * turn; st.fz += (dirz - st.fz) * turn;
    }
    // Keep facing in the tangent plane (⟂ normal) + normalised; reseed from the LEAST-aligned world
    // axis if it ever collapses (guaranteed non-parallel to the normal → never NaN).
    let fdn = st.fx * st.nx + st.fy * st.ny + st.fz * st.nz;
    st.fx -= fdn * st.nx; st.fy -= fdn * st.ny; st.fz -= fdn * st.nz;
    let fll = Math.hypot(st.fx, st.fy, st.fz);
    if (fll < 1e-3) {
      const ax = Math.abs(st.nx), ay = Math.abs(st.ny), az = Math.abs(st.nz);
      const rx = ax <= ay && ax <= az ? 1 : 0, ry = !rx && ay <= az ? 1 : 0, rz = !rx && !ry ? 1 : 0;
      const rd = rx * st.nx + ry * st.ny + rz * st.nz;
      st.fx = rx - rd * st.nx; st.fy = ry - rd * st.ny; st.fz = rz - rd * st.nz;
      fll = Math.hypot(st.fx, st.fy, st.fz) || 1;
    }
    st.fx /= fll; st.fy /= fll; st.fz /= fll;

    // Hard guard: if anything went non-finite, reset cleanly (prevents a NaN transform exploding into
    // screen-filling white triangles).
    if (!Number.isFinite(st.cx + st.cy + st.cz + st.fx + st.nx)) {
      st.cx = spawn[0]; st.cy = spawn[1]; st.cz = spawn[2];
      st.nx = 0; st.ny = 1; st.nz = 0; st.fx = 0; st.fy = 0; st.fz = 1;
    }

    inst.x = st.cx; inst.y = st.cy - CH * 0.25; inst.z = st.cz; inst.yaw = Math.atan2(st.fx, st.fz);

    // Update the body box (low, flat) so OTHER Crawlies can crawl on top of this one.
    const br = Math.max(0.35, CH * 0.35);
    box.min.set(st.cx - br, st.cy - 0.05, st.cz - br);
    box.max.set(st.cx + br, st.cy + 0.25, st.cz + br);

    // 5) Orient: local up = surface normal, local forward = facing (both unit + perpendicular).
    up.set(st.nx, st.ny, st.nz);
    fwd.set(st.fx, st.fy, st.fz);
    right.crossVectors(fwd, up);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0).cross(up);   // paranoia: never normalise a zero vector
    if (right.lengthSq() < 1e-8) right.set(0, 0, 1).cross(up);
    right.normalize();
    fwd.crossVectors(up, right).normalize();
    basis.makeBasis(right, up, fwd);
    g.position.set(st.cx, st.cy, st.cz);
    g.quaternion.setFromRotationMatrix(basis);
    g.scale.set(scale, scale * FLAT, scale);

    // Scuttle sound: looped at the body, only audible while actually crawling.
    if (!scuttle.current) scuttle.current = startLoopSound(SCUTTLE, { x: st.cx, y: st.cy, z: st.cz, baseVolume: 0 });
    camera.getWorldDirection(camDir);
    updateLoopSound(scuttle.current, st.cx, st.cy, st.cz, camera.position, camDir, 1, moving ? 0.5 : 0);
  });

  return <group ref={group}><group ref={inner} rotation={[0, HEADING, 0]}><primitive object={cloned} /></group></group>;
}

useGLTF.preload(URL);
