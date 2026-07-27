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
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { CFG, MONSTER_CATALOG } from '../siegeMonsterCatalog';
import { APP_VERSION } from '@/version';
import { walkSpeed, runSpeed, type KaijuBody } from './kaijuBody';
import { METRES_PER_UNIT } from './cubeSphere';
import {
  getAgents, stepArena, arenaStarted, playerAttack, subscribeArena, arenaVersion,
  ARENA_HEIGHT, type Agent,
} from './kaijuArena';
import { getProjectiles } from './kaijuWeapons';
import { updateKaijuFootsteps, stopKaijuFootsteps, stopAllKaijuFootsteps } from './kaijuAudio';
import { prepareFlash, applyFlash, flashIntensity, releaseFlash } from './kaijuFlash';

/** Clip preferences per gait, matching GlobeKaiju so both look the same. */
const CLIPS: Record<string, string[]> = {
  walk: ['walk', 'walking'],
  run: ['run', 'walk', 'walking'],
  idle: ['breathidle', 'idle'],
  attack: ['attack', 'attack1', 'jumpattack', 'hit'],
  dead: ['death', 'die', 'hit', 'idle'],
};

/**
 * Playback rate for a Kaiju's clips. TWO factors, and this had NEITHER of them right.
 *
 * 1. SIZE. Under dynamic similarity a creature scaled up by S moves its limbs at 1/sqrt(S). A
 *    300 m Kaiju built from a 4 m Red Demon is 75x its natural size, so its clips must play at
 *    about 0.12x. This applied no size factor at all — which is why Geoff's opponent was
 *    "running super fast": the AI Kaiju were animating roughly fifteen times too quickly while
 *    the player's own Kaiju (which does apply it) looked correct.
 *
 * 2. GAIT. The stride correction has to be measured against the speed the CURRENT CLIP depicts.
 *    Dividing by walk speed while the run clip is playing pushed it to the 1.8x clamp on top of
 *    everything else. Same bug already fixed in GlobeKaiju; it lived on here.
 *
 * `naturalMetres` is the creature's real-world height from the catalog, not the model's units.
 */
function animRate(b: KaijuBody, h: number, naturalMetres: number, running: boolean): number {
  const sizeRatio = (h * METRES_PER_UNIT) / Math.max(0.01, naturalMetres);
  const sizeMul = 1 / Math.sqrt(sizeRatio);
  const reference = running ? runSpeed(h) : walkSpeed(h);
  const stride = Math.min(1.6, Math.max(0.35, b.speed / Math.max(1e-4, reference)));
  return sizeMul * stride;
}

function AgentAvatar({ agent }: { agent: Agent }) {
  const camera = useThree((s) => s.camera);
  const look = useRef(new THREE.Vector3());
  const cfg = CFG[agent.monsterType as keyof typeof CFG];
  const url = cfg?.url;
  const modelHeight = cfg?.modelHeight ?? 2;
  // The creature's REAL-WORLD height, which is what the size slowdown is measured against — a Red
  // Demon is naturally 4 m, a Fort Golem 12 m, so blowing both up to 300 m slows them by very
  // different amounts.
  const naturalMetres = MONSTER_CATALOG.find((c) => c.id === agent.monsterType)?.baseHeight ?? 2;
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(`${url}?v=${APP_VERSION}`);

  // SkeletonUtils.clone, not scene.clone() — see the long note in GlobeKaiju.tsx. A plain clone
  // leaves each SkinnedMesh bound to the original skeleton and renders nothing at all.
  const model = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    c.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    prepareFlash(c);
    return c;
  }, [scene]);
  useEffect(() => () => releaseFlash(model), [model]);

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

    if (!agent.alive) { play('dead'); mixer.timeScale = 0.4; stopKaijuFootsteps(agent.id); return; }
    const wS = walkSpeed(ARENA_HEIGHT), rS = runSpeed(ARENA_HEIGHT);
    const running = b.speed > (wS + rS) * 0.5;
    play(running ? 'run' : b.speed > wS * 0.25 ? 'walk' : 'idle');
    mixer.timeScale = animRate(b, ARENA_HEIGHT, naturalMetres, running);

    // Footsteps, positioned in the world — so an enemy Kaiju crossing behind you is something you
    // hear before you see, which at this scale is most of the drama.
    camera.getWorldDirection(look.current);
    updateKaijuFootsteps(agent.id, b, ARENA_HEIGHT, camera.position, look.current, true);
    applyFlash(model, flashIntensity(agent.ackFlash));
  });

  useEffect(() => () => stopKaijuFootsteps(agent.id), [agent.id]);

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

      // FIRE GROWS AND COOLS. A flame ball that is one constant size and colour reads as a
      // travelling pebble; real fire expands as it burns out and shifts white -> orange -> smoke.
      // `age` runs 0 (just fired) to 1 (about to die).
      const age = 1 - Math.max(0, Math.min(1, p.life / Math.max(0.01, p.maxLife)));
      if (p.weapon === 'flame') {
        dummy.scale.setScalar(p.size * (0.45 + age * 1.9));
        // White-hot at the muzzle, deep orange in the middle, dim red as it dies.
        colour.setRGB(
          1.0,
          0.92 - age * 0.62,
          0.75 - age * 0.72,
        ).multiplyScalar(1 - age * 0.65);
      } else {
        dummy.scale.setScalar(p.size);
        colour.setRGB(p.colour[0], p.colour[1], p.colour[2]);
      }
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, colour);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    // Additive and depth-write off: overlapping flame particles accumulate into a bright core the
    // way fire does, instead of showing every sphere's silhouette as a hard edge.
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX]} frustumCulled={false}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshBasicMaterial
        toneMapped={false}
        transparent
        opacity={0.85}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
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

  useEffect(() => () => stopAllKaijuFootsteps(), []);

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
