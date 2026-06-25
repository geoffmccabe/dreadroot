// assetBase — where the large 3D asset library (the Synty builder/sampler catalog under
// `siege/scifi`) is served from. These ~11k models live in R2 (CDN), NOT in the Pages deploy,
// which has a hard 20,000-files-per-deployment cap. Pages hosts only the app + gameplay-critical
// assets. ONE place to change the host — swap to the custom domain once it's connected.
//
// glTF+bin pairs were merged to single .glb files on R2 (one request instead of two), so a `.gltf`
// filename — including ones stored inside saved maps and the sampler/catalog manifests — resolves
// to its `.glb`. Other extensions (.webp textures, .json manifests) pass through unchanged; textures
// referenced inside a .glb resolve automatically (relative URI against the .glb's R2 URL).

// R2 custom domain (production-grade, no rate limit). The r2.dev URL is rate-limited and only
// for testing; this CNAMEs the dreadroot-assets bucket via Cloudflare CDN.
export const ASSET_BASE = 'https://assets.dreadroot.com';

/** R2 URL for a siege/scifi MODEL (maps a .gltf name to its merged .glb). */
export function scifiAsset(file: string): string {
  return `${ASSET_BASE}/siege/scifi/${file.replace(/\.gltf$/i, '.glb')}`;
}

/** R2 URL for a siege/scifi DATA file (sampler/catalog .json) — no extension change. */
export function scifiData(file: string): string {
  return `${ASSET_BASE}/siege/scifi/${file}`;
}
