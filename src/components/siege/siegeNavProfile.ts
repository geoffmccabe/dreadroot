// siegeNavProfile — per-MAP monster navigation traits. A Map can have many instances (open world vs
// challenges), but the navigation a map's geometry NEEDS is a property of the map, so it lives here.
// MonsterEnemy reads the active map's profile and turns the right pursuit behaviours on — so we get
// map-specific "no safe spots" behaviour WITHOUT forking every monster.
//
//   pathfindAround — grid A* to route AROUND walls into garages/caves at the player's level.
//   climbToRoof    — scale BVH (mesh) building walls UP to a player on a rooftop / flying.
//   crawlHoles     — prone-crawl into low openings (plays the crawl clip while pathing).
//
// The box-collider "climb gait" (Bleakrock rocks/towns) is separate and always on for climb-gait
// monsters; this profile adds the MESH-world behaviours those worlds can't express.

export interface NavProfile {
  pathfindAround: boolean;
  climbToRoof: boolean;
  crawlHoles: boolean;
}

// Open world / box-collider maps: A* around + crawl; vertical handled by the box climb gait.
const DEFAULT: NavProfile = { pathfindAround: true, climbToRoof: false, crawlHoles: true };

// BVH-mesh maps that need full "no safe spots" pursuit.
const CITY: NavProfile = { pathfindAround: true, climbToRoof: true, crawlHoles: true };

const PROFILES: Record<string, NavProfile> = {
  'city-demo': CITY,   // Death Dark City (and the open-world SciFi City) — climb to rooftops + crawl in
  'apoc-city': CITY,
};

export function getNavProfile(mapId: string | undefined): NavProfile {
  return (mapId && PROFILES[mapId]) || DEFAULT;
}
