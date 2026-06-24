// Collider debug view. Ctrl OR Cmd + "\" (or "|") toggles collider OUTLINES.
// (Was Ctrl/Cmd + "+", which collided with browser zoom.)
// GREEN = box / voxel colliders (the spatial grid). BLUE = true MESH colliders
// (three-mesh-bvh) — drawn as a blue wireframe of the actual collision mesh so
// you can tell them apart and confirm a model converted. Drawn on top of the
// world (depthTest off). Opacity fades with distance; near-cull + cap keep it light.
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { forEachMeshInstance } from './meshColliderSystem';
import { colliderDebugStats } from './colliderDebugStats';

const NEAR = 20, FAR = 100, MAX = 2500;
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const edgeGeo = new THREE.EdgesGeometry(boxGeo);
// The ACTUAL collision-mesh wireframe per geometry is expensive to build, so cache it (shared, never
// disposed — the underlying BVH geometry lives for the world's lifetime).
const wireCache = new WeakMap<THREE.BufferGeometry, THREE.WireframeGeometry>();
const _wc = new THREE.Vector3();

export function ColliderDebugView() {
  const [on, setOn] = useState(false);
  const ref = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const lastBuildPos = useRef(new THREE.Vector3(1e9, 1e9, 1e9));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.code === 'Backslash' || e.key === '\\' || e.key === '|')) {
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
    // Nothing in here may throw — an error would unmount the component and kill
    // the toggle hotkey (Ctrl/Cmd + "+"), letting it fall through to browser zoom.
    try {
      clear(g);
      const cam = camera.position;
      let n = 0;
      // GREEN: box / voxel colliders (independent of the blue pass below).
      const cells = (worldCollisionGrid as unknown as { colliderCells?: Map<THREE.Box3, unknown> }).colliderCells;
      if (cells) {
        const c = new THREE.Vector3(), s = new THREE.Vector3();
        for (const b of cells.keys()) {
          b.getCenter(c);
          if (cam.distanceTo(c) > FAR) continue;
          b.getSize(s);
          const wire = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
            color: 0x39ff14, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false,
            toneMapped: false,
          }));
          wire.position.copy(c); wire.scale.copy(s); wire.renderOrder = 999;
          wire.userData.center = c.clone();
          g.add(wire);
          if (++n >= MAX) break;
        }
      }
      const greenCount = n;
      // BLUE: the ACTUAL collision mesh (triangle wireframe) for instances near the camera — so you
      // can see the real cave/building walls, floors and roofs, not just bounding boxes.
      let blueCount = 0;
      forEachMeshInstance((geometry, matrix) => {
        if (n >= MAX) return;
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        _wc.copy(geometry.boundingSphere!.center).applyMatrix4(matrix);
        const r = geometry.boundingSphere!.radius * Math.max(matrix.elements[0], matrix.elements[5], matrix.elements[10]);
        if (cam.distanceTo(_wc) - r > FAR) return;     // cull far instances (account for size)
        let wg = wireCache.get(geometry);
        if (!wg) { wg = new THREE.WireframeGeometry(geometry); wireCache.set(geometry, wg); }
        const wire = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({
          color: 0x33aaff, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false,
          toneMapped: false,
        }));
        matrix.decompose(wire.position, wire.quaternion, wire.scale);
        wire.renderOrder = 999; wire.userData.mc = true;   // mc → constant opacity in the frame loop
        g.add(wire);
        blueCount++;
        if (++n >= MAX) return;
      });
      lastBuildPos.current.copy(cam);
      colliderDebugStats.on = true;
      colliderDebugStats.green = greenCount;
      colliderDebugStats.blue = blueCount;
      colliderDebugStats.tris = 0;
    } catch (err) {
      console.warn('[ColliderDebug] rebuild skipped:', err);
    }
  };

  useEffect(() => {
    const g = ref.current; if (!g) return;
    if (on) rebuild(); else { clear(g); colliderDebugStats.on = false; }
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { colliderDebugStats.on = false; }, []);

  // The V voxelize tool mutates the grid — rebuild immediately so new cubes show at once.
  useEffect(() => {
    const onChanged = () => { if (on) rebuild(); };
    window.addEventListener('sw-colliders-changed', onChanged);
    return () => window.removeEventListener('sw-colliders-changed', onChanged);
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    const g = ref.current; if (!g || !on) return;
    try {
      const cam = camera.position;
      if (cam.distanceTo(lastBuildPos.current) > 20) rebuild(); // re-follow the player
      for (const ch of g.children) {
        const mat = (ch as THREE.Mesh).material as THREE.Material & { opacity: number };
        // Blue mesh colliders: constant opacity + always visible (their pivot can be
        // far from the player even while you stand inside, so don't distance-fade).
        if (ch.userData.mc) { mat.opacity = 0.6; ch.visible = true; continue; }
        const d = cam.distanceTo(ch.userData.center as THREE.Vector3);
        const f = THREE.MathUtils.clamp((FAR - d) / (FAR - NEAR), 0, 1);
        mat.opacity = 0.6 * f;
        ch.visible = f > 0.02;
      }
    } catch { /* never let the debug overlay break the frame loop */ }
  });

  return <group ref={ref} />;
}
