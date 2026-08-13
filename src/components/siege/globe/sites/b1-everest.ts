// B1 — Mount Everest.
//
// The original arena, and still the best plain stage on the planet: the highest ground there is,
// with nothing built on it to argue with the scale. No city block, so the terrain is the real
// elevation data and nothing overrides it.

import { DEFAULT_BATTLE, WILDERNESS_GROUND, type SiteDef } from './siteTypes';

export const EVEREST: SiteDef = {
  key: 'Digit1',
  slug: 'everest',
  name: 'Mount Everest',
  blurb: 'The highest ground on Earth, and nothing built on it to argue with the scale.',
  lat: 27.9881, lon: 86.9250, facingDeg: 0,
  ground: WILDERNESS_GROUND,
  battle: DEFAULT_BATTLE,
  garrison: {
    // A token force. Nobody garrisons the summit of Everest, and a company of infantry standing in
    // the death zone would read as a joke — but a handful gives the scale reference the site exists
    // for, which is the whole reason to put a Kaiju here.
    soldiers: 40, layout: 'ring', fireRate: 1.2,
    arrival: 'ground', paratroopers: 0,
    humvees: 0, tanks: 0, helicopters: 0, jets: 0,
    note: 'A token ring. There is no road to 8,849 m and nothing heavier could get here.',
  },
};
