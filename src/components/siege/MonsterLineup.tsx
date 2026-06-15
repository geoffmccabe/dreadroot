// MonsterLineup — the game's enemy roster in a row BEHIND the character lineup, feet on
// the same level so relative sizes read clearly. Each glb is normalized to 1m tall (feet at
// origin), so the per-monster scale below IS its height in metres. Sizes are first-pass
// estimates by name tier (grunt < small troll < medium troll < big red) — easy to retune.
// Next step (planned): load their idle/walk animations and let them wander the map.

import { Component, ReactNode, Suspense } from 'react';
import { useGLTF } from '@react-three/drei';

const ROSTER = ['mushroomgrunt', 'smallgreentroll', 'mediumgreentroll', 'bigred'];

// [heightMetres, feetY, rot]  rot 0 = Z-up source (-90X), 1 = upright (faces forward).
const LINEUP: Record<string, [number, number, number]> = {
  mushroomgrunt: [1.8, 0, 1],
  smallgreentroll: [2.5, 0, 1],
  mediumgreentroll: [3.3, 0, 1],
  bigred: [4.5, 0, 1],
};
const ROT: [number, number, number][] = [[-Math.PI / 2, Math.PI, 0], [0, Math.PI, 0]];
const SPACING = 5; // monsters are large; wider spacing than characters

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

function Mon({ url, name, px, py, pz }: { url: string; name: string; px: number; py: number; pz: number }) {
  const { scene } = useGLTF(url);
  const [scale, feetY, rot] = LINEUP[name] ?? [2, 0, 1];
  return (
    <group position={[px, py - feetY, pz]} scale={scale}>
      <group rotation={ROT[rot]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

export function MonsterLineup({ origin }: { origin: [number, number, number] }) {
  return (
    <>
      {ROSTER.map((name, i) => (
        <Boundary key={name}>
          <Suspense fallback={null}>
            <Mon url={`/siege/monsters/${name}.glb`} name={name}
                 px={origin[0] + i * SPACING} py={origin[1]} pz={origin[2]} />
          </Suspense>
        </Boundary>
      ))}
    </>
  );
}
