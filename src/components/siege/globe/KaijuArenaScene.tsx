// KaijuArenaScene — draws the Everest fight: the opposing Kaiju, and every projectile in flight.
//
// The player's own Kaiju is still drawn by GlobeKaiju/KaijuLabController, which is untouched.
// This module only adds the opponents and the ordnance, and drives the simulation clock.
//
// WHY A SEPARATE AVATAR COMPONENT. GlobeKaiju's avatar derives its transform from the CAMERA (it
// is the player's third-person stand-in). An AI Kaiju has its own simulated body, so it needs a
// renderer that reads a KaijuBody instead. Rather than thread a mode flag through the working
// player renderer — which is shared with the other Claude on this branch — this is its own module.

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { CFG } from '../siegeMonsterCatalog';
import { APP_VERSION } from '@/version';
import { walkSpeed, runSpeed, type KaijuBody } from './kaijuBody';
import {
  getAgents, stepArena, arenaStarted, playerAttack, subscribeArena, arenaVersion,
  ARENA_HEIGHT, type Agent,
} from './kaijuArena';
import { getProjectiles } from './kaijuWeapons';

/** Clip preferences per gait, matching GlobeKaiju so both look the same. */
const CLIPS: Record<string, string[]> = {
  walk: ['walk', 'walking'],
  run: ['run', 'walk', 'walking'],
  idle: ['breathidle', 'idle'],
  attack: ['attack', 'attack1', 'jumpattack', 'hit'],
  dead: ['death', 'die', 'hit', 'idle'],
};

/** Playback rate for a body this tall. Bigger creatures move their limbs slower (Froude). */
function animRate(b: KaijuBody, h: number): number {
  const w = walkSpeed(h);
  return Math.max(0.35, Math.min(1.8, b.speed / Math.max(1e-4, w)));
}

function AgentAvatar({ agent }: { agent: Agent }) {
  const cfg = CFG[agent.monsterType as keyof typeof CFG];
  const url = cfg?.url;
  const modelHeight = cfg?.modelHeight ?? 2;
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(`${url}?v=${APP_VERSION}`);

  // SkeletonUtils.clone, not scene.clone() — see the long note in GlobeKaiju.tsx. A plain clone
  // leaves each SkinnedMesh bound to the original skeleton and renders nothing at all.
  const model = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    c.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    return c;
  }, [scene]);

  const { actions, names, mixer } = useAnimations(animations, model);
  const gait = useRef<string>('idle');
  const current = useRef<THREE.AnimationAction | null>(null);

  const play = (g: string) => {
    if (gait.current === g && current.current) return;
    gait.current = g;
    const want = CLIPS[g] ?? CLIPS.idle;
    const name = want.map((w) => names.find((n) => n.toLowerCase() === w)).find(Boolean) ?? names[0];
    if (!name) return;
    const next = actions[name];
    if (!next || next === current.current) return;
    current.current?.fadeOut(0.25);
    next.reset().fadeIn(0.25).play();
    if (g === 'dead') { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
    else next.setLoop(THREE.LoopRepeat, Infinity);
    current.current = next;
  };

  useEffect(() => { if (names.length) play('idle'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [names.length]);

  const right = useRef(new THREE.Vector3());
  const trueF = useRef(new THREE.Vector3());
  const basis = useRef(new THREE.Matrix4());

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const b = agent.body;

    g.position.copy(b.dir).multiplyScalar(b.radius);
    // FACING. The model's local +Z is its front — the same convention MonsterEnemy uses when it
    // does `rotation.y = atan2(dx, dz)`. So the basis must map local +Z to `forward`, local +Y to
    // the local up, and local +X to up x forward.
    //
    // This previously built makeBasis(right, up, -forward), which is a valid right-handed frame
    // but is rotated 180 degrees about up — so the Kaiju faced and animated exactly backwards
    // while walking forwards. Verified numerically rather than by eye.
    right.current.crossVectors(b.dir, b.forward).normalize();
    trueF.current.copy(b.forward).normalize();
    basis.current.makeBasis(right.current, b.dir, trueF.current);
    g.quaternion.setFromRotationMatrix(basis.current);

    if (!agent.alive) { play('dead'); mixer.timeScale = 1; return; }
    const wS = walkSpeed(ARENA_HEIGHT), rS = runSpeed(ARENA_HEIGHT);
    play(b.speed > (wS + rS) * 0.5 ? 'run' : b.speed > wS * 0.25 ? 'walk' : 'idle');
    mixer.timeScale = animRate(b, ARENA_HEIGHT);
  });

  if (!url) return null;
  const scale = ARENA_HEIGHT / Math.max(0.01, modelHeight);
  return (
    <group ref={group}>
      <primitive object={model} scale={scale} />
    </group>
  );
}

/** Every projectile as a single instanced draw, because the flamethrower emits a lot of them. */
function Projectiles() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const MAX = 400;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colour = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const list = getProjectiles();
    const n = Math.min(list.length, MAX);
    for (let i = 0; i < n; i++) {
      const p = list[i];
      dummy.position.copy(p.pos);
      dummy.scale.setScalar(p.size);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      colour.setRGB(p.colour[0], p.colour[1], p.colour[2]);
      m.setColorAt(i, colour);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/**
 * Mount inside the globe scene. Steps the simulation and draws the opponents.
 *
 * `playerControlled` tells the arena to leave agent 0's body alone, because the walk controller
 * is driving it. With it false the player's Kaiju fights itself, which is how the headless check
 * runs a full three-way battle.
 */
export function KaijuArenaScene({ playerControlled }: { playerControlled: boolean }) {
  // SUBSCRIBE, do not just read.
  //
  // Reading the arena state during render meant this component mounted with no fight running,
  // returned null, and was never re-rendered when one started — so the opponents could never
  // appear, however correct the simulation underneath was. That is the whole of the "I only see
  // my own Kaiju" symptom. The version counter changes on every start, reset and stop, which is
  // what brings React back to build the models.
  useSyncExternalStore(subscribeArena, arenaVersion, arenaVersion);
  const agents = getAgents();
  const firing = useRef(false);

  // Left mouse held = fire your weapon (the flamethrower, which is continuous, so holding is the
  // natural way to use it). R = swing. Both go through the same cooldowns and hit tests the AI
  // uses, so nothing about the player's Kaiju is privileged.
  useEffect(() => {
    const down = (e: MouseEvent) => { if (e.button === 0) firing.current = true; };
    const up = (e: MouseEvent) => { if (e.button === 0) firing.current = false; };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'KeyR' && !e.repeat && arenaStarted()) playerAttack('melee');
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('keydown', key);
    };
  }, []);

  useFrame((_, rawDt) => {
    if (!arenaStarted()) return;
    // Clamp: a long frame (tab restored, a stall) must not teleport everybody through each other.
    if (firing.current) playerAttack('weapon');
    stepArena(Math.min(rawDt, 0.05), playerControlled);
  });

  if (!arenaStarted()) return null;
  return (
    <>
      {agents.filter((a) => !a.isPlayer).map((a) => <AgentAvatar key={a.id} agent={a} />)}
      <Projectiles />
    </>
  );
}
