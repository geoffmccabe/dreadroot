// Collider debug view. Ctrl OR Cmd + "+"/"=" toggles green collider outlines.
// - Distance fade: fully visible within 20m, fading to invisible at 100m (declutters far ones).
// - Depth: each collider also writes an invisible solid box into the depth buffer, so closer
//   colliders OCCLUDE the wireframes behind them — you see the outer shell of a voxelized rock
//   instead of every overlapping edge. Gives a real sense of depth.
// - Near-cull + cap: only colliders within 100m are built (rebuilt as you move), capped, so the
//   toggle stays light. Siege-only; meant for spotting troublesome colliders with the L laser.
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

const NEAR = 20, FAR = 100, MAX = 1500;
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const edgeGeo = new THREE.EdgesGeometry(boxGeo);
// Invisible depth-writer: occludes wireframes behind it (front-occludes-back). polygonOffset
// pushes it back a hair so a box never occludes its OWN front edges.
const occluderMat = new THREE.MeshBasicMaterial({
  colorWrite: false, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});

export function ColliderDebugView() {
  const [on, setOn] = useState(false);
  const ref = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const lastBuildPos = useRef(new THREE.Vector3(1e9, 1e9, 1e9));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=')) {
        e.preventDefault(); e.stopPropagation(); setOn((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const clear = (g: THREE.Group) => {
    while (g.children.length) {
      const c = g.children[0] as THREE.Mesh;
      g.remove(c);
      if (c.material && c.material !== occluderMat) (c.material as THREE.Material).dispose();
    }
  };

  const rebuild = () => {
    const g = ref.current; if (!g) return;
    clear(g);
    const cells = (worldCollisionGrid as unknown as { colliderCells?: Map<THREE.Box3, unknown> }).colliderCells;
    if (!cells) return;
    const cam = camera.position, c = new THREE.Vector3(), s = new THREE.Vector3();
    let n = 0;
    for (const b of cells.keys()) {
      b.getCenter(c);
      if (cam.distanceTo(c) > FAR) continue;
      b.getSize(s);
      const occ = new THREE.Mesh(boxGeo, occluderMat);
      occ.position.copy(c); occ.scale.copy(s); occ.renderOrder = 0;
      g.add(occ);
      const wire = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x44ff99, transparent: true, opacity: 0.5, depthTest: true }));
      wire.position.copy(c); wire.scale.copy(s); wire.renderOrder = 1;
      wire.userData.center = c.clone();
      g.add(wire);
      if (++n >= MAX) break;
    }
    lastBuildPos.current.copy(cam);
  };

  useEffect(() => {
    const g = ref.current; if (!g) return;
    if (on) rebuild(); else clear(g);
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    const g = ref.current; if (!g || !on) return;
    const cam = camera.position;
    if (cam.distanceTo(lastBuildPos.current) > 20) rebuild(); // re-follow the player
    for (const ch of g.children) {
      if (!(ch instanceof THREE.LineSegments)) continue;
      const d = cam.distanceTo(ch.userData.center as THREE.Vector3);
      const f = THREE.MathUtils.clamp((FAR - d) / (FAR - NEAR), 0, 1);
      (ch.material as THREE.LineBasicMaterial).opacity = 0.55 * f;
      ch.visible = f > 0.02;
    }
  });

  return <group ref={ref} />;
}
