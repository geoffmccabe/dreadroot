// BuilderObjectsLayer — renders every placed object for the active builder map and loads the
// map's saved placements on enter. The catalog glbs already carry baked textures, so each is just
// cloned and transformed (no runtime atlas mapping like the SWW WorldObjectsLayer). The selected
// object gets a cyan bounding-box highlight. Draco-compressed glbs decode via the local /draco/.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF, useHelper } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { applyVineWind, vineTime } from '../vineWind';
import { useActiveMapId } from '@/config/activeMap';
import { loadMap } from '../terrain/mapPersistence';
import { useBuilder, setObjects, type PlacedObject } from './builderObjectsState';
import { scifiAsset } from '@/config/assetBase';
import { registerMeshGeometry, setGroupInstances, clearGroup, type MeshInstanceInput } from '../meshColliderSystem';

// Absolute paths (local /siege/imports imports, or full URLs) load directly; catalog file ids go
// through the R2 scifi resolver.
const resolveModel = (file: string) => (file.startsWith('/') || file.startsWith('http') ? file : scifiAsset(file));

// Force materials opaque + double-sided so imported models (esp. mushrooms) don't flicker/vanish by
// angle from alpha-blend depth sorting — same treatment as the Builder Sandbox display mushrooms.
function makeSolid(mat: THREE.Material): void {
  const m = mat as THREE.MeshStandardMaterial;
  m.side = THREE.DoubleSide; m.transparent = false; m.depthWrite = true; m.alphaTest = 0;
  if ('opacity' in m) m.opacity = 1;
  m.needsUpdate = true;
}

function PlacedModel({ obj, selected }: { obj: PlacedObject; selected: boolean }) {
  const { scene } = useGLTF(resolveModel(obj.file), '/draco/');
  const grp = useRef<THREE.Group>(null);
  // Highlight the selected object's bounds (null disables the helper).
  useHelper(selected ? (grp as React.MutableRefObject<THREE.Object3D>) : null, THREE.BoxHelper, 0x6cf0ff);
  const cloned = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      m.userData.builderId = obj.id;
      if (m.isMesh && m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(makeSolid);
    });
    applyVineWind(c);   // slow wind sway on any hanging vines (mushroomtree05/06)
    return c;
  }, [scene, obj.id]);
  // Register this placed object's real shape as a walk-on BVH collider (active only on maps with
  // meshColliders on, e.g. Bleakrock 2). Re-runs when it's moved/rotated/scaled; cleared on delete.
  const gid = `builder:${obj.id}`;
  const [px, py, pz] = obj.pos;
  useEffect(() => {
    if (obj.noCollider) return;   // accepted procedural forests skip BVH (perf) — still editable
    const g = grp.current; if (!g) return;
    g.updateWorldMatrix(true, true);
    const inputs: MeshInstanceInput[] = [];
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const geo = m.geometry as THREE.BufferGeometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      registerMeshGeometry(gid, geo.uuid, geo, 1);
      inputs.push({ key: geo.uuid, matrix: m.matrixWorld.clone(), geoBox: geo.boundingBox as THREE.Box3 });
    });
    setGroupInstances(gid, inputs);
    return () => clearGroup(gid);
  }, [cloned, gid, px, py, pz, obj.rotY, obj.scale, obj.noCollider]);
  return (
    <group ref={grp} position={obj.pos} rotation={[obj.tiltX ?? 0, obj.rotY, obj.tiltZ ?? 0]}
      scale={[obj.scale * (obj.sx ?? 1), obj.scale * (obj.sy ?? 1), obj.scale * (obj.sz ?? 1)]} userData={{ builderId: obj.id }}>
      <primitive object={cloned} />
    </group>
  );
}

export function BuilderObjectsLayer() {
  const mapId = useActiveMapId();
  const { objects, selectedId } = useBuilder();
  useFrame((s) => { vineTime.value = s.clock.elapsedTime; });   // drive the vine-wind sway

  // Load this map's saved placements on enter; clear first so objects never bleed across maps.
  useEffect(() => {
    let alive = true;
    setObjects([]);
    loadMap(mapId).then((saved) => { if (alive && saved?.objects?.length) setObjects(saved.objects); }).catch(() => {});
    return () => { alive = false; };
  }, [mapId]);

  return (
    <Suspense fallback={null}>
      {objects.map((o) => (
        <PlacedModel key={o.id} obj={o} selected={o.id === selectedId} />
      ))}
    </Suspense>
  );
}
