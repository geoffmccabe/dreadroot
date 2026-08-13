// B8 — London. A river city, and the river is the whole problem.
//
// THE THAMES READS +8 METRES IN THE COARSE DATA — as LAND. Measured before anything was baked:
// Blackfriars +8 m, the Isle of Dogs +3 m. Left alone, the river is a field, the Isle of Dogs is not
// an isle, and the single feature every London view is composed around simply is not there. This is
// the same fault New York's East River had, and it is why the land mask matters more here than the
// buildings do.
//
// THERE IS NO FLOOD FILL HERE AT ALL, and my first attempt assumed the opposite. I wrote that OSM
// maps the tidal Thames banks as natural=coastline up to Teddington. It does not: Britain's
// coastline is mapped at the actual SEA coast, forty kilometres downstream, and the Thames through
// the city is a water AREA. The bake said so in one line — "stroked 0 coastline ways" — and the
// flood then filled 100% of the grid, which the sanity band caught before it could be written.
//
// A river city needs no flood: everything is land except the water polygons. Simpler, and correct.
//
// THE RIVER IS ALSO PAINTED FROM ITS CENTRELINE, because the polygons alone gave a BROKEN Thames
// with dry stretches you could walk across. A big river is one multipolygon whose member ways
// spread over many fetch tiles, so each tile assembles only a partial ring. Nothing in the counts
// showed it: 1,489 water areas came back and not one was named Thames. A 230 m corridor along the
// centreline cannot have gaps — 545 of 550 columns now carry water, longest dry run 0.1 km.
//
// AND THE BRIDGES ARE THE VIEW. Tower Bridge, London Bridge, Westminster, Waterloo, Blackfriars,
// the Millennium footbridge — the skyline is read ACROSS them. Without the bridge pass they are
// part of the road network, painted flat on the water, which is what happened to New York's four.
//
// Relief runs 5 to 82 m: Canary Wharf 5, the City 14, Charing Cross 17, Hampstead 82 (really 134 —
// the coarse tiles clip a hill as they clip a volcano).

import type { SiteDef } from './siteTypes';

export const LONDON: SiteDef = {
  key: 'Digit8',
  slug: 'london',
  name: 'London',
  blurb: 'A river, and a thousand years of city on both sides of it.',

  lat: 51.5074, lon: -0.1278, facingDeg: 95,

  ground: {
    mode: 'follow',
    groundMetres: 15,
    shallowSeaMetres: -12,
    innerMetres: 11000,
    outerMetres: 22000,
    trustBaseOutside: true,
  },

  city: {
    bbox: [51.44, -0.24, 51.57, 0.02],
    assets: { buildings: true, detail: true, roads: true, water: true, bridges: true },
    drawWithinUnits: 400,
    cars: 7000,
    // 100 m. The Shard is 310 and 22 Bishopsgate 278, but London's tall buildings are a handful of
    // clusters in a low city — at Dubai's 180 m almost nothing would carry a lamp.
    beaconMinHeightMetres: 100,

    stops: [
      {
        name: 'The City / Bishopsgate',
        lat: 51.5152, lon: -0.0813, facingDeg: 200,
        note: 'The Square Mile cluster, facing southwest at the Shard across the river.',
      },
      {
        name: 'Westminster',
        lat: 51.4995, lon: -0.1248, facingDeg: 70,
        note: 'Parliament and the bridge, looking downstream toward the City.',
      },
      {
        name: 'South Bank / The Shard',
        lat: 51.5045, lon: -0.0865, facingDeg: 340,
        note: 'Under the tallest building in the country, with the river and the City in front.',
      },
      {
        name: 'Canary Wharf',
        lat: 51.5049, lon: -0.0195, facingDeg: 280,
        note: 'The other cluster, on a loop of the Thames, facing back west at everything else.',
      },
    ],
  },

  battle: {
    roster: [{ breed: 0 }, { breed: 2 }, { breed: 1 }, { breed: 4 }],
    seed: 0x10D0,
    spreadBodies: 6,
  },

  garrison: {
    soldiers: 200, layout: 'scatter', fireRate: 1.5,
    arrival: 'parachute', paratroopers: 200,
    // The Union flag: its own red and blue, which are not the American ones — #C8102E and #012169
    // against #B22234 and #3C3B6E. A city dropping the wrong nation's colours is invisible until it
    // is noticed, and then it is all you can see.
    chuteColours: [[0.61, 0.02, 0.06], [0.88, 0.88, 0.87], [0.00, 0.05, 0.24]],
    humvees: 0, tanks: 0, helicopters: 0, jets: 0,
    note: 'Two hundred by air, in Union flag colours. The Parachute Regiment is a real formation '
      + 'here, unlike in San Jose, where there is no army at all.',
  },
};
