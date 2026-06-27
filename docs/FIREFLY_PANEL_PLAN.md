# Firefly World-Builder Panel — Plan

A world-building panel for authoring the ambient firefly life of a map. Modeled on the **Challenge
Creator** UI: a stack of **cards**, where each card = one **species** of firefly (instead of a
combat wave). Authors mix species to set a world's "vibe."

## Already built (this slice)
- **Data model + store** — `src/components/siege/fireflies/fireflySpecies.ts`:
  `FireflySpecies` (every value the panel exposes) + a zustand store (`useFireflyStore`) holding the
  live species array + `panelOpen`. `defaultSpecies()` = Geoff's randomized "standard" look.
- **GPU renderer** — `EnchantedFireflies.tsx` rewritten to render every enabled species from the
  store as additive `THREE.Points`. ALL behaviour runs in the shader off per-point attributes:
  - colour: base purple → drift toward **fuchsia** or **blue** per point; 10% **fully random** hue.
  - motion: **±50% speed** variance; 10% extra **sine wobble**; horizontal drift radius.
  - **high-flyers**: 10% roam high into the trees at **3× speed** (feels like another species).
  - **pulse/blink**: per-point duty cycle from "always on" → "lit 10% of the time"; **0–2s fade**
    in/out (some snap, some breathe slowly).
  - **LOD**: distance-cull fade beyond ~95 m; all animation is GPU, so high counts stay cheap.
- It reads the store live, so the panel just needs to mutate species → instant visual update.

## The panel UI (BUILT — v4.204.0)
`src/components/siege/fireflies/FireflyPanel.tsx` — HTML panel rendered **outside the Canvas**
(portal to `<body>`), styled to match the Challenge Creator's dark-HUD chrome + card look,
reading/writing `useFireflyStore`. Mounted in `Fortress.tsx` next to `ChallengeCreatorPanel`.

**Spawn codes** (self-contained `@F` keyboard parser inside the panel component):
- `@FF` → toggle the panel.
- `@F<code>` → spawn (enable) the species with that GLOBAL code. Each card shows its `@F<code>`
  badge; codes start at #1 for the built-ins, `addSpecies` hands out the next code. Permission:
  a player may only spawn their OWN species (`ownerId`); admin/superadmin may spawn any
  (`spawnByCode` enforces it; an on-screen toast reports ok / not-yours / no-such-firefly).

Each species card: code badge, name, enable/duplicate/delete, collapse, and grouped sliders —
Density &amp; Colour (count, size, base swatch, fuchsia/blue/random drift), Motion, High-flyers,
Pulse/Blink, Area. Live: every edit hits the store → the GPU swarm updates instantly.

### Still to build
- Per-map persistence (save the species array into the world record) — see below.
- A build-mode toolbar button as an alternative to the `@FF` command.

Layout (mirrors Challenge Creator):
- **Header**: "Fireflies" + an `+ Add Species` card button (like `+ Spawn`).
- **Species cards** (one per `FireflySpecies`), each collapsible, with:
  - name, enable toggle, duplicate, delete.
  - **Density** (count) + **Size** sliders (top-level, most-used).
  - **Colour**: base swatch, `towardFuchsia`, `towardBlue`, `randomColorPct` sliders.
  - **Motion**: `speed`, `speedVariancePct`, `driftRadius`, `sineWavePct`.
  - **High-flyers**: `highFlyerPct`, `highFlyerSpeedMul`, `highFlyerYBoost`.
  - **Pulse**: `pulseOnFracMin/Max`, `fadeMinSec/Max`.
  - **Area**: `area`, `yMin`, `yMax`.
  - Each control is randomized-by-default; "Randomize" button re-rolls a card.
- **Live preview**: edits hit the store → renderer updates immediately (already wired).

## Persistence
Species live with the map. Save into the world record (the named-worlds persistence layer) /
`mapPersistence` so a built world keeps its firefly ambience. Default world (`enchanted-forest`)
ships with the standard species in code until per-map authoring is saved.

## Noted for later (Geoff — not in this pass)
- **Flocking** — boids-style cohesion/separation per species.
- **Attack / damage** — hostile species that can hurt the player.
- **Capture / collect** — net or proximity-collect for points (ties into Dread Points).
- **Biome / object affinity** — species that congregate around specific props, water, or biomes
  rather than a flat area scatter.
- Day/night activity windows; spawn/despawn over time.
