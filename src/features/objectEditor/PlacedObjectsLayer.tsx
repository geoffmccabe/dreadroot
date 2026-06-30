// Game-agnostic render layer for placed objects. Mounted by BOTH games (DreadRoot in
// FortressScene, Siege in SiegeWorldLayers) with the current worldId. On enter it loads
// that world's objects from Supabase into the editor store and renders each one; the
// selected object gets a cyan bounding-box highlight. A 'builtin:box' url renders a
// primitive (used by the Phase-0 test object) so the spine needs no art asset.
import { Suspense, useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { getActiveGame } from '@/config/activeGame';
import { scifiAsset } from '@/config/assetBase';
import type { WorldObject } from './types';
import { setContext, setCanEdit, useEditorObjects } from './store';
import { loadObjects, loadCanEdit } from './persistence';
import { setWorldOverrides, loadWorldFromDb } from './bakedOverrides';

// Selection feedback is drawn by SelectionHighlight (a pulsing world-space box), so these just
// render the model + tag it with its id for picking.
function tag(o: THREE.Object3D, id: string) { o.traverse((c) => { c.userData.worldObjectId = id; }); }

function BuiltinObject({ obj }: { obj: WorldObject }) {
  return (
    <group position={obj.pos} quaternion={obj.quat} scale={obj.scale} userData={{ worldObjectId: obj.id }}>
      <mesh userData={{ worldObjectId: obj.id }}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ff8c2b" />
      </mesh>
    </group>
  );
}

function GltfObject({ obj }: { obj: WorldObject }) {
  // Catalog files resolve through scifiAsset; absolute urls pass through.
  const url = obj.modelUrl.startsWith('http') ? obj.modelUrl : scifiAsset(obj.modelUrl);
  const { scene } = useGLTF(url, '/draco/');
  const cloned = useMemo(() => { const c = scene.clone(true); tag(c, obj.id); return c; }, [scene, obj.id]);
  return (
    <group position={obj.pos} quaternion={obj.quat} scale={obj.scale} userData={{ worldObjectId: obj.id }}>
      <primitive object={cloned} />
    </group>
  );
}

export function PlacedObjectsLayer({ worldId }: { worldId: string }) {
  const objects = useEditorObjects();

  useEffect(() => {
    let alive = true;
    const game = getActiveGame();
    setWorldOverrides(worldId);   // instant localStorage seed before the batch layer builds
    loadWorldFromDb(game, worldId).catch(() => {});   // then merge the shared published history
    setContext(game, worldId, []);
    loadObjects(game, worldId).then((objs) => { if (alive) setContext(game, worldId, objs); }).catch(() => {});
    loadCanEdit().then((v) => { if (alive) setCanEdit(v); }).catch(() => {});
    return () => { alive = false; };
  }, [worldId]);

  return (
    <Suspense fallback={null}>
      {objects.filter((o) => !o.baked && !o.external).map((o) => (
        o.modelUrl.startsWith('builtin:')
          ? <BuiltinObject key={o.id} obj={o} />
          : <GltfObject key={o.id} obj={o} />
      ))}
    </Suspense>
  );
}
