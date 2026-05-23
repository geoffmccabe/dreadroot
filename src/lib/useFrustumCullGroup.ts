/**
 * Coarse frustum cull for a group of InstancedMeshes whose instances move.
 *
 * Three's built-in frustum culling fails for moving InstancedMeshes (the
 * mesh's bounding sphere goes stale), so enemy renderers force
 * `frustumCulled={false}` — meaning the meshes always render, even behind
 * the camera. This hook restores the cull manually: every ~100ms it
 * recomputes a bounding sphere over all active instance positions and
 * toggles each mesh's `.visible`.
 *
 * When there are no active instances, meshes are hidden.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { frameLoop } from '@/lib/frameLoop';

const _sphere = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _matrix = new THREE.Matrix4();
let _idCounter = 0;

type MeshRef = { current: THREE.Object3D | null };
type Pos = { x: number; y: number; z: number };

export function useFrustumCullGroup(
  name: string,
  meshes: MeshRef[],
  getPositions: () => Pos[] | null,
  options?: { intervalMs?: number; radiusPad?: number },
): void {
  const { camera } = useThree();
  const interval = options?.intervalMs ?? 100;
  const pad = options?.radiusPad ?? 2;

  // Capture mutable inputs in refs so we register exactly once.
  const meshesRef = useRef(meshes);
  meshesRef.current = meshes;
  const getPositionsRef = useRef(getPositions);
  getPositionsRef.current = getPositions;

  const idRef = useRef<string | null>(null);
  if (idRef.current === null) {
    idRef.current = `frustumCull-${name}-${++_idCounter}`;
  }

  useEffect(() => {
    let last = 0;
    const unregister = frameLoop.register(idRef.current!, () => {
      const now = performance.now();
      if (now - last < interval) return;
      last = now;

      const positions = getPositionsRef.current();
      const list = meshesRef.current;
      if (!positions || positions.length === 0) {
        for (const r of list) { if (r.current) r.current.visible = false; }
        return;
      }

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const p of positions) {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.z < minZ) minZ = p.z;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; if (p.z > maxZ) maxZ = p.z;
      }
      _sphere.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      _sphere.radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2 + pad;
      _matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_matrix);
      const visible = _frustum.intersectsSphere(_sphere);
      for (const r of list) { if (r.current) r.current.visible = visible; }
    });
    return unregister;
  }, [camera, interval, pad]);
}
