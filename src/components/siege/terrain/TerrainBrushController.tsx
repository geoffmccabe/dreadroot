// TerrainBrushController — in-Canvas owner of the terrain brush. When build mode is on
// it shows a ring at the ground point under the crosshair and, while an apply key is
// held, stamps the heightField there (raise/lower/smooth/flat) every frame. Keys are
// captured ONLY while build mode is on, so normal play keybinds are never affected.
//   B (hold) = apply current mode · R/F/G/T = set mode raise/lower/smooth/flat
// Mode/size/strength/blur also come from the styled panel via terrainBrushState.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { applyBrush, getHeight } from './heightField';
import { getBrushState, setBrushState } from './terrainBrushState';

const MARCH_MAX = 700; // meters the brush ray reaches
const MARCH_STEP = 2;  // coarse step (m); refined by bisection on crossing

export function TerrainBrushController() {
  const cam = useThree((s) => s.camera);
  const ring = useRef<THREE.Mesh>(null);
  const applying = useRef(false);
  const flatTarget = useRef<number | undefined>(undefined);
  const ro = useMemo(() => new THREE.Vector3(), []); // ray origin (reused)
  const rd = useMemo(() => new THREE.Vector3(), []); // ray dir (reused)
  const hit = useRef(new THREE.Vector3());
  const hasHit = useRef(false);

  // Analytic ray-march of the crosshair ray vs the height function — a few hundred cheap
  // getHeight() calls instead of raycasting ~2.6M terrain triangles every frame.
  const marchToGround = (): boolean => {
    cam.getWorldPosition(ro);
    cam.getWorldDirection(rd);
    let prev = ro.y - getHeight(ro.x, ro.z);
    for (let t = MARCH_STEP; t <= MARCH_MAX; t += MARCH_STEP) {
      const diff = (ro.y + rd.y * t) - getHeight(ro.x + rd.x * t, ro.z + rd.z * t);
      if (diff <= 0 && prev > 0) {           // crossed the surface in (t-STEP, t] — bisect
        let lo = t - MARCH_STEP, hi = t;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          if ((ro.y + rd.y * m) - getHeight(ro.x + rd.x * m, ro.z + rd.z * m) <= 0) hi = m; else lo = m;
        }
        const fm = (lo + hi) / 2;
        hit.current.set(ro.x + rd.x * fm, ro.y + rd.y * fm, ro.z + rd.z * fm);
        return true;
      }
      prev = diff;
    }
    return false;
  };

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (!getBrushState().enabled) return;
      const code = e.code;
      if (code === 'KeyB') { applying.current = true; flatTarget.current = undefined; e.preventDefault(); e.stopImmediatePropagation(); }
      else if (code === 'KeyR') { setBrushState({ mode: 'raise' }); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (code === 'KeyF') { setBrushState({ mode: 'lower' }); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (code === 'KeyG') { setBrushState({ mode: 'smooth' }); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (code === 'KeyT') { setBrushState({ mode: 'flat' }); e.preventDefault(); e.stopImmediatePropagation(); }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyB') applying.current = false;
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => { window.removeEventListener('keydown', onDown, true); window.removeEventListener('keyup', onUp, true); };
  }, []);

  useFrame((_, dt) => {
    const bs = getBrushState();
    if (ring.current) ring.current.visible = bs.enabled && hasHit.current;
    if (!bs.enabled) { applying.current = false; return; }

    // Ground point under the crosshair (analytic ray-march vs the height function).
    hasHit.current = marchToGround();
    if (hasHit.current && ring.current) {
      ring.current.position.set(hit.current.x, hit.current.y + 0.2, hit.current.z);
      ring.current.scale.setScalar(bs.radius);
    }

    if (applying.current && hasHit.current) {
      if (bs.mode === 'flat' && flatTarget.current === undefined) flatTarget.current = hit.current.y;
      applyBrush(hit.current.x, hit.current.z, bs.radius, bs.strength, bs.mode, Math.min(dt, 0.05), bs.edge, flatTarget.current);
    }
  });

  // Unit ring (scaled to radius each frame), laid flat on the ground.
  return (
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.92, 1, 48]} />
      <meshBasicMaterial color={0x33ddff} transparent opacity={0.85} depthTest={false} />
    </mesh>
  );
}
