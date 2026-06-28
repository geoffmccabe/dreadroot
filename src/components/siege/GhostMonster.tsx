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
import { sampleHeight } from './terrainHeight';
import { fireGhostExplosion } from './GhostExplosion';
import { FIRE_SMOKE, registerRecipe } from '@/effects/recipes';
import { trackInstanceMaterials, useDisposeInstanceMaterials } from '@/lib/three/instanceMaterials';
import { effectiveComponentStats } from './componentMonsterStats';
import type { MonsterMods } from './siegeMonsterCatalog';

const URL = '/siege/monsters/skeletonflesh.glb';
const MODEL_H = 1.803;          // intrinsic skeletonflesh height (model property, not a tunable)
// All other stats (height/opacity/health/hit radius/strike jitter/dive speed/jitter/damage) are
// admin-tunable via componentMonsterStats (npcType 9); defaults below reproduce the originals.

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
  // Admin-tunable base stats (read once per instance so it stays stable; lazy so we don't recompute
  // on every render).
  const csRef = useRef<Record<string, number> | null>(null);
  if (!csRef.current) csRef.current = effectiveComponentStats(9);
  const cs = csRef.current;

  // Per-ghost variation (stable for this instance): ± size & speed jitter. Jitter is clamped to
  // [0,1] and the final size floored so a bad admin value can't flip/zero the model.
  const V = useRef<{ size: number; speed: number } | null>(null);
  if (!V.current) {
    const sj = Math.max(0, Math.min(1, cs.sizeJitter)), vj = Math.max(0, Math.min(1, cs.speedJitter));
    V.current = { size: Math.max(0.05, 1 + (Math.random() * 2 - 1) * sj), speed: Math.max(0.05, 1 + (Math.random() * 2 - 1) * vj) };
  }
  const GH = Math.max(0.05, cs.height * V.current.size * (mods?.sizeMul ?? 1));
  const scale = GH / MODEL_H;

  // Clone the rig (own skeleton) + give it the ghost look via a FRESNEL rim: the silhouette edges
  // go near-opaque and glow cyan (so it's always visible against the bright sky OR dark objects),
  // while the interior stays faint/see-through. A uGhostFade uniform drives the death fade-out.
  const fadeU = useRef<{ value: number }[]>([]);
  const cloned = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    const us: { value: number }[] = [];
    const owned: THREE.Material[] = [];   // per-instance material clones → disposed on unmount
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.frustumCulled = false;
      if (!mesh.isMesh) return;
      const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mats = src.map((m) => (m as THREE.Material).clone());
      owned.push(...mats);
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
      mats.forEach((mm) => {
        const m = mm as THREE.MeshStandardMaterial;
        // depthWrite MUST stay true: with it off, where only sky is behind the ghost writes no depth
        // and the sky background fills back over it → totally invisible vs sky (visible only when an
        // opaque object's depth blocks the sky). The transparent Dark Lord boss writes depth for the
        // same reason.
        m.transparent = true; m.depthWrite = true;
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
    trackInstanceMaterials(c, owned);
    return c;
  }, [scene]);
  useDisposeInstanceMaterials(cloned);

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
    height: GH, radius: Math.max(0.5, GH * 0.22), hp: cs.health * (mods?.healthMul ?? 1), maxHp: cs.health * (mods?.healthMul ?? 1),
    dead: false, deadAt: 0, despawned: false, kvx: 0, kvz: 0, kvy: 0, stunUntil: 0, hitAt: 0,
    headFrac: 0.25, noStun: true, noKnockback: true, yaw: 0, opacity: cs.opacity,
  }).current;
  useEffect(() => { addDemon(inst); return () => removeDemon(inst); }, [inst]);
  useSmokeTrail(inst, true, 'ghost-smoke');

  // Movement state: a center point (cx,cy,cz = body center) that swirls around+above the player,
  // re-rolling its orbit every 6-12s, and diving at the player every 2.5-6s.
  const cx = useRef(spawn[0]), cy = useRef(spawn[1] + cs.height), cz = useRef(spawn[2]);
  const m = useRef({
    angle: Math.random() * Math.PI * 2, dir: Math.random() < 0.5 ? 1 : -1,
    radius: 6, height: 7, rev: 0.4, bobAmp: 1, bobFreq: 0.6, radAmp: 1, radFreq: 0.5,
    rerollAt: 0, mode: 'orbit' as 'orbit' | 'dive' | 'back', diveAt: 0, diveEndsBy: 0, hitDone: false, yaw: 0,
    dtx: 0, dty: 0, dtz: 0,                                            // committed strike point for the current dive
    lastHit: 0, wildUntil: 0, wildSpin: 0, wildYaw: 0,               // shot-mid-attack: fast spin about its own axis
    px: spawn[0], py: spawn[1] + cs.height, pz: spawn[2], vx: 0, vy: 0, vz: 0,   // prev pos + velocity (for death physics)
    deathInit: false, deadFrom: 0, deathSpin: 0, deathAngle: 0,
  }).current;
  const reroll = (now: number) => {
    m.radius = rnd([4, 9]); m.height = rnd([5, 9]); m.rev = rnd([0.25, 0.6]);
    m.bobAmp = rnd([0.5, 2]); m.bobFreq = rnd([0.4, 1.0]); m.radAmp = rnd([0.5, 2.5]); m.radFreq = rnd([0.3, 0.9]);
    m.rerollAt = now + rnd([6000, 12000]);
  };

  useFrame((_, dt) => {
    const g = group.current; if (!g) return;
    const now = performance.now();
    const SPD = V.current!.speed * (mods?.speedMul ?? 1);

    // Death: keep its last trajectory, add gravity + a random 0-1 rev/s tumble, and fall. When it
    // reaches the ground, burst a transparent-black ghost explosion and despawn.
    if (inst.dead) {
      if (!m.deathInit) { m.deathInit = true; m.deadFrom = now; m.deathSpin = Math.random() * Math.PI * 2; }
      m.vy -= 18 * dt;                                                   // gravity
      cx.current += m.vx * dt; cy.current += m.vy * dt; cz.current += m.vz * dt;
      m.deathAngle += m.deathSpin * dt;
      const ground = sampleHeight(cx.current, cz.current) ?? spawn[1];
      const feet = cy.current - GH / 2;
      g.position.set(cx.current, cy.current + GH / 2, cz.current);
      g.rotation.set(Math.PI + m.deathAngle, m.yaw, m.deathAngle * 0.6);
      g.scale.setScalar(scale);
      if (!inst.despawned && (feet <= ground || now - m.deadFrom > 5000)) {
        inst.despawned = true;
        fireGhostExplosion(cx.current, Math.max(ground, feet), cz.current, Math.max(1.4, GH / 2.2));
        onDespawn?.(inst.id);
      }
      return;
    }

    if (m.rerollAt === 0) reroll(now);
    if (now > m.rerollAt) reroll(now);

    // Shot during the wind-up OR the dive → cancel the strike, bounce back up, and tumble wildly for
    // 3s (a player defence: shoot it out of an attack).
    if (inst.hitAt && inst.hitAt !== m.lastHit) {
      m.lastHit = inst.hitAt;
      if (m.mode === 'dive' && !m.hitDone) {
        m.hitDone = true; m.mode = 'back'; m.wildUntil = now + 3000;
        m.wildSpin = (Math.random() < 0.5 ? 1 : -1) * 7.3;   // ~1/3 of the old chaotic tumble, one axis
      }
    }

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
      // Begin a dive (but not while still tumbling from a hit). COMMIT to a strike point NOW — where
      // you are, +0.25m jitter — and drop straight down on it from above, so moving away dodges it.
      if (now > m.diveAt && now > m.wildUntil) {
        const ja = Math.random() * Math.PI * 2, jr = Math.sqrt(Math.random()) * cs.strikeJitter;
        m.dtx = px + Math.cos(ja) * jr; m.dtz = pz + Math.sin(ja) * jr; m.dty = py + 0.3;
        m.mode = 'dive'; m.hitDone = false; m.diveEndsBy = now + 2600;
      }
    } else if (m.mode === 'dive') {
      tx = m.dtx; ty = m.dty; tz = m.dtz; chase = cs.diveSpeed * SPD;   // committed point, half-speed → dodgeable
      const arrived = Math.hypot(m.dtx - cx.current, m.dty - cy.current, m.dtz - cz.current) < 0.7;
      if (arrived || now > m.diveEndsBy) {
        if (!m.hitDone) {                                             // hit ONLY if you're still near the strike point
          m.hitDone = true;
          if (Math.hypot(px - m.dtx, pz - m.dtz) < cs.hitR) {
            const ddx = px - cx.current, ddy = py - cy.current, ddz = pz - cz.current, dd = Math.max(0.001, Math.hypot(ddx, ddy, ddz));
            dealPlayerDamage(rnd([cs.dmgMin, cs.dmgMax]) * (mods?.damageMul ?? 1), ddx / dd, ddy / dd, ddz / dd, rnd([2, 5]) * 6, '/punched.mp3', 'Ghost');
          }
        }
        m.mode = 'back';
      }
    } else {
      m.angle += m.rev * Math.PI * 2 * m.dir * dt;            // climb back up to the orbit
      tx = px + Math.cos(m.angle) * m.radius; tz = pz + Math.sin(m.angle) * m.radius; ty = py + m.height;
      chase = 30 * SPD;
      if (Math.hypot(tx - cx.current, ty - cy.current, tz - cz.current) < 1.5) { m.mode = 'orbit'; m.diveAt = now + rnd([2500, 6000]); }
    }

    // Move the center toward the target at `chase` m/s.
    const mvx = tx - cx.current, mvy = ty - cy.current, mvz = tz - cz.current;
    const md = Math.hypot(mvx, mvy, mvz);
    if (md > 0.0001) { const step = Math.min(md, chase * dt); cx.current += mvx / md * step; cy.current += mvy / md * step; cz.current += mvz / md * step; }

    // Track velocity (for the death fall to inherit the current trajectory).
    const idt = 1 / Math.max(dt, 0.001);
    m.vx = (cx.current - m.px) * idt; m.vy = (cy.current - m.py) * idt; m.vz = (cz.current - m.pz) * idt;
    m.px = cx.current; m.py = cy.current; m.pz = cz.current;

    // Face the player (yaw), smoothed.
    const wantYaw = Math.atan2(px - cx.current, pz - cz.current);
    m.yaw += Math.atan2(Math.sin(wantYaw - m.yaw), Math.cos(wantYaw - m.yaw)) * Math.min(1, dt * 6);

    // Write the hitbox (feet = center - GH/2) so bullets/flames hit the flying body.
    inst.x = cx.current; inst.z = cz.current; inst.y = cy.current - GH / 2; inst.yaw = m.yaw;

    // Render: body centred on the fly point. Normally upside-down + slow spin; while tumbling from a
    // hit, spin fast on all axes (re-rolled every ~150ms) for 3s to telegraph it was struck.
    g.position.set(cx.current, cy.current + GH / 2, cz.current);
    if (now < m.wildUntil) {
      // Struck: spin fast about its OWN vertical axis (1/3 the old tumble), still upside-down.
      m.wildYaw += m.wildSpin * dt;
      g.rotation.set(Math.PI, m.yaw + m.wildYaw, 0);
    } else {
      g.rotation.set(Math.PI, m.yaw + now * 0.0006, 0);
    }
    g.scale.setScalar(scale);
  });

  return <group ref={group}><primitive object={cloned} /></group>;
}

useGLTF.preload(URL);
