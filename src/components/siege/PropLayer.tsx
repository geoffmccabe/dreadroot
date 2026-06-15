// PropLayer — renders the Siege Worlds scenery from the exported placement data.
//
// Reads /siege/placements.json (mesh groups + positions, centered on origin),
// loads each converted glTF once, and draws every placement as a single
// InstancedMesh per sub-mesh — so ~39k objects stay cheap. For slice 1b props
// sit on the flat ground (y = surfaceY); real terrain height comes with the
// terrain swap. Wind sway (for `sway: 'wind'` groups) is a follow-up.

import { useEffect, useMemo, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

interface PropGroup {
  mesh: string;
  url: string;
  sway: 'none' | 'wind';
  positions: [number, number][];
}
interface Placements {
  center: [number, number];
  props: PropGroup[];
}

// Golden-angle yaw per instance → natural variety without Math.random.
const GOLDEN = 2.399963229728653;

function PropInstances({ url, positions, surfaceY }: { url: string; positions: [number, number][]; surfaceY: number }) {
  const gltf = useGLTF(url);

  const group = useMemo(() => {
    const out = new THREE.Group();
    const srcMeshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) srcMeshes.push(o as THREE.Mesh);
    });

    const m = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);

    for (const src of srcMeshes) {
      src.updateWorldMatrix(true, false);
      local.copy(src.matrixWorld); // sub-mesh transform within the model
      const inst = new THREE.InstancedMesh(src.geometry, src.material, positions.length);
      inst.frustumCulled = true;
      for (let i = 0; i < positions.length; i++) {
        const [x, z] = positions[i];
        e.set(0, (i * GOLDEN) % (Math.PI * 2), 0);
        q.setFromEuler(e);
        pos.set(x, surfaceY, z);
        m.compose(pos, q, one).multiply(local);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      out.add(inst);
    }
    return out;
  }, [gltf, positions, surfaceY]);

  return <primitive object={group} />;
}

export function PropLayer({ surfaceY = 0 }: { surfaceY?: number }) {
  const [data, setData] = useState<Placements | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/siege/placements.json')
      .then((r) => r.json())
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!data) return null;
  return (
    <>
      {data.props.map((p) => (
        <PropInstances key={p.mesh} url={p.url} positions={p.positions} surfaceY={surfaceY} />
      ))}
    </>
  );
}
