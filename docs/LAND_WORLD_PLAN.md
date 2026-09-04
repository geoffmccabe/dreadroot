# LAND WORLD - plan (SWW spun out as a land-ownership metaverse)

Status: **analysis + plan only, nothing built.** Written 2026-Sep-03, against dreadroot v4.352.83.

The idea: take Siege Worlds Web (SWW) and spin it into a separate game the way Divi Kaiju is
separate, sharing the same engine. A single persistent world made of 100 m x 100 m land squares
that people own, build on, and mine. Alien Worlds land NFT holders claim a square free. Everyone
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

## 2. The world

### 2a. Grid

| | |
|---|---|
| Parcel size | 100 m x 100 m (1 hectare) |
| Grid | 300 x 300 |
| Total parcels | 90,000 |
| World extent | 30 km x 30 km = 900 km2 |
| Parcel indices | x and z each run -150 to +149 |
| Centre | the world origin (0,0,0) is the shared corner of a **2 x 2 block of 4 parcels** |
| Plaza | those 4 parcels, 200 m x 200 m, **nobody can own them** |

The 2 x 2 centre keeps the world perfectly symmetric on both axes (300 is even, so there is no
single middle square, and forcing one would put the origin off-centre). The origin point sits
exactly where parcels (-1,-1), (-1,0), (0,-1) and (0,0) meet. Those four are the spawn plaza and
are permanently unowned.

### 2a-i. Ring distance

Distance from the centre is counted in **rings** measured from the origin point, not from a
centre square. A parcel's ring is how many parcels out it sits on its furthest axis: the four
plaza parcels are ring 1, the shell around them is ring 2, and so on out to ring 150 at the edge.

- Ring R contains 8R - 4 parcels.
- Everything within ring R totals (2R)^2 parcels.
- Ring 150 is the edge, and (2 x 150)^2 = 90,000, which checks out against the whole grid.

### 2b. Scale in context

The current SWW map is about 2 km x 2 km. The largest existing map is +/- 10 km. This world is
**225x the area of SWW today**. That is the single biggest engineering fact in this document,
and Section 6 covers what it costs.

### 2c. The key architectural decision

**Make one land parcel equal one streaming cell equal one network zone equal one save unit.**

Terrain today streams in 128 m cells, a size chosen so it nests into DreadRoot's 16 m voxel
chunks. That reason does not apply here, because this game has no voxels. Changing the cell to
100 m makes the parcel, the streaming chunk, the network interest area, the ownership unit and
the save unit all the same grid. Every ownership, streaming and "who can see whom" question then
collapses into one question with one answer.

If the cell stays at 128 m, every parcel straddles up to four cells forever, and every one of
those questions stays messy. This is the highest-leverage decision in the plan.

---

## 3. Land supply and pricing

### 3a. Supply

| Category | Count |
|---|---|
| Total parcels | 90,000 |
| Reserved for Alien Worlds land NFT claims | 3,343 |
| Reserved: centre spawn plaza (the 2 x 2 block) | 4 |
| **Available for sale** | **86,653** |

### 3b. Price

Paid in crypto. Two tiers:

| Tier | Price | What you get |
|---|---|---|
| **Random** | **$5** | The system assigns you a parcel. You do not choose where. |
| **Choose** | **$10** | You pick the exact parcel from the map, if it is unclaimed. |

Theoretical ceiling if every parcel sold: $433k at the random price, $867k at the choose price.
Treat both as arithmetic, not a forecast.

The two-tier split is doing real work beyond revenue: it sorts buyers by how much they care
about location, which is what concentrates the built-up area instead of scattering it. See 3d.

### 3c. How "random" should actually work

Random must not mean uniformly random across 900 km2, or the $5 tier actively creates the empty
world we are trying to avoid. **Recommendation: random draws from the innermost ring band that
still has unsold parcels, expanding outward only as each band fills.** So early $5 buyers land
near the centre and near each other, and the world grows outward as a settled area rather than
as scattered dust. The buyer still does not choose, so the $10 tier keeps its value: choosers
get a *specific* parcel, including one that random buyers cannot reach yet.

This is a recommendation, not a decision. The alternative (true uniform random over the whole
grid) is simpler to explain but produces a visibly dead world.

### 3d. Benefits of being near the centre

Distance from the centre is measured in **rings**, defined in 2a-i.

Proposed ring bands (names and exact perks to be finalised):

| Band | Rings | Parcels in band | Footprint | Character |
|---|---|---|---|---|
| Plaza | 1 | 4 | 200 m | Spawn point, everyone arrives here, never for sale |
| Inner City | 2 to 10 | 396 | 2.0 km across | Densest, highest traffic, highest perks |
| Districts | 11 to 30 | 3,200 | 6.0 km across | Where the Alien Worlds claims go, see 4b |
| Outlands | 31 to 75 | 18,900 | 15.0 km across | Cheaper, quieter, room to build big |
| Frontier | 76 to 150 | 67,500 | 30 km across | Wilderness, best resources, worst footfall |

Perks should scale continuously with ring number rather than jumping at band edges, so there is
no cliff. Candidate perks, to be chosen later:

- **Footfall.** Everyone spawns on the 4-parcel Plaza, so nearness to centre literally is
  nearness to every other player. This perk costs nothing to implement and is the strongest one.
- **Faster travel.** Free or cheap teleport to the Plaza from inner parcels; long walk or paid
  transport from the Frontier.
- **Mining yield vs. mining rarity.** Inner parcels yield more often; Frontier parcels yield
  rarer things. This makes the Frontier genuinely worth buying instead of merely cheap.
- **Build allowance.** Higher object count or higher structure height nearer the centre.
- **Marketplace visibility.** Shops on inner parcels surface first in search.
- **Safety.** Inner rings are safe zones, outer rings have hostile spawns from the existing
  monster roster. This reuses the whole SWW enemy system with no new work.

### 3e. Resale

Not in scope for the first build, but the parcel record should carry an owner from day one so
that transferring one later is a change of owner, not a schema migration.

---

## 4. Alien Worlds claims

### 4a. The claim

A holder connects their WAX wallet through LW-SSO, we read their `alien.worlds` / `land.worlds`
holdings server-side (never trusting the browser), and they may claim **one parcel per land NFT
they hold**, free.

### 4b. Where the claims go

**Recommendation: reserve the Inner City and Districts bands (rings 2 to 30) for Alien Worlds
claims.** Those bands hold 3,596 parcels; there are 3,343 land NFTs. They fit, with 253 to spare.

This matters more than it looks. It guarantees the core of the world is populated on day one by
the people most likely to actually build, instead of hoping paying customers happen to cluster.
It also gives the free claim a real perk (a central parcel) without giving away revenue parcels.

Within that band, **give each of the 6 planets its own wedge radiating from the centre**, so
Magor holders end up neighbours, Veles holders end up neighbours, and so on. Planet populations
(652 / 650 / 648 / 609 / 429 / 355) are close enough that six equal wedges work.

Any inner parcels still unclaimed after a cutoff date go on sale at the $10 choose price.

### 4c. Snapshot or lease

Two ways to handle a holder selling their NFT on WAX after claiming:

- **Snapshot (recommended).** The claim is permanent. Sell the NFT afterwards and you keep the
  parcel; the buyer gets nothing. Simple, and nobody's buildings ever vanish.
- **Lease.** The parcel is yours only while you hold the NFT. Keeps the NFT valuable, but means
  someone's city can disappear out from under them, and it needs a continuous re-check job.

**Recommendation: snapshot.** Decision still open, and it should be made before launch because it
is not reversible in either direction without upsetting someone.

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

- **Land type is generated, not stored per parcel.** 90,000 rows of "this one is forest" is
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
blob in one record**. That is correct for one authored map and fatal for 90,000 independently
owned parcels, because every save would rewrite the world. It has to become one record per
parcel, written only when that parcel is actually edited. Not a huge job, but unavoidable, and
everything else depends on it.

### 6b. The parcel and ownership tables

Who owns which square, how they got it (claim / random buy / choose buy), when, and what they
paid. Plus the anti-double-claim rule, which must be enforced by the database, not by the app.

### 6c. Per-parcel build permission

Object editing is currently locked to admins. It has to become "you may edit inside squares you
own", enforced on the server. The contract for this is already written up in
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

1. **The grid exists.** New game entry in the registry, new world definition, 300 x 300 parcel
   maths, parcel outlines visible on the ground, a coordinate readout. Walk around, see squares.
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

- **Emptiness is the main risk, and it is what killed Decentraland and The Sandbox.** 90,000
  parcels against roughly 3,343 claims plus realistically a few hundred sales is about 4%
  occupancy. Within a 1 km view you would see around a dozen built parcels in an ocean of
  nothing. This concern was raised and the 300 x 300 grid was confirmed as the decision, so the
  plan keeps it. **The mitigations are the ones already in the design and they are genuinely
  good ones:** centre perks pull building inward (3d), the Alien Worlds claims are placed in the
  core rather than scattered (4b), and random buys fill from the middle outward (3c). Together
  those turn a 4%-occupied world into a small dense city surrounded by wilderness, which is a
  perfectly good thing to be. What must be avoided is uniformly scattering owners across all
  900 km2. If that happens the world will feel dead no matter what else is built.
- **The free-claim audience is 545 accounts.** Concentrated too: the top 10 hold 37%. Do not
  plan launch traffic around the Alien Worlds crossover alone.
- **Art scope.** A dozen biomes plus buildings plus props is a lot of asset work and it is what
  players judge in the first ten seconds.
- **Performance.** 225x the current world area, on a codebase already being tuned for framerate.
- **Moderation.** User-built content on owned land, with no takedown path yet.

---

## 10. Confidence

That the technical path works: **high, about 85%.** The coordinate range, the streaming terrain,
the object placement, the WAX gating and the non-voxel render mode are all real and were read
directly, not assumed. The four gaps in Section 6 are ordinary work, not research.

That 90,000 parcels sell: **low.** The revenue arithmetic in 3b is a ceiling and should not be
planned against. The product case rests on the core being alive, not on the acreage.
