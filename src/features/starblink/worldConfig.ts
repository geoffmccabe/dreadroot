// worldConfig — the authoritative numbers for the Starblink land world.
// Every other module reads these; nothing hardcodes a coordinate or a count.
// The reasoning behind each number is in docs/LAND_WORLD_PLAN.md (§2) in the dreadroot repo.

/** Distance across a parcel's flats, and therefore the centre-to-centre spacing of neighbours. */
export const HEX_ACROSS_FLATS_M = 100;

/** Regular-hexagon side length == circumradius (centre to corner). 57.735 m at 100 m flats. */
export const HEX_CIRCUMRADIUS_M = HEX_ACROSS_FLATS_M / Math.sqrt(3);

/** Parcel area, 8,660 m2 = 0.866 ha. */
export const HEX_AREA_M2 = 1.5 * Math.sqrt(3) * HEX_CIRCUMRADIUS_M * HEX_CIRCUMRADIUS_M;

/**
 * Rings of parcels around the centre one. The world is every hex with ring <= this.
 * Total parcels is the centred hexagonal number 3R^2 + 3R + 1, so R = 173 gives 90,307,
 * the closest such number to the 90,000 target.
 */
export const WORLD_RINGS = 173;

/** Total parcels in the world. */
export const TOTAL_PARCELS = 3 * WORLD_RINGS * WORLD_RINGS + 3 * WORLD_RINGS + 1;

/** Parcels within ring R inclusive (centred hexagonal number). */
export const parcelsWithin = (rings: number) => 3 * rings * rings + 3 * rings + 1;

/** Parcels in ring r alone. Ring 0 is the single centre parcel. */
export const parcelsInRing = (r: number) => (r === 0 ? 1 : 6 * r);

/** The unowned home fortress: the centre parcel plus its 6 neighbours (rings 0 to 1). */
export const FORTRESS_RINGS = 1;

/** Alien Worlds claim reserve: rings 2 to 36, 3,990 parcels, exactly 665 per planet sector. */
export const HOMELANDS_RINGS = 36;

/** Named regions by ring, outermost last. `maxRing` is inclusive. */
export interface Region { name: string; maxRing: number }
export const REGIONS: Region[] = [
  { name: 'Fortress',  maxRing: FORTRESS_RINGS },
  { name: 'Homelands', maxRing: HOMELANDS_RINGS },
  { name: 'Districts', maxRing: 61 },
  { name: 'Outlands',  maxRing: 110 },
  { name: 'Frontier',  maxRing: WORLD_RINGS },
];

export function regionOf(ring: number): string {
  for (const r of REGIONS) if (ring <= r.maxRing) return r.name;
  return 'Void';
}
