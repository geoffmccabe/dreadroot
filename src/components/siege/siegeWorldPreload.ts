// siegeWorldPreload — warm the SWW world's LIGHTWEIGHT data during the homescreen (before START):
// the placement list + the terrain heightfield tiles, so they're already fetched when the canvas
// mounts.
//
// It deliberately does NOT preload the model .glb files. Only ~150 of the world's ~1300 models are
// near the spawn and actually render, so blanket-preloading them all wasted ~9× the work, DRACO-
// decoded EVERYTHING on every load (which defeated the geometry cache), and starved the placements
// fetch. The near models now load on demand through the incremental world build, which uses the
// IndexedDB geometry cache to skip DRACO on repeat visits.

let started = false;
export function preloadSiegeWorld(dataDir = '/siege/world'): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  // Placement list (small JSON) — warms the HTTP cache so the in-scene fetch is instant.
  fetch(`${dataDir}/placements.json`).catch(() => {});
  // Terrain heightfield tiles — warms the HTTP + IndexedDB byte cache TerrainLayer reads.
  fetch('/siege/terrain/manifest.json')
    .then((r) => r.json())
    .then((m: { tiles?: { file: string }[] }) => {
      for (const t of m.tiles ?? []) fetch(`/siege/terrain/${t.file}`).catch(() => {});
    })
    .catch(() => {});
}
