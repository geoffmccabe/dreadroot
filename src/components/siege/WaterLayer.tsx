// WaterLayer — the sea surface at the world's water height (Client.cs WATER_HEIGHT = 22).
// A real-time reflective surface (drei MeshReflectorMaterial mirrors the islands + sky) that
// reads as proper water from above; the murky "inside" look + drowning are handled by
// UnderwaterEffect. Movement-in-water (walk-the-bottom) is the controller's job via WaterVolume.

import * as THREE from 'three';
import { MeshReflectorMaterial } from '@react-three/drei';
import type { WorldDefinition } from '@/config/worldDefinition';

export function WaterLayer({ world }: { world: WorldDefinition }) {
  const level = world.water?.[0]?.surfaceY;
  if (level == null) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-500, level, -500]} renderOrder={1}>
      <planeGeometry args={[6000, 6000]} />
      {/* Reflective surface: mirrors the scene (blurred) so the ocean catches the islands + sky.
          More opaque than the old flat plane so the surface reads as water, not thin glass. */}
      <MeshReflectorMaterial
        resolution={512}
        mixBlur={1.2}
        mixStrength={3.5}
        blur={[420, 110]}
        minDepthThreshold={0.85}
        maxDepthThreshold={1.2}
        depthScale={1}
        roughness={0.28}
        metalness={0.55}
        color={0x244f63}
        transparent
        opacity={0.82}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
