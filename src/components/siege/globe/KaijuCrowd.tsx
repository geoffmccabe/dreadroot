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
import * as THREE from 'three';
import { APP_VERSION } from '@/version';
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

function Crowd() {
  const { scene } = useGLTF(`${MODEL_URL}?v=${APP_VERSION}`);
  const mesh = useRef<THREE.InstancedMesh>(null);

  /**
   * One geometry, merged from the model in its bind pose and normalised so the feet sit at y=0 and
   * the head at y=1. Normalising here means the instance scale is simply the person's height, and
   * swapping the model later cannot silently change how tall everyone is.
   */
  const geometry = useMemo(() => {
    // TAKE THE BIGGEST MESH, not the first one.
    //
    // A character model contains several meshes — body, hair, eyes, kit — and traverse order is
    // whatever the exporter wrote. Grabbing the first one and stretching it to a person's height
    // could produce 200 copies of somebody's eyelashes, which at this size reads as unexplained
    // specks rather than as people. That is almost certainly Geoff's "sparkles". The body is
    // reliably the mesh with the most vertices.
    let found: THREE.BufferGeometry | null = null;
    let bestVerts = 0;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const n = m.geometry.attributes.position?.count ?? 0;
      if (n > bestVerts) { bestVerts = n; found = m.geometry.clone() as THREE.BufferGeometry; }
    });
    const geo = found ?? new THREE.CapsuleGeometry(0.25, 1.2, 4, 8);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const h = Math.max(1e-4, bb.max.y - bb.min.y);
    geo.translate(0, -bb.min.y, 0);      // feet to the origin
    geo.scale(1 / h, 1 / h, 1 / h);      // unit height
    return geo;
  }, [scene]);

  // Unlit, not Lambert. These are three pixels tall against snow and sky; a lit material makes
  // them read as dark specks or vanish entirely depending on where the sun is, which is a poor
  // trade for shading nobody can resolve at this size.
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#e8dcc8' }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  /** Spawn everyone in a ring around wherever the Kaiju is standing right now. */
  const people = useMemo<Person[]>(() => {
    // CORRIDOR LAYOUT: scattered along the line from the viewer to the Kaiju.
    if (spawnHint) {
      const { from, to } = spawnHint;
      const side = new THREE.Vector3().crossVectors(from, to).normalize();
      const out: Person[] = [];
      for (let i = 0; i < CROWD_SIZE; i++) {
        // Biased toward the near end, so the closest figures are the ones you can actually read.
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
    const out: Person[] = [];
    for (let i = 0; i < CROWD_SIZE; i++) {
      // sqrt on the radius gives an even area density instead of everyone bunched at the middle.
      const r = Math.sqrt(rand()) * (SPREAD_M / METRES_PER_UNIT);
      const ang = rand() * Math.PI * 2;
      const dir = centre.clone()
        .addScaledVector(east, (Math.cos(ang) * r) / PLANET_RADIUS)
        .addScaledVector(north, (Math.sin(ang) * r) / PLANET_RADIUS)
        .normalize();
      const fwd = new THREE.Vector3().crossVectors(dir, east).normalize();
      out.push({
        dir, fwd,
        running: rand() < 0.7,
        timer: rand() * 3,
        phase: rand() * Math.PI * 2,
        // A little spread in speed, or 200 identical dots move like a single sheet.
        speed: (RUN_MS * (0.75 + rand() * 0.5)) / METRES_PER_UNIT,
      });
    }
    return out;
  }, []);

  useEffect(() => {
    crowdDiag.on = true;
    crowdDiag.spawned = people.length;
    crowdDiag.layout = spawnHint ? 'corridor' : 'ring';
    const verts = geometry.attributes.position?.count ?? 0;
    crowdDiag.modelOk = verts > 200;   // a body, not an eyelash
    console.log(`[crowd] ${people.length} people, ${crowdDiag.layout} layout, ${verts} verts each`
      + `${verts <= 200 ? '  <-- SUSPICIOUSLY FEW: probably not the body mesh' : ''}`);
    return () => { crowdDiag.on = false; crowdDiag.spawned = 0; };
  }, [people, geometry]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const _up = useMemo(() => new THREE.Vector3(), []);
  const _side = useMemo(() => new THREE.Vector3(), []);
  const _axis = useMemo(() => new THREE.Vector3(), []);
  const _toKaiju = useMemo(() => new THREE.Vector3(), []);
  const _basis = useMemo(() => new THREE.Matrix4(), []);
  const clock = useRef(0);

  useFrame((_, rawDt) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(rawDt, 0.05);
    clock.current += dt;

    const kaiju = playerBody.dir;

    for (let i = 0; i < people.length; i++) {
      const p = people[i];

      // Run, stop, look around, run again. The timer is what makes a crowd read as people rather
      // than as particles: constant motion looks like a screensaver.
      p.timer -= dt;
      if (p.timer <= 0) {
        p.running = !p.running;
        // Running more than standing: Geoff wants them following him around, so the stops are
        // brief glances rather than long pauses.
        p.timer = p.running ? 2.5 + rand() * 5 : 0.4 + rand() * 1.4;
        if (p.running) {
          // Mostly drift toward the monster — people gather to look at the impossible thing — with
          // a wide random spread so it never becomes a tidy convergence.
          _toKaiju.copy(kaiju).sub(p.dir);
          _toKaiju.addScaledVector(p.dir, -_toKaiju.dot(p.dir));
          if (_toKaiju.lengthSq() < 1e-12) _toKaiju.copy(p.fwd);
          _toKaiju.normalize();
          _axis.copy(p.dir);
          // Narrower scatter than before, so the crowd genuinely FOLLOWS rather than dispersing.
          p.fwd.copy(_toKaiju).applyAxisAngle(_axis, (rand() - 0.5) * 1.5).normalize();
        }
      }

      if (p.running) {
        const dist = p.speed * dt;
        _axis.crossVectors(p.dir, p.fwd).normalize();
        const ang = dist / PLANET_RADIUS;
        p.dir.applyAxisAngle(_axis, ang).normalize();
        p.fwd.applyAxisAngle(_axis, ang);
        // Keep the heading tangent; floating point walks it off the sphere otherwise.
        p.fwd.addScaledVector(p.dir, -p.fwd.dot(p.dir)).normalize();
      }

      // Stand on the ground. Falls back to sea level while tiles stream, which for a crowd is
      // invisible — they are three pixels tall and briefly at the wrong height.
      const metres = sampleGlobeSurface(p.dir.x, p.dir.y, p.dir.z);
      const radius = PLANET_RADIUS + (metres ?? 0) / METRES_PER_UNIT;

      // Procedural motion, which at this apparent size IS the animation: a running bob and a
      // forward lean, still and upright when stopped.
      // 2.4 rad/s, not 9. A running human's stride is about two steps a second; 9 rad/s is nearly
      // three times that and at three pixels tall reads as a flicker rather than as running —
      // which is the other half of why they looked like sparkles.
      const bob = p.running ? Math.abs(Math.sin(clock.current * 2.4 + p.phase)) * PERSON_UNITS * 0.10 : 0;
      const lean = p.running ? 0.22 : 0;

      _up.copy(p.dir);
      _side.crossVectors(p.fwd, _up).normalize();
      _basis.makeBasis(_side, _up, p.fwd);
      dummy.quaternion.setFromRotationMatrix(_basis);
      if (lean) dummy.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean),
      );
      dummy.position.copy(p.dir).multiplyScalar(radius + bob);
      dummy.scale.setScalar(PERSON_UNITS);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, CROWD_SIZE]}
      frustumCulled={false}
    />
  );
}
