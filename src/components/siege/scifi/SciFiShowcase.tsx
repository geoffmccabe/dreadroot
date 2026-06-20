// SciFiShowcase — a TEMPORARY verification display: the first converted Synty sci-fi
// models, dropped into Starblink near spawn so they can be eyeballed in-game (grounded,
// real 1:1 metre scale, textured via their shared external webp atlases). This is NOT
// the builder — it's a fixed grid to confirm the conversion pipeline before scaling.
// Replaced by the Phase 3 drop-in palette (reads catalog.json) once verified.

import { Suspense, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { sampleHeight } from '../terrainHeight';
import { toRenderSpace } from '@/lib/renderSpace';

// First converted city models — a spread of building / prop / vehicle / sign.
const MODELS = [
  'city_SM_Prop_Atm_01',
  'city_SM_Prop_Bench_01',
  'city_SM_Prop_Crate_01',
  'city_SM_Prop_Box_Supplies_01',
  'city_SM_Prop_BarChair_01',
  'city_SM_Prop_Advertisement_Pillar_01',
  'city_SM_Veh_Armored_Truck_01',
  'city_SM_Veh_Armored_Truck_01_Hover',
  'city_SM_Sign_Ad_01',
  'city_SM_Bld_Background_Small_01',
  'city_SM_Bld_Advanced_01',
  'city_SM_Prop_Box_RobotParts_01',
];
// Grid PITCH (12 m) exceeds the largest model footprint (~7 m truck) + margin, so nothing
// overlaps. Centred on spawn (0,0,0) and spread across all quadrants so they're visible
// whichever way you're facing; no model sits on the spawn point itself.
const COLS = 4;
const PITCH = 12;

function ShowcaseModel({ file, x, z }: { file: string; x: number; z: number }) {
  const { scene } = useGLTF(`/siege/scifi/${file}.gltf`);
  const obj = useMemo(() => {
    const model = scene.clone(true);           // static meshes → plain clone is fine
    const box = new THREE.Box3().setFromObject(model);
    const ground = sampleHeight(x, z) ?? 0;
    // Lift the model so its lowest point sits exactly on the ground (no floating/sinking).
    model.position.y = ground - box.min.y;
    const wrap = new THREE.Group();
    wrap.add(model);
    const [rx, , rz] = toRenderSpace(x, 0, z);
    wrap.position.set(rx, 0, rz);
    return wrap;
  }, [scene, x, z]);
  return <primitive object={obj} />;
}

export function SciFiShowcase() {
  return (
    <Suspense fallback={null}>
      {MODELS.map((f, i) => {
        const col = i % COLS, row = Math.floor(i / COLS);   // 4 cols × 3 rows
        const x = (col - (COLS - 1) / 2) * PITCH;            // -18, -6, 6, 18
        const z = (row - 1) * PITCH;                         // -12, 0, 12 (around spawn)
        return <ShowcaseModel key={f} file={f} x={x} z={z} />;
      })}
    </Suspense>
  );
}
