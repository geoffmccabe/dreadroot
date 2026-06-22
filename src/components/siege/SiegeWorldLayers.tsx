// SiegeWorldLayers — the Siege Worlds WORLD as one mountable unit (terrain + water +
// placed objects + live monsters), with NO player/controller/HUD/sky/lights of its own.
// This is the piece that plugs into the Dreadroot Fortress shell in place of the voxel
// world (CameraTrackedBlocks): the engine renders EITHER blocks (kind:'voxel') OR these
// layers (kind:'siege'), while the player, controls, jet-boost, weapons, and HUD — all
// world-agnostic — come from Fortress unchanged. Terrain mounts first; the rest follows.

import { Suspense, useState, useEffect } from 'react';
import type { WorldDefinition } from '@/config/worldDefinition';
import { sampleHeight } from './terrainHeight';
import { setCoinGroundSampler } from '@/features/coinDrops/coinGround';
import { TerrainLayer } from './TerrainLayer';
import { FlatGroundLayer } from './FlatGroundLayer';
import { HeightmapTerrain } from './terrain/HeightmapTerrain';
import { TerrainBrushController } from './terrain/TerrainBrushController';
import { BuilderObjectsLayer } from './builder/BuilderObjectsLayer';
import { BuilderController } from './builder/BuilderController';
import { SiegePortalEffect } from './SiegePortalEffect';
import { EditableWaterLayer } from './terrain/EditableWaterLayer';
import { SciFiShowcase } from './scifi/SciFiShowcase';
import { DemoScene } from './scifi/DemoScene';
import { SetSampler } from './scifi/SetSampler';
import { NightDimmer } from './NightDimmer';
import { useSiegeLighting } from './siegeLighting';
import { WaterLayer } from './WaterLayer';
import { WorldObjectsLayer } from './WorldObjectsLayer';
import { MonsterEnemy } from './MonsterEnemy';
import { SiegeMonsterParade } from './SiegeMonsterParade';
import { SiegeItemGrid } from './SiegeItemGrid';
import { MeshColliderPlayer } from './MeshColliderPlayer';
import { SiegeTeleport } from './SiegeTeleport';
import { SprayAttackRenderer } from './spray/SprayAttackRenderer';
import { BloodRenderer } from './BloodRenderer';
import { BleakrockLighting } from './BleakrockLighting';
import { UnderwaterEffect } from './UnderwaterEffect';
import { ChallengeRunner } from './challenge/ChallengeRunner';
import { RegionSpawnerRunner } from './challenge/RegionSpawnerRunner';
import { CombatTelemetryProbe } from './CombatTelemetryView';
import { DamageNumbers } from './DamageNumbersLayer';
import { GhostExplosions } from './GhostExplosion';
import { getChallengeState, subscribeChallenge } from './challenge/challengeStore';
import { useSyncExternalStore } from 'react';

const selectActive = () => getChallengeState().active;

export function SiegeWorldLayers({ world }: { world: WorldDefinition }) {
  // Track WHICH world is ready (not a bare bool). Derived at render → switching maps makes
  // terrainReady instantly false for the new world with NO effect, avoiding the effect-order
  // race where the parent's reset ran AFTER the child ground's onReady and clobbered it to
  // false (which silently hid everything in this block — incl. the sci-fi showcase).
  const [readyWorld, setReadyWorld] = useState<string | null>(null);
  const lightingMode = useSiegeLighting();   // Admin/Weather "Night Mood" preview
  const terrainReady = readyWorld === world.id;
  const signalReady = () => setReadyWorld(world.id);
  // While a challenge is running, hide the ambient beach enemies + parade so ONLY challenge
  // monsters are in the world.
  const challengeActive = useSyncExternalStore(subscribeChallenge, selectActive, selectActive);
  // Blank builder canvases (flat or editable heightmap, e.g. Starblink) get NONE of the
  // SWW-specific scenery/enemies/regions — just ground + spawn + the builder tools.
  const kind = world.ground.kind;
  const isHeightmap = kind === 'heightmap';
  const isBlank = kind === 'flat' || isHeightmap;
  // Let falling coin drops land on the mesh terrain (no voxels here) instead of dropping through it.
  useEffect(() => { setCoinGroundSampler(sampleHeight); return () => setCoinGroundSampler(null); }, []);
  return (
    <>
      {/* Ground first — signals ready so everything else mounts on top of it. */}
      {isHeightmap
        ? <HeightmapTerrain world={world} onReady={signalReady} />
        : kind === 'flat'
          ? <FlatGroundLayer world={world} onReady={signalReady} />
          : <TerrainLayer onReady={signalReady} />}
      {/* Builder/blank maps (Starblink, City Demo) drop the SWW horror fog, so faces away
          from the sun go near-black with only the base ambient. Add bright fill light so
          all object textures read clearly (esp. the tall city buildings). */}
      {isBlank && (
        <>
          <ambientLight intensity={world.fill?.ambient ?? 0.7} />
          <hemisphereLight args={['#ffffff', '#b9c4d0', world.fill?.hemi ?? 0.6]} />
        </>
      )}
      {/* Night maps (SciFi City) OR the Admin/Weather "Night Mood" preview toggle on any world:
          dim the shared sun/sky so emissive signs/windows glow against a dark scene. */}
      {(world.night || lightingMode === 'night') && <NightDimmer />}
      {/* Editable maps get the in-world terrain brush (controller; panel is in the HUD)
          and adjustable flood water; static maps keep the SWW ocean (WaterLayer). */}
      {isHeightmap && <TerrainBrushController />}
      {/* Drop-in object builder: render placed objects always (so saved maps show them in play),
          and the placement controller (no-ops unless build mode is on). */}
      {isHeightmap && <BuilderObjectsLayer />}
      {isHeightmap && <BuilderController />}
      {/* Magic-portal VFX inside the lobby warp gate (SWW world only). */}
      {!isBlank && <SiegePortalEffect />}
      {/* (Magic Chest model removed — the lobby already has a chest at the spot; the open/spin
          interaction lives in MagicChestPanel and works on that existing chest.) */}
      {isHeightmap ? <EditableWaterLayer world={world} /> : <WaterLayer world={world} />}
      {/* Quick-travel: Ctrl/Cmd+J then 1-8. Always available in Siege. */}
      <SiegeTeleport />
      {/* Renders + simulates monster breath-weapon particles (acid vomit, etc.). */}
      <SprayAttackRenderer />
      {/* Bullseye blood spray — teardrop droplets + fading decals. */}
      <BloodRenderer />
      {/* Dark, cold horror fog + dimming scrim that fades in as you approach Bleakrock. */}
      {!isBlank && <BleakrockLighting />}
      {/* Underwater murk + breath/drowning damage below the sea surface. */}
      {world.water?.[0]?.surfaceY != null && <UnderwaterEffect level={world.water[0].surfaceY} />}
      {/* Challenge wave engine. Start/stop the test challenge with the "!c" command. */}
      <ChallengeRunner />
      {/* Combat recorder probe — feeds player position to the telemetry every frame. */}
      <CombatTelemetryProbe />
      {/* Floating combat damage numbers (Unity FloatingDamageText port). */}
      <DamageNumbers />
      {/* Ghost death blasts (transparent-black explosion + heat-haze refraction). */}
      <GhostExplosions />

      {terrainReady && (
        <>
          {/* SWW scenery + colliders — only on the real terrain map, not flat canvases. */}
          {!isBlank && (
            <Suspense fallback={null}>
              <WorldObjectsLayer meshColliders={world.meshColliders} />
            </Suspense>
          )}
          {!isBlank && world.meshColliders && <MeshColliderPlayer />}
          {/* Press "I" to show a floating grid of every game item over spawn (SWW review only). */}
          {!isBlank && <SiegeItemGrid />}
          {/* TEMP: sci-fi conversion verification grid (Starblink only). Remove when the
              Phase 3 drop-in palette lands. */}
          {world.id === 'starblink' && <SciFiShowcase />}
          {/* Baked Synty asset-set demos + their BVH colliders (one per demo map). */}
          {world.id === 'city-demo' && (
            <Suspense fallback={null}>
              <DemoScene file="city_demo.gltf" group="citydemo" />
              <MeshColliderPlayer />
            </Suspense>
          )}
          {world.id === 'space-demo' && (
            <Suspense fallback={null}>
              {/* The Space exterior scene is ~10km — shrink it so it's viewable on the ground. */}
              <DemoScene file="space_demo.gltf" group="spacedemo" scale={0.025} />
              <MeshColliderPlayer />
            </Suspense>
          )}
          {world.id === 'adventure-demo' && (
            <Suspense fallback={null}>
              {/* Baked Synty Adventure fantasy village — auto-grounded/recentered by DemoScene. */}
              <DemoScene file="adventure_demo.gltf" group="adventuredemo" />
              <MeshColliderPlayer />
            </Suspense>
          )}
          {/* Component-only sets shown as auto-arranged sampler grids. */}
          {world.id === 'cyber-demo' && <SetSampler set="cyber" />}
          {world.id === 'mech-demo' && <SetSampler set="mech" />}
          {world.id === 'worlds-demo' && <SetSampler set="worlds" />}
          {world.id === 'apoc-demo' && <SetSampler set="apoc" />}
          {world.id === 'dark-demo' && <SetSampler set="dark" />}
          {world.id === 'nature-demo' && <SetSampler set="nature" />}
          {world.id === 'alpine-demo' && <SetSampler set="alpine" />}
          {world.id === 'desert-demo' && <SetSampler set="desert" />}
          {world.id === 'meadow-demo' && <SetSampler set="meadow" />}
          {world.id === 'swamp-demo' && <SetSampler set="swamp" />}
          {world.id === 'jungle-demo' && <SetSampler set="jungle" />}
          {/* "Various 2" component grids (Cmd-J O–U). */}
          {world.id === 'adventure-grid' && <SetSampler set="adventure" />}
          {world.id === 'ancient-grid' && <SetSampler set="ancient" />}
          {world.id === 'dungeon-grid' && <SetSampler set="dungeon" />}
          {world.id === 'elven-grid' && <SetSampler set="elven" />}
          {world.id === 'enchanted-grid' && <SetSampler set="enchanted" />}
          {world.id === 'kingdom-grid' && <SetSampler set="kingdom" />}
          {world.id === 'samurai-grid' && <SetSampler set="samurai" />}
          {/* Live enemies wandering the beach near the player spawn (-400,45,660),
              with wide aggro so they detect + chase the moment you arrive. Hidden during a
              challenge so only the challenge monsters remain. */}
          {!isBlank && !challengeActive && (
            <Suspense fallback={null}>
              {/* The BIG Red Demon (npcType 8) — now strikes for real (committed swipe). */}
              <MonsterEnemy spawn={[-400, 26, 705]} url="/siege/monsters/reddemon.glb"
                            modelHeight={1.886} height={4} aggro={140} health={1000} noStun
                            attackRange={2.2} attackMs={1500}
                            meleeContact={{ dmg: [20, 60], kb: [4, 9], cooldownMs: 1500 }}
                            roarSound="/demon_roar_1.mp3" attackSound="/demon_attack.mp3"
                            missSound="/swoosh_miss_low.mp3" />
              <MonsterEnemy spawn={[-440, 26, 695]} url="/siege/monsters/greentrollgrunt.glb"
                            modelHeight={1.772} height={2.4} aggro={140} />
              <MonsterEnemy spawn={[-360, 26, 695]} url="/siege/monsters/greentroll.glb"
                            modelHeight={1.927} height={3.0} aggro={140} />
              <MonsterEnemy spawn={[-420, 26, 720]} url="/siege/monsters/redtroll.glb"
                            modelHeight={2.033} height={2.7} aggro={140} />
              <MonsterEnemy spawn={[-380, 26, 720]} url="/siege/monsters/mushroomgruntanim.glb"
                            modelHeight={2.331} height={2.2} aggro={140} attackMs={1500}
                            attackStyle="spin-lunge" meleeContact={{ dmg: [3, 17], kb: [1, 5] }}
                            hitSound="/little_slap.mp3" missSound="/swoosh_miss_high.mp3" />
            </Suspense>
          )}
          {/* SiegeMonsterParade (zombie, dfskeleton, skeletons, darklord, demonmale) disabled —
              those are already in the game and don't need to load/display in the review area. */}
          {/* {!challengeActive && <SiegeMonsterParade />} */}
          {/* Open-World ambient spawner: plays + loops any region-tagged Challenge at its coords. */}
          {!isBlank && !challengeActive && <RegionSpawnerRunner />}
        </>
      )}
    </>
  );
}
