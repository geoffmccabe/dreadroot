// Collider debug view. Ctrl OR Cmd + "+"/"=" toggles collider OUTLINES.
// GREEN = box / voxel colliders (the spatial grid). BLUE = true MESH colliders
// (three-mesh-bvh) — drawn as a blue wireframe of the actual collision mesh so
// you can tell them apart and confirm a model converted. Drawn on top of the
// world (depthTest off). Opacity fades with distance; near-cull + cap keep it light.
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { forEachMeshInstance } from './meshColliderSystem';

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
      // Dispose the material; box-wire geometry is shared (don't), and mesh-wire
      // geometry is the collider's own shared geometry (don't dispose either).
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
      // toneMapped:false keeps the colour pure neon green (otherwise tone-mapping washes it white).
      const wire = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
        color: 0x39ff14, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false,
        toneMapped: false,
      }));
      wire.position.copy(c); wire.scale.copy(s); wire.renderOrder = 999;
      wire.userData.center = c.clone();
      g.add(wire);
      if (++n >= MAX) break;
    }
    // BLUE: true mesh colliders (three-mesh-bvh) — a wireframe of the real
    // collision mesh at each instance, so you can see/confirm a converted model.
    const pos = new THREE.Vector3();
    forEachMeshInstance((geo, matrix) => {
      if (n >= MAX) return;
      pos.setFromMatrixPosition(matrix);
      if (cam.distanceTo(pos) > FAR) return;
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x2277ff, wireframe: true, transparent: true, opacity: 0.7,
        depthTest: false, depthWrite: false, toneMapped: false,
      }));
      matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.renderOrder = 999;
      mesh.userData.center = pos.clone();
      g.add(mesh);
      n++;
    });
    lastBuildPos.current.copy(cam);
  };

  useEffect(() => {
    const g = ref.current; if (!g) return;
    if (on) rebuild(); else clear(g);
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps

  // The V voxelize tool mutates the grid — rebuild immediately so new cubes show at once.
  useEffect(() => {
    const onChanged = () => { if (on) rebuild(); };
    window.addEventListener('sw-colliders-changed', onChanged);
    return () => window.removeEventListener('sw-colliders-changed', onChanged);
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
