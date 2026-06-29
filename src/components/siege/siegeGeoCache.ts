// siegeGeoCache — caches each world model's DECODED geometry in IndexedDB so repeat loads skip the
// DRACO decompression entirely. A perf trace proved DRACO decode (4 worker threads, hundreds of
// seconds of CPU on ~1600 compressed .glb models) is the single largest load cost — and it's redone
// every visit. We store the decoded geometry + per-mesh world transform + material names once; on the
// next visit we rebuild the model straight from the cache (no fetch, no DRACO).
//
// Scope: only the standard lobby/world path (trustMaterials=false), where materials are re-derived
// from the atlas anyway, so a name-only material placeholder reproduces the same look. Worlds that
// keep their original baked materials (trustMaterials) still decode normally.
import * as THREE from 'three';
import { swwCacheGet, swwCachePut, swwCacheKeys, serializeGeometry, deserializeGeometry, type SerGeo } from './siegeWorldCache';

interface CachedMesh { name: string; mat: number[]; geo: SerGeo; matNames: string[] }
type CachedScene = CachedMesh[];

// `index` = the START-OF-SESSION snapshot of which urls are cached. hasGeo() reads ONLY this, so a
// group's cached-vs-decode choice is fixed for the whole load — a url decoded THIS session won't flip
// to the cached path mid-load (which would race the async write). It takes effect on the NEXT visit.
const index = new Set<string>();
const written = new Set<string>();   // urls stored this session (dedupe puts)
let loadedKey: string | null = null;

export async function loadGeoIndex(worldKey: string): Promise<void> {
  if (loadedKey === worldKey) return;
  loadedKey = worldKey;
  index.clear();
  for (const k of await swwCacheKeys('geometry')) index.add(k);
}

export function hasGeo(url: string): boolean { return index.has(url); }

/** Serialize a decoded model's meshes (from gltf.scene) and store them (cold load). */
export function putGeo(url: string, meshes: THREE.Mesh[]): void {
  if (index.has(url) || written.has(url)) return;
  written.add(url);
  try {
    const scene: CachedScene = meshes.map((src) => {
      src.updateWorldMatrix(true, false);
      const mats = Array.isArray(src.material) ? src.material : [src.material];
      return {
        name: src.name,
        mat: src.matrixWorld.toArray(),
        geo: serializeGeometry(src.geometry as THREE.BufferGeometry),
        matNames: mats.map((m) => (m as THREE.Material).name || ''),
      };
    });
    void swwCachePut('geometry', url, scene);
  } catch { /* never let caching break the load */ }
}

const _placeholderTex = (() => { const t = new THREE.Texture(); return t; })();

/** Load + rebuild a model's meshes from the cache (warm load). Returns a flat Group whose mesh
 *  matrices ARE the original world matrices, so the existing GroupInstances build reads them
 *  identically. Returns null on a miss / any error (caller then shows nothing for that group). */
export async function getGeoGroup(url: string): Promise<THREE.Group | null> {
  try {
    const scene = await swwCacheGet<CachedScene>('geometry', url);
    if (!scene || !scene.length) return null;
    const g = new THREE.Group();
    for (const cm of scene) {
      const geo = deserializeGeometry(cm.geo);
      const mats = cm.matNames.map((nm) => { const m = new THREE.MeshStandardMaterial(); m.name = nm; m.emissiveMap = null; return m; });
      const mesh = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
      mesh.matrixAutoUpdate = false;          // keep the matrix we set (build calls updateWorldMatrix)
      mesh.matrix.fromArray(cm.mat);          // = original world matrix; no parent chain → matrixWorld == matrix
      mesh.name = cm.name;
      g.add(mesh);
    }
    void _placeholderTex;   // (reserved for emissive-map fidelity if ever needed)
    return g;
  } catch { return null; }
}
