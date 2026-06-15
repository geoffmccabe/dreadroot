# Siege Worlds — Primitive Colliders (plan)

Replace voxel-box colliders with a small set of **fitted primitives** (oriented boxes, plus
capsules/spheres for rounded shapes) per object. Goals:

- **Tighter fit** — stand on the object's *real* surface instead of a 1m voxel cell boundary, so
  no more floating ~1m above rocks.
- **Far fewer colliders** — a rock that needs 50–70 voxels needs ~1–4 primitives.
- Same **authoring / persistence / bake** pipeline we already built (V tool → localStorage →
  shipped `collider_overrides.json`).

This is an *alternative* to voxels; voxels stay as a fallback during the transition.

---

## Why voxels float (the problem we're fixing)

Voxels snap to a 1m grid, so a rock's top rests at the nearest cell boundary — up to ~1m above
(or below) the actual surface. A primitive (OBB/capsule) hugs the mesh, so the "ground height at
(x,z)" query returns the true surface and the player/monsters stand exactly on it.

---

## Off-the-shelf survey

| Option | What it gives | Usable here? |
|---|---|---|
| **three.js `OBB`** (`examples/jsm/math/OBB`) | Oriented box + intersection (OBB↔OBB, OBB↔sphere, ray↔OBB) | **Yes** — ready primitive + half the collision math. |
| **PCA-fit OBB** (covariance → eigenvectors) | One tight oriented box around a mesh | **Yes** — small in-code algorithm. |
| **Ritter / Welzl bounding sphere**, PCA capsule | Sphere/capsule fit | **Yes** — small in-code algorithms. |
| **CoACD** (best convex decomposition) | Multiple convex hulls, great fit | **Not directly** — no browser/JS/WASM build (Python/Blender/Unity only). Would need offline tooling (Blender export) or compiling CoACD to WASM ourselves. Defer. |
| **V-HACD** | Convex hulls (older) | Deprecated/EOL. |

**Conclusion:** build it ourselves with OBB (+ capsule/sphere) using three.js's OBB math and
standard fitting algorithms. Convex hulls (CoACD) are a *future* upgrade needing offline tooling.

---

## The core challenge

Our collision is an **axis-aligned `Box3` spatial grid** (`worldCollisionGrid`). Every physics
consumer assumes AABBs:
- player movement + floor clamp (`FortressControls`),
- monster ground/wall/standable + climb (`MonsterEnemy`),
- grenade bounce (`grenadePhysics` / `useGrenadeSystem`),
- bullet ricochet (`useFortressFrameLoop`).

So the real work is teaching the collision system to hold and test **tagged primitives**
(`aabb | obb | sphere | capsule`). The spatial hash still broadphases by each primitive's world
AABB; the narrowphase runs the right test per kind. **This must be additive** — AABB stays the
default, so Dreadroot's voxel world is untouched and can't regress.

---

## Phased plan

### Phase 0 — Decide the primitive set
Recommended workhorses: **OBB** (rocks, buildings, crates — 1–4 per object) + **capsule/sphere**
(rounded boulders — smooth top, zero float). Skip full convex hulls for now.

### Phase 1 — Collision primitive abstraction (the foundation, most of the work)
- A `Primitive` shape: `{ kind, ...params }` (`obb` = center+halfExtents+rotation; `sphere` =
  center+radius; `capsule` = p0+p1+radius). Each carries a precomputed world **AABB** for the grid.
- Extend `worldCollisionGrid` to store primitives keyed by their AABB (broadphase unchanged), and
  expose narrowphase helpers consumers call on the returned candidates.
- Implement the tests each consumer needs:
  1. **Ground height at (x,z)** — the top surface of a primitive under a column. Kills the float;
     used by monster `groundY` and the player floor clamp.
  2. **Point/short-capsule push-out** — player & monster horizontal collision (slide along faces).
  3. **Ray ↔ primitive** — grenade bounce + bullet ricochet.
- three.js `OBB` covers OBB↔sphere and ray↔OBB; we add the "top surface at column" and capsule
  cases.

### Phase 2 — Authoring tool (extend the V tool into "primitive mode")
- Aim + key: **fit primitives** to the pointed mesh instead of voxelizing.
- `<` / `>` adjusts the **count/fit** (1 OBB → split into 2–3 → …) or cycles the primitive type
  (OBB ↔ capsule ↔ sphere). Live readout shows the primitive count.
- Reuse the existing persistence: localStorage per edit + **Ctrl/Cmd+B** to copy/bake into
  `collider_overrides.json` (extend the saved format to store primitive specs, not just `cell`).

### Phase 3 — Auto-fit algorithms (in-code)
- **PCA-OBB**: covariance of the mesh vertices → eigenvectors = box axes → extents from the
  projected min/max. One tight oriented box.
- **Multi-OBB** ("poor-man's convex decomposition"): split the mesh along its longest axis (or
  k-means on vertices) into N parts, OBB each. `<`/`>` controls N — the tuning loop you already
  like, but with boxes that actually fit.
- **Sphere (Ritter)** / **capsule (PCA main axis + radius)** for rounded rocks.

### Phase 4 — Migration + fallback
- Per object, the author picks **primitive vs voxel** (voxels remain for awkward shapes).
- Persist/bake both kinds in `collider_overrides.json`.
- Voxels keep working throughout — no big-bang switch.

### Phase 5 (future) — Convex hulls via CoACD
- If OBBs aren't enough for organic shapes: run CoACD **offline** (Blender) to export convex
  hulls, or compile CoACD to WASM. Add a `hull` primitive + GJK/EPA narrowphase. Largest lift;
  only if needed.

---

## Effort & risk
- **Phase 1 is the meat and the risk** — it touches the shared collision math used by the player,
  monsters, and weapons in **both** games. Mitigation: primitives are an additive `kind`; AABB
  stays default; Dreadroot voxel collision path is unchanged and regression-tested.
- Phases 2–3 are self-contained (the authoring tool + fitting math), low risk.
- Net result: dozens of voxels → a handful of primitives, exact surface standing, similar or
  better perf (fewer grid entries, slightly heavier per-primitive narrowphase).

## Open decisions
1. **Primitive set**: OBB-only (simplest) vs OBB + capsule/sphere (smoother rounded rocks).
2. **Replace or coexist**: keep voxels as a fallback (recommended) vs fully replace.
3. **Build OBB now** vs invest in offline CoACD convex hulls later (recommended: build OBB now,
   keep CoACD as a future option).

## Sources
- three.js OBB: https://threejs.org/docs/#examples/en/math/OBB
- CoACD: https://github.com/SarahWeiii/CoACD
- Bounding spheres (Ritter/Welzl): https://github.com/AntonSemechko/Bounding-Spheres-And-Circles
