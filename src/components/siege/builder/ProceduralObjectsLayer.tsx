// ProceduralObjectsLayer — renders the PG-generated instances as InstancedMeshes (one per sub-mesh of
// each species model), so tens of thousands draw cheaply. Rebuilds whenever `generate()` produces a new
// set. Positions are raw engine coords (same as the manual builder objects, which align with terrain).
// v1: opaque (makeSolid), no per-instance vine wind or colliders yet (later phases).
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
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
  // ── LEVEL OF DETAIL ────────────────────────────────────────────────────────────────────────
  // Every instance used to be drawn at every distance, with frustum culling off, so a forest showed
  // up as specks on the horizon long after the ground under it had faded out. Now each instance has
  // a draw distance that scales with its HEIGHT, because a 200 m mushroom should be visible from
  // kilometres away while a 10 m one should not, and the mesh is refilled with only what qualifies.
  //
  // The instance buffer is capped, so the stored forest can be far larger than anything drawn: the
  // list is the world, the buffer is the view.
  // ⚠ THESE MODELS ARE ENORMOUS. Measured across the 36 mushroom glbs: 34,492 triangles on
  // AVERAGE, with several over 100,000. A game tree is normally 500-2,000. So:
  //     500 drawn instances  =  17 M triangles
  //   2,000 drawn instances  =  69 M triangles
  //  50,000 drawn instances  = 1.7 BILLION triangles
  // which is why a 50k forest ran at 2 fps. The budget below is what a scene can actually afford
  // with source meshes this heavy; a genuinely DENSE forest needs decimated LOD meshes or
  // billboard impostors, not a bigger cap. See docs/STARBLINK_WORLDGEN_PLAN.md Phase 4.
  const DRAW_CAP = 22;              // instances per species actually uploaded (~30 species)
  const LOD_BASE_M = 120;           // even a tiny prop is visible this far
  const LOD_PER_HEIGHT = 6;         // ...plus this much per metre of its height
  const REFILL_MOVE_M = 25;         // refill after the camera has moved this far

  const meshes = useRef<THREE.InstancedMesh[]>([]);
  const lastFill = useRef(new THREE.Vector3(Infinity, Infinity, Infinity));

  useEffect(() => {
    const g = grp.current; if (!g) return;
    while (g.children.length) { const c = g.children[0] as THREE.InstancedMesh; g.remove(c); c.dispose?.(); }
    const cap = Math.min(list.length, DRAW_CAP);
    meshes.current = model.subs.map((sub) => {
      const im = new THREE.InstancedMesh(sub.geo, sub.mat, cap);
      im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
      im.count = 0;
      g.add(im);
      return im;
    });
    lastFill.current.set(Infinity, Infinity, Infinity);   // force a fill on the next frame
  }, [model, list]);

  const obj = useMemo(() => new THREE.Matrix4(), []);
  const out = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const eul = useMemo(() => new THREE.Euler(), []);
  const vpos = useMemo(() => new THREE.Vector3(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera }) => {
    const ims = meshes.current;
    if (!ims.length) return;
    if (camera.position.distanceTo(lastFill.current) < REFILL_MOVE_M) return;
    lastFill.current.copy(camera.position);

    const cap = ims[0].instanceMatrix.count;
    let n = 0;
    for (let i = 0; i < list.length && n < cap; i++) {
      const inst = list[i];
      const dx = inst.x - camera.position.x, dz = inst.z - camera.position.z;
      const maxD = LOD_BASE_M + inst.height * LOD_PER_HEIGHT;
      if (dx * dx + dz * dz > maxD * maxD) continue;   // too far for something this size
      const u = inst.height / model.modelH;
      eul.set(inst.tiltX, inst.yaw, inst.tiltZ, 'YXZ');
      q.setFromEuler(eul);
      vpos.set(inst.x, inst.y, inst.z);
      scl.set(u * inst.stretchX, u * inst.stretchY, u * inst.stretchZ);
      obj.compose(vpos, q, scl);
      for (let m = 0; m < ims.length; m++) {
        out.multiplyMatrices(obj, model.subs[m].local);   // bake the sub-mesh's local transform in
        ims[m].setMatrixAt(n, out);
      }
      n++;
    }
    for (const im of ims) { im.count = n; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
  });

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
