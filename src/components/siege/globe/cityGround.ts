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

interface CitySite {
  name: string;
  /** Unit direction from the planet centre. */
  dx: number; dy: number; dz: number;
  /** What the ground is, in metres above sea level, inside the city. */
  groundM: number;
  /** Full city ground within this radius, in metres. */
  innerM: number;
  /** Blended back to the real terrain by this radius. */
  outerM: number;
  /** cos of the two radii as angles, so the common case is one dot product. */
  cosInner: number;
  cosOuter: number;
}

const EARTH_R_M = PLANET_RADIUS * METRES_PER_UNIT;

function makeSite(name: string, lat: number, lon: number, groundM: number,
                  innerM: number, outerM: number): CitySite {
  const d = new Float64Array(3);
  latLonToDirection(lat, lon, d);
  return {
    name, dx: d[0], dy: d[1], dz: d[2], groundM, innerM, outerM,
    cosInner: Math.cos(innerM / EARTH_R_M),
    cosOuter: Math.cos(outerM / EARTH_R_M),
  };
}

/**
 * Dubai. 6 m above sea level, which is about right for the Marina and Downtown.
 *
 * The inner radius covers the whole import — the furthest building is 13.1 km from the origin — and
 * the blend runs out to 26 km so the transition happens over open desert and water rather than
 * through the middle of a district.
 *
 * Declared as a constant rather than registered when the city file loads, deliberately: the terrain
 * starts building before any fetch completes, and a ground that appears late would leave already
 * built patches showing the seabed while everything around them moved.
 */
const SITES: CitySite[] = [
  makeSite('Dubai', 25.14, 55.21, 6, 15000, 26000),
];

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
    if (dot >= s.cosInner) return s.groundM;  // squarely inside it
    const distM = Math.acos(Math.min(1, dot)) * EARTH_R_M;
    const t = smooth((distM - s.innerM) / (s.outerM - s.innerM));
    // No tile yet: hold the city's ground rather than inventing a slope down to nothing.
    if (base == null) return s.groundM;
    return s.groundM + (base - s.groundM) * t;
  }
  return base;
}

/** Ground elevation at a city's own centre, for placing the buildings themselves. */
export function cityGroundMetres(name: string): number {
  return SITES.find((s) => s.name === name)?.groundM ?? 0;
}
