// B7 — Miami. Flat, low, and built around a bay rather than along a coast.
//
// EVERY OTHER CITY HERE HAS RELIEF TO ARGUE ABOUT. Miami has none: measured against the real tiles
// it reads 1 to 3 metres everywhere — downtown 2 m, Brickell 1 m, Wynwood 3 m, Coral Gables 3 m.
// That is not the coarse data failing, it is Miami. The highest natural ground in the whole county
// is under 8 m.
//
// SO THE MASK DOES ALL THE WORK HERE. What gives Miami its shape is not height but WATER: Biscayne
// Bay between the mainland and the barrier islands, and Miami Beach sitting out in it. The coarse
// elevation reads Miami Beach at -1 m — the island averaged with the ocean around it — so without
// a mask the most recognisable strip of the city is underwater.
//
// AND THE CAUSEWAYS. Downtown and South Beach are four kilometres apart across open water, joined
// by the MacArthur, the Venetian and the Julia Tuttle. A Kaiju fight here is a fight about the
// crossings, so bridges are not decoration.

import type { SiteDef } from './siteTypes';

export const MIAMI: SiteDef = {
  key: 'Digit7',
  slug: 'miami',
  name: 'Miami',
  blurb: 'Towers on a sandbar, a bay between them, and three causeways to knock down.',

  lat: 25.7743, lon: -80.1937, facingDeg: 110,

  ground: {
    // FOLLOW, like every city except Dubai — though here it changes almost nothing, because there
    // is almost nothing to follow. It is still right: 3 m of real variation beats 0 m of invented
    // flatness, and it costs the same.
    mode: 'follow',
    groundMetres: 2,
    shallowSeaMetres: -14,
    // 14 km: Coral Gables and the northern suburbs reach 13.5 km from the bay, and in FOLLOW mode
    // this radius is what suppresses procedural relief across the city so buildings and ground
    // agree. A building outside it stands on fractal terrain nothing sampled offline could predict.
    innerMetres: 14000,
    outerMetres: 24000,
    trustBaseOutside: true,
  },

  city: {
    bbox: [25.70, -80.30, 25.87, -80.11],
    assets: { buildings: true, detail: true, roads: true, water: true, bridges: true },
    drawWithinUnits: 400,
    cars: 5000,
    // 120 m. Miami's tallest is Panorama at 261 m and there are perhaps a dozen over 150 — Dubai's
    // 180 m threshold would light three buildings in the entire city.
    beaconMinHeightMetres: 120,

    stops: [
      {
        name: 'Downtown / Bayfront',
        lat: 25.7743, lon: -80.1937, facingDeg: 110,
        note: 'Facing east across the bay at Miami Beach, with the causeways running out to it.',
      },
      {
        name: 'Brickell',
        lat: 25.7620, lon: -80.1930, facingDeg: 20,
        note: 'The tallest cluster in Florida, looking back north up the waterfront.',
      },
      {
        name: 'South Beach',
        lat: 25.7800, lon: -80.1300, facingDeg: 250,
        note: 'Out on the barrier island, with four kilometres of open water between you and downtown.',
      },
      {
        name: 'Wynwood',
        lat: 25.8010, lon: -80.1990, facingDeg: 160,
        note: 'Low-rise warehouses — the one district where a 300 m creature has nothing to hide behind.',
      },
    ],
  },

  battle: {
    roster: [{ breed: 0 }, { breed: 2 }, { breed: 1 }, { breed: 4 }],
    seed: 0x81A1,
    spreadBodies: 6,
  },

  garrison: {
    soldiers: 200, layout: 'scatter', fireRate: 1.5,
    arrival: 'parachute', paratroopers: 200,
    // US colours, as for New York and Seattle.
    chuteColours: [[0.55, 0.03, 0.08], [0.88, 0.88, 0.86], [0.02, 0.09, 0.35]],
    humvees: 0, tanks: 0, helicopters: 0, jets: 0,
    note: 'Two hundred by air. Half the city is reachable only over water, so the drop is the only '
      + 'way anything arrives quickly.',
  },
};
