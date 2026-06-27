// SetSampler — an auto-arranged "showroom" for a COMPONENT-only Synty set (CyberCity, Mech,
// SciFi Worlds) that ships no baked scene. Reads /siege/scifi/_sampler_<set>.json (a curated
// spread of the set's models + dims) and lays them in a grid, grounded at real 1:1 scale,
// textured. Each model loads in its own Suspense so one failure can't blank the whole grid.

import { Component, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { sampleHeight } from '../terrainHeight';
import { scifiAsset, scifiData } from '@/config/assetBase';

interface SamplerItem { file: string; w: number; h: number; d: number; category: string; }
interface SamplerManifest { set: string; cell: number; count: number; items: SamplerItem[]; }

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
      .then((m) => { if (alive) setManifest(m); })
      .catch(() => { /* manifest missing on both */ });
    return () => { alive = false; };
  }, [set]);

  if (!manifest) return null;
  const cols = Math.ceil(Math.sqrt(manifest.items.length));
  const cell = manifest.cell;
  return (
    <>
      {manifest.items.map((it, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = (col - (cols - 1) / 2) * cell;
        const z = (row - (cols - 1) / 2) * cell;
        return (
          <ModelBoundary key={it.file}>
            <Suspense fallback={null}>
              <SamplerModel file={it.file} x={x} z={z} />
            </Suspense>
          </ModelBoundary>
        );
      })}
    </>
  );
}
