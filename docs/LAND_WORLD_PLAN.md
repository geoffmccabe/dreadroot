# LAND WORLD - plan (SWW spun out as a land-ownership metaverse)

Status: **analysis + plan only, nothing built.** Written 2026-Sep-03, against dreadroot v4.352.83.

The idea: take Siege Worlds Web (SWW) and spin it into a separate game the way Divi Kaiju is
separate, sharing the same engine. A single persistent world made of hexagonal land parcels,
100 m across, tiled as a honeycomb into one giant hexagon, that people own, build on, and mine.
Alien Worlds land NFT holders claim a parcel free. Everyone
else buys one. Characters, weapons, combat and inventory carry over unchanged from SWW and
DreadRoot. **This is NOT a voxel game.**

Everything in Section 1 was verified on 2026-Sep-03 (live WAX chain query, and reading the
files named). Everything after that is design, and is marked where it is a recommendation
rather than a decision.

---

## 1. Verified facts

### 1a. Alien Worlds land supply (queried live from the WAX AtomicAssets API)

Collection `alien.worlds`, schema `land.worlds`:

| Fact | Value |
|---|---|
| Land NFTs in existence | **3,343** |
| Distinct templates | 101 |
| Unique holder accounts | **545** |
| Held by the top 10 accounts | 1,226 (37%) |
| Largest single holder | `open.worlds`, 295 (looks like a treasury/contract) |

By planet: Magor 652, Neri 650, Kavian 648, Naron 609, Eyeke 429, Veles 355.

By terrain type (20 types, and this is effectively a free biome list):
Rocky Desert 541, Icy Desert 518, Mountains 425, Tree Forest 247, Icy Mountains 200,
Sandy Desert 179, Methane Swampland 137, Rocky Crater 129, Grassland 116, Grass Coastline 108,
Rocky Coastline 104, Plains 100, Active Volcano 98, Dunes 95, Dormant Volcano 82,
Inland River 72, Geothermal Springs 57, Sandy Coastline 54, Mushroom Forest 49, Small Island 32.

**The original estimate of "around 1000" was low by 3.3x.** This is good news for world density
and bad news for the size of the free-claim audience: only 545 accounts can claim anything, and
a large share of them hold one or two parcels.

### 1b. What the engine can already do

| Capability | Where it lives | State |
|---|---|---|
| Non-voxel render mode | `src/config/gameRegistry.ts` (`usesVoxelWorld: false`) | **Working today.** Siege Worlds already runs this way. |
| Sculptable streamed terrain | `src/components/siege/terrain/heightField.ts`, `HeightmapTerrain.tsx` | Working. Sparse (stores only edited points), streamed by camera distance. |
| Terrain coordinate range | same | **+/- 32,768 m.** The proposed world needs +/- 15,000 m, so it fits with room to spare. |
| Long view distance | `viewCells` in `src/config/worldDefinition.ts` | Proven at 8 cells (about 1 km) on the Bleakrock map. |
| Placing 3D objects | `src/features/objectEditor/` | Working. Move/rotate/scale, saved to a shared `world_objects` table scoped by game + world. |
| WAX NFT gating | `src/features/tokenGates/` | Working. Reads holdings by collection / schema / template and grants named bonuses. This IS the land-claim check. |
| WAX wallet connect | `src/features/wallet/WaxWalletPanel.tsx`, `docs/WAX_SSO_HANDOFF.md` | Our side built. Waiting on 4 changes in the SSO repo. |
| Characters / weapons / combat / inventory | shared registries, already game-agnostic | Carry over with no work. |
| Parkour on non-voxel ground | `src/features/parkour/meshScanner.ts` | Already built as the non-voxel scanner, specifically so SWW terrain works. |
| Ownership + build-authority contract | `docs/NAMED_WORLDS_PERSISTENCE.md` | Specified, not yet implemented. |

Honest assessment: roughly **70% of this already exists**, built for other reasons.

---

## 2. The world (hexagonal)

Parcels are **regular hexagons tiled as a honeycomb**, not squares. Section 2e explains why this
is the right call for this particular design, and what it costs.

### 2a. Parcel geometry

Sized so a parcel still reads as "100 metres across", which is the number in the original spec.

| | |
|---|---|
| Across the flats (and centre-to-centre spacing of neighbours) | **100 m exactly** |
| Side length | 57.74 m |
| Across the corners | 115.47 m |
| Area | 8,660 m2 = **0.866 hectares** |
| Neighbours | **6, all sharing a full edge, all exactly 100 m away** |

The alternative is to hold the area at exactly 1 hectare, which gives a hex 107.5 m across the
flats and 124.1 m across the corners. **Recommendation: use the 100 m spacing above.** The
centre-to-centre spacing is the number the entire coordinate system is built on, and a round 100
is worth more than a round hectare.

### 2b. Total parcel count: the giant hexagon

A honeycomb that itself forms a perfect hexagon always has a **centred hexagonal number** of
parcels. With R rings around the centre parcel:

> **total = 3R^2 + 3R + 1**, and ring r on its own holds 6r parcels.

The sequence is 1, 7, 19, 37, 61, 91, 127 and so on. Candidates near the 90,000 target:

| Rings (R) | Total parcels |
|---|---|
| 170 | 87,211 |
| 171 | 88,237 |
| 172 | 89,269 |
| **173** | **90,307** |
| 174 | 91,351 |
| 175 | 92,401 |

**Recommendation: R = 173, giving 90,307 parcels.** It is the closest centred hexagonal number to
90,000, and it has a small bonus: 90,307 divides exactly by 7 (7 x 12,901), which sits nicely with
a 7-parcel home fortress. That is a divisibility fact and nothing more; seven-parcel rosettes do
tile the plane, but they will not come out flush against a hexagonal boundary, so do not plan on
carving the whole world into tidy 7-blocks.

If the world ever needs to be smaller, the same formula gives clean fallbacks: R = 100 is 30,301
parcels, R = 60 is 10,981, R = 57 is 9,919.

### 2c. World size

| | |
|---|---|
| Total parcels | 90,307 |
| Widest span (corner to corner) | **34.7 km** |
| Narrowest span (flat to flat) | **30.1 km** |
| Total land area | **782 km2** |
| Furthest parcel from the centre | 17.36 km |

That last row matters: the terrain system's coordinate range is +/- 32,768 m, so the world fits
with roughly half the range to spare.

### 2d. The centre: the home fortress

The middle of the world is the centre parcel plus its 6 neighbours, a **7-parcel rosette**, and
**nobody can own any of it**. It is the shared spawn, the fortress, and the starting town.

| Fortress size | Parcels | Across the flats | Area |
|---|---|---|---|
| **Rings 0 to 1 (recommended)** | **7** | **300 m** | **6.1 ha** |
| Rings 0 to 2 | 19 | 500 m | 16.5 ha |
| Rings 0 to 3 | 37 | 700 m | 32.0 ha |

6.1 hectares is about eight football pitches, which is a real town rather than a courtyard. If it
starts to feel cramped once buildings go in, stepping up to 19 parcels is a config change, not a
redesign, so **build it at 7 and leave the door open**.

### 2e. Why hexagons, and what they cost

Three reasons this design specifically wants hexes:

1. **The hexagon has 6 sides and Alien Worlds has exactly 6 planets.** One planet per 60 degree
   sector, radiating from the fortress. Every ring divides by 6 with no remainder, so the sectors
   are *exactly* equal in size, forever, at every radius. On a square grid, six wedges is an ugly
   approximation. This alone is close to decisive.
2. **The centre-proximity perks actually work.** Perks scale with distance from the middle. On a
   square grid the corner parcels of "ring 20" are 1.41x further from the centre than the edge
   parcels of the same ring, so any ring-based perk is quietly unfair. Hex rings are genuinely
   ring-shaped and every parcel in a ring is a comparable distance out.
3. **Six equal neighbours, every one sharing a full edge.** A square has 4 edge neighbours plus 4
   corner neighbours at a different distance, which distorts every adjacency rule (alliances,
   merged plots, resource spread, territory control). Hex adjacency is uniform and needs no
   special cases.

The cost is real but smaller than it first looks. The square plan had one lovely property: parcel
= streaming cell = network zone = save unit, all the same grid. Hexes break that, because the
terrain renderer builds square mesh patches on a square 1 m height lattice.

**The fix is to stop insisting those be the same thing.** They do not have to be:

- **Save unit = the hex parcel.** This is the part that genuinely matters, because it is what
  stops one person's edit rewriting the world (Section 6a).
- **Render and streaming unit = a square cell**, sized to hold many hexes. A cell rebuilds its
  mesh from whatever hex edits fall inside it. Height sampling is bilinear at any position, so
  patch shape and sample lattice are already independent.
- **Network interest area = a radius in metres** around the player, which is what it should have
  been anyway.

What that leaves is a hex-to-cell lookup and a set of hex coordinate helpers. Use standard axial
/ cube coordinates (q, r, s with q + r + s = 0), where the ring number falls straight out as
(|q| + |r| + |s|) / 2 and the world is simply every hex with ring <= 173. It is a well solved
problem with good public references; budget it as a small module, not a research project.

Two smaller costs to accept: minimap and map-UI tiles are square by nature and will need hex
rendering, and people build rectangular buildings, which fit a hexagon slightly less neatly than
a square. At 0.87 hectares neither is a real constraint.

### 2f. Scale in context

The current SWW map is about 2 km x 2 km. The largest existing map is +/- 10 km. This world is
**roughly 200x the area of SWW today**. That is the single biggest engineering fact in this
document, and Section 6 covers what it costs.

---

## 3. Land supply and pricing

### 3a. Supply

| Category | Parcels |
|---|---|
| Total (R = 173 giant hexagon) | 90,307 |
| Reserved: home fortress, rings 0 to 1 | 7 |
| Reserved: Alien Worlds claims, rings 2 to 36 | 3,990 |
| **Available for sale** | **86,310** |

The Alien Worlds reserve is deliberately larger than the 3,343 land NFTs. Section 4b explains
why, and what happens to the surplus.

### 3b. Price

Paid in crypto. Two tiers:

| Tier | Price | What you get |
|---|---|---|
| **Random** | **$5** | The system assigns you a parcel from the current random pool (3c). You do not choose. |
| **Choose** | **$10** | You pick the exact parcel off the map, anywhere unsold. |

Theoretical ceiling if every parcel sold: $432k at the random price, $863k at the choose price.
Treat both as arithmetic, not a forecast.

The two tier split does real work beyond revenue: it sorts buyers by how much they care about
location, and that is what concentrates the built-up area instead of scattering it.

### 3c. The random pool: the innermost 5 bands

The for-sale area is divided into numbered **bands, each 5 rings wide**, starting at ring 37 and
running out to the edge (28 bands in total). Bands are an allocation mechanism, not a place name;
the named regions in 3d are what players actually see.

**A random ($5) purchase draws from the innermost 5 bands that still have unsold parcels.** As an
inner band sells out the window slides outward by one, so the settled area grows outward from the
fortress as a spreading town rather than as dust scattered over 782 km2.

The opening window, bands 1 to 5:

| Band | Rings | Parcels |
|---|---|---|
| 1 | 37 to 41 | 1,170 |
| 2 | 42 to 46 | 1,320 |
| 3 | 47 to 51 | 1,470 |
| 4 | 52 to 56 | 1,620 |
| 5 | 57 to 61 | 1,770 |
| **Opening pool** | **37 to 61** | **7,350** |

That pool is a band roughly 10.6 km across, wrapped immediately around the Alien Worlds core. A
five band window rather than a single band is the right call: it keeps a real element of luck in
the $5 tier (you might land next to the core or five bands out) while still filling from the
inside. The $10 tier keeps its value because a chooser gets a *named* parcel, including parcels
far outside the random window that random buyers cannot reach yet.

### 3d. Regions and the benefits of being near the centre

Rings are the raw measure; regions are what players see. Perks should scale **continuously with
ring number**, not jump at region edges, so there is no cliff.

| Region | Rings | Parcels | Across | Character |
|---|---|---|---|---|
| Fortress | 0 to 1 | 7 | 300 m | Spawn, town, never for sale |
| Homelands | 2 to 36 | 3,990 | 6.4 km | The Alien Worlds claim reserve, 6 planet sectors |
| Districts | 37 to 61 | 7,350 | 10.6 km | The opening random pool |
| Outlands | 62 to 110 | 25,284 | 19.1 km | Cheaper, quieter, room to build big |
| Frontier | 111 to 173 | 53,676 | 30.1 km | Wilderness, best resources, worst footfall |

Candidate perks, to be chosen later:

- **Footfall.** Everyone spawns at the Fortress, so nearness to the centre literally is nearness
  to every other player. This perk costs nothing to implement and is the strongest one.
- **Faster travel.** Free or cheap teleport to the Fortress from inner parcels; a long walk or
  paid transport from the Frontier.
- **Mining yield versus mining rarity.** Inner parcels yield more often; Frontier parcels yield
  rarer things. This is what makes the Frontier genuinely worth buying rather than merely cheap.
- **Build allowance.** Higher object count or greater structure height nearer the centre.
- **Marketplace visibility.** Shops on inner parcels surface first in search.
- **Safety.** Inner rings are safe zones; outer rings have hostile spawns drawn from the existing
  monster roster. This reuses the whole SWW enemy system with no new work.

### 3e. Resale

Not in scope for the first build, but the parcel record should carry an owner from day one, so
that transferring one later is a change of owner rather than a schema migration.

---

## 4. Alien Worlds claims

### 4a. The claim

A holder connects their WAX wallet through LW-SSO, we read their `alien.worlds` / `land.worlds`
holdings **server side** (never trusting the browser), and they may claim **one parcel per land
NFT they hold**, free.

### 4b. Where the claims go: six planets, six sectors

The giant hexagon has 6 sides, Alien Worlds has 6 planets, and **every hex ring divides by 6 with
no remainder**. So the Homelands split into six exactly equal 60 degree sectors, one per planet.
Magor holders end up neighbours, Veles holders end up neighbours, and so on.

The reserve is **rings 2 to 36: 3,990 parcels, exactly 665 per sector.** That size was chosen so
the largest planet fits inside its own sector:

| Planet | Land NFTs | Sector capacity | Spare |
|---|---|---|---|
| Magor | 652 | 665 | 13 |
| Neri | 650 | 665 | 15 |
| Kavian | 648 | 665 | 17 |
| Naron | 609 | 665 | 56 |
| Eyeke | 429 | 665 | 236 |
| Veles | 355 | 665 | 310 |
| **Total** | **3,343** | **3,990** | **647** |

This matters more than it looks. It guarantees the core of the world is populated on day one by
the people most likely to actually build, instead of hoping paying customers happen to cluster.
It also gives the free claim a genuine perk (a central parcel, in your own planet's quarter)
without giving away revenue parcels.

The 647 spare parcels, plus anything still unclaimed after a cutoff date, go on sale at the $10
choose price. They are the most desirable land in the world after the Fortress, so they should
not be released cheaply or early.

### 4c. Snapshot or lease

Two ways to handle a holder selling their NFT on WAX after claiming:

- **Snapshot (recommended).** The claim is permanent. Sell the NFT afterwards and you keep the
  parcel; the buyer gets nothing. Simple, and nobody's buildings ever vanish.
- **Lease.** The parcel is yours only while you hold the NFT. Keeps the NFT valuable, but means
  someone's city can disappear out from under them, and it needs a continuous re-check job.

**Recommendation: snapshot.** Decision still open, and it should be made before launch, because
it is not reversible in either direction without upsetting someone.

---

## 5. Natural land types

Every parcel has a natural land type, fixed at world generation, that determines what the ground
looks like, what grows on it, what you can mine there, and part of its value. **The full list is
to be decided.** Provisional list, drawn from Geoff's examples plus the 20 real Alien Worlds
terrain types (which are already authored, already balanced by rarity, and free to borrow):

Forest, Jungle, Swamp, Desert, Sandy Desert, Rocky Desert, Icy Desert, Dunes, Plains, Grassland,
Mountains, Icy Mountains, Rocky Crater, Active Volcano (lava), Dormant Volcano, Geothermal
Springs, Inland River, Grass Coastline, Sandy Coastline, Rocky Coastline, Mushroom Forest,
Small Island, Methane Swampland.

Design notes:

- **Land type is generated, not stored per parcel.** 90,307 rows of "this one is forest" is
  waste. Generate the type from the world seed and the parcel coordinates, so it is identical for
  every player and costs nothing to store. Only *overrides* (a hand-authored region, a special
  parcel) get a row.
- **Types should form regions, not confetti.** Use large-scale noise so forests are forests, not
  a single forest parcel next to a volcano. Coastlines and rivers in particular have to line up
  with actual water or they will look absurd.
- **Where an Alien Worlds land NFT lands, the parcel takes that NFT's real terrain type.** A
  holder of "Mushroom Forest on Neri" should arrive at a mushroom forest. We already have the
  mushroom assets from Bleakrock.
- **Land type drives mining.** This is the whole reason to have types: what a parcel produces
  should follow from what it is. Lava parcels yield differently from swamp parcels.
- **Art is the real cost here.** The terrain shader currently blends exactly **three** textures
  (sand, grass, rock), and only two of them are actually on disk under `public/siege/terrain/`.
  A dozen-plus biomes needs either more texture slots in that shader or the texture-array work
  already drafted in `docs/TEXTURE_ARRAY_MIGRATION_PLAN.md`, plus real artwork for each biome.
  Budget for this properly; it is not a small task and it is the thing players will judge first.

---

## 6. What has to be built

Four engineering gaps, plus art.

### 6a. Per-parcel terrain storage (the main rewrite)

Today `src/components/siege/terrain/mapPersistence.ts` saves an entire map's terrain as **one
blob in one record**. That is correct for one authored map and fatal for 90,307 independently
owned parcels, because every save would rewrite the world. It has to become one record per **hex
parcel**, written only when that parcel is actually edited, with the square render cell rebuilding
its mesh from whichever hex edits fall inside it (see 2e). Not a huge job, but unavoidable, and
everything else depends on it.

### 6b. The parcel and ownership tables

Who owns which parcel, how they got it (claim / random buy / choose buy), when, and what they
paid. Parcels are addressed by axial hex coordinate, not by row and column. Plus the anti-double-claim rule, which must be enforced by the database, not by the app.

### 6c. Per-parcel build permission

Object editing is currently locked to admins. It has to become "you may edit inside parcels you
own", enforced on the server, with the parcel boundary test being a point-in-hexagon check rather
than a rectangle test. The contract for this is already written up in
`docs/NAMED_WORLDS_PERSISTENCE.md`: every build action is a named, server-validated call that
checks the caller against the parcel, and rejects edits outside its bounds.

### 6d. Terrain level-of-detail

We are already fighting framerate on a 2 km world. A 30 km world with a 1 km view will draw far
more ground than the current renderer can afford. Distant terrain has to get coarser. Without
this, view distance stays short, and a land world you cannot see across is a much weaker product.

### 6e. Biome art

See Section 5. Shader slots plus textures plus props per biome.

---

## 7. Other decisions to make early

- **What mining pays out.** TLM cannot be minted by us; it belongs to the Alien Worlds contract.
  Mining on a parcel has to pay our own currency. Dread Points is the existing rail and the
  obvious candidate. This needs deciding early because it shapes the entire land-value pitch.
- **Payment rail.** Which chains and tokens are accepted for the $5 / $10 purchase, and where
  the funds land.
- **Moderation.** People will build things on land they own. There needs to be a takedown path
  and a way to hide a parcel's contents, decided before launch and not after the first incident.
- **Whether it is one world or one world per planet.** This plan assumes one shared world with
  planet-themed wedges. Six separate worlds would be more faithful to Alien Worlds and would
  divide an already thin population by six. Recommendation: one world.

---

## 8. Suggested build order

Each phase should end with something playable.

1. **The honeycomb exists.** New game entry in the registry, new world definition, the hex
   coordinate module (axial coords, ring number, hex-to-cell lookup), parcel outlines drawn on the
   ground, a coordinate and ring readout. Walk around, see the honeycomb.
2. **Terrain generation.** World seed, land types as regions, biome colouring using whatever
   textures exist today. The world looks like somewhere.
3. **Parcel records and ownership.** Tables, the claim/buy paths as admin-only tools, a map
   showing owned vs free. No payments yet.
4. **Alien Worlds claim flow.** Wallet connect through SSO, server-side holdings read, claim one
   parcel per NFT, wedge assignment by planet.
5. **Buying.** $5 random and $10 choose, real crypto payment, the ring-band random rule from 3c.
6. **Building.** Per-parcel permission on the existing object editor, per-parcel terrain saves.
   This is when it becomes a metaverse rather than a map.
7. **Mining and centre perks.** Yield by land type, ring-scaled perks, safety zones.
8. **Level-of-detail and performance.** Ongoing, but it must be real before any public launch.

---

## 9. Risks

- **Emptiness is the main risk, and it is what killed Decentraland and The Sandbox.** 90,307
  parcels against roughly 3,343 claims plus realistically a few hundred sales is about 4%
  occupancy. Spread evenly, a 1 km view would show around a dozen built parcels in an ocean of
  nothing. This concern was raised and the full-size world was confirmed as the decision, so the
  plan keeps it. **The mitigations are the ones already in the design and they are genuinely
  good ones:** centre perks pull building inward (3d), the Alien Worlds claims fill six equal
  sectors of the core rather than scattering (4b), and random buys draw from a five-band window
  that slides outward only as it fills (3c). Together
  those turn a 4%-occupied world into a small dense city surrounded by wilderness, which is a
  perfectly good thing to be. What must be avoided is uniformly scattering owners across all
  782 km2. If that happens the world will feel dead no matter what else is built.
- **The free-claim audience is 545 accounts.** Concentrated too: the top 10 hold 37%. Do not
  plan launch traffic around the Alien Worlds crossover alone.
- **Art scope.** A dozen biomes plus buildings plus props is a lot of asset work and it is what
  players judge in the first ten seconds.
- **Performance.** Roughly 200x the current world area, on a codebase already being tuned for
  framerate.
- **Moderation.** User-built content on owned land, with no takedown path yet.

---

## 10. Confidence

That the technical path works: **high, about 85%.** The coordinate range, the streaming terrain,
the object placement, the WAX gating and the non-voxel render mode are all real and were read
directly, not assumed. The four gaps in Section 6 are ordinary work, not research.

That 90,307 parcels sell: **low.** The revenue arithmetic in 3b is a ceiling and should not be
planned against. The product case rests on the core being alive, not on the acreage.
