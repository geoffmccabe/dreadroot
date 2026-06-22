// DemoScene — a fully-baked Synty demo scene (City, Space, …) loaded as ONE glb, grounded
// at real 1:1 scale, with player collision via the SWW BVH mesh-collider system, built in
// the BACKGROUND on the budgeted work queue so entering never freezes. Backdrop/decor meshes
// (planet/sky/background/hologram/billboard/neon/glass) are excluded from collision so they
// don't become giant invisible walls. Each demo lives on its own map (letter teleport).

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { sampleHeight } from '../terrainHeight';
import { enqueueJob } from '@/lib/budgetedWork';
import {
  registerMeshGeometry, setGroupInstances, clearGroup, clearMeshColliders,
  setMeshCollidersEnabled, type MeshInstanceInput,
} from '../meshColliderSystem';

// FULL-fidelity colliders (no decimation). Decimating thin street tiles pulled their edges
// inward, leaving seam GAPS you fall through (the render mesh stays full-res so no visible
// hole). Full-res BVH costs more triangles but is built in the background; correctness wins.
const COLLIDER_RATIO = 1.0;
const PER_JOB = 40;           // meshes registered per budgeted tick
const SKIP = /planet|background|bkgrnd|sky|hologram|billboard|neon|glass|emissive/;

export function DemoScene({ file, group, scale = 1 }: { file: string; group: string; scale?: number }) {
  // Draco-compressed (to fit Cloudflare's 25MB/file limit); decode via local /draco/.
  const { scene } = useGLTF(`/siege/scifi_demo/${file}`, '/draco/');

  const root = useMemo(() => {
    const model = scene.clone(true);
    if (scale !== 1) model.scale.setScalar(scale);   // huge scenes (Space ~10km) shrink to view
    model.updateMatrixWorld(true);
    // Ground/recenter using ONLY solid meshes — backdrop spheres (sky/planets) can be
    // tens of km across, and including them would catapult the real content into the sky
    // (the Space scene's bug). Center the solid content on the spawn and sit it on ground.
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const matName = mats.map((x) => (x as THREE.Material)?.name ?? '').join(',').toLowerCase();
      if (SKIP.test(matName) || SKIP.test((m.name ?? '').toLowerCase())) return;
      tmp.setFromObject(m);
      if (!tmp.isEmpty()) box.union(tmp);
    });
    if (box.isEmpty()) box.setFromObject(model);   // fallback: all meshes
    const ground = sampleHeight(0, 0) ?? 0;
    const c = box.getCenter(new THREE.Vector3());
    const wrap = new THREE.Group();
    wrap.add(model);
    wrap.position.set(-c.x, ground - box.min.y, -c.z);
    wrap.updateMatrixWorld(true);
    return wrap;
  }, [scene, scale]);

  useEffect(() => {
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const matName = mats.map((x) => (x as THREE.Material)?.name ?? '').join(',').toLowerCase();
      if (SKIP.test(matName) || SKIP.test((m.name ?? '').toLowerCase())) return;
      meshes.push(m);
    });

    let i = 0;
    const inputs: MeshInstanceInput[] = [];
    enqueueJob(`demo_colliders_${group}`, () => {
      const end = Math.min(i + PER_JOB, meshes.length);
      for (; i < end; i++) {
        const m = meshes[i];
        const geo = m.geometry as THREE.BufferGeometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const key = `${group}_${i}`;
        registerMeshGeometry(group, key, geo, COLLIDER_RATIO);
        inputs.push({ key, matrix: m.matrixWorld.clone(), geoBox: geo.boundingBox!.clone() });
      }
      if (i >= meshes.length) {
        setGroupInstances(group, inputs);
        setMeshCollidersEnabled(true);
        return true;
      }
      return false;
    });

    return () => {
      clearGroup(group);
      clearMeshColliders();
      setMeshCollidersEnabled(false);
    };
  }, [root, group]);

  return <primitive object={root} />;
}

useGLTF.preload('/siege/scifi_demo/city_demo.gltf', '/draco/');
useGLTF.preload('/siege/scifi_demo/space_demo.gltf', '/draco/');
useGLTF.preload('/siege/scifi_demo/adventure_demo.gltf', '/draco/');
