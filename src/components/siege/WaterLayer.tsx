// WaterLayer — a translucent sea plane at the world's water height (Client.cs
// WATER_HEIGHT = 22). Helps orient the world: everything poking above is land,
// everything below is submerged (beaches, ocean floor). Large enough to read as
// open ocean past the terrain edges. Movement-in-water (walk-the-bottom) is
// handled by the controller via the WaterVolume; this is just the visual.

import * as THREE from 'three';
import type { WorldDefinition } from '@/config/worldDefinition';

export function WaterLayer({ world }: { world: WorldDefinition }) {
  const level = world.water?.[0]?.surfaceY;
  if (level == null) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-500, level, -500]} renderOrder={1}>
      <planeGeometry args={[6000, 6000]} />
      <meshStandardMaterial
        color={0x2f6f8f}
        transparent
        opacity={0.62}
        roughness={0.2}
        metalness={0.1}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
