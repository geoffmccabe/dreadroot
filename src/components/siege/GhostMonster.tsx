// GhostMonster — a 4m skeletonflesh GHOST that hovers UPSIDE-DOWN around the player like it's caught
// in an invisible tornado: it swirls/orbits above, occasionally DIVES straight down at the player
// (mushroom-grunt style, but from above) then zooms back up. Faint (20% opacity) so it's hard to see,
// and — because opacity doubles as damage resistance in siegeHorde — it only takes 20% damage. It
// trails faint smoke that rises fast. Self-contained: it registers a DemonInstance into siegeDemons,
// so the shared combat registry (bullets/flames/scoring/death) handles it with no weapon-code changes.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { addDemon, removeDemon, type DemonInstance } from './siegeHorde';
import { dealPlayerDamage } from './spray/sprayAttackSystem';
import { useSmokeTrail } from './siegeSmoke';
import { FIRE_SMOKE, registerRecipe } from '@/effects/recipes';
import type { MonsterMods } from './siegeMonsterCatalog';

const URL = '/siege/monsters/skeletonflesh.glb';
const MODEL_H = 1.803;          // intrinsic skeletonflesh height
const BASE_H = 4;               // desired ghost height (m)
const OPACITY = 0.2;            // 20% visible → 20% damage taken (siegeHorde scales by opacity)
const HP = 100;
const HIT_R = 2.6;              // dive contact radius (m)
const DEATH_MS = 1600;          // fade-out window after death before despawn

// Faint, fast-rising ghost smoke: 10s life, rises 3× base, low opacity, cool grey-blue.
registerRecipe({ ...FIRE_SMOKE, code: 'ghost-smoke', lifetime: 10.0, rise: 3.0, spawnRate: 55,
  opacity0: 0.12, opacity1: 0.0, color0: '#9fb4d0', color1: '#cdd9ec', size1: 0.7, spiral: false });

const rnd = ([a, b]: [number, number]) => a + Math.random() * (b - a);
let _gid = 0;

export function GhostMonster({ spawn, id, onDespawn, mods }: {
  spawn: [number, number, number]; id?: string; onDespawn?: (id: string) => void; mods?: MonsterMods;
}) {
  const camera = useThree((s) => s.camera);
  const { scene, animations } = useGLTF(URL);
  const group = useRef<THREE.Group>(null);

  // Per-ghost variation (stable for this instance): ±15% size & speed.
  const V = useRef<{ size: number; speed: number } | null>(null);
  if (!V.current) V.current = { size: 1 + (Math.random() * 2 - 1) * 0.15, speed: 1 + (Math.random() * 2 - 1) * 0.15 };
  const GH = BASE_H * V.current.size * (mods?.sizeMul ?? 1);
  const scale = GH / MODEL_H;

  // Clone the rig (own skeleton) + give it the ghost look via a FRESNEL rim: the silhouette edges
  // go near-opaque and glow cyan (so it's always visible against the bright sky OR dark objects),
  // while the interior stays faint/see-through. A uGhostFade uniform drives the death fade-out.
  const fadeU = useRef<{ value: number }[]>([]);
  const cloned = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    const us: { value: number }[] = [];
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.frustumCulled = false;
      if (!mesh.isMesh) return;
      const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mats = src.map((m) => (m as THREE.Material).clone());
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
      mats.forEach((mm) => {
        const m = mm as THREE.MeshStandardMaterial;
        m.transparent = true; m.depthWrite = false;
        if ('metalness' in m) m.metalness = 0;
        if ('roughness' in m) m.roughness = 0.9;
        const uFade = { value: 1 };
        m.customProgramCacheKey = () => 'ghost-fresnel';
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uGhostFade = uFade;
          shader.fragmentShader = 'uniform float uGhostFade;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            '#include <dithering_fragment>\n'
            + 'float _fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.0);\n'
            + 'gl_FragColor.rgb += vec3(0.45, 0.8, 1.0) * _fr * 1.3;\n'                 // cyan rim glow
            + 'gl_FragColor.a = clamp((0.22 + _fr * 0.72) * uGhostFade, 0.0, 0.96);',  // faint core, opaque edge
          );
        };
        m.needsUpdate = true;
        us.push(uFade);
      });
    });
    fadeU.current = us;
    return c;
  }, [scene]);

  // Idle clip at ¼ speed.
  const { actions, names } = useAnimations(animations, group);
  useEffect(() => {
    const n = names.find((x) => x.toLowerCase().includes('idle')) ?? names[0];
    const a = n ? actions[n] : null;
    a?.reset().fadeIn(0.3).play();
    if (a) a.timeScale = 0.25;
    return () => { a?.fadeOut(0.2); };
  }, [actions, names]);

  // Combat instance — registered so bullets/flames/scoring/death all work via the shared registry.
  // opacity 0.2 ⇒ takes 20% damage. noKnockback/noStun: the ghost drives its own motion.
  const inst = useRef<DemonInstance>({
    id: id ?? `ghost_${_gid++}`, x: spawn[0], y: spawn[1], z: spawn[2],
    height: GH, radius: Math.max(0.5, GH * 0.22), hp: HP * (mods?.healthMul ?? 1), maxHp: HP * (mods?.healthMul ?? 1),
    dead: false, deadAt: 0, despawned: false, kvx: 0, kvz: 0, kvy: 0, stunUntil: 0, hitAt: 0,
    headFrac: 0.25, noStun: true, noKnockback: true, yaw: 0, opacity: OPACITY,
  }).current;
  useEffect(() => { addDemon(inst); return () => removeDemon(inst); }, [inst]);
  useSmokeTrail(inst, true, 'ghost-smoke');

  // Movement state: a center point (cx,cy,cz = body center) that swirls around+above the player,
  // re-rolling its orbit every 6-12s, and diving at the player every 2.5-6s.
  const cx = useRef(spawn[0]), cy = useRef(spawn[1] + BASE_H), cz = useRef(spawn[2]);
  const m = useRef({
    angle: Math.random() * Math.PI * 2, dir: Math.random() < 0.5 ? 1 : -1,
    radius: 6, height: 7, rev: 0.4, bobAmp: 1, bobFreq: 0.6, radAmp: 1, radFreq: 0.5,
    rerollAt: 0, mode: 'orbit' as 'orbit' | 'dive' | 'back', diveAt: 0, diveEndsBy: 0, hitDone: false, yaw: 0,
  }).current;
  const reroll = (now: number) => {
    m.radius = rnd([4, 9]); m.height = rnd([5, 9]); m.rev = rnd([0.25, 0.6]);
    m.bobAmp = rnd([0.5, 2]); m.bobFreq = rnd([0.4, 1.0]); m.radAmp = rnd([0.5, 2.5]); m.radFreq = rnd([0.3, 0.9]);
    m.rerollAt = now + rnd([6000, 12000]);
  };

  const fade = useRef(1);

  useFrame((_, dt) => {
    const g = group.current; if (!g) return;
    const now = performance.now();
    const SPD = V.current!.speed * (mods?.speedMul ?? 1);

    // Death: fade out the materials, then despawn once.
    if (inst.dead) {
      fade.current = Math.max(0, 1 - (now - inst.deadAt) / DEATH_MS);
      for (const u of fadeU.current) u.value = fade.current;
      g.position.set(cx.current, cy.current + GH / 2, cz.current);
      if (!inst.despawned && now - inst.deadAt > DEATH_MS) { inst.despawned = true; onDespawn?.(inst.id); }
      return;
    }

    if (m.rerollAt === 0) reroll(now);
    if (now > m.rerollAt) reroll(now);

    const px = camera.position.x, py = camera.position.y, pz = camera.position.z;

    // Decide the target the ghost is moving toward + the speed to chase it at.
    let tx: number, ty: number, tz: number, chase: number;
    if (m.mode === 'orbit') {
      m.angle += m.rev * Math.PI * 2 * m.dir * dt;
      const r = m.radius + Math.sin(now * 0.001 * m.radFreq) * m.radAmp;
      const h = m.height + Math.sin(now * 0.001 * m.bobFreq + m.angle) * m.bobAmp;
      tx = px + Math.cos(m.angle) * r; tz = pz + Math.sin(m.angle) * r; ty = py + h;
      chase = 16 * SPD;
      if (m.diveAt === 0) m.diveAt = now + rnd([2500, 6000]);
      if (now > m.diveAt) { m.mode = 'dive'; m.hitDone = false; m.diveEndsBy = now + 1500; }   // begin a dive
    } else if (m.mode === 'dive') {
      tx = px; ty = py + 0.3; tz = pz; chase = 42 * SPD;     // zoom straight down at the player
      const dx = px - cx.current, dy = (py + 0.3) - cy.current, dz = pz - cz.current;
      const dist = Math.hypot(dx, dy, dz);
      if (!m.hitDone && dist < HIT_R) {                      // contact → 1-50 dmg, 2-5m knockback
        m.hitDone = true;
        const id2 = Math.max(0.001, dist);
        dealPlayerDamage(rnd([1, 50]) * (mods?.damageMul ?? 1), dx / id2, dy / id2, dz / id2, rnd([2, 5]) * 6);
      }
      if (m.hitDone || dist < HIT_R || now > m.diveEndsBy) m.mode = 'back';
    } else {
      m.angle += m.rev * Math.PI * 2 * m.dir * dt;            // climb back up to the orbit
      tx = px + Math.cos(m.angle) * m.radius; tz = pz + Math.sin(m.angle) * m.radius; ty = py + m.height;
      chase = 38 * SPD;
      if (Math.hypot(tx - cx.current, ty - cy.current, tz - cz.current) < 1.5) { m.mode = 'orbit'; m.diveAt = now + rnd([2500, 6000]); }
    }

    // Move the center toward the target at `chase` m/s.
    const mvx = tx - cx.current, mvy = ty - cy.current, mvz = tz - cz.current;
    const md = Math.hypot(mvx, mvy, mvz);
    if (md > 0.0001) { const step = Math.min(md, chase * dt); cx.current += mvx / md * step; cy.current += mvy / md * step; cz.current += mvz / md * step; }

    // Face the player (yaw), smoothed.
    const wantYaw = Math.atan2(px - cx.current, pz - cz.current);
    m.yaw += Math.atan2(Math.sin(wantYaw - m.yaw), Math.cos(wantYaw - m.yaw)) * Math.min(1, dt * 6);

    // Write the hitbox (feet = center - GH/2) so bullets/flames hit the flying body.
    inst.x = cx.current; inst.z = cz.current; inst.y = cy.current - GH / 2; inst.yaw = m.yaw;

    // Render: upside-down (rotate π on X), body centred on the fly point, spinning slowly in place.
    g.position.set(cx.current, cy.current + GH / 2, cz.current);
    g.rotation.set(Math.PI, m.yaw + now * 0.0006, 0);
    g.scale.setScalar(scale);
  });

  return <group ref={group}><primitive object={cloned} /></group>;
}

useGLTF.preload(URL);
