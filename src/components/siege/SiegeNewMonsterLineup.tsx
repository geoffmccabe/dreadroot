// SiegeNewMonsterLineup — review row of the freshly-imported Synty monsters (Goblin War Camp +
// Boss Zombies) near spawn. Uses a SIMPLE direct-play renderer (clone + useAnimations, play one
// chosen clip) — NOT MonsterEnemy — so we (a) control exactly which clip plays and (b) can cycle
// through every clip with a key to see which animations look right.
//
// Press  M  to cycle the animation for ALL monsters at once; the current clip name shows on screen.
// glb URLs are cache-busted with ?v=APP_VERSION so re-converted models actually reload.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useSyncExternalStore } from 'react';
import { useGLTF, useAnimations, Billboard, Text } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { sampleHeight } from './terrainHeight';
import { SIEGE_SPAWN_POINT } from './siegeAreas';
import { APP_VERSION } from '@/version';

// [glb name, display name, intrinsic modelHeight]
const ROW: [string, string, number][] = [
  ['goblinarcherf', 'Goblin Archer F', 1.792], ['goblinarcherm', 'Goblin Archer M', 1.791],
  ['goblinbeasttamer', 'Goblin Beast Tamer', 1.799], ['goblincook', 'Goblin Cook', 1.798],
  ['goblinking', 'Goblin King', 1.791], ['goblinknight', 'Goblin Knight', 1.795],
  ['goblinprisoner1', 'Goblin Prisoner 1', 1.797], ['goblinprisoner2', 'Goblin Prisoner 2', 1.791],
  ['goblinprisoner3', 'Goblin Prisoner 3', 1.791], ['goblinranger', 'Goblin Ranger', 1.797],
  ['goblinshaman', 'Goblin Shaman', 1.803], ['goblinwarrior', 'Goblin Warrior', 1.804],
  ['goblinwizard', 'Goblin Wizard', 1.793], ['goblinking2', 'Goblin King 2', 1.824],
  ['goblintroll', 'Goblin Troll', 1.825], ['zombieblobber', 'Zombie Blobber', 1.831],
  ['zombiebrute', 'Zombie Brute', 1.845], ['zombieslobber', 'Zombie Slobber', 1.831],
  ['zombiewretch', 'Zombie Wretch', 1.782],
];
const SPACING = 2.2, PER_ROW = 5;

// ── global clip-cycle state (press M) ──
let clipIdx = 0;
let clipLabel = '';
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
function useClipIdx() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => clipIdx);
}

function ReviewMonster({ id, name, mh, x, y, z, first }: { id: string; name: string; mh: number; x: number; y: number; z: number; first: boolean }) {
  const { scene, animations } = useGLTF(`/siege/monsters/${id}.glb?v=${APP_VERSION}`);
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as THREE.Group, [scene]);
  const group = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(animations, group);
  const idx = useClipIdx();

  useEffect(() => {
    if (!names.length) return;
    const clip = names[idx % names.length];
    if (first) { clipLabel = `${(idx % names.length) + 1}/${names.length}  ${clip}`; emit(); }
    const a = actions[clip];
    Object.values(actions).forEach((x) => { if (x && x !== a) x.fadeOut(0.15); });
    a?.reset().fadeIn(0.15).play();
  }, [actions, names, idx, first]);

  return (
    <group>
      <group ref={group} position={[x, y, z]}><primitive object={cloned} /></group>
      <Billboard position={[x, y + mh + 0.6, z]}>
        <Text fontSize={0.3} color="#ffffff" anchorX="center" outlineWidth={0.03} outlineColor="#000000">{name}</Text>
      </Billboard>
    </group>
  );
}

// DOM key handler + on-screen current-clip label.
function useCyclePanel() {
  useEffect(() => {
    const lbl = document.createElement('div');
    lbl.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:10000;background:rgba(10,12,16,.82);border:1px solid #3a4456;border-radius:8px;padding:7px 14px;font:13px sans-serif;color:#dfe6f0';
    const render = () => { lbl.textContent = `Monster anim — press M to cycle:  ${clipLabel || '(loading…)'}`; };
    subs.add(render); render();
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyM') return;
      const t = (e.target as HTMLElement | null)?.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA') return;
      clipIdx++; emit();
    };
    window.addEventListener('keydown', onKey);
    document.body.appendChild(lbl);
    return () => { window.removeEventListener('keydown', onKey); subs.delete(render); lbl.remove(); };
  }, []);
}

export function SiegeNewMonsterLineup() {
  useCyclePanel();
  const cx = SIEGE_SPAWN_POINT[0];
  const cz0 = SIEGE_SPAWN_POINT[2] + 6;
  const placed = useMemo(() => ROW.map(([id, name, mh], i) => {
    const col = i % PER_ROW, row = Math.floor(i / PER_ROW);
    const x = cx + (col - (PER_ROW - 1) / 2) * SPACING;
    const z = cz0 + row * SPACING;
    const y = sampleHeight(x, z) ?? SIEGE_SPAWN_POINT[1];
    return { id, name, mh, x, y, z };
  }), [cx, cz0]);

  return (
    <Suspense fallback={null}>
      {placed.map((p, i) => (
        <ReviewMonster key={p.id} {...p} first={i === 0} />
      ))}
    </Suspense>
  );
}
