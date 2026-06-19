// GhostExplosion — the Ghost's death blast: a near-invisible BLACK explosion with a heat-haze
// distortion. Two parts per blast: (1) a dark, ~90%-transparent smoke puff so you can tell an
// explosion happened, and (2) an expanding transmission (refraction) sphere that bends what's
// behind it like rising heat. Self-contained: a persistent <GhostExplosions/> manager (mounted in
// SiegeWorldLayers) renders short-lived blasts; the Ghost calls fireGhostExplosion() on impact.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface Blast { id: number; x: number; y: number; z: number; scale: number }
let _id = 0;
const subs = new Set<(b: Blast) => void>();
/** Fire one ghost explosion at a world point. */
export function fireGhostExplosion(x: number, y: number, z: number, scale = 1) {
  const b: Blast = { id: _id++, x, y, z, scale };
  subs.forEach((f) => f(b));
}

const PARTICLES = 30;
const LIFE = 1.1;   // seconds

const smokeTex = (() => {
  const t = new THREE.TextureLoader().load('/siege/vfx/PolygonParticles_Smoke_01.png');
  t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
})();

function GhostBlast({ b, onDone }: { b: Blast; onDone: (id: number) => void }) {
  const haze = useRef<THREE.Mesh>(null);
  const t0 = useRef(performance.now());

  // One dark smoke puff: positions start at the centre, velocities burst out + up.
  const P = useMemo(() => {
    const pos = new Float32Array(PARTICLES * 3), vel = new Float32Array(PARTICLES * 3);
    for (let i = 0; i < PARTICLES; i++) {
      const az = Math.random() * Math.PI * 2, pol = Math.random() * Math.PI * 0.55;
      const sp = (2 + Math.random() * 5) * b.scale;
      vel[i * 3] = Math.cos(az) * Math.sin(pol) * sp;
      vel[i * 3 + 1] = Math.cos(pol) * sp + 2;
      vel[i * 3 + 2] = Math.sin(az) * Math.sin(pol) * sp;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { pos, vel, geo };
  }, [b]);

  // Heat-haze: a transmissive (refracting) sphere, tinted black, very transparent.
  const hazeMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    transmission: 1, roughness: 0.18, thickness: 2.0, ior: 1.18, metalness: 0,
    color: new THREE.Color(0x000000), transparent: true, opacity: 0.14, depthWrite: false,
  }), []);
  const ptMat = useMemo(() => new THREE.PointsMaterial({
    map: smokeTex, size: 1.7 * b.scale, transparent: true, opacity: 0.12, color: 0x000000,
    depthWrite: false, sizeAttenuation: true, blending: THREE.NormalBlending,
  }), [b]);

  useEffect(() => () => { P.geo.dispose(); hazeMat.dispose(); ptMat.dispose(); }, [P, hazeMat, ptMat]);

  useFrame((_s, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const f = (performance.now() - t0.current) / 1000 / LIFE;
    if (f >= 1) { onDone(b.id); return; }
    if (haze.current) { haze.current.scale.setScalar((0.3 + f * 2.4) * b.scale); hazeMat.opacity = 0.18 * (1 - f); }
    for (let i = 0; i < PARTICLES; i++) {
      P.vel[i * 3 + 1] -= 6 * dt;
      P.vel[i * 3] *= 1 - 1.2 * dt; P.vel[i * 3 + 1] *= 1 - 0.6 * dt; P.vel[i * 3 + 2] *= 1 - 1.2 * dt;
      P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
    }
    (P.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    ptMat.opacity = 0.14 * (1 - f);
  });

  return (
    <group position={[b.x, b.y, b.z]}>
      <mesh ref={haze} material={hazeMat}><sphereGeometry args={[1, 24, 16]} /></mesh>
      <points geometry={P.geo} material={ptMat} />
    </group>
  );
}

export function GhostExplosions() {
  const [blasts, setBlasts] = useState<Blast[]>([]);
  useEffect(() => {
    const CAP = 5;   // cap concurrent blasts (each transmission sphere re-renders the scene)
    const on = (b: Blast) => setBlasts((l) => (l.length >= CAP ? [...l.slice(1), b] : [...l, b]));
    subs.add(on); return () => { subs.delete(on); };
  }, []);
  const done = (id: number) => setBlasts((l) => l.filter((x) => x.id !== id));
  return <>{blasts.map((b) => <GhostBlast key={b.id} b={b} onDone={done} />)}</>;
}
