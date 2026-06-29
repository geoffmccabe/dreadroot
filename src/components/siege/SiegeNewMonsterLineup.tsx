// SiegeNewMonsterLineup — the curated FantasyRivals monster set for Siege Worlds.
//  • A review row at Bleakrock spawn: each monster at its chosen height, on the ground, with a
//    floating name tag. Press M to cycle ONLY the kept animations (the ones confirmed good).
//  • Spawn command: type  @ <monster#> # <qty>  (e.g. @6#3 = three Elemental Golems) to drop
//    active monsters at the camera. Health = 50 × height. Bigger monsters walk with slower
//    animation (so they don't skate).
// Once these basics are confirmed, they get wired into the Challenge Creator.
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isTypingTarget } from '@/lib/isTypingTarget';
import { useGLTF, useAnimations, Billboard, Text } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';
import { groundAt } from './siegeGround';
import { SIEGE_SPAWN_POINT } from './siegeAreas';
import { APP_VERSION } from '@/version';
import { MonsterEnemy, type MonsterConfig } from './MonsterEnemy';
import { throwBoulder, getBoulders, updateBoulders } from './boulderSystem';
import { getGlobalAtlasTexture } from '@/hooks/useTextureAtlas';
import { useWorkMode } from './siegeWorkMode';

// id (for @ command) | glb | display name | height m | walk speed m/s | animSpeed (anim playback)
// All glbs are ~2.0 m intrinsic, so render scale = height/2. Bigger ⇒ slower animSpeed (no skating).
type Mon = { id: number; glb: string; name: string; height: number; speed: number; animSpeed: number };
const MONSTERS: Mon[] = [
  { id: 1, glb: 'slayer',          name: 'Slayer',           height: 2.0,  speed: 3.0, animSpeed: 1.0 },
  { id: 2, glb: 'pigbutcher',      name: 'Pig Butcher',      height: 2.2,  speed: 2.8, animSpeed: 1.0 },
  { id: 3, glb: 'mutant',          name: 'Mutant',           height: 2.6,  speed: 3.2, animSpeed: 1.0 },
  { id: 4, glb: 'forestguardian',  name: 'Forest Guardian',  height: 3.5,  speed: 2.5, animSpeed: 0.85 },
  { id: 5, glb: 'barbariangiant',  name: 'Barbarian Giant',  height: 6.0,  speed: 2.6, animSpeed: 0.65 },
  { id: 6, glb: 'elementalgolem',  name: 'Elemental Golem',  height: 8.0,  speed: 2.2, animSpeed: 0.55 },
  { id: 7, glb: 'mechanicalgolem', name: 'Mechanical Golem', height: 10.0, speed: 2.4, animSpeed: 0.5 },
  { id: 8, glb: 'fortgolem',       name: 'Fort Golem',       height: 12.0, speed: 2.0, animSpeed: 0.45 },
];
const INTRINSIC = 2.0;
const healthFor = (h: number) => Math.round(50 * h);
// Only these animations are kept for cycling (the confirmed-good ones).
const KEEP = ['idle', 'walk', 'run', 'weapon_strike1', 'punch', 'swipe', 'hit', 'death'];

// ── M-cycle state ──
let clipIdx = 0, clipLabel = '';
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
function useClipIdx() { return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => clipIdx); }

function ReviewMonster({ mon, x, z, y: yOverride, first }: { mon: Mon; x: number; z: number; y?: number; first: boolean }) {
  const { scene, animations } = useGLTF(`/siege/monsters/${mon.glb}.glb?v=${APP_VERSION}`);
  const cloned = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    c.traverse((o) => {
      const m = o as THREE.Mesh; if (!(m as THREE.Mesh).isMesh) return;
      const arr = Array.isArray(m.material) ? m.material : [m.material];
      const cl = arr.map((mm) => (mm as THREE.Material).clone());
      m.material = Array.isArray(m.material) ? cl : cl[0];
      cl.forEach((mm) => { const s = mm as THREE.MeshStandardMaterial; if ('emissive' in s && s.map) { s.emissive = new THREE.Color(0xffffff); s.emissiveMap = s.map; s.emissiveIntensity = 0.5; s.needsUpdate = true; } });
    });
    return c;
  }, [scene]);
  const group = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, group);
  const idx = useClipIdx();
  const keep = useMemo(() => KEEP.filter((k) => names.includes(k)), [names]);
  const y = useMemo(() => yOverride ?? sampleHeight(x, z) ?? SIEGE_SPAWN_POINT[1], [x, z, yOverride]);
  const scale = mon.height / INTRINSIC;

  useEffect(() => {
    if (!keep.length) return;
    const clip = keep[idx % keep.length];
    if (first) { clipLabel = `${mon.name}: ${clip}  (${(idx % keep.length) + 1}/${keep.length})`; emit(); }
    const a = actions[clip];
    Object.values(actions).forEach((q) => { if (q && q !== a) q.fadeOut(0.15); });
    a?.reset().fadeIn(0.15).play();
  }, [actions, keep, idx, first, mon.name]);

  return (
    <group>
      <group ref={group} position={[x, y, z]} scale={scale}><primitive object={cloned} /></group>
      <Billboard position={[x, y + mon.height + 0.5, z]}>
        <Text fontSize={Math.max(0.4, mon.height * 0.12)} color="#ffffff" anchorX="center" outlineWidth={0.04} outlineColor="#000000">{mon.name}</Text>
      </Billboard>
    </group>
  );
}

// Press M to cycle kept animations; big 3s name label. Only active in work mode (⌘-]).
function useCyclePanel(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:10001;background:rgba(10,12,16,.92);border:2px solid #5a7cff;border-radius:12px;padding:14px 32px;font:700 22px sans-serif;color:#fff;opacity:0;transition:opacity .2s;pointer-events:none;text-align:center';
    const hint = document.createElement('div');
    hint.textContent = '@@@ = toggle lineup   •   M = cycle animation   •   @<#>#<qty> = spawn (e.g. @6#3)';
    hint.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:10000;background:rgba(10,12,16,.7);border:1px solid #3a4456;border-radius:6px;padding:5px 12px;font:13px sans-serif;color:#aab4c4';
    let hideT: ReturnType<typeof setTimeout>;
    const show = () => { flash.textContent = clipLabel || 'loading…'; flash.style.opacity = '1'; clearTimeout(hideT); hideT = setTimeout(() => { flash.style.opacity = '0'; }, 3000); };
    subs.add(show);
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyM') return;
      if (isTypingTarget(e)) return;
      clipIdx++; emit();
    };
    window.addEventListener('keydown', onKey);
    document.body.appendChild(flash); document.body.appendChild(hint);
    return () => { window.removeEventListener('keydown', onKey); subs.delete(show); clearTimeout(hideT); flash.remove(); hint.remove(); };
  }, [enabled]);
}

// Type "@@@" (three @ in quick succession) to toggle the review lineup on/off anywhere,
// without needing work mode. Counts @ presses; 3 within ~900ms = toggle.
function useLineupToggle(toggle: () => void) {
  useEffect(() => {
    let count = 0;
    let t: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      // '@' (US) or Shift+physical-2 (layout-independent via e.code), matching the spawn/NPC commands.
      if (!(e.key === '@' || (e.shiftKey && e.code === 'Digit2'))) return;
      count++;
      if (t) clearTimeout(t);
      if (count >= 3) { count = 0; toggle(); return; }
      t = setTimeout(() => { count = 0; }, 1200);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (t) clearTimeout(t); };
  }, [toggle]);
}

let spawnSeq = 0;
type WeaponAttach = { url: string; scale?: number; pos?: [number, number, number]; rotDeg?: [number, number, number] };
type Spawned = { key: number; mon: Mon; pos: [number, number, number]; weapon?: WeaponAttach };

// TEST: random melee weapons for the Pig Butcher. Consistent Synty SM_Wep set (handle ~through
// the origin); scale 100 compensates the rig's 0.01 hand-bone scale → ~1 m, scaling with the
// monster. Grip seating (pos/rotDeg) is rough for now — fine-tune once the look is approved.
const PIG_WEAPONS: WeaponAttach[] = [
  { url: '/siege/world/SM_Wep_Sword_01.glb', scale: 100, rotDeg: [-90, 0, 0] },
  { url: '/siege/world/SM_Wep_Sword_02.glb', scale: 100, rotDeg: [-90, 0, 0] },
  { url: '/siege/world/SM_Wep_Sword_03.glb', scale: 100, rotDeg: [-90, 0, 0] },
  { url: '/siege/world/SM_Wep_Axe_01.glb',   scale: 100, rotDeg: [-90, 0, 0] },
  { url: '/siege/world/SM_Wep_Axe_02.glb',   scale: 100, rotDeg: [-90, 0, 0] },
  { url: '/siege/world/SM_Wep_Spear_01.glb', scale: 100, rotDeg: [-90, 0, 0] },
  { url: '/siege/world/SM_Item_Hammer_01.glb', scale: 100, rotDeg: [-90, 0, 0] },
];


// Renders thrown boulders (2 m grey spheres with the fortress block texture) from a fixed pool,
// updated each frame. The golem's onRangedAttack pushes boulders into boulderSystem.
function BoulderField() {
  const camera = useThree((s) => s.camera);
  const POOL = 24;
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  // Use the baked rock mesh (Apocalypse SM_Env_Rock_01, stretched round, ~2 m) instead of a sphere.
  const { scene } = useGLTF(`/siege/monsters/boulder.glb?v=${APP_VERSION}`);
  const { geo, mat } = useMemo(() => {
    let g: THREE.BufferGeometry | null = null, m: THREE.Material | null = null;
    scene.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh && !g) { g = me.geometry; m = me.material as THREE.Material; } });
    return { geo: g ?? new THREE.SphereGeometry(1, 16, 12), mat: m ?? new THREE.MeshStandardMaterial({ color: 0x8a8a8a }) };
  }, [scene]);
  useFrame((_, dt) => {
    updateBoulders(dt, camera.position.x, camera.position.y - 1.6, camera.position.z);
    const bs = getBoulders();
    for (let i = 0; i < POOL; i++) {
      const m = refs.current[i]; if (!m) continue;
      const b = bs[i];
      if (b) { m.visible = true; m.position.set(b.x, b.y, b.z); m.rotation.x += dt * 2; m.rotation.z += dt * 1.3; }
      else m.visible = false;
    }
  });
  return <>{Array.from({ length: POOL }).map((_, i) => (
    <mesh key={i} ref={(el) => { refs.current[i] = el; }} geometry={geo} material={mat} visible={false} frustumCulled={false} />
  ))}</>;
}

export function SiegeNewMonsterLineup() {
  const workMode = useWorkMode();
  const camera = useThree((s) => s.camera);
  const [lineupShown, setLineupShown] = useState(false);
  // When @@@ turns the lineup ON, snapshot a row in front of the camera so it appears
  // wherever the player is standing — not pinned to the Bleakrock spawn. (rx,rz) = the
  // camera-right unit vector the row is laid along; y = ground under that point.
  const [anchor, setAnchor] = useState<{ cx: number; cz: number; rx: number; rz: number; y: number } | null>(null);
  const toggleLineup = useMemo(() => () => {
    setLineupShown((v) => {
      const nv = !v;
      if (nv) {
        const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0;
        if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1); else fwd.normalize();
        const cx = camera.position.x + fwd.x * 16;
        const cz = camera.position.z + fwd.z * 16;
        const y = groundAt(cx, cz, camera.position.y + 1) ?? (camera.position.y - 1.6);
        setAnchor({ cx, cz, rx: -fwd.z, rz: fwd.x, y });
      } else setAnchor(null);
      return nv;
    });
  }, [camera]);
  useLineupToggle(toggleLineup);
  const showLineup = workMode || lineupShown;   // ⌘-] work mode OR typed @@@
  useCyclePanel(showLineup);
  const [spawned, setSpawned] = useState<Spawned[]>([]);
  const add = useMemo(() => (mon: Mon, pos: [number, number, number]) => {
    // Pig Butcher gets a RANDOM melee weapon (testing the hand-attach + variety).
    const weapon = mon.glb === 'pigbutcher' ? PIG_WEAPONS[(Math.random() * PIG_WEAPONS.length) | 0] : undefined;
    setSpawned((s) => [...s, { key: spawnSeq++, mon, pos, weapon }]);
  }, []);
  // Remove a dead @-spawned monster once its death finishes, so the list + its collider
  // don't leak (it's not a challenge, so corpses sink + despawn).
  const removeSpawned = useMemo(() => (id: string) => setSpawned((s) => s.filter((x) => `lu${x.key}` !== id)), []);
  // @-spawn retired: spawning is now ONE system via "!" (SiegeSpawner), which already covers these
  // monsters (catalog ids 10-17). The review lineup itself still toggles via ⌘-] / @@@.
  void add;

  // Per-monster special behavior + clip overrides.
  const extraProps = (mon: Mon): Partial<MonsterConfig> => {
    // Clean re-baked walk; SWIPE attack (committed swing → strike, via the swing sound); enrage
    // to run + 50% speed once shot.
    const props: Partial<MonsterConfig> = {
      clips: { attack: 'swipe' }, attackSound: '/swoosh_miss_low.mp3', missSound: '/swoosh_miss_low.mp3',
      lungeOnSwing: true, enrageOnHit: true,
    };
    if (mon.glb === 'elementalgolem') {
      Object.assign(props, {
        kiteMin: 50, kiteMax: 100, rangedRange: 100, rangedCooldownMs: 1000, rangedCooldownMaxMs: 3000,
        onRangedAttack: (ox: number, oy: number, oz: number) => {
          if (Math.random() < 0.5) return;            // 50% chance per 1-3 s window
          // Release the boulder ~50% of the way through the attack animation.
          setTimeout(() => {
            const p = camera.position;
            throwBoulder(ox, oy, oz, p.x, p.y - 1.6, p.z, 30 + Math.random() * 30,
              { dmgMin: 50, dmgMax: 200, kbMin: 5, kbMax: 20 });
          }, 500);
        },
      });
    }
    return props;
  };

  // Spaced so big monsters don't overlap. Laid along the camera-right axis when summoned via
  // @@@ (anchor set), else along world-X at the Bleakrock spawn (work-mode display).
  const placed = useMemo(() => {
    const half = MONSTERS.map((m) => Math.max(1.2, m.height * 0.35));
    const total = half.reduce((a, h) => a + 2 * h + 2.5, 0);
    const cx = anchor ? anchor.cx : SIEGE_SPAWN_POINT[0];
    const cz = anchor ? anchor.cz : SIEGE_SPAWN_POINT[2] + 8;
    const rx = anchor ? anchor.rx : 1, rz = anchor ? anchor.rz : 0;
    let off = -total / 2;
    return MONSTERS.map((m, i) => {
      off += half[i] + 1.25; const o = off; off += half[i] + 1.25;
      return { m, x: cx + rx * o, z: cz + rz * o, y: anchor ? anchor.y : undefined };
    });
  }, [anchor]);

  return (
    <Suspense fallback={null}>
      {/* The standing review lineup — shown in work mode (⌘-]) OR after typing @@@. */}
      {showLineup && placed.map((p, i) => (
        <ReviewMonster key={p.m.glb} mon={p.m} x={p.x} z={p.z} y={p.y} first={i === 0} />
      ))}
      {spawned.map((s) => (
        <MonsterEnemy key={s.key} id={`lu${s.key}`} onDespawn={removeSpawned} spawn={s.pos} url={`/siege/monsters/${s.mon.glb}.glb?v=${APP_VERSION}`}
          modelHeight={INTRINSIC} height={s.mon.height} speed={s.mon.speed} animSpeed={s.mon.animSpeed}
          health={healthFor(s.mon.height)} gait="climb" deathStyle="topple" attackRange={Math.max(1.6, s.mon.height * 0.5 + 0.8)} attackMs={1400}
          meleeContact={{ dmg: [s.mon.height * 3, s.mon.height * 7], kb: [2, 8], cooldownMs: 1300 }} weapon={s.weapon} {...extraProps(s.mon)} />
      ))}
      <BoulderField />
    </Suspense>
  );
}
