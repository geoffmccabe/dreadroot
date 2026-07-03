// ProceduralObjectsLayer — renders the PG-generated instances as InstancedMeshes (one per sub-mesh of
// each species model), so tens of thousands draw cheaply. Rebuilds whenever `generate()` produces a new
// set. Positions are raw engine coords (same as the manual builder objects, which align with terrain).
// v1: opaque (makeSolid), no per-instance vine wind or colliders yet (later phases).
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { importUrl } from './mushroomCatalog';
import { usePgInstances, type PgInstance } from './pgState';

function solidClone(mat: THREE.Material): THREE.Material {
  const m = mat.clone() as THREE.MeshStandardMaterial;
  m.side = THREE.DoubleSide; m.transparent = false; m.depthWrite = true; m.alphaTest = 0;
  if ('opacity' in m) m.opacity = 1;
  m.needsUpdate = true;
  return m;
}

function SpeciesInstances({ file, list }: { file: string; list: PgInstance[] }) {
  const { scene } = useGLTF(importUrl(file), '/draco/');
  // Sub-meshes (geometry + solid material + local transform) and the model's natural height.
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(clone);
    const modelH = Math.max(0.001, box.max.y - box.min.y);
    const subs: { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[]; local: THREE.Matrix4 }[] = [];
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const mat = Array.isArray(m.material) ? m.material.map(solidClone) : solidClone(m.material);
      subs.push({ geo: m.geometry as THREE.BufferGeometry, mat, local: m.matrixWorld.clone() });
    });
    return { subs, modelH };
  }, [scene]);

  const grp = useRef<THREE.Group>(null);
  useEffect(() => {
    const g = grp.current; if (!g) return;
    while (g.children.length) { const c = g.children[0] as THREE.InstancedMesh; g.remove(c); c.dispose?.(); }
    const obj = new THREE.Matrix4(), out = new THREE.Matrix4();
    const q = new THREE.Quaternion(), eul = new THREE.Euler();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    for (const sub of model.subs) {
      const im = new THREE.InstancedMesh(sub.geo, sub.mat, list.length);
      im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
      for (let i = 0; i < list.length; i++) {
        const inst = list[i];
        const u = inst.height / model.modelH;
        eul.set(inst.tiltX, inst.yaw, inst.tiltZ, 'YXZ');
        q.setFromEuler(eul);
        pos.set(inst.x, inst.y, inst.z);
        scl.set(u * inst.stretchX, u * inst.stretchY, u * inst.stretchZ);
        obj.compose(pos, q, scl);
        out.multiplyMatrices(obj, sub.local);   // bake the sub-mesh's local transform in
        im.setMatrixAt(i, out);
      }
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      g.add(im);
    }
  }, [model, list]);

  return <group ref={grp} />;
}

export function ProceduralObjectsLayer() {
  const instances = usePgInstances();
  const byFile = useMemo(() => {
    const m = new Map<string, PgInstance[]>();
    for (const inst of instances) { const a = m.get(inst.file); if (a) a.push(inst); else m.set(inst.file, [inst]); }
    return m;
  }, [instances]);
  return (
    <Suspense fallback={null}>
      {[...byFile.entries()].map(([file, list]) => <SpeciesInstances key={file} file={file} list={list} />)}
    </Suspense>
  );
}
