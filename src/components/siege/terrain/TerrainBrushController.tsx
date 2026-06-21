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
import { shapeOutline, type BrushShape } from './brushShapes';

// Indicator colour cycle: light blue → dark grey-blue, ~1 rev/sec, so the ring stays
// visible over ANY ground colour (incl. blue water).
const COL_A = new THREE.Color(0x9fe4ff); // light blue
const COL_B = new THREE.Color(0x33506b); // dark grey-blue

const MARCH_MAX = 700; // meters the brush ray reaches
const MARCH_STEP = 2;  // coarse step (m); refined by bisection on crossing

export function TerrainBrushController() {
  const cam = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const applying = useRef(false);
  const flatTarget = useRef<number | undefined>(undefined);
  const ro = useMemo(() => new THREE.Vector3(), []); // ray origin (reused)
  const rd = useMemo(() => new THREE.Vector3(), []); // ray dir (reused)
  const hit = useRef(new THREE.Vector3());
  const hasHit = useRef(false);
  const yaw = useRef(0);

  // Ground indicator: a flat line-loop outline of the current shape, rebuilt when the
  // shape/size changes, oriented to facing, colour-cycling each frame.
  const indicator = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const mat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false });
    const line = new THREE.LineLoop(geo, mat);
    line.renderOrder = 999;
    line.visible = false;
    return line;
  }, []);
  const indShape = useRef<BrushShape | null>(null);
  const indR = useRef(-1);
  const rebuildOutline = (shape: BrushShape, r: number) => {
    if (indShape.current === shape && indR.current === r) return;
    indShape.current = shape; indR.current = r;
    const pts = shapeOutline(shape, r);
    indicator.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    indicator.geometry.computeBoundingSphere();
  };

  // Analytic ray-march of the crosshair ray vs the height function — a few hundred cheap
  // getHeight() calls instead of raycasting ~2.6M terrain triangles every frame.
  const marchToGround = (): boolean => {
    cam.getWorldPosition(ro);
    cam.getWorldDirection(rd);
    yaw.current = Math.atan2(rd.x, rd.z);   // facing → orients non-circular shapes
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
    // Mouse drawing — only over the game canvas (so panel clicks still work). Intercept at
    // capture phase so the click never reaches the weapon (that "fail" sound = the gun
    // dry-firing on an empty/blocked shot).
    const canvas = gl.domElement;
    const onMouseDown = (e: MouseEvent) => {
      if (!getBrushState().enabled || e.target !== canvas) return;
      if (e.button === 0) { applying.current = true; flatTarget.current = undefined; }
      else if (e.button === 2) { applying.current = true; flatTarget.current = undefined; setBrushState({ mode: 'lower' }); }
      e.preventDefault(); e.stopImmediatePropagation();
    };
    const onMouseUp = () => { applying.current = false; };
    const onContext = (e: MouseEvent) => { if (getBrushState().enabled && e.target === canvas) e.preventDefault(); };
    // Scroll wheel = brush size in 0.5 m steps.
    const onWheel = (e: WheelEvent) => {
      if (!getBrushState().enabled || e.target !== canvas) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const r = getBrushState().radius + (e.deltaY < 0 ? 0.5 : -0.5);
      setBrushState({ radius: Math.max(0.5, Math.min(80, Math.round(r * 2) / 2)) });
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('contextmenu', onContext, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('contextmenu', onContext, true);
      window.removeEventListener('wheel', onWheel, true);
    };
  }, [gl]);

  const tRef = useRef(0);
  useFrame((_, dt) => {
    const bs = getBrushState();
    indicator.visible = bs.enabled && hasHit.current;
    if (!bs.enabled) { applying.current = false; return; }

    // Ground point under the crosshair (analytic ray-march vs the height function).
    hasHit.current = marchToGround();
    if (hasHit.current) {
      rebuildOutline(bs.shape, bs.radius);
      indicator.position.set(hit.current.x, hit.current.y + 0.25, hit.current.z);
      indicator.rotation.y = -yaw.current;   // orient shape to facing
      // colour cycle ~1 rev/sec (triangle wave light↔dark blue)
      tRef.current += dt;
      const k = 0.5 - 0.5 * Math.cos(tRef.current * Math.PI * 2);
      (indicator.material as THREE.LineBasicMaterial).color.copy(COL_A).lerp(COL_B, k);
    }

    if (applying.current && hasHit.current) {
      if (bs.mode === 'flat' && flatTarget.current === undefined) flatTarget.current = hit.current.y;
      applyBrush(hit.current.x, hit.current.z, bs.radius, bs.strength, bs.mode,
                 Math.min(dt, 0.05), bs.edge, flatTarget.current, bs.shape, yaw.current);
    }
  });

  return <primitive object={indicator} />;
}
