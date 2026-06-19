// Faint animated moiré overlay on the force-field walls (DreadRoot only). The
// animated WebP is decoded/animated by the browser in a tiny off-DOM-ish <img>
// (frames stay in native memory, not the JS heap), and each tick the current frame
// is copied to a canvas texture mapped onto planes coincident with the force-field.
// One tile spans the wall WIDTH and the texture repeats vertically up the 400m wall
// so it keeps going if the player flies up. Rendered at 5% opacity (95% transparent).
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { frameLoop } from '@/lib/frameLoop';
import { FSZ_MIN_X, FSZ_MAX_X, FSZ_MIN_Z, FSZ_MAX_Z } from '@/features/enemies/ai/fortressSafeZone';

const WALL_H = 400;
const HALF_H = WALL_H / 2;
const W_X = FSZ_MAX_X - FSZ_MIN_X;          // 64 (front/back width)
const W_Z = FSZ_MAX_Z - FSZ_MIN_Z;          // 96 (side width)
const CZ = (FSZ_MIN_Z + FSZ_MAX_Z) / 2;     // -16
const URL = '/moire_animation.webp';
const OPACITY = 0.05;                        // 5% (95% transparent)
const CAPTURE_DT = 0.06;                      // ~16fps capture is plenty for a faint overlay

export function ForceFieldMoire() {
  const [mats, setMats] = useState<{ fb: THREE.Material; lr: THREE.Material } | null>(null);
  const r = useRef<{
    img?: HTMLImageElement;
    canvas?: HTMLCanvasElement;
    ctx?: CanvasRenderingContext2D | null;
    texs: THREE.CanvasTexture[];
  }>({ texs: [] });

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';
    // On-screen but visually imperceptible (a 2px corner speck at 1% opacity) so the
    // browser keeps the animated WebP playing rather than throttling an off-screen img.
    img.style.cssText =
      'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
    img.onload = () => {
      if (cancelled) return;
      document.body.appendChild(img);

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 600;
      canvas.height = img.naturalHeight || 600;
      const ctx = canvas.getContext('2d');

      const mkTex = (repeatY: number) => {
        const t = new THREE.CanvasTexture(canvas);
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.RepeatWrapping;     // tile vertically up the wall
        t.repeat.set(1, repeatY);            // one tile across the width
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      // Square tiles (un-stretched) → vertical repeats = wall height / wall width.
      const texFB = mkTex(WALL_H / W_X);     // front/back walls (64 wide)
      const texLR = mkTex(WALL_H / W_Z);     // side walls (96 wide)
      r.current = { img, canvas, ctx, texs: [texFB, texLR] };

      const mk = (map: THREE.Texture) =>
        new THREE.MeshBasicMaterial({
          map,
          transparent: true,
          opacity: OPACITY,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
      setMats({ fb: mk(texFB), lr: mk(texLR) });
    };
    img.src = URL;

    return () => {
      cancelled = true;
      r.current.texs.forEach((t) => t.dispose());
      const el = r.current.img;
      if (el && el.parentNode) el.parentNode.removeChild(el);
      r.current = { texs: [] };
    };
  }, []);

  useEffect(() => {
    if (!mats) return;
    let last = -1;
    const unreg = frameLoop.register('forcefield-moire', (_d, elapsed) => {
      if (elapsed - last < CAPTURE_DT) return;
      last = elapsed;
      const c = r.current;
      if (!c.ctx || !c.img || !c.canvas) return;
      // Copy whatever frame the browser is currently showing.
      c.ctx.drawImage(c.img, 0, 0, c.canvas.width, c.canvas.height);
      for (const t of c.texs) t.needsUpdate = true;
    }, 67);
    return unreg;
  }, [mats]);

  if (!mats) return null;
  // Planes sit just outside the force-field (offset 0.12 away from center) to avoid
  // z-fighting with the shimmer; positions otherwise match the FSZ perimeter walls.
  return (
    <group>
      <mesh position={[0, HALF_H, FSZ_MAX_Z + 0.12]} material={mats.fb}>
        <planeGeometry args={[W_X, WALL_H]} />
      </mesh>
      <mesh position={[0, HALF_H, FSZ_MIN_Z - 0.12]} material={mats.fb}>
        <planeGeometry args={[W_X, WALL_H]} />
      </mesh>
      <mesh position={[FSZ_MIN_X - 0.12, HALF_H, CZ]} rotation={[0, Math.PI / 2, 0]} material={mats.lr}>
        <planeGeometry args={[W_Z, WALL_H]} />
      </mesh>
      <mesh position={[FSZ_MAX_X + 0.12, HALF_H, CZ]} rotation={[0, Math.PI / 2, 0]} material={mats.lr}>
        <planeGeometry args={[W_Z, WALL_H]} />
      </mesh>
    </group>
  );
}
