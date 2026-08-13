// B3 — Dubai. The first city, and the one every number in the framework was learned from.
//
// 58,856 boxes, 1,214 detailed solids, 15,571 roads, 369 waterways. Four districts along 20 km of
// coast, all loaded at once, so walking between them works and the shortcode tours them.
//
// EVERY VALUE BELOW HAS A SCAR ON IT. Read the comments before changing one — most of these numbers
// were arrived at by shipping the wrong one first.

import type { SiteDef } from './siteTypes';

export const DUBAI: SiteDef = {
  key: 'Digit3',
  slug: 'dubai',
  name: 'Dubai',
  blurb: 'The densest cluster of tall towers on Earth, on a coast, with the Burj Khalifa in it.',

  // The default drop is the Marina stop — see stops[0] for why it is where it is.
  lat: 25.0760, lon: 55.1489, facingDeg: 300,

  ground: {
    // HALF A METRE, and not zero. Geoff went 6 m -> 2 m -> "another 2 m down"; the last step stops
    // here because the ocean is a mesh at exactly the planet's radius, so ground at exactly zero is
    // coplanar with it and the whole city strobes between sand and water per pixel. Half a metre is
    // below anything visible at this scale and above that failure — and it keeps the procedural
    // terrain noise switched off, since that fades out below 120 m and is under 20 cm here.
    groundMetres: 0.5,
    // -30, deepened from -12, and it is about how the water LOOKS rather than the seabed. Ocean
    // opacity ramps with depth and only nears solid at 120 m, so a 12 m shelf drew at nine per cent:
    // a thin wash over a sand-coloured bed, which reads as still more beach.
    shallowSeaMetres: -30,
    // The furthest building is 13.1 km out, so 15 km covers the whole import...
    innerMetres: 15000,
    // ...and the blend runs to 26 km so the transition happens over open desert and water rather
    // than through the middle of a district.
    outerMetres: 26000,
    // FALSE, and Dubai is the reason the flag exists. Its tiles read -87 m across the whole emirate
    // — a nine-kilometre average of gulf and low desert — so blending the land back toward them
    // would put the desert under sixty metres of water. Here the override is correcting a lie, not
    // simplifying a truth, and it must hold all the way out.
    trustBaseOutside: false,
  },

  city: {
    // The exact area the bake fetched. Recorded so a rebuild fetches the identical ground; without
    // it, "re-run the bake" means "fetch whatever I type this time" and the city changes shape.
    bbox: [25.02, 55.02, 25.30, 55.40],
    assets: { buildings: true, detail: true, roads: true, water: true },
    // 400 units = 40 km: past the far side of every district, so the skyline is complete from
    // anywhere you would fight, and gone by the time you are in orbit.
    drawWithinUnits: 400,
    cars: 9000,
    beaconMinHeightMetres: 180,

    stops: [
      {
        // ONE KILOMETRE INLAND of the Marina's own coordinates, at a bearing of 120 degrees, and the
        // bearing is measured rather than guessed: a script walked every compass direction at 1 km
        // against the real land mask and scored each by whether the drop point AND all four spawn
        // positions 1.8 km around it come out on land. 120 is the only one that scores full marks.
        name: 'Dubai Marina',
        lat: 25.0760, lon: 55.1489, facingDeg: 300,
        note: 'The densest tower cluster anywhere. Facing back northwest at the towers and the water.',
      },
      {
        name: 'Palm Jumeirah',
        lat: 25.1124, lon: 55.1390, facingDeg: 300,
        note: 'The trunk, looking out along the fronds — the one place the islands read as islands.',
      },
      {
        name: 'Downtown / Burj Khalifa',
        lat: 25.1880, lon: 55.2650, facingDeg: 40,
        note: 'Standing off the Burj far enough that all 828 m of it fits above a Kaiju\'s eye line.',
      },
      {
        name: 'Sheikh Zayed Road',
        lat: 25.2175, lon: 55.2825, facingDeg: 225,
        note: 'Looking down the canyon of towers that lines the twelve-lane highway.',
      },
    ],
  },

  battle: {
    roster: [{ breed: 0 }, { breed: 2 }, { breed: 1 }, { breed: 4 }],
    seed: 0x5EED,
    spreadBodies: 6,
  },

  garrison: {
    soldiers: 200, layout: 'corridor', fireRate: 1.5,
    // Dubai's flag: red, green, white, black. The original palette.
    arrival: 'parachute', paratroopers: 50,
    // Declared and zero. The city has the roads for them; nothing drives on them yet.
    humvees: 0, tanks: 0, helicopters: 0, jets: 0,
    note: 'Infantry along the approach. Tracers, ricochets and shouting, which is what gives the '
      + 'towers their scale as much as the towers give it to the Kaiju.',
  },
};
