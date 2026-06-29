// Pulsing selection outline for the Arrange tool. Draws a bright additive wireframe box around
// the selected object's world bounding box and pulses its opacity ~2×/sec (smooth sine). Works for
// BOTH a placed object (found by its worldObjectId) and a baked map instance (box derived from the
// instance matrix), so cliffs/leaves finally show selection feedback. It's a wireframe drawn OVER
// everything (depthTest off, additive) — bright on dark surfaces, and it never hides the object's
// real colour. Crucially it touches NO material (writing instanceColor recompiled the EF shaders
// and made objects vanish — see LaserProbe). Added straight to the scene so it lives in world space.
import { useEffect, useMemo, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCurrent } from './store';

const COLOR = 0x7df0ff;

export function SelectionHighlight() {
  const { scene } = useThree();
  const sel = useCurrent();

  const box = useMemo(() => {
    const ls = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: COLOR, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    ls.renderOrder = 1001; ls.frustumCulled = false; ls.visible = false;
    return ls;
  }, []);
  const b3 = useMemo(() => new THREE.Box3(), []);
  const ctr = useMemo(() => new THREE.Vector3(), []);
  const sz = useMemo(() => new THREE.Vector3(), []);
  const m4 = useMemo(() => new THREE.Matrix4(), []);

  // Add the box to the scene root (world space) for the component's lifetime.
  useEffect(() => { scene.add(box); return () => { scene.remove(box); box.visible = false; }; }, [scene, box]);

  // Resolved placed Object3D, cached per selected ID. Re-resolved (per frame, until found) only
  // when the ID changes — so it picks up a just-duplicated object that mounts a frame later,
  // without traversing the whole scene every drag frame.
  const targetRef = useRef<THREE.Object3D | null>(null);
  const idRef = useRef<string | null>(null);

  useFrame((state) => {
    if (!sel) { box.visible = false; return; }
    if (sel.baked) {
      const im = sel.baked.mesh; const g = im?.geometry as THREE.BufferGeometry | undefined;
      if (!im || !g) { box.visible = false; return; }
      if (!g.boundingBox) g.computeBoundingBox();
      im.getMatrixAt(sel.baked.instanceId, m4);
      b3.copy(g.boundingBox as THREE.Box3).applyMatrix4(m4);
    } else {
      if (idRef.current !== sel.id) { idRef.current = sel.id; targetRef.current = null; }
      if (!targetRef.current) {
        const id = sel.id;
        scene.traverse((o) => { if (!targetRef.current && o.userData?.worldObjectId === id) targetRef.current = o; });
      }
      if (!targetRef.current) { box.visible = false; return; }
      b3.setFromObject(targetRef.current);
    }
    if (b3.isEmpty()) { box.visible = false; return; }
    b3.getCenter(ctr); b3.getSize(sz);
    box.position.copy(ctr);
    box.scale.set(Math.max(sz.x, 0.05), Math.max(sz.y, 0.05), Math.max(sz.z, 0.05));
    // 2 Hz smooth pulse; floor at 0.2 so it stays readable but clearly fades on/off.
    (box.material as THREE.LineBasicMaterial).opacity = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * Math.PI * 4));
    box.visible = true;
  });

  return null;
}
