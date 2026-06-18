// regionDefaults — the default spawn coordinates for each Open-World region's ambient spawner.
// Seeded from the teleport pads (siegeAreas), with Beach pointed at the known beach-monster area.
// These are just DEFAULTS: a superadmin overrides them per region-spawner challenge in the Creator
// (stored on challenge.spawn), and we update these constants when better coordinates come in.
import { SIEGE_TELEPORTS } from '../siegeAreas';

export const REGION_COORDS: Record<string, [number, number, number]> = (() => {
  const m: Record<string, [number, number, number]> = {};
  for (const t of SIEGE_TELEPORTS) m[t.name] = [...t.pos] as [number, number, number];
  m['Beach'] = [-400, 26, 705];   // the beach-monster area, not the teleport pad
  return m;
})();

export const regionCoords = (region?: string): [number, number, number] =>
  (region && REGION_COORDS[region]) || [-400, 26, 705];
