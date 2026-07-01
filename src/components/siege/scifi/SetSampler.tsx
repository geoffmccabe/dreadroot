// SetSampler — an auto-arranged "showroom" for a COMPONENT-only Synty set (CyberCity, Mech,
// SciFi Worlds) that ships no baked scene. Reads /siege/scifi/_sampler_<set>.json (a curated
// spread of the set's models + dims) and lays them in a grid, grounded at real 1:1 scale,
// textured. Each model loads in its own Suspense so one failure can't blank the whole grid.

import { Component, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { sampleHeight } from '../terrainHeight';
import { scifiAsset, scifiData } from '@/config/assetBase';
import { assetCode, idFromFile, shortName } from './assetCode';
import { AssetGridLabels, type GridLabel } from './AssetGridLabels';

interface SamplerItem { file: string; w: number; h: number; d: number; category: string; }
interface SamplerManifest { set: string; cell: number; count: number; items: SamplerItem[]; }

// A catalog row (the full per-set model list the builder palette uses) carries the same size
// fields a sampler needs, so when a set has no curated `_sampler_<set>.json` we can synthesize a
// grid straight from `_catalog_<set>.json`. Some packs have 700–2300 models, so we take an
// even-spaced spread up to CATALOG_CAP (keeps the showroom light + varied across categories).
interface CatalogItem { file: string; w?: number; h?: number; d?: number; category?: string; }
const CATALOG_CAP = 140;
function manifestFromCatalog(set: string, cat: { items?: CatalogItem[] }): SamplerManifest {
  const all = (cat.items ?? []).filter((it) => it.file);
  const stride = Math.max(1, Math.ceil(all.length / CATALOG_CAP));
  const picked = all.filter((_, i) => i % stride === 0).slice(0, CATALOG_CAP);
  const items: SamplerItem[] = picked.map((it) => ({
    file: it.file, w: it.w ?? 1, h: it.h ?? 1, d: it.d ?? 1, category: it.category ?? 'misc',
  }));
  // Cell = biggest footprint among the chosen models (+20% gap), clamped so one giant building
  // can't blow the grid out to a sparse field, and small props still get breathing room.
  const foot = items.reduce((m, it) => Math.max(m, it.w, it.d), 1);
  const cell = Math.min(30, Math.max(3, Math.round(foot * 1.2)));
  return { set, cell, count: items.length, items };
}

// A single bad/corrupt model must NOT white-screen the whole map. This boundary swallows a
// failed model (and its Suspense throw) so the rest of the grid still renders.
class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* skip the broken model silently */ }
  render() { return this.state.failed ? null : this.props.children; }
}

function SamplerModel({ file, x, z }: { file: string; x: number; z: number }) {
  // '/draco/' so draco-compressed models (e.g. the big assembled mech) decode; plain
  // models ignore it.
  const { scene } = useGLTF(scifiAsset(file), '/draco/');
  const obj = useMemo(() => {
    const model = scene.clone(true);
    const id = file.replace(/\.gltf$/, '');
    // Tag every mesh with the asset id so the laser inspector reports WHICH model you flag.
    model.traverse((o) => { o.userData.fbx = id; });
    // CRITICAL: compute world matrices before measuring. Synty roots carry a 0.01 scale + 90° rotation;
    // on a freshly-cloned, never-rendered model the matrixWorlds are still identity, so setFromObject
    // would measure the mesh at raw CENTIMETRE scale → a huge wrong box that flings the model far off
    // screen (this is why the sampler grids looked empty).
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const ground = sampleHeight(x, z) ?? 0;
    // A model with corrupt/Infinite vertex bounds yields a non-finite box → a NaN/Inf position flings
    // its mesh to infinity = screen-filling white/grey flashing triangles. box.isEmpty() does NOT catch
    // non-finite bounds (NaN compares false), so check finiteness explicitly and fall back to ground.
    const okBox = !box.isEmpty() && Number.isFinite(box.min.y) && Number.isFinite(box.max.y);
    model.position.y = okBox ? ground - box.min.y : ground;               // lowest point on the ground
    const wrap = new THREE.Group();
    wrap.add(model);
    wrap.position.set(x, 0, z);
    return wrap;
  }, [scene, x, z]);
  return <primitive object={obj} />;
}

export function SetSampler({ set }: { set: string }) {
  const [manifest, setManifest] = useState<SamplerManifest | null>(null);
  useEffect(() => {
    let alive = true;
    // Manifest lookup: try the Pages copy first (small JSON committed to public/siege/scifi — e.g. the
    // "Various 2" grids like mining, whose manifests aren't on R2), then fall back to R2 where the
    // sci-fi/nature set manifests live. Pages serves the SPA index.html for a missing file, so .json()
    // throws on the HTML and we fall through to R2. Models still load from R2 regardless.
    const getJson = (url: string) => fetch(url).then((r) => r.json());
    getJson(`/siege/scifi/_sampler_${set}.json`)
      .catch(() => getJson(scifiData(`_sampler_${set}.json`)))
      // No curated sampler for this set → synthesize a grid from the full model catalog so the
      // pack still shows its assets (fixes the packs whose `_sampler_*.json` was never generated).
      .catch(() => getJson(scifiData(`_catalog_${set}.json`)).then((c) => manifestFromCatalog(set, c)))
      .then((m) => { if (alive) setManifest(m); })
      .catch(() => { /* no sampler and no catalog — nothing to show */ });
    return () => { alive = false; };
  }, [set]);

  if (!manifest) return null;
  const cols = Math.ceil(Math.sqrt(manifest.items.length));
  const cell = manifest.cell;
  // Lay the grid out once: world position + the asset's stable code + short name for the labels.
  const laid = manifest.items.map((it, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const id = idFromFile(it.file);
    return { file: it.file, code: assetCode(id), name: shortName(id),
      x: (col - (cols - 1) / 2) * cell, z: (row - (cols - 1) / 2) * cell };
  });
  const labels: GridLabel[] = laid.map((p) => ({ code: p.code, name: p.name, x: p.x, z: p.z }));
  return (
    <>
      {laid.map((p) => (
        <ModelBoundary key={p.file}>
          <Suspense fallback={null}>
            <SamplerModel file={p.file} x={p.x} z={p.z} />
          </Suspense>
        </ModelBoundary>
      ))}
      <AssetGridLabels items={labels} />
    </>
  );
}
