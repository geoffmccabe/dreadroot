// BuilderObjectsLayer — renders every placed object for the active builder map and loads the
// map's saved placements on enter. The catalog glbs already carry baked textures, so each is just
// cloned and transformed (no runtime atlas mapping like the SWW WorldObjectsLayer). The selected
// object gets a cyan bounding-box highlight. Draco-compressed glbs decode via the local /draco/.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF, useHelper } from '@react-three/drei';
import * as THREE from 'three';
import { useActiveMapId } from '@/config/activeMap';
import { loadMap } from '../terrain/mapPersistence';
import { useBuilder, setObjects, type PlacedObject } from './builderObjectsState';
import { scifiAsset } from '@/config/assetBase';

function PlacedModel({ obj, selected }: { obj: PlacedObject; selected: boolean }) {
  const { scene } = useGLTF(scifiAsset(obj.file), '/draco/');
  const grp = useRef<THREE.Group>(null);
  // Highlight the selected object's bounds (null disables the helper).
  useHelper(selected ? (grp as React.MutableRefObject<THREE.Object3D>) : null, THREE.BoxHelper, 0x6cf0ff);
  const cloned = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => { (o as THREE.Mesh).userData.builderId = obj.id; });
    return c;
  }, [scene, obj.id]);
  return (
    <group ref={grp} position={obj.pos} rotation={[0, obj.rotY, 0]} scale={obj.scale} userData={{ builderId: obj.id }}>
      <primitive object={cloned} />
    </group>
  );
}

export function BuilderObjectsLayer() {
  const mapId = useActiveMapId();
  const { objects, selectedId } = useBuilder();

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
