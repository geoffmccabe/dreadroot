# Goggles Feature — Implementation Plan

> Status: PLAN ONLY. Do not implement until the voxel-collision rework is
> confirmed stable in real play. Build order in §9.

## 1. Concept & why it's also a performance solution

The goggles are a deliberate, bounded, on-demand long-range view. Normal play
runs with thick fog and a short load/render distance (cheap, scales no matter
how many trees exist in the world). The goggles let the player intentionally
"stop and look far" for a limited moment. The grow + clarity animation is the
budget window during which the engine streams and prepares the far data; the
pixelation isn't just an aesthetic — rendering the far scene at low resolution
first is genuinely cheap, and we sharpen it in stages as the far chunks finish
loading. On close, the far data is released. This converts "render everything
far, always" (impossible at 50× trees) into "render a thin slice, briefly, at
escalating detail, on demand" (feasible).

## 2. Dependencies / prerequisites & normal-play far skirt

- **Fog must actually gate loading.** Normal play must shrink load distance,
  collision distance and chunk retention to the fog distance — not just draw
  visual fog over a still-loaded world. (Visual-only fog buys nothing.)
- **A cheap far-tree representation must exist** (impostor / billboard /
  low-detail trees). The goggles render far trees at this reduced detail;
  rendering thousands of full 300-block trees even once = a multi-second
  freeze. (Same low-detail/LOD work flagged in the architecture review.)
- **Normal-play cheap far skirt (new, experimental):** beyond the full-detail
  fog radius, always render an extra **+1 to +2 chunks (by radius)** using the
  cheap far-tree representation, even without the goggles. This widens the
  felt view distance affordably during ordinary play. Treat the skirt width
  as a single tunable number; ship it, watch the DF report, and if it bogs
  the game down we reduce it or find another solution later. The goggles
  extend *beyond* this skirt, also using the cheap representation.
- Voxel-collision rework verified stable (current work).

If the cheap far representation isn't ready, the goggles can still ship
visually, but the far view must be capped very low (few extra chunks, heavy
pixelation that never fully sharpens) until it exists.

## 3. The button

- Location: bottom of the UI, directly **below the GEAR button**.
- Shape: two equal-radius circles overlapping like a Venn diagram, with the
  distance between their centers equal to the radius (each circle's edge
  passes through the other's center — classic binocular/vesica silhouette).
- Colors: the circle **edge color and fill color must exactly match the GEAR
  button's box** (border + background). At implementation, read the gear
  button's actual style tokens / CSS variables and reuse the *same* tokens
  (not hardcoded copies) so they stay in sync if the theme changes.
- Tap to open the goggles overlay. (No separate "hold to charge" — the grow +
  clarity animation IS the prepare window.)

## 4. The goggles overlay

- A full-screen layer: everything **outside** the goggle shape is black at
  **90% opacity**; **inside** the shape is a clear view of the 3D scene
  (rendered through a mask in the binocular shape — implement via SVG mask or
  CSS clip-path of the two-circle union).
- Geometry: two equal-radius circles side by side, centers one radius apart.
  Final size: scaled so the circle **diameter equals the available viewport
  height** (shape is ~1.5× as wide as it is tall), centered on screen.
- Appear animation: the shape **grows from a point at screen center to full
  size over ~1 second** (scale up).
- Close: **clicking anywhere closes** the overlay, restores normal controls,
  and tears down the far view (revert distance/fog, release far chunks/memory).

## 5. Clarity / pixelation effect (aesthetic + real performance mechanism)

- On open, the view through the goggles starts heavily pixelated and sharpens
  in discrete stages: pixel block size steps **100 → 50 → 25 → 13 → 6 → 3 → 2
  → 1**.
- Implemented as **render-resolution scaling**: the far scene is first drawn
  into a low-resolution buffer (very cheap even with lots of far geometry) and
  the buffer resolution is increased each stage. The stages double as the
  performance ramp — show *something* immediately at low cost, only pay full
  render cost once (and if) the far chunks have finished streaming.
- Total duration of the full clarity sequence is **tier-dependent** (see §7).
- If far chunks haven't finished loading by a stage, that stage holds (stays
  pixelated) until data is ready rather than showing holes.

## 6. Far-view rendering behaviour

- While the goggles are open the player is **stationary** ("stop and look").
- On open: temporarily extend render/fog/load distance by the tier's chunk
  bonus, **in the player's current facing direction only** (a forward
  snapshot — far cheaper than a 360° sphere). Stream + cheap-mesh those far
  chunks during the grow + clarity window. This extends beyond the normal-play
  far skirt (§2).
- On close: immediately revert distance/fog to normal and release the far
  chunks so memory returns to the normal small footprint.
- Open question: whether higher tiers may allow limited look-around while open
  (costs more far-render) vs. always forward-only. Default: forward-only.

## 7. Tier system & progression

- **Every character has a built-in Tier 0 goggle** — the unlisted base item.
  It is standard equipment, never shown in inventory, and defines the baseline
  view distance + clarity speed.
- Finding or buying a **Tier 1 goggle item is the first improvement over the
  Tier 0 base**. Each further upgrade item raises the tier by one, up to a
  defined max.
- Effective tier model: `effectiveTier = clamp(upgradeItemsOwned, 0, MAX_TIER)`
  — 0 = built-in base, +1 per acquired upgrade item.
- Two parameters scale with tier: (a) extra chunks of visibility, (b) speed of
  the clarity sequence.

| Tier | Source | Extra chunks visible | Clarity sequence duration |
|------|--------|----------------------|---------------------------|
| 0 | built-in, unlisted (everyone) | +2 | ~1.0 s total (≈125 ms/step over 8 steps) |
| 1 | first acquired item | +3 | ~0.5 s total |
| 2 | upgrade item | +4 | faster… |
| … | upgrade item | +1 per tier | continues decreasing |
| Max | capped | capped value | capped fastest |

(Exact per-tier numbers and MAX_TIER finalized at implementation. The tier
table is a single tunable config object — values changeable without code
changes. Note: the goggle "extra chunks" are *in addition to* the normal-play
cheap far skirt from §2.)

## 8. Open questions to confirm before implementing

1. **Clarity timing meaning:** is "Tier 0 = one-second clarity" the *whole*
   8-step sequence in ~1 s (assumed here, ≈125 ms/step), or 1 s *per step*
   (= 8 s, very long)? Assumed: whole sequence ≈ 1 s at Tier 0, ≈ 0.5 s at
   Tier 1, etc.
2. **Look-around while open:** forward-only snapshot for all tiers (assumed),
   or do higher tiers allow turning?
3. **Movement while open:** player fully stationary/locked (assumed) — confirm.
4. **Pixelation scope:** only the view inside the goggle shape (assumed), or
   the whole screen?
5. Behaviour if the player is attacked / takes damage while goggles are open
   (auto-close? vulnerable on purpose?).
6. Cooldown / energy cost between uses, or unlimited? (Not specified yet.)
7. Normal-play far-skirt width: start at +1 or +2 chunks? (Assumed +2; tune
   down via the DF report if it bogs the game.)

## 9. Suggested build sequence

1. Confirm voxel-collision rework stable (current debugging).
2. Make fog/render/load/collision distance actually short and gated (the real
   scaling change; standalone value even without goggles).
3. Cheap far-tree representation (impostor/billboard/low-detail), including
   the normal-play +1–2 chunk far skirt (§2) — measure with DF, tune.
4. Goggles UI: button (shape + matched colors), overlay mask + black 90%,
   grow animation, click-to-close.
5. Clarity pixelation via render-resolution staging.
6. Forward far-view: extend distance on open, stream at low detail, release
   on close.
7. Tier config: built-in Tier 0 + item-driven upgrades (Tier 1+).
8. Tune per-tier numbers and skirt width; playtest.
