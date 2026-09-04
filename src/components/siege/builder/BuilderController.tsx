// BuilderController — the in-Canvas placement interaction for the drop-in builder. Active only
// while builder mode is ON. Shows a translucent ghost of the armed asset under the crosshair
// (analytic ray-march vs the ground, same trick as the terrain brush — no per-frame mesh raycast),
// and handles: left-click = place (or select when nothing is armed), [ ] = rotate, - = = scale,
// Delete = remove selected, Esc = disarm/deselect. Keys/clicks are captured only in builder mode,
// so normal play is untouched.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { isTypingTarget } from '@/lib/isTypingTarget';
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleHeight } from '../terrainHeight';
import {
  getBuilder, setBuilder, addObject, updateObject, removeObject, useBuilder,
} from './builderObjectsState';
import { scifiAsset } from '@/config/assetBase';
import { getEditMode } from '@/features/objectEditor/store';

const MARCH_MAX = 800;   // meters the placement ray reaches
const MARCH_STEP = 2;    // coarse step (m), refined by bisection
const clampScale = (s: number) => Math.min(50, Math.max(0.05, s));
const groundY = (x: number, z: number) => { const h = sampleHeight(x, z); return h == null ? 0 : h; };

const resolveModel = (file: string) => (file.startsWith('/') || file.startsWith('http') ? file : scifiAsset(file));

function GhostModel({ file }: { file: string }) {
  const { scene } = useGLTF(resolveModel(file), '/draco/');
  const ghost = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const arr = Array.isArray(m.material) ? m.material : [m.material];
      m.material = arr.map((mm) => { const g = (mm as THREE.Material).clone(); g.transparent = true; g.opacity = 0.5; g.depthWrite = false; return g; });
      if (Array.isArray(m.material) && m.material.length === 1) m.material = m.material[0];
    });
    return c;
  }, [scene]);
  return <primitive object={ghost} />;
}

export function BuilderController() {
  const { camera, scene, gl } = useThree();
  const { enabled, armed } = useBuilder();

  const ro = useMemo(() => new THREE.Vector3(), []);
  const rd = useMemo(() => new THREE.Vector3(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const hitValid = useRef(false);
  const ghostRef = useRef<THREE.Group>(null);
  const ray = useMemo(() => new THREE.Raycaster(), []);

  const marchToGround = (): boolean => {
    camera.getWorldPosition(ro);
    camera.getWorldDirection(rd);
    let prev = ro.y - groundY(ro.x, ro.z);
    for (let t = MARCH_STEP; t <= MARCH_MAX; t += MARCH_STEP) {
      const diff = (ro.y + rd.y * t) - groundY(ro.x + rd.x * t, ro.z + rd.z * t);
      if (diff <= 0 && prev > 0) {
        let lo = t - MARCH_STEP, hi = t;
        for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if ((ro.y + rd.y * m) - groundY(ro.x + rd.x * m, ro.z + rd.z * m) <= 0) hi = m; else lo = m; }
        const fm = (lo + hi) / 2;
        hit.set(ro.x + rd.x * fm, ro.y + rd.y * fm, ro.z + rd.z * fm);
        return true;
      }
      prev = diff;
    }
    return false;
  };

  // Place / select / rotate / scale / delete — read live state via getBuilder() so listeners
  // never go stale, and capture-phase so they pre-empt weapon-fire / play keybinds in builder mode.
  useEffect(() => {
    const place = () => {
      const b = getBuilder();
      if (!b.armed || !hitValid.current) return;
      const y = groundY(hit.x, hit.z) + b.armedY;   // wheel raises/lowers above the ground
      addObject({ set: b.armed.set, file: b.armed.file, name: b.armed.name, pos: [hit.x, y, hit.z], rotY: b.armedRotY, scale: b.armedScale });
    };
    const selectAtCrosshair = () => {
      camera.getWorldPosition(ro); camera.getWorldDirection(rd); ray.set(ro, rd);
      const hits = ray.intersectObjects(scene.children, true);
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o) { if (o.userData?.builderId) { setBuilder({ selectedId: o.userData.builderId as string }); return; } o = o.parent; }
      }
      setBuilder({ selectedId: null });
    };
    const onMouse = (e: MouseEvent) => {
      const b = getBuilder();
      if (!b.enabled || e.button !== 0) return;
      if (e.target !== gl.domElement) return;   // let clicks on the panel (dropdown/search/buttons) work
      // Holding an item → left-click DROPS it (takes priority over everything).
      if (b.armed) { e.preventDefault(); e.stopImmediatePropagation(); place(); return; }
      if (getEditMode()) return;   // not holding → let Arrange edit mode (Shift+`) grab/move placed objects
      e.preventDefault(); e.stopImmediatePropagation();
      selectAtCrosshair();
    };
    // Scroll wheel while holding an item → raise/lower it on Y (Shift = coarse).
    const onWheel = (e: WheelEvent) => {
      const b = getBuilder();
      if (!b.enabled || !b.armed || getEditMode() || e.target !== gl.domElement) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const step = e.shiftKey ? 2 : 0.5;
      setBuilder({ armedY: b.armedY + (e.deltaY < 0 ? step : -step) });
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;   // don't hijack typing in panel fields
      const b = getBuilder();
      if (!b.enabled || e.metaKey || e.ctrlKey || e.altKey) return;
      const sel = b.selectedId ? b.objects.find((o) => o.id === b.selectedId) : null;
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        const step = (Math.PI / 12) * (e.code === 'BracketRight' ? 1 : -1);
        if (b.armed) setBuilder({ armedRotY: b.armedRotY + step });
        else if (sel) updateObject(sel.id, { rotY: sel.rotY + step });
        e.preventDefault();
      } else if (e.code === 'Minus' || e.code === 'Equal') {
        const f = e.code === 'Equal' ? 1.1 : 0.9;
        if (b.armed) setBuilder({ armedScale: clampScale(b.armedScale * f) });
        else if (sel) updateObject(sel.id, { scale: clampScale(sel.scale * f) });
        e.preventDefault();
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (b.selectedId) { removeObject(b.selectedId); e.preventDefault(); }
      } else if (e.code === 'Escape') {
        // ESC LETS GO OF EVERYTHING AT ONCE: the held item leaves the pointer and the selection
        // clears, in ONE press. It used to take two presses (armed first, then selection), which
        // felt like the item was stuck to the cursor. Consumed while the builder is on so it can
        // never also pause or exit the world out from under you.
        if (b.armed || b.selectedId) {
          setBuilder({ armed: null, armedY: 0, selectedId: null });
          e.preventDefault(); e.stopImmediatePropagation();
        }
      }
    };
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel, true);
    };
  }, [camera, scene, gl, ray, ro, rd, hit]);

  useFrame(() => {
    if (!enabled || !armed) { hitValid.current = false; return; }
    hitValid.current = marchToGround();
    const g = ghostRef.current;
    if (g) {
      g.visible = hitValid.current;
      if (hitValid.current) {
        const b = getBuilder();
        g.position.set(hit.x, groundY(hit.x, hit.z) + b.armedY, hit.z);
        g.rotation.set(0, b.armedRotY, 0);
        g.scale.setScalar(b.armedScale);
      }
    }
  });

  if (!enabled || !armed) return null;
  return (
    <Suspense fallback={null}>
      <group ref={ghostRef} visible={false}>
        <GhostModel file={armed.file} />
      </group>
    </Suspense>
  );
}
