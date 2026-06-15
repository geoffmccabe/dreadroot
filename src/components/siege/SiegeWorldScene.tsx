// SiegeWorldScene — the contents of the <Canvas> for a Siege Worlds world.
//
// Load order matters: the terrain mounts FIRST, then everything that sits on it
// (world objects, characters, monsters) mounts once the terrain is ready, so nothing
// renders floating before the ground exists.

import { Suspense, useState } from 'react';
import { Sky } from '@react-three/drei';
import type { WorldDefinition } from '@/config/worldDefinition';
import { SiegeFlyController } from './SiegeFlyController';
import { TerrainLayer } from './TerrainLayer';
import { WaterLayer } from './WaterLayer';
import { PlacementEditor } from './PlacementEditor';
import { CharacterTest } from './CharacterTest';
import { CharacterLineup } from './CharacterLineup';
import { MonsterLineup } from './MonsterLineup';
import { MonsterEnemy } from './MonsterEnemy';
import { WorldObjectsLayer } from './WorldObjectsLayer';
import { LaserProbe } from './LaserProbe';

interface Props {
  world: WorldDefinition;
  editorMode: boolean;
  transformMode: 'translate' | 'rotate' | 'scale';
  charAnim: string;
}

export function SiegeWorldScene({ world, editorMode, transformMode, charAnim }: Props) {
  const [terrainReady, setTerrainReady] = useState(false);
  return (
    <>
      {/* Solid sky-blue background so we never see black void if the Sky dome clips. */}
      <color attach="background" args={[0x9ec8e8]} />
      <Sky distance={45000} sunPosition={[1000, 600, 1000]} turbidity={6} rayleigh={1.5} />
      <fog attach="fog" args={[0x9ec8e8, 2500, 9000]} />

      <hemisphereLight args={[0xbfd4ff, 0x6b6453, 0.6]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[400, 600, 300]} intensity={1.1} />

      {/* TERRAIN FIRST — signals ready so the rest mounts on top of it. */}
      <TerrainLayer onReady={() => setTerrainReady(true)} />
      <WaterLayer world={world} />

      {/* Everything that sits on the terrain waits until the ground exists. */}
      {terrainReady && (
        <>
          <Suspense fallback={null}>
            <WorldObjectsLayer />
          </Suspense>

          <Suspense fallback={null}>
            <CharacterTest position={[-100, 22.3, 310]} anim={charAnim} />
          </Suspense>

          {/* Live enemies at the BEACH (engine ~-400,700), wandering + searching for the
              player, pursuing + attacking within aggro range. One of each ported monster. */}
          {!editorMode && (
            <Suspense fallback={null}>
              {/* Animated via the official Synty animation packs (idle/walk/attack) —
                  rig-compatible with the Synty enemy models. */}
              <MonsterEnemy spawn={[-400, 26, 700]} url="/siege/monsters/reddemon.glb"
                            modelHeight={1.886} height={4} />
              <MonsterEnemy spawn={[-416, 26, 706]} url="/siege/monsters/greentrollgrunt.glb"
                            modelHeight={1.772} height={2.4} />
              <MonsterEnemy spawn={[-386, 26, 710]} url="/siege/monsters/greentroll.glb"
                            modelHeight={1.927} height={3.0} />
              <MonsterEnemy spawn={[-422, 26, 690]} url="/siege/monsters/redtroll.glb"
                            modelHeight={2.033} height={2.7} />
              <MonsterEnemy spawn={[-390, 26, 694]} url="/siege/monsters/mushroomgruntanim.glb"
                            modelHeight={2.331} height={2.2} />
            </Suspense>
          )}
        </>
      )}

      {/* Placement gizmo kept available (editor mode). */}
      {editorMode && <PlacementEditor editorMode={editorMode} mode={transformMode} />}

      {/* Sky lineups (reference rows) — independent of the ground. */}
      <CharacterLineup origin={[-122, 45, 310]} />
      <MonsterLineup origin={[-115, 45, 318]} />

      {/* Laser-pointer probe: press L to copy where you're looking + what you hit. */}
      <LaserProbe />

      {!editorMode && <SiegeFlyController world={world} />}
    </>
  );
}
