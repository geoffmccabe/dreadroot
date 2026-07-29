// KaijuCrowd — 200 human beings, 1.8 m tall, milling around a 300 m monster.
//
// Geoff: "It would be good to get a sense of the 300m scale of the Kaiju." That is exactly what
// this is for, and it is the cheapest way to make the size READ. A number in a HUD does not do it;
// a creature whose foot is longer than the crowd running away from it does.
//
// THE ONE ENGINEERING DECISION WORTH EXPLAINING.
//
// These are drawn as ONE instanced mesh in a single draw call, in a fixed pose, with their motion
// done procedurally — not as 200 animated characters. That is not a shortcut taken to save effort;
// it is the correct call at this scale, and the maths says so:
//
//   a person is 1.8 m; the Kaiju is 300 m; so a person is 0.6% of its height.
//   Framed so the Kaiju fills half the screen, a person is about THREE PIXELS tall.
//
// Skinned animation at three pixels is invisible. What is visible at three pixels is whether the
// dot is moving, bobbing, and leaning — so that is what gets simulated. 200 skinned meshes would
// cost 200 draw calls and 200 skeleton updates per frame to render detail nobody can resolve, on a
// map that already streams a planet.
//
// Their behaviour is deliberately simple and deliberately human: run for a while, stop and look,
// run again, and generally stay near the monster the way crowds actually do — which is to say some
// flee and some absolutely do not.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { APP_VERSION } from '@/version';
import { CFG } from '../siegeMonsterCatalog';
import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';
import { body as playerBody } from './kaijuBody';
import { rand } from './kaijuRandom';

/** A real person, in game units. 1.8 m at 100 m per unit. */
const PERSON_UNITS = 1.8 / METRES_PER_UNIT;
/** How many. Geoff asked for 200. */
export const CROWD_SIZE = 200;
/**
 * How far from the Kaiju they spread, in metres.
 *
 * 350, not 900. At 900 m the 200 of them work out to about 79 people per square kilometre — a
 * quiet park, and individually invisible next to something 300 m tall. The point of the crowd is
 * to be a RULER held up against the Kaiju, so they need to be close enough to appear in the same
 * glance. At 350 m the density is roughly 520 per square kilometre and the nearest of them stand
 * about one Kaiju-height away, which is where the comparison actually lands.
 */
const SPREAD_M = 350;
/** Running speed, metres per second. A frightened human, not an athlete. */
const RUN_MS = 5.5;   // a running human, not an athlete

const MODEL_URL = '/siege/characters/player.glb';

interface Person {
  /** Unit direction from the planet centre. */
  dir: THREE.Vector3;
  /** Tangent heading. */
  fwd: THREE.Vector3;
  running: boolean;
  /** Seconds until the next stop/start decision. */
  timer: number;
  /** Phase offset so the crowd does not bob in unison, which reads as machinery. */
  phase: number;
  speed: number;
}

let crowdOn = false;
/**
 * Bumped whenever the crowd should re-form somewhere new.
 *
 * Without this, `setCrowd(true)` on an already-visible crowd did nothing, so jumping from Everest
 * to the Grand Canyon left 200 people standing on the wrong mountain — they spawn around the Kaiju
 * ONCE, when the component mounts. The epoch is a React key, so a new site rebuilds them.
 */
let crowdEpoch = 0;

/**
 * Where to put the crowd. Null = a ring around the Kaiju, the default.
 *
 * The scale view needs them strung out in the CORRIDOR between the viewer and the Kaiju instead,
 * because that is what makes the comparison work: people at your feet, people in the middle
 * distance, and the creature beyond them all — three reference points in one line of sight, which
 * is far more legible than a ring you are standing outside of.
 */
let spawnHint: { from: THREE.Vector3; to: THREE.Vector3 } | null = null;
export function setCrowdCorridor(from: THREE.Vector3 | null, to?: THREE.Vector3): void {
  spawnHint = from && to ? { from: from.clone().normalize(), to: to.clone().normalize() } : null;
}
const listeners = new Set<() => void>();
export function isCrowdOn(): boolean { return crowdOn; }

/** Live state, so 'I don't see the humans' can be answered by looking rather than guessing. */
export const crowdDiag = { on: false, spawned: 0, layout: 'none' as 'none' | 'ring' | 'corridor', modelOk: false };
export function subscribeCrowd(fn: () => void): () => void {
  listeners.add(fn); return () => { listeners.delete(fn); };
}
/** Turn the crowd on explicitly — used when a battle starts, so they are simply there. */
export function setCrowd(on: boolean): void {
  // Always re-form on a fresh request, even if already visible — that is the point.
  if (on) crowdEpoch++;
  if (crowdOn === on) { for (const l of listeners) l(); return; }
  crowdOn = on;
  for (const l of listeners) l();
}

export function toggleCrowd(): void {
  crowdOn = !crowdOn;
  if (crowdOn) crowdEpoch++;
  for (const l of listeners) l();
  console.log(`[kaiju] crowd ${crowdOn ? 'ON' : 'OFF'} — ${CROWD_SIZE} people at 1.8 m`);
}

export function KaijuCrowd() {
  const [, force] = useState(0);
  useEffect(() => subscribeCrowd(() => force((n) => n + 1)), []);
  if (!crowdOn) return null;
  // Keyed by epoch: a new battle site rebuilds the crowd around the Kaiju's new position.
  return <Crowd key={crowdEpoch} />;
}

/**
 * Where everyone starts.
 *
 * CORRIDOR (the scale view): strung along the line from the viewer to the Kaiju, so there are
 * figures near, in the middle distance, and far — three legible reference depths in one line of
 * sight, which is what makes the size comparison work.
 *
 * RING (everywhere else): scattered around the Kaiju itself.
 */
function makePeople(): Person[] {
  const out: Person[] = [];

  if (spawnHint) {
    const { from, to } = spawnHint;
    const side = new THREE.Vector3().crossVectors(from, to).normalize();
    for (let i = 0; i < CROWD_SIZE; i++) {
      // Biased toward the near end, so the closest figures — the readable ones — are the many.
      const t = 0.06 + Math.pow(rand(), 1.5) * 0.82;
      const dir = from.clone().lerp(to, t).normalize();
      // Lateral scatter widens down the corridor, which reads as depth rather than as a queue.
      const spread = (60 + t * 420) / METRES_PER_UNIT;
      dir.addScaledVector(side, ((rand() * 2 - 1) * spread) / PLANET_RADIUS).normalize();
      const fwd = new THREE.Vector3().crossVectors(dir, side).normalize();
      out.push({
        dir, fwd, running: rand() < 0.65, timer: rand() * 3, phase: rand() * Math.PI * 2,
        speed: (RUN_MS * (0.75 + rand() * 0.5)) / METRES_PER_UNIT,
      });
    }
    return out;
  }

  const centre = playerBody.dir.clone().normalize();
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), centre).normalize();
  const north = new THREE.Vector3().crossVectors(centre, east).normalize();
  for (let i = 0; i < CROWD_SIZE; i++) {
    // sqrt on the radius gives even area density instead of everyone bunched in the middle.
    const r = Math.sqrt(rand()) * (SPREAD_M / METRES_PER_UNIT);
    const ang = rand() * Math.PI * 2;
    const dir = centre.clone()
      .addScaledVector(east, (Math.cos(ang) * r) / PLANET_RADIUS)
      .addScaledVector(north, (Math.sin(ang) * r) / PLANET_RADIUS)
      .normalize();
    out.push({
      dir,
      fwd: new THREE.Vector3().crossVectors(dir, east).normalize(),
      running: rand() < 0.7,
      timer: rand() * 3,
      phase: rand() * Math.PI * 2,
      speed: (RUN_MS * (0.75 + rand() * 0.5)) / METRES_PER_UNIT,
    });
  }
  return out;
}

function Crowd() {
  // USE THE NPC THE GAME ALREADY ANIMATES.
  //
  // I had been pulling a mesh out of a character file and driving it procedurally, which meant
  // guessing which mesh was the body and hand-rolling a run cycle — and produced the "sparkles".
  // Type 1 in the monster catalog is 1.8 m, human-scaled, already rigged, already has clips, and
  // is already cloned correctly elsewhere in this codebase. Reusing it removes every guess.
  //
  // THE COST, stated plainly: 200 skinned clones is 200 draw calls and 200 skeleton updates a
  // frame, against one draw call for the instanced version. That is a real price, worth paying
  // here because in the scale view the nearest figures are ~50 px tall, where a frozen pose is
  // obvious and a walk cycle is the whole point. If it costs too much the lever is the head
  // count, not the technique.
  const cfg = CFG[1 as keyof typeof CFG];
  const { scene, animations } = useGLTF(`${cfg?.url ?? MODEL_URL}?v=${APP_VERSION}`);
  const group = useRef<THREE.Group>(null);

  const people = useMemo<Person[]>(() => makePeople(), []);

  /** One clone and one mixer each, so everybody is at a different point in their stride. */
  const rigs = useMemo(() => {
    const names = animations.map((a) => a.name.toLowerCase());
    const pick = ['walk', 'walking', 'run', 'idle'].find((n) => names.includes(n));
    const clip = pick ? animations[names.indexOf(pick)] : animations[0];
    const scale = PERSON_UNITS / Math.max(0.01, cfg?.modelHeight ?? 1.886);

    return people.map(() => {
      const obj = SkeletonUtils.clone(scene) as THREE.Group;
      obj.scale.setScalar(scale);
      obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      const mixer = new THREE.AnimationMixer(obj);
      if (clip) {
        const act = mixer.clipAction(clip);
        act.play();
        // Random start and a little rate spread, or 200 figures move as one rigid block.
        act.time = rand() * clip.duration;
        act.timeScale = 0.85 + rand() * 0.3;
      }
      return { obj, mixer };
    });
  }, [scene, animations, people, cfg]);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    for (const r of rigs) g.add(r.obj);
    crowdDiag.on = true;
    crowdDiag.spawned = rigs.length;
    crowdDiag.layout = spawnHint ? 'corridor' : 'ring';
    crowdDiag.modelOk = animations.length > 0;
    console.log(`[crowd] ${rigs.length} animated NPCs, ${crowdDiag.layout} layout, `
      + `${animations.length} clips`);
    return () => {
      for (const r of rigs) { r.mixer.stopAllAction(); g.remove(r.obj); }
      crowdDiag.on = false; crowdDiag.spawned = 0;
    };
  }, [rigs, animations]);

  const _up = useMemo(() => new THREE.Vector3(), []);
  const _side = useMemo(() => new THREE.Vector3(), []);
  const _axis = useMemo(() => new THREE.Vector3(), []);
  const _toKaiju = useMemo(() => new THREE.Vector3(), []);
  const _basis = useMemo(() => new THREE.Matrix4(), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const kaiju = playerBody.dir;

    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const rig = rigs[i];
      if (!rig) continue;

      p.timer -= dt;
      if (p.timer <= 0) {
        p.running = !p.running;
        p.timer = p.running ? 2.5 + rand() * 5 : 0.4 + rand() * 1.4;
        if (p.running) {
          _toKaiju.copy(kaiju).sub(p.dir);
          _toKaiju.addScaledVector(p.dir, -_toKaiju.dot(p.dir));
          if (_toKaiju.lengthSq() < 1e-12) _toKaiju.copy(p.fwd);
          _toKaiju.normalize();
          _axis.copy(p.dir);
          p.fwd.copy(_toKaiju).applyAxisAngle(_axis, (rand() - 0.5) * 1.5).normalize();
        }
      }

      if (p.running) {
        const dist = p.speed * dt;
        _axis.crossVectors(p.dir, p.fwd).normalize();
        const ang = dist / PLANET_RADIUS;
        p.dir.applyAxisAngle(_axis, ang).normalize();
        p.fwd.applyAxisAngle(_axis, ang);
        p.fwd.addScaledVector(p.dir, -p.fwd.dot(p.dir)).normalize();
      }

      // The clip only advances while they are moving, so a stopped figure stands rather than
      // running on the spot.
      rig.mixer.update(p.running ? dt : dt * 0.12);

      const metres = sampleGlobeSurface(p.dir.x, p.dir.y, p.dir.z);
      rig.obj.position.copy(p.dir)
        .multiplyScalar(PLANET_RADIUS + (metres ?? 0) / METRES_PER_UNIT);

      // Upright on the sphere, facing the way they are heading. Model front is local +Z, matching
      // the convention MonsterEnemy already relies on.
      _up.copy(p.dir);
      _side.crossVectors(_up, p.fwd).normalize();
      _basis.makeBasis(_side, _up, p.fwd);
      rig.obj.quaternion.setFromRotationMatrix(_basis);
    }
  });

  return <group ref={group} />;
}
