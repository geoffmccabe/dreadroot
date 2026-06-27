// EnchantedFireflies — the Synty Enchanted Forest demo's floating glow motes, recreated as a
// single additive-blended THREE.Points cloud that drifts slowly. Emissive/additive so the global
// Bloom (FortressPostFX) makes them glow. Cheap: one draw call, no per-point objects, ref-driven.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const COUNT = 80;   // 25% of the original 320 (Geoff: far too many)
const AREA = 130;   // spread (m) across the forest, centred on origin
const Y_MIN = 0.5, Y_MAX = 22;

export function EnchantedFireflies() {
  const ref = useRef<THREE.Points>(null);
  // Deterministic start positions + per-mote drift phase/speed (no Math.random in render).
  const { geometry, base, phase } = useMemo(() => {
    const pos = new Float32Array(COUNT * 3);
    const base = new Float32Array(COUNT * 3);
    const phase = new Float32Array(COUNT * 2);
    let s = 1337;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < COUNT; i++) {
      const x = (rnd() - 0.5) * AREA, y = Y_MIN + rnd() * (Y_MAX - Y_MIN), z = (rnd() - 0.5) * AREA;
      base[i * 3] = x; base[i * 3 + 1] = y; base[i * 3 + 2] = z;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      phase[i * 2] = rnd() * Math.PI * 2; phase[i * 2 + 1] = 0.3 + rnd() * 0.7;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { geometry: g, base, phase };
  }, []);

  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(220,200,255,1)');
    grad.addColorStop(0.3, 'rgba(150,130,255,0.7)');
    grad.addColorStop(1, 'rgba(120,90,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const arr = (ref.current!.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      const ph = phase[i * 2], sp = phase[i * 2 + 1];
      arr[i * 3] = base[i * 3] + Math.sin(t * sp + ph) * 1.4;
      arr[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * sp * 0.6 + ph) * 0.9;
      arr[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * sp * 0.8 + ph) * 1.4;
    }
    ref.current!.geometry.getAttribute('position').needsUpdate = true;
  });

  return (
    <points ref={ref} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        map={tex}
        size={1.1}
        sizeAttenuation
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        color={'#b9a3ff'}
      />
    </points>
  );
}
