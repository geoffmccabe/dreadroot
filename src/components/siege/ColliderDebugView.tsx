// Collider debug view. Ctrl OR Cmd + "+"/"=" toggles green collider OUTLINES.
// Edges only — no solid faces. Each collider draws as a green wireframe drawn on top of the
// world (depthTest off) so you can see every nearby collider shape and highlight the bad ones
// with the L laser. Opacity fades with distance: full within 20m, invisible by 100m, so the
// view declutters as colliders recede. Near-cull + cap keep it light; rebuilt as you move.
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

const NEAR = 20, FAR = 100, MAX = 2500;
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const edgeGeo = new THREE.EdgesGeometry(boxGeo);

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
      const c = g.children[0] as THREE.LineSegments;
      g.remove(c);
      (c.material as THREE.Material).dispose();
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
      // Edges only, drawn over the world so collider shapes are always visible to aim at.
      const wire = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
        color: 0x4dff88, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false,
      }));
      wire.position.copy(c); wire.scale.copy(s); wire.renderOrder = 999;
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
      const d = cam.distanceTo((ch as THREE.LineSegments).userData.center as THREE.Vector3);
      const f = THREE.MathUtils.clamp((FAR - d) / (FAR - NEAR), 0, 1);
      ((ch as THREE.LineSegments).material as THREE.LineBasicMaterial).opacity = 0.6 * f;
      ch.visible = f > 0.02;
    }
  });

  return <group ref={ref} />;
}
