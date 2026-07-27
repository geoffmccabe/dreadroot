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
const RUN_MS = 5.5;

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
const listeners = new Set<() => void>();
export function isCrowdOn(): boolean { return crowdOn; }
export function subscribeCrowd(fn: () => void): () => void {
  listeners.add(fn); return () => { listeners.delete(fn); };
}
export function toggleCrowd(): void {
  crowdOn = !crowdOn;
  for (const l of listeners) l();
  console.log(`[kaiju] crowd ${crowdOn ? 'ON' : 'OFF'} — ${CROWD_SIZE} people at 1.8 m`);
}

export function KaijuCrowd() {
  const [, force] = useState(0);
  useEffect(() => subscribeCrowd(() => force((n) => n + 1)), []);
  if (!crowdOn) return null;
  return <Crowd />;
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
    let found: THREE.BufferGeometry | null = null;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!found && m.isMesh && m.geometry) found = m.geometry.clone() as THREE.BufferGeometry;
    });
    const geo = found ?? new THREE.CapsuleGeometry(0.25, 1.2, 4, 8);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const h = Math.max(1e-4, bb.max.y - bb.min.y);
    geo.translate(0, -bb.min.y, 0);      // feet to the origin
    geo.scale(1 / h, 1 / h, 1 / h);      // unit height
    return geo;
  }, [scene]);

  const material = useMemo(() => new THREE.MeshLambertMaterial({ color: '#c8b49a' }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  /** Spawn everyone in a ring around wherever the Kaiju is standing right now. */
  const people = useMemo<Person[]>(() => {
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
        p.timer = p.running ? 1.5 + rand() * 4 : 0.6 + rand() * 2.5;
        if (p.running) {
          // Mostly drift toward the monster — people gather to look at the impossible thing — with
          // a wide random spread so it never becomes a tidy convergence.
          _toKaiju.copy(kaiju).sub(p.dir);
          _toKaiju.addScaledVector(p.dir, -_toKaiju.dot(p.dir));
          if (_toKaiju.lengthSq() < 1e-12) _toKaiju.copy(p.fwd);
          _toKaiju.normalize();
          _axis.copy(p.dir);
          p.fwd.copy(_toKaiju).applyAxisAngle(_axis, (rand() - 0.5) * 2.6).normalize();
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
      const bob = p.running ? Math.abs(Math.sin(clock.current * 9 + p.phase)) * PERSON_UNITS * 0.10 : 0;
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
