// CityDemo — the fully-baked Synty "SciFi City" demo scene (the whole assembled city,
// 1866 meshes) loaded as ONE glb, grounded at real 1:1 scale. Player collision uses the
// existing SWW BVH mesh-collider system, built in the BACKGROUND via the budgeted work
// queue so entering the map never freezes (1866 BVH builds spread over frames). Lives on
// its own 'city-demo' map (teleport slot 0) so Starblink stays a blank builder canvas.

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { sampleHeight } from '../terrainHeight';
import { enqueueJob } from '@/lib/budgetedWork';
import {
  registerMeshGeometry, setGroupInstances, clearGroup, clearMeshColliders,
  setMeshCollidersEnabled, type MeshInstanceInput,
} from '../meshColliderSystem';

const GROUP = 'citydemo';
const COLLIDER_RATIO = 0.5;   // decimate collider geometry to half (BVH is for blocking, not pixels)
const PER_JOB = 40;           // meshes registered per budgeted tick

// Draco-compressed (51MB→9MB to fit Cloudflare's 25MB/file limit); decode via local /draco/.
export function CityDemo() {
  const { scene } = useGLTF('/siege/scifi_demo/city_demo.gltf', '/draco/');

  const root = useMemo(() => {
    const model = scene.clone(true);
    // Ground the whole scene so its lowest point sits on the terrain at the map origin.
    const box = new THREE.Box3().setFromObject(model);
    const ground = sampleHeight(0, 0) ?? 0;
    const wrap = new THREE.Group();
    wrap.add(model);
    wrap.position.set(0, ground - box.min.y, 0);
    wrap.updateMatrixWorld(true);
    return wrap;
  }, [scene]);

  useEffect(() => {
    // Collect every mesh + its world matrix, then register BVH colliders in the background.
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });

    let i = 0;
    const inputs: MeshInstanceInput[] = [];
    enqueueJob('citydemo_colliders', () => {
      const end = Math.min(i + PER_JOB, meshes.length);
      for (; i < end; i++) {
        const m = meshes[i];
        const geo = m.geometry as THREE.BufferGeometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const key = `citydemo_${i}`;
        registerMeshGeometry('citydemo', key, geo, COLLIDER_RATIO);
        inputs.push({ key, matrix: m.matrixWorld.clone(), geoBox: geo.boundingBox!.clone() });
      }
      if (i >= meshes.length) {
        setGroupInstances(GROUP, inputs);
        setMeshCollidersEnabled(true);
        return true;   // done
      }
      return false;    // keep going next frame
    });

    return () => {
      clearGroup(GROUP);
      clearMeshColliders();
      setMeshCollidersEnabled(false);
    };
  }, [root]);

  return <primitive object={root} />;
}

useGLTF.preload('/siege/scifi_demo/city_demo.gltf', '/draco/');
