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

export function SiegeWorldLayers({ world }: { world: WorldDefinition }) {
  const [terrainReady, setTerrainReady] = useState(false);
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

      {terrainReady && (
        <>
          <Suspense fallback={null}>
            <WorldObjectsLayer meshColliders={world.meshColliders} />
          </Suspense>
          {world.meshColliders && <MeshColliderPlayer />}
          {/* Press "I" to show a floating grid of every game item over spawn. */}
          <SiegeItemGrid />
          {/* Live enemies wandering the beach near the player spawn (-400,45,660),
              with wide aggro so they detect + chase the moment you arrive. */}
          <Suspense fallback={null}>
            <MonsterEnemy spawn={[-400, 26, 705]} url="/siege/monsters/reddemon.glb"
                          modelHeight={1.886} height={4} aggro={140} health={1000} noStun />
            <MonsterEnemy spawn={[-440, 26, 695]} url="/siege/monsters/greentrollgrunt.glb"
                          modelHeight={1.772} height={2.4} aggro={140} />
            <MonsterEnemy spawn={[-360, 26, 695]} url="/siege/monsters/greentroll.glb"
                          modelHeight={1.927} height={3.0} aggro={140} />
            <MonsterEnemy spawn={[-420, 26, 720]} url="/siege/monsters/redtroll.glb"
                          modelHeight={2.033} height={2.7} aggro={140} />
            <MonsterEnemy spawn={[-380, 26, 720]} url="/siege/monsters/mushroomgruntanim.glb"
                          modelHeight={2.331} height={2.2} aggro={140} />
          </Suspense>
          {/* One of each NEW FantasyRivals monster (converted + animated from the
              Synty source pack) in a row just north of the beach enemies. */}
          <SiegeMonsterParade />
        </>
      )}
    </>
  );
}
