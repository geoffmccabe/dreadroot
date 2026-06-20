// EditableWaterLayer — the adjustable "flood" water for editable maps. A translucent
// plane at the map's water level (set in the terrain panel); dig terrain below it with
// the Lower brush to carve lakes, raise terrain above it for islands. Lightweight (no
// reflection target — this is a builder surface, not the SWW ocean). Movement-in-water
// (swim / walk-bottom) is NOT wired for editable maps yet — visuals + underwater murk
// (UnderwaterEffect, mounted alongside) only, for now.
import * as THREE from 'three';
import { useMemo } from 'react';
import type { WorldDefinition } from '@/config/worldDefinition';
import { useBrushState } from './terrainBrushState';
import { toRenderSpace } from '@/lib/renderSpace';
import { UnderwaterEffect } from '../UnderwaterEffect';

export function EditableWaterLayer({ world }: { world: WorldDefinition }) {
  const { waterOn, waterLevel } = useBrushState();
  const { sizeX, sizeZ, cx, cz } = useMemo(() => {
    const b = world.bounds;
    const minX = b ? b.min[0] : -10000, maxX = b ? b.max[0] : 10000;
    const minZ = b ? b.min[1] : -10000, maxZ = b ? b.max[1] : 10000;
    return { sizeX: maxX - minX, sizeZ: maxZ - minZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  }, [world.bounds]);
  if (!waterOn) return null;
  const [rx, , rz] = toRenderSpace(cx, waterLevel, cz);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[rx, waterLevel, rz]} renderOrder={1}>
        <planeGeometry args={[sizeX, sizeZ]} />
        <meshStandardMaterial
          color={0x2f6f86} transparent opacity={0.72} roughness={0.2} metalness={0.5}
          depthWrite={false} side={THREE.DoubleSide}
        />
      </mesh>
      {/* Murk + drowning when the camera drops below the flood surface. */}
      <UnderwaterEffect level={waterLevel} />
    </>
  );
}
