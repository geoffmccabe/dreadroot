// Game-agnostic render layer for placed objects. Mounted by BOTH games (DreadRoot in
// FortressScene, Siege in SiegeWorldLayers) with the current worldId. On enter it loads
// that world's objects from Supabase into the editor store and renders each one; the
// selected object gets a cyan bounding-box highlight. A 'builtin:box' url renders a
// primitive (used by the Phase-0 test object) so the spine needs no art asset.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF, useHelper } from '@react-three/drei';
import * as THREE from 'three';
import { getActiveGame } from '@/config/activeGame';
import { scifiAsset } from '@/config/assetBase';
import type { WorldObject } from './types';
import { setContext, setCanEdit, useEditorObjects, useSelectedId } from './store';
import { loadObjects, loadCanEdit } from './persistence';
import { setWorldOverrides } from './bakedOverrides';

const HILITE = 0x6cf0ff;

function tag(o: THREE.Object3D, id: string) { o.traverse((c) => { c.userData.worldObjectId = id; }); }

function BuiltinObject({ obj, selected }: { obj: WorldObject; selected: boolean }) {
  const grp = useRef<THREE.Group>(null);
  useHelper(selected ? (grp as React.MutableRefObject<THREE.Object3D>) : null, THREE.BoxHelper, HILITE);
  return (
    <group ref={grp} position={obj.pos} quaternion={obj.quat} scale={obj.scale} userData={{ worldObjectId: obj.id }}>
      <mesh userData={{ worldObjectId: obj.id }}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ff8c2b" />
      </mesh>
    </group>
  );
}

function GltfObject({ obj, selected }: { obj: WorldObject; selected: boolean }) {
  // Catalog files resolve through scifiAsset; absolute urls pass through.
  const url = obj.modelUrl.startsWith('http') ? obj.modelUrl : scifiAsset(obj.modelUrl);
  const { scene } = useGLTF(url, '/draco/');
  const grp = useRef<THREE.Group>(null);
  useHelper(selected ? (grp as React.MutableRefObject<THREE.Object3D>) : null, THREE.BoxHelper, HILITE);
  const cloned = useMemo(() => { const c = scene.clone(true); tag(c, obj.id); return c; }, [scene, obj.id]);
  return (
    <group ref={grp} position={obj.pos} quaternion={obj.quat} scale={obj.scale} userData={{ worldObjectId: obj.id }}>
      <primitive object={cloned} />
    </group>
  );
}

export function PlacedObjectsLayer({ worldId }: { worldId: string }) {
  const objects = useEditorObjects();
  const selectedId = useSelectedId();

  useEffect(() => {
    let alive = true;
    const game = getActiveGame();
    setWorldOverrides(worldId);   // load this world's baked-instance edits before the batch layer builds
    setContext(game, worldId, []);
    loadObjects(game, worldId).then((objs) => { if (alive) setContext(game, worldId, objs); }).catch(() => {});
    loadCanEdit().then((v) => { if (alive) setCanEdit(v); }).catch(() => {});
    return () => { alive = false; };
  }, [worldId]);

  return (
    <Suspense fallback={null}>
      {objects.filter((o) => !o.baked).map((o) => (
        o.modelUrl.startsWith('builtin:')
          ? <BuiltinObject key={o.id} obj={o} selected={o.id === selectedId} />
          : <GltfObject key={o.id} obj={o} selected={o.id === selectedId} />
      ))}
    </Suspense>
  );
}
