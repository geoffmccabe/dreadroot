// KaijuCrowd — 200 human beings, 1.8 m tall, milling around a 300 m monster.
//
// Geoff: "It would be good to get a sense of the 300m scale of the Kaiju." That is exactly what
// this is for, and it is the cheapest way to make the size READ. A number in a HUD does not do it;
// a creature whose foot is longer than the crowd running away from it does.
//
// HOW IT IS LIGHT, since that was the requirement.
//
// They are REAL animated characters — the game's own 1.8 m NPC, with its own walk clip — but they
// cost one draw call between them and no per-frame skinning at all.
//
// The trick is in crowdBake.ts: the walk cycle is evaluated ONCE at load and written into a
// texture, so the vertex shader can look up where any vertex is at any point in the cycle. Every
// figure is then just an instance with its own position and its own place in that cycle.
//
//   200 skinned clones : 200 draw calls, 200 skeleton updates every frame
//   this               : 1 draw call, 0 skeleton updates, a few MB of texture
//
// It also scales: a thousand of them would cost the same draw call and the same texture.
//
// Their behaviour is deliberately simple and deliberately human: run for a while, stop and look,
// run again, and generally stay near the monster the way crowds actually do — which is to say some
// flee and some absolutely do not.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { APP_VERSION } from '@/version';
import { CFG } from '../siegeMonsterCatalog';
import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';
import { body as playerBody } from './kaijuBody';
import { rand } from './kaijuRandom';
import { bakeCrowd, makeCrowdMaterial } from './crowdBake';

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
/** Stride length as a fraction of height — one full cycle covers this much ground. */
const STRIDE_FRAC = 0.8;

const MODEL_URL = '/siege/characters/player.glb';

interface Person {
  /** Unit direction from the planet centre. */
  dir: THREE.Vector3;
  /** Tangent heading. */
  fwd: THREE.Vector3;
  running: boolean;
  /** Seconds until the next stop/start decision. */
  timer: number;
  /** Where this person is in the walk cycle, 0..1. Advanced by distance covered, not by time. */
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
        dir, fwd, running: rand() < 0.65, timer: rand() * 3, phase: rand(),
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
      phase: rand(),
      speed: (RUN_MS * (0.75 + rand() * 0.5)) / METRES_PER_UNIT,
    });
  }
  return out;
}

function Crowd() {
  // ONE DRAW CALL for the whole crowd.
  //
  // The animation is baked into a texture once at load (see crowdBake.ts), so every figure is a
  // single instance whose vertex shader looks up where it should be at its own point in the walk
  // cycle. No per-person skeleton, no per-person draw call, and the CPU does nothing each frame
  // but move two hundred matrices.
  const cfg = CFG[1 as keyof typeof CFG];
  const { scene, animations } = useGLTF(`${cfg?.url ?? MODEL_URL}?v=${APP_VERSION}`);
  const mesh = useRef<THREE.InstancedMesh>(null);

  const people = useMemo<Person[]>(() => makePeople(), []);

  const baked = useMemo(() => {
    const names = animations.map((a) => a.name.toLowerCase());
    const pick = ['walk', 'walking', 'run', 'idle'].find((n) => names.includes(n));
    const clip = pick ? animations[names.indexOf(pick)] : animations[0] ?? null;
    const b = bakeCrowd(scene, clip);
    if (b) {
      console.log(`[crowd] baked ${b.frames} frames x ${b.vertexCount} verts `
        + `(${((b.vertexCount * b.frames * 3 * 4) / 1048576).toFixed(1)} MB) from "${clip?.name}"`);
    } else {
      console.warn('[crowd] could not bake — no skinned mesh or no clip; crowd will not render');
    }
    return b;
  }, [scene, animations]);

  /** Reuse the source model's texture so the figures keep their own colours. */
  const material = useMemo(() => {
    if (!baked) return null;
    let map: THREE.Texture | null = null;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (map || !m.isMesh) return;
      const mm = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      if (mm?.map) map = mm.map;
    });
    return makeCrowdMaterial(baked, map);
  }, [baked, scene]);

  // Per-instance animation state: where in the cycle, and whether moving at all.
  const phase = useMemo(() => new Float32Array(CROWD_SIZE), []);
  const moving = useMemo(() => new Float32Array(CROWD_SIZE), []);

  useEffect(() => {
    if (!baked || !mesh.current) return;
    const g = mesh.current.geometry;
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    g.setAttribute('aMoving', new THREE.InstancedBufferAttribute(moving, 1));
    crowdDiag.on = true;
    crowdDiag.spawned = people.length;
    crowdDiag.layout = spawnHint ? 'corridor' : 'ring';
    crowdDiag.modelOk = true;
    return () => {
      crowdDiag.on = false;
      crowdDiag.spawned = 0;
      baked.texture.dispose();
      baked.geometry.dispose();
    };
  }, [baked, people, phase, moving]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const _up = useMemo(() => new THREE.Vector3(), []);
  const _side = useMemo(() => new THREE.Vector3(), []);
  const _axis = useMemo(() => new THREE.Vector3(), []);
  const _toKaiju = useMemo(() => new THREE.Vector3(), []);
  const _basis = useMemo(() => new THREE.Matrix4(), []);

  useFrame((_, rawDt) => {
    const m = mesh.current;
    if (!m || !baked) return;
    const dt = Math.min(rawDt, 0.05);
    const kaiju = playerBody.dir;
    // Scale the source model to a real 1.8 m person, whatever units it was made in.
    const scale = PERSON_UNITS / baked.modelHeight;

    for (let i = 0; i < people.length; i++) {
      const p = people[i];

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
        // Advance the cycle in step with the DISTANCE covered, so the feet match the ground
        // instead of sliding — the same rule the Kaiju's own gait follows.
        p.phase = (p.phase + (dist / (PERSON_UNITS * STRIDE_FRAC))) % 1;
      }
      phase[i] = p.phase;
      moving[i] = p.running ? 1 : 0;

      const metres = sampleGlobeSurface(p.dir.x, p.dir.y, p.dir.z);
      dummy.position.copy(p.dir).multiplyScalar(PLANET_RADIUS + (metres ?? 0) / METRES_PER_UNIT);
      _up.copy(p.dir);
      _side.crossVectors(_up, p.fwd).normalize();
      _basis.makeBasis(_side, _up, p.fwd);
      dummy.quaternion.setFromRotationMatrix(_basis);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }

    m.instanceMatrix.needsUpdate = true;
    const ph = m.geometry.getAttribute('aPhase');
    const mv = m.geometry.getAttribute('aMoving');
    if (ph) ph.needsUpdate = true;
    if (mv) mv.needsUpdate = true;
  });

  if (!baked || !material) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[baked.geometry, material, CROWD_SIZE]}
      frustumCulled={false}
    />
  );
}
