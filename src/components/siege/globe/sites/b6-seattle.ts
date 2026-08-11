// B6 — Seattle. The hardest city in the framework so far, and worth having for exactly that reason.
//
// THE PROBLEM IS THAT SEATTLE IS ITS TOPOGRAPHY. This framework stands a city on ONE tangent plane
// and holds the ground flat under it, which is right for Dubai (a coastal flat) and defensible for
// San Jose (a plateau). Seattle is neither: it is a set of steep hills between two bodies of water,
// and flattening the whole thing would remove the thing that makes it Seattle. Measured:
//
//     Downtown        L6:  35 m       Capitol Hill  L6: 107 m   (real ~130 m)
//     Queen Anne      L6:  63 m       Ballard       L6:  36 m   (real ~140 m at the top)
//     Elliott Bay     L6: -73 m       Lake Union    L6: +32 m   <- fresh water reading as land
//
// So the flat core is kept SMALL — 9 km, against Dubai's 15 and New York's 12 — which covers
// downtown, Belltown, SoDo, South Lake Union and the foot of the hills, and lets the real relief
// take over beyond it. That is a compromise and it is worth saying so plainly: the hills inside the
// core are being levelled, and the cure for that is per-building ground sampling, which is a
// different piece of work.
//
// FIRST CITY WITH FRESH WATER. Lake Union and Lake Washington read as LAND in the coarse elevation
// (+32 m and +4 m), so the water bake matters here as much as the coastline — the Ship Canal, the
// lakes and Elliott Bay all have to be cut in explicitly or the city sits in a bowl of dry ground.

import type { SiteDef } from './siteTypes';

export const SEATTLE: SiteDef = {
  key: 'Digit6',
  slug: 'seattle',
  name: 'Seattle',
  blurb: 'Steep, wet and hemmed in — a downtown wedged between a sound, a lake and its own hills.',

  lat: 47.6080, lon: -122.3350, facingDeg: 315,

  ground: {
    // 35 m, the measured downtown elevation, rather than an average over the hills — the core is
    // what gets flattened, so the core's own height is the honest number to use.
    groundMetres: 35,
    shallowSeaMetres: -40,
    // Deliberately small. See the note above: past this the real hills come back.
    innerMetres: 9000,
    outerMetres: 20000,
  },

  city: {
    bbox: [47.55, -122.42, 47.68, -122.27],
    assets: { buildings: true, detail: true, roads: true, water: true },
    drawWithinUnits: 400,
    cars: 5000,
    // 120 m, between Dubai's 180 and San Jose's 60. Columbia Center is 285 m and there are a dozen
    // over 150, so 180 would light almost nothing.
    beaconMinHeightMetres: 120,

    stops: [
      {
        name: 'Downtown / Columbia Center',
        lat: 47.6045, lon: -122.3301, facingDeg: 290,
        note: 'The tallest building west of the Mississippi outside LA, facing out over Elliott Bay.',
      },
      {
        name: 'Seattle Center / Space Needle',
        lat: 47.6205, lon: -122.3493, facingDeg: 150,
        note: 'The Needle in the foreground and the whole downtown skyline behind it.',
      },
      {
        name: 'South Lake Union',
        lat: 47.6205, lon: -122.3370, facingDeg: 200,
        note: 'The tech blocks, with the lake at your back — one of the few flat parts of the city.',
      },
      {
        name: 'Pioneer Square / SoDo',
        lat: 47.5990, lon: -122.3330, facingDeg: 0,
        note: 'The old town and the stadiums, looking north up the length of downtown.',
      },
    ],
  },

  battle: {
    roster: [{ breed: 0 }, { breed: 2 }, { breed: 1 }, { breed: 4 }],
    seed: 0x5EA77,
    spreadBodies: 6,
  },

  garrison: {
    soldiers: 180, layout: 'scatter', fireRate: 1.4,
    humvees: 0, tanks: 0, helicopters: 0, jets: 0,
    note: 'Scattered rather than drawn up along one approach — there is no straight line through '
      + 'this city, which is the whole difficulty of fighting in it.',
  },
};
