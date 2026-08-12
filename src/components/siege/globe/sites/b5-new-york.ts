// B5 — New York City. Manhattan, and enough of Brooklyn, Queens and Jersey City for the rivers to
// have two banks.
//
// THE LAND MASK DOES MORE WORK HERE THAN ANYWHERE. The planet's coarse elevation reads the EAST
// RIVER at +4 m — as LAND — and the Hudson barely below zero. Without a mask Manhattan is welded to
// Queens, the Hudson is a field, and the single most recognisable city outline on Earth is a blob.
// Measured before anything was baked:
//
//     Lower Manhattan (WTC)  L4:   2 m        Midtown (Empire State) L4:  10 m
//     Central Park           L4:  16 m        Downtown Brooklyn      L4:  15 m
//     Long Island City       L4:   0 m        Jersey City            L4:  -7 m
//     Upper Bay   (water)    L4:  -8 m        East River  (water)    L4:  +4 m  <- the problem
//
// The coastBbox in the config is far wider than the built area on purpose: the flood fill that
// decides which side is sea has to enter from open ocean south of the Narrows and travel up the
// Hudson and the East River. Start it too close and it never gets in.
//
// This is also the tallest city in the framework. One World Trade is 541 m, Central Park Tower 472,
// 111 West 57th 435 — all of them mapped in OSM's Simple 3D Buildings layer, which is what
// make-detail reads. Expect the setbacks and spires that make Manhattan's skyline what it is.

import type { SiteDef } from './siteTypes';

export const NEW_YORK: SiteDef = {
  key: 'Digit5',
  slug: 'new-york',
  name: 'New York City',
  blurb: 'The tallest skyline in the framework, on an island, with two rivers to knock things into.',

  lat: 40.7484, lon: -73.9857, facingDeg: 200,

  ground: {
    // Low and coastal, like Dubai and for the same reasons: the beach is the band between this and
    // the water, and Manhattan's shoreline is a hard edge that wants no beach at all.
    // FOLLOW, not flatten. Manhattan is not flat: the audit found 60 m of high ground 11 km north being levelled to 2 m.
    mode: 'follow',
    groundMetres: 2,
    shallowSeaMetres: -30,
    // The built area reaches about 11 km from Midtown; 12 km covers it and matches the bake's clip.
    innerMetres: 12000,
    outerMetres: 26000,
    // The harbour and the Palisades are real in the tile data, so let them be real.
    trustBaseOutside: true,
  },

  city: {
    bbox: [40.68, -74.04, 40.82, -73.90],
    // ALL FOUR. The 3D layer is what turns One World Trade from a 417 m box into the full 541 m
    // antiprism with its mast, and the Chrysler from 246 m into 319 m with its spire. Buildings over
    // 100 m went from 441 to 3,222 — most of Manhattan's skyline is described in that layer and
    // none of it was being drawn.
    assets: { buildings: true, detail: true, roads: true, water: true },
    drawWithinUnits: 400,
    cars: 9000,
    // Manhattan has a great many buildings over 180 m, so the Dubai threshold works here unchanged.
    beaconMinHeightMetres: 180,

    stops: [
      {
        name: 'Midtown',
        lat: 40.7484, lon: -73.9857, facingDeg: 200,
        note: 'Beside the Empire State, facing downtown along the avenues at the taller cluster.',
      },
      {
        name: 'Lower Manhattan',
        lat: 40.7127, lon: -74.0134, facingDeg: 20,
        note: 'One World Trade and the financial district, looking back north up the island.',
      },
      {
        name: 'Central Park South',
        lat: 40.7663, lon: -73.9810, facingDeg: 180,
        note: 'The supertall row on 57th, with the park behind you and the whole skyline in front.',
      },
      {
        name: 'Brooklyn waterfront',
        lat: 40.7020, lon: -73.9900, facingDeg: 320,
        note: 'Across the East River, which is the view Manhattan was built to be seen from.',
      },
    ],
  },

  battle: {
    roster: [{ breed: 0 }, { breed: 2 }, { breed: 1 }, { breed: 4 }],
    seed: 0x0F1CE,
    spreadBodies: 6,
  },

  garrison: {
    // The largest garrison of the three, and the only one with armour and aircraft pencilled in.
    // They are still zero because none of it is built — but unlike San Jose, where zero is a fact
    // about the country, these are zero only until the vehicles exist.
    soldiers: 300, layout: 'corridor', fireRate: 1.6,
    humvees: 0, tanks: 0, helicopters: 0, jets: 0,
    note: 'Heavy infantry along the avenues. The one site where armour and helicopters belong once '
      + 'they exist — the counts here are a placeholder, not a statement about the city.',
  },
};
