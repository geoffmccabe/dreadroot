// Renders the Dark Lord's lightning (three.js LightningStrike — the open-source effect Geoff
// picked). Per hand: a wide dim PURPLE glow bolt (halo, matches his purple fire) + three THIN
// white-lavender arcs that jitter independently for variety; additive so they read as a white-hot
// core in a purple glow. One pool; each active caster (from darkLordLightning's store) drives two
// hands → the LOS-clipped beam end. Mounted once in the siege scene.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LightningStrike } from 'three-stdlib';
import { getLightningCasters } from './darkLordLightning';

const BEAMS = 6;     // 3 Dark Lords × 2 hands
const THIN = 3;      // thin arcs per hand

const ray = (r0: number, r1: number) => ({
  sourceOffset: new THREE.Vector3(), destOffset: new THREE.Vector3(),
  radius0: r0, radius1: r1, minRadius: 0.02, maxIterations: 7,
  isEternal: true, timeScale: 0.8,
  propagationTimeFactor: 0.05, vanishingTimeFactor: 0.95,
  subrayPeriod: 2.5, subrayDutyCycle: 0.4, maxSubrayRecursion: 3,
  ramification: 7, recursionProbability: 0.6, roughness: 0.9, straightness: 0.62,
});
type Bolt = { ls: { rayParameters: { sourceOffset: THREE.Vector3; destOffset: THREE.Vector3 }; update: (t: number) => void }; mesh: THREE.Mesh };
const mkBolt = (r0: number, r1: number, color: number, opacity: number): Bolt => {
  const ls = new LightningStrike(ray(r0, r1) as unknown as ConstructorParameters<typeof LightningStrike>[0]);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(ls as unknown as THREE.BufferGeometry, mat);
  mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 999;
  return { ls: ls as unknown as Bolt['ls'], mesh };
};

export function DarkLordLightning() {
  // Each beam = 1 wide purple glow + 3 thin white-lavender arcs.
  const beams = useMemo(() => Array.from({ length: BEAMS }, () => ({
    glow: mkBolt(0.16, 0.06, 0x7a3cff, 0.45),                                  // purple halo
    arcs: Array.from({ length: THIN }, () => mkBolt(0.03, 0.018, 0xe6ddff, 0.95)),  // white-lavender cores
  })), []);
  const all = useMemo(() => beams.flatMap((b) => [b.glow.mesh, ...b.arcs.map((a) => a.mesh)]), [beams]);
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += dt;
    let bi = 0;
    getLightningCasters().forEach((c) => {
      const hands: [number, number, number][] = [[c.ax, c.ay, c.az], [c.bx, c.by, c.bz]];
      for (const [sx, sy, sz] of hands) {
        if (bi >= BEAMS) return;
        const beam = beams[bi++];
        const drive = (b: Bolt, off: number) => {
          b.ls.rayParameters.sourceOffset.set(sx, sy, sz);
          b.ls.rayParameters.destOffset.set(c.ex, c.ey, c.ez);
          b.ls.update(t.current + off);
          b.mesh.visible = true;
        };
        drive(beam.glow, 0);
        beam.arcs.forEach((a, i) => drive(a, 1.7 + i * 2.3));                  // offset time → each arc differs
      }
    });
    for (; bi < BEAMS; bi++) { const b = beams[bi]; b.glow.mesh.visible = false; b.arcs.forEach((a) => (a.mesh.visible = false)); }
  });
  return <group>{all.map((m, i) => <primitive key={i} object={m} />)}</group>;
}
