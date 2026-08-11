// cityGround — a city knows it is on land, even when the elevation data says otherwise.
//
// Geoff, on arriving at Dubai: "I don't see any city or any kaijus. I can't move and I can't move
// the camera... it's very broken."
//
// Measured, not guessed. scripts probed the real tile server at each site:
//
//     Grand Canyon    L10:  819 m   L8: 2059 m   L6: 1970 m   L4: 1805 m
//     Mount Everest   L10: 5982 m   L8: 4712 m   L6: 5761 m   L4: 5381 m
//     Dubai Marina    L10:  --      L8:  --      L6:  --      L4:  -87 m
//
// Dubai has NO detail tiles at any level, and the only data that exists puts it 87 metres UNDER
// WATER. So B3 dropped the Kaiju on the seabed of the Persian Gulf: submerged, therefore swimming
// rather than walking, inside the underwater murk the camera switches to below sea level — which is
// every symptom at once, and none of them looking like the cause.
//
// WHY THE DATA IS WRONG AND THE CITY IS RIGHT. The coarsest tiles are roughly nine kilometres to a
// sample, and Dubai's coast at that resolution is an average of shallow gulf and low desert that
// lands below zero. The Marina and the Palm are reclaimed land that did not exist when most
// bathymetry was surveyed. Against that, 59,202 building footprints surveyed to the metre are the
// better evidence: if there are towers there, it is land.
//
// So a city declares its own ground, and the terrain agrees with it — blended out over a few
// kilometres so the coast is a slope rather than a cliff.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: the terrain MESH, the ground the Kaiju stands on, and
// the elevation the patch index reproduces must all pass through here. They are three separate
// samplers that each read the tiles directly, and the last time two of them disagreed the ground was
// 460 metres from where it was drawn. One function, called from all three.

import { PLANET_RADIUS, METRES_PER_UNIT, latLonToDirection } from './cubeSphere';
import { landFractionFor } from './sites/maskRegistry';
import { citySites, siteOverridesGround } from './sites';
import './sites/landmasks';   // side-effect: every generated mask registers itself

interface CitySite {
  name: string;
  /** Names the land mask and the asset folder. */
  slug: string;
  /** Unit direction from the planet centre. */
  dx: number; dy: number; dz: number;
  /** East and north unit vectors at the site, for turning a direction into local metres. */
  ex: number; ey: number; ez: number;
  nx: number; ny: number; nz: number;
  /** What the ground is, in metres above sea level, inside the city. */
  groundM: number;
  /** Full city ground within this radius, in metres. */
  innerM: number;
  /** Blended back to the real terrain by this radius. */
  outerM: number;
  /** Depth of the sea immediately around this city. Per-city; see SiteGround. */
  seaM: number;
  /** Whether the planet's elevation outside the core is usable. See SiteGround.trustBaseOutside. */
  trustBase: boolean;
  /** cos of the two radii as angles, so the common case is one dot product. */
  cosInner: number;
  cosOuter: number;
}

const EARTH_R_M = PLANET_RADIUS * METRES_PER_UNIT;

// The sea depth around a city now lives on the site (SiteGround.shallowSeaMetres) rather than as a
// constant here, because it is a per-city look decision — see sites/siteTypes.ts for why -30 and not
// the raw tile value, which over Dubai is -87 m everywhere and would put a cliff along the shore.

function makeSite(name: string, slug: string, lat: number, lon: number, groundM: number,
                  innerM: number, outerM: number, seaM: number, trustBase: boolean): CitySite {
  const d = new Float64Array(3);
  latLonToDirection(lat, lon, d);
  // East = worldY x up, north = up x east — the same frame the bake used, so a building's stored
  // offset and this projection describe the same point. Written out rather than via Vector3 because
  // this runs once per site and the cross products are three lines each.
  let ex = d[2], ey = 0, ez = -d[0];
  let el = Math.hypot(ex, ey, ez);
  if (el < 1e-9) { ex = 1; ey = 0; ez = 0; el = 1; }   // directly over a pole
  ex /= el; ey /= el; ez /= el;
  const nx = d[1] * ez - d[2] * ey;
  const ny = d[2] * ex - d[0] * ez;
  const nz = d[0] * ey - d[1] * ex;
  return {
    name, slug, dx: d[0], dy: d[1], dz: d[2], ex, ey, ez, nx, ny, nz, groundM, innerM, outerM,
    seaM, trustBase,
    cosInner: Math.cos(innerM / EARTH_R_M),
    cosOuter: Math.cos(outerM / EARTH_R_M),
  };
}

/**
 * Dubai. Half a metre above sea level.
 *
 * Geoff, twice: "the sea level is too low... perhaps 3-5 m of sea rise", then "the land level is
 * too high and needs to be brought down another 2 m so that the beaches are smaller and less broad."
 *
 * Lowering the LAND rather than raising the water, because the water is the planet's own sea surface
 * at elevation zero and moving that moves every coast on Earth. Six metres became two, and two now
 * becomes a half.
 *
 * NOT ZERO, which is what "another 2 m" literally asks for, and the missing half metre is the one
 * decision here worth defending. The ocean is a mesh at exactly the planet's radius; ground at
 * exactly zero is the same surface, and two coplanar meshes do not decide which is in front — they
 * fight, per pixel, and the whole city would strobe between sand and water as the camera moved. Half
 * a metre is below anything visible at this scale and above that failure. It also holds the
 * procedural terrain noise off: that fades out below 120 m and is under 20 cm here, so the ground
 * inside the city is genuinely flat rather than gently lumpy.
 *
 * The inner radius covers the whole import — the furthest building is 13.1 km from the origin — and
 * the blend runs out to 26 km so the transition happens over open desert and water rather than
 * through the middle of a district.
 *
 * Declared as a constant rather than registered when the city file loads, deliberately: the terrain
 * starts building before any fetch completes, and a ground that appears late would leave already
 * built patches showing the seabed while everything around them moved.
 */
const SITES: CitySite[] = citySites()
  .filter(siteOverridesGround)
  .map((d) => makeSite(
    d.name, d.slug, d.lat, d.lon,
    d.ground.groundMetres, d.ground.innerMetres, d.ground.outerMetres, d.ground.shallowSeaMetres,
    d.ground.trustBaseOutside !== false,
  ));

/** Smootherstep — zero derivative at both ends, so the coastline has no visible crease. */
function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

/**
 * Fold any city's ground into a base elevation sample.
 *
 * `base` may be null when no tile has loaded; inside a city that still returns the city's ground,
 * because "we know there is land here" does not depend on a tile arriving.
 *
 * Costs one dot product per call in the overwhelming majority of cases — the acos only runs for
 * samples actually inside the blend band.
 */
export function cityBaseMetres(x: number, y: number, z: number, base: number | null): number | null {
  for (let i = 0; i < SITES.length; i++) {
    const s = SITES[i];
    const dot = x * s.dx + y * s.dy + z * s.dz;
    if (dot <= s.cosOuter) continue;          // outside this city entirely

    // WHERE IS THIS, IN THE CITY'S OWN METRES? The offset from the site direction, projected onto
    // east and north. Over 26 km the chord and the arc differ by under a metre, so the small-angle
    // form is exact enough and costs two dot products instead of a pair of trig calls.
    const ox = x - s.dx, oy = y - s.dy, oz = z - s.dz;
    const em = (ox * s.ex + oy * s.ey + oz * s.ez) * EARTH_R_M;
    const nm = (ox * s.nx + oy * s.ny + oz * s.nz) * EARTH_R_M;
    // The bake stores +z as SOUTH, so the mask is indexed by -north.
    //
    // A FRACTION, NOT A YES/NO. Geoff: "it's very pixellated coastline, like made of 50 m squares
    // or something." A one-bit answer per cell can only ever produce a staircase, and the ground
    // faithfully drew it. The mask now interpolates between its four surrounding cells, so the
    // shoreline arrives as a ramp one cell wide and the terrain renders a beach instead of a kerb.
    // A CITY WITH NO MASK IS ALL LAND, not all sea. An inland city never needed one, and treating
    // its footprint as water would sink it. Null and 0 mean opposite things here.
    const landFrac = landFractionFor(s.slug, em, -nm) ?? 1;

    // SEA STAYS SEA. Geoff: "The palm is supposed to be a set of islands in the water but everything
    // is inland." It was: the override was a flat disc fifteen kilometres across, which filled in
    // the Gulf, the Marina's waterways and every channel between the Palm's fronds. Only LAND is
    // raised now, and the land map comes from the city's own 59,202 footprints plus a stated
    // coastline — see scripts/make-city-landmask.mjs.
    // LAND IS NOT BLENDED TOWARD THE BASE, and that is deliberate rather than lazy.
    //
    // The blend exists so the city's ground meets the real terrain without a step. But the "real
    // terrain" here is -87 m EVERYWHERE within reach, including under the city itself — it is a
    // nine-kilometre average of gulf and desert, and it is the very error this file exists to
    // correct. Blending land into it just sinks the desert instead of the city: a probe 21 km south
    // came out at -56 m, which is dry sand under sixty metres of water.
    //
    // So land holds. There is a step where the override ends, 26 km out and well beyond every
    // district, and a step in empty desert nobody walks to is a far better trade than drowning it.
    if (landFrac >= 1) {
      // FLAT IN THE CORE, REAL OUTSIDE IT — when the surrounding data is worth having. Dubai sets
      // trustBaseOutside false because its tiles read -87 m everywhere and blending toward that
      // drowns the desert; San Jose leaves it true, so past the core the Valle Central's walls and
      // the volcanoes beyond come back instead of a twenty-four kilometre table.
      if (!s.trustBase || base == null || dot >= s.cosInner) return s.groundM;
      const dM = Math.acos(Math.min(1, dot)) * EARTH_R_M;
      const t = smooth((dM - s.innerM) / (s.outerM - s.innerM));
      return s.groundM + (base - s.groundM) * t;
    }

    // WHAT THE SEA IS HERE. Shallow close in, blending out to the real depth at the outer radius —
    // because out there the base is not wrong, the Gulf really does deepen.
    let seaM = s.seaM;
    if (dot < s.cosInner && base != null) {
      const distM = Math.acos(Math.min(1, dot)) * EARTH_R_M;
      const t = smooth((distM - s.innerM) / (s.outerM - s.innerM));
      seaM = s.seaM + (base - s.seaM) * t;
    }
    if (landFrac <= 0) return seaM;

    // THE BEACH. One cell of the mask, forty metres, to climb from the water to the ground —
    // smoothstepped so it leaves the sea and meets the land with no crease at either end.
    return seaM + (s.groundM - seaM) * smooth(landFrac);
  }
  return base;
}

/**
 * How flat this direction is being forced to be by a city, 0 to 1.
 *
 * 1 inside the city's core, falling to 0 at its outer radius, and 0 everywhere else.
 *
 * THIS EXISTS BECAUSE OF SAN JOSE, and it is the one thing Dubai could never have taught. The
 * planet lays procedural relief over the tile data, scaled by elevation: none at sea level, rising
 * to full ruggedness in the mountains. Dubai's declared ground is half a metre, so it gets nothing
 * — the coastal fade zeroes it, and the city is flat by accident.
 *
 * San Jose sits at 1,160 m. At that elevation the same function offers up to THREE HUNDRED AND
 * FORTY-FIVE METRES of noise, over a city whose buildings are mostly between three and fifteen
 * metres tall. The city would not have looked bumpy; it would have been buried, with towers
 * submerged in hills that are not there and roads climbing cliffs.
 *
 * A city declares its ground. Anything added on top of that declaration contradicts it, so inside
 * the core the relief is switched off entirely and faded back in across the blend band — which is
 * the same band the elevation itself blends over, so the two agree.
 */
export function cityFlatness(x: number, y: number, z: number): number {
  for (let i = 0; i < SITES.length; i++) {
    const s = SITES[i];
    const dot = x * s.dx + y * s.dy + z * s.dz;
    if (dot <= s.cosOuter) continue;
    if (dot >= s.cosInner) return 1;

    // IT FOLLOWS THE ELEVATION, WHICH IS THE WHOLE POINT. cityBaseMetres holds LAND at the city's
    // ground all the way out to the outer radius — only sea blends back to the real depth — so
    // fading the relief back in over that same band would lay hills on ground that is still being
    // held perfectly flat. The two must answer the same question the same way or the city grows
    // lumps just outside its core, exactly where nobody thinks to look.
    const ox = x - s.dx, oy = y - s.dy, oz = z - s.dz;
    const em = (ox * s.ex + oy * s.ey + oz * s.ez) * EARTH_R_M;
    const nm = (ox * s.nx + oy * s.ny + oz * s.nz) * EARTH_R_M;
    // Land is held flat to the outer radius only where the base is NOT trusted; where it is, the
    // relief must come back on exactly the same ramp the elevation does.
    if (!s.trustBase && (landFractionFor(s.slug, em, -nm) ?? 1) >= 1) return 1;

    // Sea, which does blend — so the relief may come back with it.
    const distM = Math.acos(Math.min(1, dot)) * EARTH_R_M;
    return 1 - smooth((distM - s.innerM) / (s.outerM - s.innerM));
  }
  return 0;
}

/**
 * How much of this direction is dry land, 0 to 1 — or null if it is not inside any city.
 *
 * Geoff: "The Kaijus now are starting at Marina but they are in the water."
 *
 * The arena already tried to avoid this, and asked the wrong question. It sampled the terrain
 * ELEVATION and called anything above 0.5 m dry — but Dubai's declared ground IS 0.5 m, and the
 * procedural detail laid over it is signed, so half the land in the city came back at 0.49 and
 * counted as sea. A test whose threshold is the exact value it is testing decides nothing.
 *
 * Worse, elevation is the wrong source even when the number works: it depends on which terrain
 * tiles have loaded, and the arena is built the instant you press the key, before any of them have.
 * The land mask is baked into the bundle, is there before anything is fetched, and is the actual
 * authority on where the coast is. Ask it.
 */
export function cityLandAt(x: number, y: number, z: number): number | null {
  for (let i = 0; i < SITES.length; i++) {
    const s = SITES[i];
    const dot = x * s.dx + y * s.dy + z * s.dz;
    if (dot <= s.cosOuter) continue;
    const ox = x - s.dx, oy = y - s.dy, oz = z - s.dz;
    const em = (ox * s.ex + oy * s.ey + oz * s.ez) * EARTH_R_M;
    const nm = (ox * s.nx + oy * s.ny + oz * s.nz) * EARTH_R_M;
    return landFractionFor(s.slug, em, -nm) ?? 1;
  }
  return null;
}

/** Ground elevation at a city's own centre, for placing the buildings themselves. */
export function cityGroundMetres(slug: string): number {
  // BY SLUG, and this cost San Jose its entire skyline. It used to match on `name`, and when the
  // registry landed the caller started passing a slug — 'san-jose' never equals 'San José, Costa
  // Rica', so the lookup silently returned the 0 default and the city group was placed at SEA LEVEL,
  // eleven hundred and sixty metres below the ground it stands on. Twenty-nine thousand buildings,
  // all present, all correct, all buried. Dubai hid it: 'dubai' does not match 'Dubai' either, but
  // its ground is half a metre, so the same bug moved the city by 50 cm and nobody could see it.
  return SITES.find((s) => s.slug === slug)?.groundM ?? 0;
}
