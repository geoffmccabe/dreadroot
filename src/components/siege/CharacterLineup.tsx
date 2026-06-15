// CharacterLineup — playable characters in a row. Per-character scale, feet offset, and
// stand-up rotation are precomputed offline (rotation auto-detected as whichever stands the
// model tallest), so placement is fully deterministic — no runtime measurement.

import { Component, ReactNode, Suspense } from 'react';
import { useGLTF } from '@react-three/drei';

const ROSTER = [
  'shiyang', 'toshiro', 'jeanette', 'dago', 'doge', 'janx', 'koraka', 'nakano', 'rajax', 'ashandthorn',
  'angus', 'bonnie', 'butch', 'chalk', 'crazyhorse', 'dulla', 'flamma', 'ladyhao', 'lozen', 'mochizuki',
  'musashi', 'pigtailgirl', 'ragnar', 'rakshaz', 'tlahucole', 'yaaantesawa', 'zap',
];

// [scale, feetY, rot] per character. rot 0 = Z-up source (-90X), 1 = Y-up source (upright).
const LINEUP: Record<string, [number, number, number]> = {
  angus: [1.00042, -0.003, 1],
  ashandthorn: [1.00976, -0.0055, 1],
  bonnie: [0.9583, 0.0, 1],
  butch: [0.96989, -0.0029, 1],
  chalk: [0.97782, -0.0036, 1],
  crazyhorse: [0.9824, -0.0029, 1],
  dago: [0.01222, -0.0771, 0],
  doge: [1.00078, -0.0, 1],
  dulla: [0.92484, 0.0001, 1],
  flamma: [1.00319, 0.0007, 1],
  janx: [1.05926, -0.004, 1],
  jeanette: [0.00983, -0.0231, 0],
  koraka: [0.01351, -0.0136, 0],
  ladyhao: [0.99766, 0.0056, 1],
  lozen: [0.99749, -0.003, 1],
  mochizuki: [1.04084, -0.0035, 1],
  musashi: [0.94117, -0.0, 1],
  nakano: [0.00937, -0.0515, 0],
  pigtailgirl: [0.95994, -0.0038, 1],
  ragnar: [0.9278, -0.0, 1],
  rajax: [0.73555, -0.3835, 1],
  rakshaz: [0.73555, -0.3835, 1],
  shiyang: [0.00897, -0.0363, 0],
  tlahucole: [0.91877, -0.0027, 1],
  toshiro: [0.00997, -0.005, 0],
  yaaantesawa: [0.95493, 0.0032, 1],
  zap: [0.98171, -0.0031, 1],
};
const ROT: [number, number, number][] = [[-Math.PI / 2, Math.PI, 0], [0, Math.PI, 0]];
const SPACING = 2.2;

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

function Char({ url, name, px, py, pz }: { url: string; name: string; px: number; py: number; pz: number }) {
  const { scene } = useGLTF(url);
  const [scale, feetY, rot] = LINEUP[name] ?? [1, 0, 1];
  return (
    <group position={[px, py - feetY, pz]} scale={scale}>
      <group rotation={ROT[rot]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

export function CharacterLineup({ origin }: { origin: [number, number, number] }) {
  return (
    <>
      {ROSTER.map((name, i) => (
        <Boundary key={name}>
          <Suspense fallback={null}>
            <Char url={`/siege/characters/${name}.glb`} name={name}
                  px={origin[0] + i * SPACING} py={origin[1]} pz={origin[2]} />
          </Suspense>
        </Boundary>
      ))}
    </>
  );
}
