// maskRegistry — where each city is land, keyed by slug.
//
// NAMED maskRegistry AND NOT landMasks, because the generated masks live in a sibling FOLDER called
// landmasks/ and two paths that differ only in capitalisation are a trap this repo has been caught
// by before: it builds on a case-insensitive Mac and fails on a case-sensitive build server, or
// TypeScript loads the same file twice under two names. Never let a file and a directory here differ
// only by case.
//
// A LAND MASK IS NOT OPTIONAL FOR A COASTAL CITY, and Dubai proved why three times over. The planet's
// elevation data is about nine kilometres to a sample, so a city has to declare its own ground — and
// the moment it does, it will fill in the sea unless something says where the sea is. The first two
// attempts (buildings only; buildings plus a flood fill) both failed, and the third (a straight line
// for the coast) invented 54 km2 of land. Only OpenStreetMap's real coastline worked.
//
// SELF-REGISTERING, so adding a city is adding a file rather than editing a list. The generated mask
// calls registerLandMask at import time; sites/landmasks/index.ts imports them all.
//
// WHY IT IS BAKED INTO THE BUNDLE rather than fetched. The terrain starts building before any fetch
// completes, and the arena is created the instant the shortcode is pressed. A mask that arrives late
// leaves already-built patches showing seabed, and puts Kaiju in the water because the spawn check
// had nothing to read. It compresses to a fraction of its size in transit — a coastline is mostly
// long runs of the same value — so the cost of having it early is small.

type LandFn = (xMetres: number, zMetres: number) => number;

const masks = new Map<string, LandFn>();

/** Called by each generated mask at import time. */
export function registerLandMask(slug: string, fn: LandFn): void {
  masks.set(slug, fn);
}

/**
 * How much of this point is land, 0 to 1 — or null if the city has no mask.
 *
 * NULL IS NOT "SEA". A city with no mask is an inland city that never needed one, and treating its
 * whole footprint as water would sink it. Callers must distinguish the two.
 */
export function landFractionFor(slug: string, xMetres: number, zMetres: number): number | null {
  const fn = masks.get(slug);
  return fn ? fn(xMetres, zMetres) : null;
}

export function hasLandMask(slug: string): boolean { return masks.has(slug); }
