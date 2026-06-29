// siegeWorldPreload — warm the SWW world's models DURING the homescreen (BEFORE the player clicks
// START). The game canvas only mounts on START, so the world's terrain + ~1600 model files otherwise
// can't begin loading until then. This kicks the fetch/decode off early (it runs from the pre-START
// orchestrator) so they're already in drei's useGLTF cache + the HTTP/IndexedDB cache when the canvas
// mounts. It mounts nothing and only primes caches — fully safe, no scene/input runs early.
import { useGLTF } from '@react-three/drei';
import { scifiAsset } from '@/config/assetBase';

// Mirror WorldObjectsLayer.resolveModelUrl so preloaded URLs match the in-scene useGLTF(url,'/draco/').
const resolveModelUrl = (url: string): string =>
  url.startsWith('/siege/scifi/') ? scifiAsset(url.slice('/siege/scifi/'.length)) : url;

let started = false;
export function preloadSiegeWorld(dataDir = '/siege/world'): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  // Models — the bulk of the load. Preload in small batches so we don't open ~1600 connections at
  // once (which would just thrash the browser's connection pool).
  fetch(`${dataDir}/placements.json`)
    .then((r) => r.json())
    .then((data: { groups?: { url: string }[] }) => {
      const urls = Array.from(new Set((data.groups ?? []).map((g) => resolveModelUrl(g.url))));
      let i = 0;
      const pump = () => {
        for (let n = 0; n < 8 && i < urls.length; n++, i++) {
          try { useGLTF.preload(urls[i], '/draco/'); } catch { /* ignore a bad url */ }
        }
        if (i < urls.length) setTimeout(pump, 60);
      };
      pump();
    })
    .catch(() => {});

  // Terrain heightfield tiles — warms the HTTP + IndexedDB byte cache TerrainLayer reads.
  fetch('/siege/terrain/manifest.json')
    .then((r) => r.json())
    .then((m: { tiles?: { file: string }[] }) => {
      for (const t of m.tiles ?? []) fetch(`/siege/terrain/${t.file}`).catch(() => {});
    })
    .catch(() => {});
}
