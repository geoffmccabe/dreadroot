// SiegeWorldLayers — the Siege Worlds WORLD as one mountable unit (terrain + water +
// placed objects + live monsters), with NO player/controller/HUD/sky/lights of its own.
// This is the piece that plugs into the Dreadroot Fortress shell in place of the voxel
// world (CameraTrackedBlocks): the engine renders EITHER blocks (kind:'voxel') OR these
// layers (kind:'siege'), while the player, controls, jet-boost, weapons, and HUD — all
// world-agnostic — come from Fortress unchanged. Terrain mounts first; the rest follows.

import { Suspense, useState } from 'react';
import type { WorldDefinition } from '@/config/worldDefinition';
import { TerrainLayer } from './TerrainLayer';
import { WaterLayer } from './WaterLayer';
import { WorldObjectsLayer } from './WorldObjectsLayer';
import { MonsterEnemy } from './MonsterEnemy';
import { SiegeMonsterParade } from './SiegeMonsterParade';
import { SiegeItemGrid } from './SiegeItemGrid';
import { MeshColliderPlayer } from './MeshColliderPlayer';
import { SiegeTeleport } from './SiegeTeleport';
import { SprayAttackRenderer } from './spray/SprayAttackRenderer';
import { BleakrockLighting } from './BleakrockLighting';
import { UnderwaterEffect } from './UnderwaterEffect';
import { ChallengeRunner } from './challenge/ChallengeRunner';
import { getChallengeState, subscribeChallenge } from './challenge/challengeStore';
import { useSyncExternalStore } from 'react';

const selectActive = () => getChallengeState().active;

export function SiegeWorldLayers({ world }: { world: WorldDefinition }) {
  const [terrainReady, setTerrainReady] = useState(false);
  // While a challenge is running, hide the ambient beach enemies + parade so ONLY challenge
  // monsters are in the world.
  const challengeActive = useSyncExternalStore(subscribeChallenge, selectActive, selectActive);
  return (
    <>
      {/* Ground first — signals ready so everything else mounts on top of it. */}
      <TerrainLayer onReady={() => setTerrainReady(true)} />
      <WaterLayer world={world} />
      {/* Quick-travel: Ctrl/Cmd+J then 1-8. Always available in Siege. */}
      <SiegeTeleport />
      {/* Renders + simulates monster breath-weapon particles (acid vomit, etc.). */}
      <SprayAttackRenderer />
      {/* Dark, cold horror fog + dimming scrim that fades in as you approach Bleakrock. */}
      <BleakrockLighting />
      {/* Underwater murk + breath/drowning damage below the sea surface. */}
      {world.water?.[0]?.surfaceY != null && <UnderwaterEffect level={world.water[0].surfaceY} />}
      {/* Challenge wave engine. Start/stop the test challenge with the "!c" command. */}
      <ChallengeRunner />

      {terrainReady && (
        <>
          <Suspense fallback={null}>
            <WorldObjectsLayer meshColliders={world.meshColliders} />
          </Suspense>
          {world.meshColliders && <MeshColliderPlayer />}
          {/* Press "I" to show a floating grid of every game item over spawn. */}
          <SiegeItemGrid />
          {/* Live enemies wandering the beach near the player spawn (-400,45,660),
              with wide aggro so they detect + chase the moment you arrive. Hidden during a
              challenge so only the challenge monsters remain. */}
          {!challengeActive && (
            <Suspense fallback={null}>
              <MonsterEnemy spawn={[-400, 26, 705]} url="/siege/monsters/reddemon.glb"
                            modelHeight={1.886} height={4} aggro={140} health={1000} noStun
                            roarSound="/demon_roar_1.mp3" />
              <MonsterEnemy spawn={[-440, 26, 695]} url="/siege/monsters/greentrollgrunt.glb"
                            modelHeight={1.772} height={2.4} aggro={140} />
              <MonsterEnemy spawn={[-360, 26, 695]} url="/siege/monsters/greentroll.glb"
                            modelHeight={1.927} height={3.0} aggro={140} />
              <MonsterEnemy spawn={[-420, 26, 720]} url="/siege/monsters/redtroll.glb"
                            modelHeight={2.033} height={2.7} aggro={140} />
              <MonsterEnemy spawn={[-380, 26, 720]} url="/siege/monsters/mushroomgruntanim.glb"
                            modelHeight={2.331} height={2.2} aggro={140} />
            </Suspense>
          )}
          {/* One of each NEW FantasyRivals monster — also hidden during a challenge. */}
          {!challengeActive && <SiegeMonsterParade />}
        </>
      )}
    </>
  );
}
