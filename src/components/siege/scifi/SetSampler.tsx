// SetSampler — an auto-arranged "showroom" for a COMPONENT-only Synty set (CyberCity, Mech,
// SciFi Worlds) that ships no baked scene. Reads /siege/scifi/_sampler_<set>.json (a curated
// spread of the set's models + dims) and lays them in a grid, grounded at real 1:1 scale,
// textured. Each model loads in its own Suspense so one failure can't blank the whole grid.

import { Suspense, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { sampleHeight } from '../terrainHeight';

interface SamplerItem { file: string; w: number; h: number; d: number; category: string; }
interface SamplerManifest { set: string; cell: number; count: number; items: SamplerItem[]; }

function SamplerModel({ file, x, z }: { file: string; x: number; z: number }) {
  const { scene } = useGLTF(`/siege/scifi/${file}`);
  const obj = useMemo(() => {
    const model = scene.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const ground = sampleHeight(x, z) ?? 0;
    model.position.y = ground - box.min.y;       // lowest point on the ground
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
    fetch(`/siege/scifi/_sampler_${set}.json`)
      .then((r) => r.json())
      .then((m) => { if (alive) setManifest(m); })
      .catch(() => { /* manifest missing */ });
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
          <Suspense key={it.file} fallback={null}>
            <SamplerModel file={it.file} x={x} z={z} />
          </Suspense>
        );
      })}
    </>
  );
}
