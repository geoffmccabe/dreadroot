// B2 — the Grand Canyon, at Mather Point.
//
// THE SCALE SHOT rather than a fight: camera at human eye height, the Kaiju 500 m off, a crowd of
// two hundred people between you and it. This is the site that answers "how big is 300 m".
//
// THE COORDINATE IS MEASURED, NOT PICKED OFF A MAP. Geoff: "I land on a relatively flat and
// featureless area... there appears to be a canyon, but it's only around 300-500 m deep." The old
// drop stood at 1020 m, which is the canyon FLOOR — about 1,100 m BELOW the rim, and the floor of a
// canyon is the one place a canyon cannot read as one. A script then searched a 4 km grid for the
// actual lip, scoring high ground with a big drop close by and a steep face. The winner is
// 36.0616, -112.1076: 2151 m, with 975 m falling away within a kilometre at a 51 degree face —
// which turns out to be Mather Point, the published visitor-centre overlook.
//
// The deepest ground lies NORTHEAST, so that is the way to look.

import { DEFAULT_BATTLE, WILDERNESS_GROUND, type SiteDef } from './siteTypes';

export const GRAND_CANYON: SiteDef = {
  key: 'Digit2',
  slug: 'grand-canyon',
  name: 'Grand Canyon (Mather Point)',
  blurb: 'The scale shot: eye height, a crowd, and 975 m of canyon falling away behind them.',
  lat: 36.0616, lon: -112.1076, facingDeg: 45,
  scaleShot: true,
  ground: WILDERNESS_GROUND,
  battle: DEFAULT_BATTLE,
  garrison: {
    // Two hundred civilians, not soldiers. The point of this site is a human being 1.8 m tall
    // standing in the same frame as something 300 m tall; armed troops would turn it into a fight
    // and the comparison is the entire content.
    soldiers: 200, layout: 'corridor', fireRate: 0,
    // Civilians. They arrive by coach, like everyone else at a viewpoint.
    arrival: 'ground', paratroopers: 0,
    humvees: 0, tanks: 0, helicopters: 0, jets: 0,
    note: 'Two hundred people at 1.8 m, between you and the Kaiju. They do not shoot.',
  },
};
