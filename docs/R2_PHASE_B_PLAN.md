# R2 Migration — Phase B Plan (finish the one-asset-system)

**Status:** planned, not started. Launch when no other Claude window is editing `src/components/siege/`.
**Prereq:** Phase A done & live (siege/scifi → R2, `assets.dreadroot.com`, dist 25,421 → 2,559 files).

---

## 1. Goal / North Star

ONE asset system. ALL 3D models + their textures served from **R2 (`assets.dreadroot.com`)**.
Cloudflare Pages hosts only app code + tiny config (draco decoder, item-sprites, sounds).
No second storage path = no tech debt. R2 is a plain CDN, orthogonal to the future Cloudflare
Durable Objects architecture (DO holds game state, not static models), so this is forward-compatible.

## 2. What still lives on Pages (the Phase-B scope)

| Folder | Files | Loaded by | Mechanism |
|---|---|---|---|
| `public/siege/world` | 1,512 | WorldObjectsLayer | `useGLTF` + runtime `TextureLoader` (material_map → `/siege/tex/<md5>`) |
| `public/siege/buildings` | 163 | BuildingLayer | `useGLTF` + `fetch` placements.json |
| `public/siege/tex` | 115 | WorldObjectsLayer | `TextureLoader` (md5-named runtime textures) |
| `public/siege/monsters` | 69 | monster components | `useGLTF` |
| `public/siege/characters` | 42 | SiegeCharacter / avatar | `useGLTF` |
| `public/siege/props` | 29 | PropLayer | `useGLTF` + `fetch` placements.json |
| `public/siege/scifi_demo` | 20 | DemoScene (city/space/adventure) | `useGLTF` — **`.gltf`+`.bin`+webp**, not `.glb` |
| `public/siege/terrain` | 19 | TerrainLayer | `fetch` manifest.json + binary tiles + grass.png |
| `public/siege/atlas`,`vfx`,`apoc` | ~15 | misc | mixed |
| `public/GLB Models All` | 96 | **nothing — zero code refs** | unused dev dump? |

Total: **~1,985 siege files + 96 unreferenced.**

## 3. Key architectural decision — ONE URL interceptor, not 49 file edits

> **DECIDED (2026-Jun-25):** the URL interceptor is the **permanent** solution — NOT a temporary
> hack, and there is **no Phase C cleanup**. `setURLModifier` is the canonical three.js CDN-redirect
> API: one source of truth, impossible for future loaders to forget. The "explicit per-loader path
> helper across 49 files" alternative was considered and rejected as *more* fragile (49 touch points,
> silent breakage if a new loader forgets the helper), not cleaner.

49 source files hardcode `/siege/...` paths. Editing each is error-prone and collides badly with the
co-build window. **But ~45 of them are three.js asset loads** (`useGLTF`, `TextureLoader`), which all
route through `THREE.DefaultLoadingManager`. So we redirect them with **one** install:

- **Mechanism A — three.js loads (models + runtime textures):** install
  `THREE.DefaultLoadingManager.setURLModifier(url => url starts with '/siege/' ? ASSET_BASE+url : url)`
  ONCE at app entry. Transparently redirects every `useGLTF` + `TextureLoader` fetch to R2. Zero
  per-component edits. Strictly gated to `/siege/` so nothing else is touched; `/draco/` (decoder)
  stays on Pages.
- **Mechanism B — raw `fetch()` JSON/binary manifests:** these bypass the loader, so they need a
  `siegeData()` helper. Only **4 files / ~10 call sites**:
  - `PropLayer.tsx` → `/siege/placements.json`
  - `BuildingLayer.tsx` → `/siege/buildings/placements.json`
  - `WorldObjectsLayer.tsx` → `atlas_map.json`, `material_map.json`, `cutout_textures.json`, `collider_overrides.json`, `placements.json` (all `${dataDir}` = `/siege/world`)
  - `TerrainLayer.tsx` → `manifest.json` + binary terrain tiles

**Net code footprint: ~6 files** (1 new redirect module + assetBase helper + 4 fetch files) instead of 49.
This is the single biggest de-risk vs Phase A and the main reason to do it this way.

## 4. Steps

### B0 — Pre-flight
- `git fetch`; confirm working tree has no other window's mid-edit on the files we touch. Sync version.ts.
- Record baseline: `find dist -type f | wc -l` and a working game (screenshot the fortress + a monster).

### B1 — Resolve `GLB Models All` (96 files)
- grep confirms **zero references**. Confirm with Geoff: almost certainly a dev dump → **archive locally + remove from `public/`** (no R2 needed, 96 files gone). If it's a future library, move to R2 instead.

### B2 — Stage + upload assets to R2 (preserve `/siege/<sub>/` paths)
- Most siege assets are already `.glb` (embedded textures) → straight copy, same paths.
- **Exception — `scifi_demo` 3 baked scenes** are `.gltf`+`.bin`+external `.webp`. Merge each to `.glb`
  (reuse `scripts/gltf2glb.mjs`) so the loader needs no relative-path resolution under the redirect.
  Update the 3 `DemoScene` filenames `.gltf`→`.glb` (or let `scifiAsset`-style mapping handle it).
- `terrain` binary tiles + `grass.png` + `manifest.json` copy as-is (served via `siegeData`/redirect).
- Upload via `rclone` (config `/tmp/rclone-r2.conf`, bucket `dreadroot-assets`) preserving the `siege/` prefix.
- Verify: source count == R2 count; sample 200s on `assets.dreadroot.com/siege/world/...`, `/monsters/...`, `/tex/<md5>`.

### B3 — Code: install interceptor + helper
- New `src/config/siegeAssetRedirect.ts`: idempotent `installSiegeAssetRedirect()` that sets the
  DefaultLoadingManager URL modifier (`/siege/` and, if kept, `/GLB Models All/` → `ASSET_BASE+path`).
  Keep any `?v=APP_VERSION` query (R2 ignores unknown query params).
- Call it once at app entry (`main.tsx`/`App`) **before** any Canvas mounts.
- Add `siegeData(path)` to `assetBase.ts` (passthrough to `ASSET_BASE + path`).

### B4 — Code: repoint the 4 fetch files
- Wrap the ~10 `fetch('/siege/...')` sites in `PropLayer`, `BuildingLayer`, `WorldObjectsLayer`,
  `TerrainLayer` with `siegeData(...)`.

### B5 — Local verification (CRITICAL — these are gameplay assets)
- **Force R2:** temporarily rename `public/siege` aside so the dev build *cannot* fall back to Pages.
- `npm run build` + serve `dist`; load the game and verify, watching console for 404s:
  - central fortress world renders **and is textured** (material_map path);
  - monsters spawn + textured; avatar/characters render + animate;
  - buildings, props, terrain (heightmap + grass), the 3 demo scenes (city/space/adventure).
- Run `props/regression_check.py` against the world baseline (placements/material_map parity).

### B6 — Remove from build + deploy
- Move `public/siege` out of the repo → `~/dreadroot-asset-archive/siege-rest`; `git rm`.
- Handle `GLB Models All` per B1.
- `npm run build` → dist should drop to **~500 files**. `tsc --noEmit`.
- Deploy via `wrangler pages deploy ./dist`; verify live (version + assets load from R2 + game plays).
- Commit + push (token-URL method; bump version; coordinate with co-build window).

### B7 — Close out
- Update `assetBase.ts` header comment (now covers ALL siege assets).
- Update memory `reference_dreadroot_r2_assets`: Phase B done, single asset system achieved.

## 5. Risks & mitigations

- **Gameplay-critical assets break** → B5 forced-R2 local test + regression guard before any deploy. Local archive = instant rollback.
- **Co-build collision** → run in a quiet window; interceptor approach limits the edit to ~6 files (not 49), shrinking conflict surface.
- **material_map md5 textures** → confirm `TextureLoader` urls begin `/siege/tex/` so the redirect catches them (verify in B5).
- **`.gltf` demo relative resolution** → sidestepped by merging demos to `.glb` in B2.
- **CORS** → already `*`/GET-HEAD on the bucket from Phase A; same paths, no change.
- **Cache-bust `?v=`** → R2 ignores unknown query params; verify one `...glb?v=` returns 200.

## 6. Outcome

dist ~500 files · all 3D models + textures on R2 · Pages = app only · one system, zero asset tech debt.
