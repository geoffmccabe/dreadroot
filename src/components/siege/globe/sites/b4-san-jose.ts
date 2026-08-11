// B4 — San José, Costa Rica. The second city, and the first one the framework built rather than
// grew: one config, five bakes, one file.
//
// It is deliberately NOT a second Dubai, and the differences are the point — each one exercised a
// path Dubai could never reach:
//
//   INLAND. No coastline, so no land mask. landFractionFor returns null for this slug and the whole
//   footprint counts as land, which is correct and is why null had to mean "no mask" rather than
//   "sea". A framework that only ever saw a coastal city would have got that backwards.
//
//   HIGH. 1,160 m in the Valle Central, ringed by volcanoes. This is what forced cityFlatness: the
//   planet lays procedural relief over the tile data scaled by elevation, and at this altitude it
//   offers up to 345 metres of it. Dubai's ground is half a metre, where the coastal fade zeroes
//   that automatically, so the city was flat by accident and nobody had noticed the accident.
//
//   LOW-RISE. Dubai is 165 towers over 150 m; San José's tallest building is under 100 m and most of
//   the city is three to fifteen metres. A 300 m Kaiju does not walk BETWEEN these buildings, it
//   walks OVER them — which is a completely different fight, and the reason to have both.
//
// The elevation was measured against the real tile server before anything was baked, not guessed:
//
//     San Jose centro   L10: --   L8: --   L6: --   L4: 1128 m   (real ~1172 m)
//     Escazu            L4: 1155 m      Curridabat  L4: 1217 m
//     Heredia           L4: 1146 m      Desamparados L4: 1165 m
//     Volcan Irazu      L4: 3058 m      (real 3432 m — the coarse tiles clip peaks)
//
// Like Dubai, Costa Rica has NO detail tiles at any level; level 4 is about nine kilometres to a
// sample. Unlike Dubai the data is not WRONG here, merely coarse — it is within about 40 m of the
// truth — so this override is flattening a real plateau rather than correcting a lie.

import type { SiteDef } from './siteTypes';

export const SAN_JOSE: SiteDef = {
  key: 'Digit4',
  slug: 'san-jose',
  name: 'San José, Costa Rica',
  blurb: 'A low-rise capital on a high plateau, ringed by volcanoes. You walk over this one.',

  lat: 9.9333, lon: -84.0784, facingDeg: 270,

  ground: {
    // 1,160 m — the mean of the measurements above across the built area. The city is genuinely a
    // plateau, so flattening it costs about 60 m of real relief at the rim and nothing in the middle.
    groundMetres: 1160,
    // Inland, so this is never read. Carried anyway because a site is one shape: a field that exists
    // only on coastal cities is a field every consumer has to test for.
    shallowSeaMetres: -30,
    // Matched to the bake's own clip radius (maxRangeMetres 12000 in the config) so that everything
    // baked sits inside the flat core. A road that ends up outside it stands on blended ground and
    // floats — which is the inland version of a building in the sea.
    innerMetres: 12000,
    outerMetres: 24000,
  },

  city: {
    bbox: [9.84, -84.18, 10.03, -83.98],
    // No water: OSM has almost nothing mapped as an area here. The rivers through San José — the
    // Torres and the María Aguilar — are steep wooded ravines mapped as lines, not surfaces, and a
    // line has no width to draw. Set this true if that ever changes.
    assets: { buildings: true, detail: true, roads: true, water: false },
    drawWithinUnits: 400,
    // Fewer than Dubai's 9,000, and not arbitrarily: the network here is about a third the length,
    // and San José at night is genuinely darker and thinner than the Gulf.
    cars: 3500,
    // 60 m rather than Dubai's 180. Aircraft warning lamps go on whatever is tall FOR THE CITY, and
    // at 180 m San José would have none at all — the country's tallest building is under 100 m.
    beaconMinHeightMetres: 60,

    stops: [
      {
        // The historic core: Plaza de la Cultura, the Teatro Nacional, Avenida Central. Dense, low,
        // and on a grid — the one part of the city where the streets read as streets from above.
        name: 'San José Centro',
        lat: 9.9333, lon: -84.0784, facingDeg: 270,
        note: 'The colonial grid. Facing west down Avenida Central toward the towers on Paseo Colón.',
      },
      {
        // Where the tall buildings actually are, such as they are.
        name: 'Paseo Colón / La Sabana',
        lat: 9.9370, lon: -84.0980, facingDeg: 90,
        note: 'The office strip and the big park. Facing back east at the centre.',
      },
      {
        // The money. Modern glass towers on the western hills, and the steepest ground in the city.
        name: 'Escazú',
        lat: 9.9190, lon: -84.1400, facingDeg: 60,
        note: 'Glass towers on the western slope, looking back northeast across the valley.',
      },
      {
        // The university district, and the eastern sprawl.
        name: 'San Pedro / Curridabat',
        lat: 9.9280, lon: -84.0300, facingDeg: 280,
        note: 'The university side. Facing west, with the whole city between you and the far ridge.',
      },
    ],
  },

  battle: {
    roster: [{ breed: 0 }, { breed: 2 }, { breed: 1 }, { breed: 4 }],
    // A different seed from Dubai's, so the two cities do not stage the identical fight — the seed
    // drives the opening delays and the scatter, and reusing one makes every site feel the same.
    seed: 0xC0574,
    spreadBodies: 6,
  },

  garrison: {
    // COSTA RICA HAS NO ARMY. It abolished its military in 1948 and has not had one since, which is
    // the single most famous fact about the country and would be absurd to ignore. What turns out
    // for a Kaiju here is the Fuerza Pública — police, not infantry — so the force is smaller than
    // Dubai's, scattered rather than drawn up along an approach, and slower to shoot.
    soldiers: 120, layout: 'scatter', fireRate: 1.0,
    // These stay at zero, and for this city that is not merely "not built yet". Costa Rica has no
    // tanks and no combat aircraft. If a future city fields armour, San José still should not.
    humvees: 0, tanks: 0, helicopters: 0, jets: 0,
    note: 'Fuerza Pública, not an army — Costa Rica abolished its military in 1948. Scattered '
      + 'police units, thinner and slower than Dubai\'s, and no armour or aircraft at any point.',
  },
};
