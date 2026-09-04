// SiegeWorldLayers — the Siege Worlds WORLD as one mountable unit (terrain + water +
// placed objects + live monsters), with NO player/controller/HUD/sky/lights of its own.
// This is the piece that plugs into the Dreadroot Fortress shell in place of the voxel
// world (CameraTrackedBlocks): the engine renders EITHER blocks (kind:'voxel') OR these
// layers (kind:'siege'), while the player, controls, jet-boost, weapons, and HUD — all
// world-agnostic — come from Fortress unchanged. Terrain mounts first; the rest follows.

import { Suspense, useState, useEffect } from 'react';
import type { WorldDefinition } from '@/config/worldDefinition';
import { isEnchantedForest } from '@/config/worldDefinition';
import { sampleHeight } from './terrainHeight';
import { setCoinGroundSampler } from '@/features/coinDrops/coinGround';
import { TerrainLayer } from './TerrainLayer';
import { FlatGroundLayer } from './FlatGroundLayer';
import { HeightmapTerrain } from './terrain/HeightmapTerrain';
import { GlobeTerrain } from './globe/GlobeTerrain';
import { GlobeCamera } from './globe/GlobeCamera';
import { GlobeLighting } from './globe/GlobeLighting';
import { GlobeCloudsGate } from './globe/GlobeCloudsGate';
import { GlobeStarfield } from './globe/GlobeStarfield';
import { KaijuLabController } from './globe/KaijuLabController';
import { KaijuWalkController } from './globe/KaijuWalkController';
import { GlobePortals } from './globe/GlobePortals';
import { GlobeErrorBoundary } from './globe/GlobeErrorBoundary';
import { TerrainBrushController } from './terrain/TerrainBrushController';
import { BuilderObjectsLayer } from './builder/BuilderObjectsLayer';
import { ProceduralObjectsLayer } from './builder/ProceduralObjectsLayer';
import { BuilderController } from './builder/BuilderController';
import { MushroomImportDisplay } from './MushroomImportDisplay';
import { PlacedObjectsLayer } from '@/features/objectEditor/PlacedObjectsLayer';
import { ObjectEditController } from '@/features/objectEditor/ObjectEditController';
import { SiegePortalEffect } from './SiegePortalEffect';
import { EditableWaterLayer } from './terrain/EditableWaterLayer';
import { SciFiShowcase } from './scifi/SciFiShowcase';
import { DemoScene } from './scifi/DemoScene';
import { CityHolePatches } from './scifi/CityHolePatches';
import { SiegeStarDome } from './SiegeStarDome';
import { SciFiCityMusic } from './SciFiCityMusic';
import { DancingDemons } from './DancingDemon';
import { Hoverbike } from './Hoverbike';
import { SetSampler } from './scifi/SetSampler';
import { NightDimmer } from './NightDimmer';
import { useSiegeLighting } from './siegeLighting';
import { WaterLayer } from './WaterLayer';
import { WorldObjectsLayer } from './WorldObjectsLayer';
import { EnchantedFireflies } from './EnchantedFireflies';
import { EnchantedLighting } from './EnchantedLighting';
import { MonsterEnemy } from './MonsterEnemy';
import { SiegeMonsterParade } from './SiegeMonsterParade';
import { SiegeItemGrid } from './SiegeItemGrid';
import { MeshColliderPlayer } from './MeshColliderPlayer';
import { WorldBoundsWall } from './WorldBoundsWall';
import { MeshHeightmapBaker } from './MeshHeightmapBaker';
import { SiegeBoulders } from './SiegeBoulders';
import { SiegeTeleport } from './SiegeTeleport';
import { SprayAttackRenderer } from './spray/SprayAttackRenderer';
import { DarkLordLightning } from './darkLord/DarkLordLightning';
import { BloodRenderer } from './BloodRenderer';
import { BleakrockLighting } from './BleakrockLighting';
import { UnderwaterEffect } from './UnderwaterEffect';
import { ChallengeRunner } from './challenge/ChallengeRunner';
import { SiegeSpawnIntro, SiegeSpawnIntroLiveTriggers } from './spawnintro/SpawnIntroCinematic';
import { SiegeSelfAvatar } from './SiegeSelfAvatar';
import { RegionSpawnerRunner } from './challenge/RegionSpawnerRunner';
import { CombatTelemetryProbe } from './CombatTelemetryView';
import { DamageNumbers } from './DamageNumbersLayer';
import { GhostExplosions } from './GhostExplosion';
import { SiegeExplosions } from './SiegeExplosion';
import { isSiegeLoadActive, completeSiegeWorldLoad, siegeLoadNote } from './siegeInitLoad';
import { setMapLoadStatus } from './mapLoadStatus';
import { SiegeAssetProgress } from './SiegeAssetProgress';
import { getChallengeState, subscribeChallenge } from './challenge/challengeStore';
import { useSyncExternalStore } from 'react';

const selectActive = () => getChallengeState().active;

export function SiegeWorldLayers({ world }: { world: WorldDefinition }) {
  // Track WHICH world is ready (not a bare bool). Derived at render → switching maps makes
  // terrainReady instantly false for the new world with NO effect, avoiding the effect-order
  // race where the parent's reset ran AFTER the child ground's onReady and clobbered it to
  // false (which silently hid everything in this block — incl. the sci-fi showcase).
  const [readyWorld, setReadyWorld] = useState<string | null>(null);
  const [objReadyWorld, setObjReadyWorld] = useState<string | null>(null);
  const lightingMode = useSiegeLighting();   // Admin/Weather "Night Mood" preview
  const terrainReady = readyWorld === world.id;
  const objectsReady = objReadyWorld === world.id;
  const signalReady = () => setReadyWorld(world.id);
  // While a challenge is running, hide the ambient beach enemies + parade so ONLY challenge
  // monsters are in the world.
  const challengeActive = useSyncExternalStore(subscribeChallenge, selectActive, selectActive);
  // Blank builder canvases (flat or editable heightmap, e.g. Builder Sandbox) get NONE of the
  // SWW-specific scenery/enemies/regions — just ground + spawn + the builder tools.
  const kind = world.ground.kind;
  const isHeightmap = kind === 'heightmap';
  // Mini Earth: a real sphere, so it has no flat ground, no XZ bounds and no SWW scenery.
  // It counts as "blank" for gating purposes (bright fill light, none of Bleakrock's
  // place-bound content), but it is otherwise a FULL siege map: weapons, jumping, panels,
  // crypto, coins, challenges and @-spawn all mount exactly as on every other siege map.
  const isGlobe = kind === 'globe';
  // ONE FLAG WAS DOING TWO JOBS, AND SPLITTING THEM IS THE WHOLE FIX.
  //
  // `isBlank` was flipped off for the globe in order to remove a bright flat fill light — which was
  // right, that fill is exactly why the Mini Earth read washed out. But this flag does not only mean
  // "add fill light". It gates NINE things, and the one that matters most is the load-completion
  // condition below: `terrainReady && (objectsReady || isBlank)`.
  //
  // With it off, the Mini Earth stopped being allowed to finish loading until SWW's scenery loader
  // had finished — so the globe sat forever on "Loading World... Loading 1673 object types",
  // dutifully trying to place the Bleakrock lobby's trees and rocks on a planet. It also switched on
  // Bleakrock's own lighting, the portal effect, the item grid and the region spawners.
  //
  // Geoff: "It's stuck on 'Loading World... Loading 1673 object types'... It's not loading and
  // basically just very broken."
  //
  // So the CONTENT meaning stays as it was — the globe is blank, it has no SWW scenery — and the
  // LIGHTING meaning gets its own flag. A flag whose name describes one thing while it controls nine
  // is a trap that will be stepped in again; naming the second one after what it actually does is
  // the cheapest possible guard.
  // The globe is NOT given the blank-map fill any more — GlobeLighting supplies it instead, so
  // there is exactly one thing lighting this map and the panel's Fill sliders actually control it.
  // With the panel's master switch off, GlobeLighting emits the identical fill this used to add, so
  // nothing changes until somebody asks for it.
  // THE GLOBE IS BLANK, AND IT HAS TO STAY IN THIS LINE. It was dropped from here once already and
  // came straight back as Geoff's "there's now a center panel that says 'Loading 1673 object types'
  // and it's not disappearing" — because without it, WorldObjectsLayer mounts on the Mini Earth and
  // starts placing the Bleakrock lobby's trees and rocks on a planet that has none. The lighting
  // meaning that motivated removing it lives in `wantsFillLight` below; do not merge them again.
  const isBlank = kind === 'flat' || isHeightmap || isGlobe;
  /**
   * Does this map want the builder-map fill light?
   *
   * Blank maps get a bright flat fill so object textures read clearly.
   * with a real elevation, shadows, and sky bounce instead of fill. Stacking the builder fill on top
   * of that is over 1.0 of directionless light, and directionless light cannot make a bright side
   * and a dark side — which is the literal cause of "everything looks soft and washed out".
   */
  const wantsFillLight = isBlank && !isGlobe;
  // Enchanted Forest uses heightmap GROUND but is a finished reconstructed map, not a build canvas —
  // so it keeps the terrain/water but drops the in-world terrain-brush + object-builder tools/modals.
  const isBuilderMap = isHeightmap && !isEnchantedForest(world.id);
  // Let falling coin drops land on the mesh terrain (no voxels here) instead of dropping through it.
  useEffect(() => { setCoinGroundSampler(sampleHeight); return () => setCoinGroundSampler(null); }, []);
  // Diagnostic: timestamp when the siege scene first mounts, so the init log shows whether the long
  // pre-terrain gap is BEFORE the scene mounts (canvas/scene gating) or after (terrain effect delay).
  useEffect(() => { siegeLoadNote('SiegeWorld', 'Scene mounted — building world...'); }, []);
  // Finish the World-Initialization overlay once the LOBBY is actually on screen: terrain up AND
  // objects loaded (blank builder maps have no objects, so terrain alone). Only acts during a SWW
  // startup the orchestrator armed — a no-op for in-game map switches.
  useEffect(() => {
    if (isSiegeLoadActive() && terrainReady && (objectsReady || isBlank)) completeSiegeWorldLoad();
  }, [terrainReady, objectsReady, isBlank]);
  // Map-switch load modal is driven directly by the terrain (HeightmapTerrain) then object
  // (WorldObjectsLayer) loaders, in order. Just clear it if the siege scene unmounts mid-load.
  useEffect(() => () => setMapLoadStatus(null), []);
  return (
    <>
      {/* Ground first — signals ready so everything else mounts on top of it. */}
      {/* key={world.id}: force the ground layer to REMOUNT on a world switch so it re-runs its
          load effect and re-fires onReady. Without this, returning to the lobby left `readyWorld`
          stale on the previous map's id (TerrainLayer has no world prop / stable deps and never
          re-signals), so terrainReady stayed false forever → lobby objects never un-hid. */}
      {isGlobe
        ? <GlobeTerrain key={world.id} onReady={signalReady} />
        : isHeightmap
          ? <HeightmapTerrain key={world.id} world={world} onReady={signalReady} />
          : kind === 'flat'
            ? <FlatGroundLayer key={world.id} world={world} onReady={signalReady} />
            : <TerrainLayer key={world.id} onReady={signalReady} />}
      {/* Builder/blank maps (Builder Sandbox, City Demo) drop the SWW horror fog, so faces away
          from the sun go near-black with only the base ambient. Add bright fill light so
          all object textures read clearly (esp. the tall city buildings). */}
      {wantsFillLight && (
        <>
          <ambientLight intensity={world.fill?.ambient ?? 0.7} />
          <hemisphereLight args={['#ffffff', '#b9c4d0', world.fill?.hemi ?? 0.6]} />
        </>
      )}
      {/* Night maps (SciFi City) OR the Admin/Weather "Night Mood" preview toggle on any world:
          dim the shared sun/sky so emissive signs/windows glow against a dark scene. */}
      {(world.night || lightingMode === 'night') && <NightDimmer />}
      {/* Enchanted Forest — dusk-blue fog + dark background, re-asserted each frame so the global
          day/night system (which drives scene.fog/background from the sky) can't strip the mood. */}
      {isEnchantedForest(world.id) && <EnchantedLighting />}
      {/* Editable maps get the in-world terrain brush (controller; panel is in the HUD)
          and adjustable flood water; static maps keep the SWW ocean (WaterLayer). */}
      {isBuilderMap && <TerrainBrushController />}
      {/* Drop-in object builder: render placed objects always (so saved maps show them in play),
          and the placement controller (no-ops unless build mode is on). */}
      {isBuilderMap && <BuilderObjectsLayer />}
      {isBuilderMap && <ProceduralObjectsLayer />}
      {isBuilderMap && <BuilderController />}
      {/* Universal placed-objects system (works on every SWW map). Renders objects from the
          shared world_objects table; the controller is a no-op until edit mode (backtick) is on. */}
      <PlacedObjectsLayer worldId={world.id} />
      <ObjectEditController />
      {/* Magic-portal VFX inside the lobby warp gate (SWW world only). */}
      {!isBlank && <Suspense fallback={null}><SiegePortalEffect /></Suspense>}
      {/* (Magic Chest model removed — the lobby already has a chest at the spot; the open/spin
          interaction lives in MagicChestPanel and works on that existing chest.) */}
      {/* Mini Earth: the Kaiju + its cycle/scale keys. Only on the globe map, so its keys
          cannot collide with play keys anywhere else. */}
      {/* Mini Earth: altitude-tracking near/far planes + fog off. Without this the planet is
          entirely outside the 6,000-unit far plane and fogged out on top. */}
      {isGlobe && <GlobeCamera />}
      {/* All the Mini Earth's light, driven entirely by the Lightning Panel (Ctrl+L). Master switch
          off = exactly what this map rendered before any of it existed. */}
      {isGlobe && <GlobeLighting />}
      {isGlobe && <GlobeCloudsGate />}
      {isGlobe && <Suspense fallback={null}><GlobeStarfield /></Suspense>}
      {/* Kaiju: suspends while its model loads, so it needs its own Suspense boundary. Without
          one the suspension propagates up and can take neighbouring layers with it, and an error
          would white-screen the game as the warpgate did. */}
      {isGlobe && (
        <GlobeErrorBoundary label="kaiju">
          <Suspense fallback={null}><KaijuLabController /></Suspense>
        </GlobeErrorBoundary>
      )}
      {isGlobe && <KaijuWalkController />}
      {/* One portal per Divi node location: the game board is decided by where nodes run.
          Wrapped: a decorative asset must never be able to take the whole game down, which is
          exactly what happened when the warpgate model failed to fetch. */}
      {isGlobe && (
        <GlobeErrorBoundary label="portals">
          <GlobePortals />
        </GlobeErrorBoundary>
      )}
      {/* The globe has NO separate water layer: the sea surface is the terrain mesh clamped up to
          sea level (see GlobeTerrain). A separate shell z-fought the terrain across the whole
          planet, because the depth buffer at orbit range cannot separate them. */}
      {isGlobe
        ? null
        : isHeightmap ? <EditableWaterLayer world={world} /> : <WaterLayer world={world} />}
      {/* Quick-travel: Ctrl/Cmd+J then 1-8. Always available in Siege. */}
      <SiegeTeleport />
      {/* Renders + simulates monster breath-weapon particles (acid vomit, etc.). */}
      <SprayAttackRenderer />
      {/* Dark Lord fingertip lightning bolts (three.js LightningStrike). */}
      <DarkLordLightning />
      {/* Bullseye blood spray — teardrop droplets + fading decals. */}
      <BloodRenderer />
      {/* Dark, cold horror fog + dimming scrim that fades in as you approach Bleakrock. */}
      {!isBlank && <BleakrockLighting />}
      {/* Underwater murk + breath/drowning damage below the sea surface. */}
      {world.water?.[0]?.surfaceY != null && <UnderwaterEffect level={world.water[0].surfaceY} />}
      {/* Challenge wave engine. Start/stop the test challenge with the "!c" command. */}
      <ChallengeRunner />
      {/* Cinematic spawn intro: character arrives → world loads → countdown → camera dollies into
          the head → FPS. ChallengeRunner.start() fires it; a no-op until then. Owns the camera while
          it plays (FortressControls stands down via isSiegeIntroActive). */}
      <SiegeSpawnIntro />
      {/* Real-game triggers: auto-fire on the open-world spawn + Space/Enter countdown bypass. */}
      <SiegeSpawnIntroLiveTriggers />
      {/* Third-person self-avatar: your own character, shown when the Alt+wheel camera is zoomed out. */}
      <SiegeSelfAvatar />
      {/* Combat recorder probe — feeds player position to the telemetry every frame. */}
      <CombatTelemetryProbe />
      {/* Floating combat damage numbers (Unity FloatingDamageText port). */}
      <DamageNumbers />
      {/* Ghost death blasts (transparent-black explosion + heat-haze refraction). */}
      <GhostExplosions />
      {/* Siege rocket-blast pool (dancing-demon landings + other fireSiegeExplosion callers). */}
      <SiegeExplosions />
      {/* Tracks real model/texture loading (useProgress) → marks objects ready when ALL have loaded,
          so the overlay's "Lobby ready" is honest (not fired the instant placements.json arrives). */}
      <SiegeAssetProgress onAllLoaded={() => setObjReadyWorld(world.id)} />

      {terrainReady && (
        <>
          {/* SWW scenery + colliders — only on the real terrain map, not flat canvases. */}
          {!isBlank && (
            <Suspense fallback={null}>
              <WorldObjectsLayer meshColliders={world.meshColliders} onReady={() => setObjReadyWorld(world.id)} />
            </Suspense>
          )}
          {world.meshColliders && <MeshColliderPlayer />}
          {/* Bleakrock 2 — the cropped Bleakrock town objects on the editable island (shared
              /siege/world glbs + textures, filtered placements in /siege/bleakrock2). Mesh colliders
              so the player collides with the real object shapes, not loose boxes. */}
          {world.id === 'bleakrock2' && (
            <Suspense fallback={null}>
              <WorldObjectsLayer meshColliders dataDir="/siege/bleakrock2" renderDist={320}
                onReady={() => setObjReadyWorld(world.id)} />
            </Suspense>
          )}
          {/* Hard arena walls for walled maps (Yeti Time). No-op unless the world sets `wallBox`. */}
          <WorldBoundsWall />
          {/* Bake a real heightmap from the glTF collider mesh so the player + monsters sit on the true
              surface (these baked-mesh maps have no real heightfield — only a flat Y=0 fallback plane). */}
          <MeshHeightmapBaker active={world.id === 'yeti-time' || world.id === 'adventure-demo' || isEnchantedForest(world.id)} />
          {/* Elemental Golem boulder projectiles (simulated + drawn in-game, not just the lineup). */}
          <SiegeBoulders />
          {/* Press "I" to show a floating grid of every game item over spawn (SWW review only). */}
          {!isBlank && <SiegeItemGrid />}
          {/* TEMP: sci-fi conversion verification grid (Builder Sandbox only). Remove when the
              Phase 3 drop-in palette lands. */}
          {world.id === 'builder-sandbox' && <SciFiShowcase />}
          {/* Imported mushroom-tree FBX models, side by side at native height (laser-pickable). */}
          {world.id === 'builder-sandbox' && (
            <Suspense fallback={null}><MushroomImportDisplay /></Suspense>
          )}
          {/* Pole-dance girls in the SciFi City nightclub. */}
          {world.id === 'city-demo' && <DancingDemons />}
          {/* Baked Synty asset-set demos + their BVH colliders (one per demo map). */}
          {world.id === 'city-demo' && (
            <Suspense fallback={null}>
              <DemoScene file="city_demo.gltf" group="citydemo" lowerY={2.8} hidePlanet />
              <MeshColliderPlayer />
              <CityHolePatches />
              <SiegeStarDome radius={300} />
              <SciFiCityMusic />
              <Hoverbike />
            </Suspense>
          )}
          {/* Apocalypse City — converted from the Synty demo scene into individual instanced objects
              (placements + colliders + laser-taggable), with the editable heightmap ground under it. */}
          {world.id === 'apoc-city' && (
            <Suspense fallback={null}>
              {/* noMonsterColliders: apoc is explore-only (no monsters) AND has world-scale scenery
                  (mountains span ~1290m) — voxelizing those into monster collision boxes was a
                  multi-second hang / OOM that crashed the tab. Player floor-collision (BVH) stays on. */}
              {/* HOLDING STATE: the apoc components are complex 49-mesh BUILDINGS, so meshColliders
                  (a BVH per mesh) hangs for minutes and the streaming budget then culls most of the
                  multi-mesh city (reads as transparent/see-through). Until the city is baked into merged
                  spatial CHUNKS, run it collider-free + a modest budget so it at least loads safely
                  (visual only; player stands on the heightmap terrain). trustMaterials keeps textures. */}
              <WorldObjectsLayer trustMaterials noMonsterColliders dataDir="/siege/apoc" renderDist={90} maxGroups={60} maxInstances={2500} />
            </Suspense>
          )}
          {/* Enchanted Forest — instanced reconstruction of the Synty Demo_01 scene on its baked
              terrain mesh. trustMaterials keeps the baked emissive glow maps; per-instance streaming
              + budgets keep the ~18.7k objects (mostly leaf/fern cards) performant. */}
          {isEnchantedForest(world.id) && (
            <Suspense fallback={null}>
              {/* Render the WHOLE forest: maxInstances must exceed the ~18.7k total or the closest-first
                  budget gets eaten by the ~8.6k canopy leaf cards and starves the trees/mushrooms/ferns
                  (which leaves the leaves floating with no trunks under them). renderDist covers the map. */}
              {/* Perf: structural objects (trees/rocks) visible to 130 m; the ~8.6k alpha leaf/fern
                  cards (the overdraw cost) culled at 55 m. Fog hides the pop-in. maxInstances high so
                  nothing is starved in the near field. Both maps share the model folder; the (Bad)
                  snapshot just loads its own frozen placements file (rocks still in the grotto). */}
              <WorldObjectsLayer meshColliders trustMaterials noMonsterColliders emissiveBoost={3} dataDir="/siege/enchanted-forest" placementsFile={world.id === 'enchanted-forest-bad' ? 'placements-bad.json' : 'placements.json'} renderDist={130} foliageDist={55} maxGroups={130} maxInstances={20000} />
              <MeshColliderPlayer />
              <EnchantedFireflies />
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
          {/* Yeti Time — the SAME Adventure Town geometry (identical world coords), walled into the
              snowy-cabin area by WorldBoundsWall (mounted below, reads the map's wallBox). */}
          {world.id === 'yeti-time' && (
            <Suspense fallback={null}>
              {/* Same Adventure Town geometry, tinted 80% pure white for the snowy look. */}
              <DemoScene file="adventure_demo.gltf" group="yetitown" lowerY={2.5} tintWhite={0.8} tintMatch="FloorTile|DirtMound|GroundMound|Hill|SnowPile|Ice|Road" />
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
          {world.id === 'mining-grid' && <SetSampler set="mining" />}
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
