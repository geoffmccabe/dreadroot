// Depth-aware pulsing selection outline for the Arrange tool. A wireframe box around the selected
// object's world bounding box, drawn in TWO passes so it reads with real depth instead of floating
// flat on top of everything:
//   • FRONT pass  — depth-TESTED, bright. Edges in front of scene geometry draw at full strength;
//                   edges genuinely behind other objects fail the depth test and don't draw here.
//   • BEHIND pass — depth-ignored, faint. The occluded edges still show, but dim — so the further
//                   back / more occluded a part is, the more transparent it looks.
// Net effect: bright & solid where the box is close/unoccluded, fading toward transparent where it's
// behind other objects — giving a true sense of the object's size and where it sits in the scene.
// (A literal "−40% brightness per occluding object" needs multi-layer depth peeling, which is far
// too expensive per frame; this two-pass x-ray is the standard editor technique and reads the same.)
// Both passes pulse together ~2×/sec. Works for placed objects AND baked map instances. Touches NO
// material (writing instanceColor recompiled the EF shaders and made objects vanish — see LaserProbe).
import { useEffect, useMemo, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCurrent } from './store';

const COLOR = 0x8df4ff;

export function SelectionHighlight() {
  const { scene } = useThree();
  const sel = useCurrent();

  const { group, frontMat, behindMat } = useMemo(() => {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const frontMat = new THREE.LineBasicMaterial({ color: COLOR, transparent: true, depthTest: true, depthWrite: false });
    const behindMat = new THREE.LineBasicMaterial({ color: COLOR, transparent: true, depthTest: false, depthWrite: false });
    const behind = new THREE.LineSegments(geo, behindMat); behind.renderOrder = 1001;  // faint, drawn first
    const front = new THREE.LineSegments(geo, frontMat); front.renderOrder = 1002;     // bright, on top of behind
    const group = new THREE.Group(); group.add(behind, front);
    group.frustumCulled = false; behind.frustumCulled = false; front.frustumCulled = false;
    group.visible = false;
    return { group, frontMat, behindMat };
  }, []);
  const b3 = useMemo(() => new THREE.Box3(), []);
  const ctr = useMemo(() => new THREE.Vector3(), []);
  const sz = useMemo(() => new THREE.Vector3(), []);
  const m4 = useMemo(() => new THREE.Matrix4(), []);

  // Add to the scene root (world space) for the component's lifetime.
  useEffect(() => { scene.add(group); return () => { scene.remove(group); group.visible = false; }; }, [scene, group]);

  // Resolved placed Object3D, cached per selected ID. Re-resolved (per frame, until found) only when
  // the ID changes — so it picks up a just-duplicated object that mounts a frame later, without
  // traversing the whole scene every drag frame.
  const targetRef = useRef<THREE.Object3D | null>(null);
  const idRef = useRef<string | null>(null);

  useFrame((state) => {
    if (!sel) { group.visible = false; return; }
    if (sel.baked) {
      const im = sel.baked.mesh; const g = im?.geometry as THREE.BufferGeometry | undefined;
      if (!im || !g) { group.visible = false; return; }
      if (!g.boundingBox) g.computeBoundingBox();
      im.getMatrixAt(sel.baked.instanceId, m4);
      b3.copy(g.boundingBox as THREE.Box3).applyMatrix4(m4);
    } else {
      if (idRef.current !== sel.id) { idRef.current = sel.id; targetRef.current = null; }
      if (!targetRef.current) {
        const id = sel.id;
        scene.traverse((o) => { if (!targetRef.current && o.userData?.worldObjectId === id) targetRef.current = o; });
      }
      if (!targetRef.current) { group.visible = false; return; }
      b3.setFromObject(targetRef.current);
    }
    if (b3.isEmpty()) { group.visible = false; return; }
    b3.getCenter(ctr); b3.getSize(sz);
    if (Math.max(sz.x, sz.y, sz.z) > 200) { group.visible = false; return; }  // never draw a map-sized box
    group.position.copy(ctr);
    group.scale.set(Math.max(sz.x, 0.05), Math.max(sz.y, 0.05), Math.max(sz.z, 0.05));
    // 2 Hz smooth pulse. Front (unoccluded) stays bold; behind (occluded) floors near the 10% the
    // user wanted, so heavily-blocked parts read as nearly transparent.
    const pulse = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * Math.PI * 4);
    frontMat.opacity = 0.65 + 0.35 * pulse;     // ~0.65 → 1.0
    behindMat.opacity = 0.1 + 0.12 * pulse;     // ~0.10 → 0.22
    group.visible = true;
  });

  return null;
}
