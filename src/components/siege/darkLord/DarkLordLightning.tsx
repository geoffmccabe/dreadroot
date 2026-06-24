// Renders the Dark Lord's lightning bolts (three.js LightningStrike, the open-source effect Geoff
// picked). One pool of bolts; each active caster (from darkLordLightning's store) drives two — one
// per hand → the LOS-clipped beam end. Mounted once in the siege scene.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LightningStrike } from 'three-stdlib';
import { getLightningCasters } from './darkLordLightning';

const POOL = 8;   // up to 4 Dark Lords casting at once (2 bolts each)

// Ray params lifted from the reference demo, widened for a hand→player beam.
const newRay = () => ({
  sourceOffset: new THREE.Vector3(), destOffset: new THREE.Vector3(),
  radius0: 0.14, radius1: 0.05, minRadius: 0.04, maxIterations: 7,
  isEternal: true, timeScale: 0.7,
  propagationTimeFactor: 0.05, vanishingTimeFactor: 0.95,
  subrayPeriod: 2.5, subrayDutyCycle: 0.3, maxSubrayRecursion: 3,
  ramification: 7, recursionProbability: 0.6, roughness: 0.85, straightness: 0.68,
});

export function DarkLordLightning() {
  const bolts = useMemo(() => Array.from({ length: POOL }, () => {
    const ls = new LightningStrike(newRay() as unknown as ConstructorParameters<typeof LightningStrike>[0]);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9be8ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(ls as unknown as THREE.BufferGeometry, mat);
    mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 999;
    return { ls, mesh };
  }), []);
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += dt;
    let i = 0;
    getLightningCasters().forEach((b) => {
      const hands: [number, number, number][] = [[b.ax, b.ay, b.az], [b.bx, b.by, b.bz]];
      for (const [sx, sy, sz] of hands) {
        if (i >= POOL) return;
        const { ls, mesh } = bolts[i++];
        const rp = (ls as unknown as { rayParameters: { sourceOffset: THREE.Vector3; destOffset: THREE.Vector3 } }).rayParameters;
        rp.sourceOffset.set(sx, sy, sz);
        rp.destOffset.set(b.ex, b.ey, b.ez);
        (ls as unknown as { update: (time: number) => void }).update(t.current);
        mesh.visible = true;
      }
    });
    for (; i < POOL; i++) bolts[i].mesh.visible = false;
  });
  return <group>{bolts.map((b, idx) => <primitive key={idx} object={b.mesh} />)}</group>;
}
