// BuildingLayer — places the real SiegeWorldsMap structures/props. Reads
// /siege/buildings/placements.json (per-model list of world matrices, extracted
// from the scene's 516 prefab instances), loads each converted glTF once, and
// instances it at those matrices. Composite buildings come through as several
// mesh groups sharing the same world transforms.

import { Component, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// DIAGNOSTIC: pulse all objects 0.01x..100x so wrong-scaled/invisible ones become visible.
const PULSE = false;

interface Group { mesh: string; url: string; matrices: number[][] } // matrices = column-major mat4
interface Placements { props: Group[] }

// Isolates a single mesh's load failure so one bad/missing glb can't crash the app.
class MeshBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

function BuildingInstances({ url, matrices }: { url: string; matrices: number[][] }) {
  const gltf = useGLTF(url);

  // build instanced meshes + remember each instance's base matrix (for the pulse)
  const built = useMemo(() => {
    const items: { inst: THREE.InstancedMesh; bases: THREE.Matrix4[] }[] = [];
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const world = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const out4 = new THREE.Matrix4();
    for (const src of meshes) {
      src.updateWorldMatrix(true, false);
      local.copy(src.matrixWorld);
      const mats = Array.isArray(src.material) ? src.material : [src.material];
      mats.forEach((m) => { (m as THREE.Material).side = THREE.DoubleSide; });
      const inst = new THREE.InstancedMesh(src.geometry, src.material, matrices.length);
      inst.frustumCulled = false; // never cull — they may be huge or far while diagnosing
      const bases: THREE.Matrix4[] = [];
      for (let i = 0; i < matrices.length; i++) {
        world.fromArray(matrices[i]);
        out4.multiplyMatrices(world, local);
        inst.setMatrixAt(i, out4);
        bases.push(out4.clone());
      }
      inst.instanceMatrix.needsUpdate = true;
      items.push({ inst, bases });
    }
    return items;
  }, [gltf, matrices]);

  const tmp = useRef(new THREE.Matrix4());
  const sv = useRef(new THREE.Vector3());
  useFrame((state) => {
    if (!PULSE) return;
    const f = Math.pow(100, Math.sin(state.clock.elapsedTime * 1.2)); // 0.01x .. 100x
    sv.current.set(f, f, f);
    for (const { inst, bases } of built) {
      for (let i = 0; i < bases.length; i++) {
        tmp.current.copy(bases[i]).scale(sv.current);
        inst.setMatrixAt(i, tmp.current);
      }
      inst.instanceMatrix.needsUpdate = true;
    }
  });

  return <>{built.map((it, i) => <primitive key={i} object={it.inst} />)}</>;
}

export function BuildingLayer() {
  const [data, setData] = useState<Placements | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/siege/buildings/placements.json')
      .then((r) => r.json())
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data) return null;
  return (
    <>
      {data.props.map((p) => (
        <MeshBoundary key={p.mesh}>
          <Suspense fallback={null}>
            <BuildingInstances url={p.url} matrices={p.matrices} />
          </Suspense>
        </MeshBoundary>
      ))}
    </>
  );
}
