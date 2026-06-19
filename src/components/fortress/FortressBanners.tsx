// Four character banners hung on the FRONT of the fortress (DreadRoot only), two
// on each side of the gate. Each is a tall cloth plane fixed at the top that lightly
// flutters toward the bottom — a traveling sine wave displaces vertices out-of-plane
// (+ a slight sideways ripple), with amplitude growing from 0 at the top to full at
// the bottom, so it reads as fabric in a light wind while staying pinned up top.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { frameLoop } from '@/lib/frameLoop';

// Banners are 15m tall; width = 15 × (imgW/imgH). The 1-4 art is 577x2166 (~4m wide);
// banner_5 is 887x1774 (~7.5m wide) and sits in the centre over the gate.
const BANNER_H = 15;
const BANNER_Y = 10;     // centered on the 20m-tall front wall
const BANNER_Z = -6.90;  // 0.10m in front of the front face (front blocks end at z = -7)

// Five banners across the 40-wide front (x -20..20). The wide centre banner is at x=0;
// the other four are re-spaced symmetrically with even gaps and stay clear of the edges
// (outermost edge at 17.25, ~2.75m margin).
const BANNERS = [
  { url: '/fortress_banner_1.webp', x: -15.25, w: 4.0 },
  { url: '/fortress_banner_2.webp', x: -8.5, w: 4.0 },
  { url: '/fortress_banner_5.webp', x: 0, w: 7.5 },
  { url: '/fortress_banner_3.webp', x: 8.5, w: 4.0 },
  { url: '/fortress_banner_4.webp', x: 15.25, w: 4.0 },
];

function Banner({
  url,
  x,
  w,
  uTime,
}: {
  url: string;
  x: number;
  w: number;
  uTime: React.MutableRefObject<{ value: number }>;
}) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);

  // Per-banner randomization so the four don't flutter in lockstep: a phase offset
  // plus a speed multiplier within ±10%. Stable for the life of this banner.
  const { phase, speed } = useMemo(() => ({
    phase: Math.random() * Math.PI * 2,
    speed: 1 + (Math.random() * 0.2 - 0.1),
  }), []);

  useEffect(() => {
    let disposed = false;
    const loader = new THREE.TextureLoader();
    loader.load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      if (disposed) { t.dispose(); return; }
      setTex(t);
    });
    return () => { disposed = true; };
  }, [url]);

  const material = useMemo(() => {
    if (!tex) return null;
    const m = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.5,        // crisp cutout — banner shape only, no transparent-corner box
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0.0,
      // Keep banners legible at night without blowing out in daylight.
      emissiveMap: tex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.22,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime.current;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float bH = ${BANNER_H.toFixed(1)};
         float topY = bH * 0.5;
         // 0 at the top edge (pinned), 1 at the bottom. Squared so flutter grows toward the hem.
         float drape = clamp((topY - transformed.y) / bH, 0.0, 1.0);
         drape = drape * drape;
         // Per-banner phase + speed (baked) keep the four out of sync.
         float ph = uTime * ${speed.toFixed(3)} + ${phase.toFixed(3)};
         float w1 = sin(transformed.y * 1.1 + ph * 2.0 + transformed.x * 0.9);
         float w2 = sin(transformed.y * 0.55 - ph * 1.3 + transformed.x * 0.4);
         // OUTWARD-ONLY billow (0..amp, toward the player) so it never swings back
         // through the wall and vanishes.
         transformed.z += drape * 0.35 * (0.5 + 0.5 * w1);
         transformed.x += drape * 0.12 * w2;   // slight sideways ripple
      `);
    };
    return m;
  }, [tex, uTime, phase, speed]);

  useEffect(() => () => { material?.dispose(); }, [material]);
  useEffect(() => () => { tex?.dispose(); }, [tex]);

  if (!material) return null;
  return (
    <mesh position={[x, BANNER_Y, BANNER_Z]} material={material} castShadow={false} receiveShadow={false}>
      <planeGeometry args={[w, BANNER_H, 8, 28]} />
    </mesh>
  );
}

export function FortressBanners() {
  // One shared time uniform drives all four banners' flutter (single frame callback).
  const uTime = useRef({ value: 0 });
  useEffect(() => {
    const unreg = frameLoop.register('fortress-banners', (_delta, elapsed) => {
      uTime.current.value = elapsed;
    }, 65); // low-priority cosmetic
    return unreg;
  }, []);

  return (
    <group>
      {BANNERS.map((b) => (
        <Banner key={b.url} url={b.url} x={b.x} w={b.w} uTime={uTime} />
      ))}
    </group>
  );
}
