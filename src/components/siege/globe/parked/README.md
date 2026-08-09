# Parked lighting work

Finished code that is NOT compiled. Renamed to `.txt` so nothing can import it by accident and
so the bundler never sees it — these are notes with working source in them, not modules.

Everything here shipped on 2026-Aug-08 as v4.310.0 and was reverted the same day. It turned the
Mini Earth pure white. Four separate faults were found and fixed during that day, and the screen
was still white afterwards, which means at least one more remains unidentified. Reverting was the
right call: the map has to work.

**Do not re-apply this as a batch.** The reason it went so badly is that six changes landed
together — sun, shadows, terrain material, haze, clouds, grade — so every symptom had six possible
causes and each fix was a guess. Re-introduce ONE at a time, each verified on screen before the
next.

Suggested order, cheapest and most reversible first:

1. **Kill the flat fill** (SiegeWorldLayers: drop `isGlobe` from `isBlank`) and add a single sun.
   This alone is most of the "washed out" complaint. One file, trivially revertible.
2. **Shadows.** Kaiju cast and receive, terrain receives, soldiers receive only.
3. **The grade** (exposure, contrast, saturation, vignette).
4. **The terrain material** (`terrainMaterial.ts.txt`). The biggest visual win and the biggest
   risk: it replaces MeshLambertMaterial with an extended MeshStandardMaterial. Standard picks up
   `scene.environment`, which Lambert largely ignores, so the swap changes overall brightness on
   its own — retune the sun after it, not before.
5. **Haze** (fog below 12 km only; above that it fogs the whole planet white).
6. **Clouds** (`GlobeClouds.tsx.txt`) — blocked on a real problem, see below.

## The known blocker: depth precision

GlobeCamera sets the near plane from height above ground (as little as 0.03) and the far plane
from the horizon (2,000 minimum, hundreds of thousands from orbit). A depth buffer spanning that
ratio has effectively no precision past a few hundred units, so nothing at planetary distance can
be depth-sorted against anything else. That is why the cloud shells painted over the terrain, and
it will affect anything else large and transparent added later.

Fixing it properly means either a logarithmic depth buffer (a renderer-wide change, affects every
map, wants measuring) or compositing the sky by altitude rather than by depth. Both are real jobs.

## What is worth keeping regardless

`scripts/check-terrain-shader.mjs` stays live and passing. It catches the class of bug that cost
most of that day: this project sets `gl.debug.checkShaderErrors = false` in production, so a shader
that fails to compile draws nothing and says nothing. The check verifies the injection points still
exist in three.js AND that they run in the right order.
