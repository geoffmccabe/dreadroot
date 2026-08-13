// siteTypes — what a battle site IS, as data.
//
// Geoff: "Each city will also have its own other details like how many kaijus, what size, what
// strength, and details about the soldiers... how many, what they do, etc. So all of that will be in
// a CITY panel for each city. Each will have a shortcode to test it... B4, B5, B6, etc."
//
// WHY THIS FILE EXISTS AT ALL. Dubai was built by hand, and by the end its details were scattered
// across nine files: the drop coordinates in KaijuLabController, the ground height and sea depth in
// cityGround, the land mask in its own generated module, the building path hard-coded in cityData,
// the roads path in cityRoads, the district tour in a third list, and the roster in kaijuArena. Every
// one of those had to be found and edited to change one thing, and adding a SECOND city meant
// finding all nine again and threading a name through each. That is not a framework, it is a city
// with the walls knocked out.
//
// So a site is now one object in one file, and everything else reads it. Adding a city means writing
// one file and running one script. Nothing else in the codebase needs to know the city exists.
//
// A SITE IS NOT ALWAYS A CITY. Everest and the Grand Canyon are sites with no buildings — they still
// have a place, a camera bearing, a Kaiju roster and a garrison, and they still want the panel. The
// `city` block is optional and its absence is the whole difference.
//
// FIELDS ARE OPTIONAL WHERE A SENSIBLE DEFAULT EXISTS, and `resolveSite` fills them in. That matters
// for the agent writing the next city file: it should be able to give a name, a coordinate and a
// rough intent, and get something that works — not have to supply forty numbers it has no opinion
// about.

import type { WeaponId } from '../kaijuWeapons';

// ---------------------------------------------------------------------------------------------
// GROUND
// ---------------------------------------------------------------------------------------------

/**
 * What the terrain does at a city.
 *
 * A city OVERRIDES the planet's elevation data, and it has to. The global tiles are about nine
 * kilometres to a sample; Dubai's whole coast averages out to 87 metres BELOW sea level, which put
 * the first build of the city on the seabed of the Persian Gulf. Against that, tens of thousands of
 * surveyed building footprints are better evidence: if there are towers there, it is land.
 */
export interface SiteGround {
  /**
   * Ground elevation inside the city, in metres above sea level.
   *
   * Keep it SMALL for a coastal city — the beach is the band between this and the water, so a high
   * number is a wide beach. Dubai sits at 0.5 m. Do not use 0: the ocean is a mesh at exactly the
   * planet's radius, and ground at exactly zero is coplanar with it, which strobes per pixel.
   */
  groundMetres: number;
  /**
   * Depth of the sea immediately around the city, in metres (negative).
   *
   * This is about how the water LOOKS, not the seabed. Ocean opacity ramps with depth and only
   * approaches solid at 120 m, so a 12 m shelf draws at nine per cent — a wash over a sand-coloured
   * bed, which the eye reads as more beach. -30 is about a quarter opaque: see-through, but
   * unmistakably water.
   */
  shallowSeaMetres: number;
  /** Full city ground within this radius, in metres. Must cover the furthest building. */
  innerMetres: number;
  /** Blended back to the real terrain by this radius. Put it over empty ground, not through a district. */
  outerMetres: number;
  /**
   * FLATTEN the ground under the city, or FOLLOW it?
   *
   * Geoff: "we need Seattle to look like Seattle... Costa Rica's terrain is very wrong, it's all
   * flat... nearby the city are Poas volcano and other volcanoes that need to be there."
   *
   * 'flatten' forces one height across the whole core. It is the original behaviour and it is right
   * for exactly one situation: a city that is genuinely flat AND whose elevation data is wrong.
   * Dubai is both — the tiles read -87 m across the emirate — so it stays.
   *
   * 'follow' leaves the measured elevation alone and puts every building on its own piece of it,
   * using the per-building heights baked by scripts/city/make-ground.mjs. The valley San Jose sits
   * in comes back, and so do Seattle's hills. The data was always there: sampled around San Jose it
   * runs from 67 m to 3,058 m within forty kilometres.
   *
   * SEA IS STILL FORCED in follow mode, because the mask is better evidence than the tiles: New
   * York's East River reads +4 m, and left alone it would be dry ground between Manhattan and
   * Queens.
   *
   * Procedural relief is suppressed across a follow city's footprint even so — see cityFlatness.
   * That is not optional: the renderer band-limits its fractal detail by the patch's own vertex
   * spacing, so the height at a point CHANGES with the level of detail, and nothing sampled offline
   * could match it at every LOD. Measured elevation is stable; the fractal on top of it is not.
   */
  mode?: 'flatten' | 'follow';
  /**
   * Is the planet's own elevation data usable OUTSIDE the city?
   *
   * Geoff, at San Jose: "the land is perfectly flat. San Jose has deep valleys, hills, and
   * volcanoes around it."
   *
   * He is right, and the cause is that LAND never blended. Dubai's tiles read -87 m across the
   * whole emirate — a nine-kilometre average of gulf and desert — so blending its land back toward
   * that would sink the desert under sixty metres of water. Land there is therefore held flat all
   * the way to the outer radius, and that was hardcoded for every city.
   *
   * San Jose is the opposite case. Its tiles are COARSE but RIGHT: centro reads 1,128 m against a
   * real 1,172, Cartago 1,419, Alajuela 994, Irazu 3,058. Holding all of that flat throws away the
   * Valle Central, which is the whole shape of the place.
   *
   * So: true (the default) blends the city's flat ground back into the real terrain between the two
   * radii, and the valleys and volcanoes return. false holds it flat, for a city whose surrounding
   * data is simply wrong.
   */
  trustBaseOutside?: boolean;
}

// ---------------------------------------------------------------------------------------------
// THE CITY ITSELF
// ---------------------------------------------------------------------------------------------

/**
 * The baked assets for a city, all under public/siege/city/<slug>/.
 *
 * Every one is optional. A city with buildings and no roads is a legitimate half-built city and
 * should render, not throw — these are scenery, and scenery must never be able to take the frame
 * loop down with it.
 */
export interface CityAssets {
  /** buildings.bin — the instanced boxes. The bulk of the city. */
  buildings: boolean;
  /** detail.bin — real extruded polygons for the buildings OSM describes in 3D. */
  detail: boolean;
  /** roads.bin — the street network, drawn as asphalt and driven by the traffic lights. */
  roads: boolean;
  /** water.bin — inland waterways: marinas, lakes, canals, creeks. */
  water: boolean;
  /**
   * bridges.bin — spans lifted off the water, with towers on the long ones.
   *
   * Optional and defaulting to off, because most cities do not need it: without this file a bridge
   * is simply part of the road network, painted flat, which is fine for an overpass. It matters
   * where the crossings ARE the skyline.
   */
  bridges?: boolean;
}

export interface CityDef {
  /**
   * The bounding box the bake fetched, as [south, west, north, east] in degrees.
   *
   * Recorded so a rebuild fetches the identical area. Without it, "re-run the bake" quietly means
   * "fetch whatever I type this time" and the city silently changes shape.
   */
  bbox: [number, number, number, number];
  assets: CityAssets;
  /** Beyond this many game units the city is not drawn. 400 units = 40 km. */
  drawWithinUnits: number;
  /**
   * Districts, for the shortcode to cycle through.
   *
   * Geoff, on Dubai: "I don't see the Burj Khalifa and downtown area where it should be." It was
   * there — but the drop point was 18.7 km away, which is a grey box on the horizon. A big city
   * needs several drop points and one press to move between them.
   */
  stops: SiteStop[];
  /** Traffic. Set cars to 0 for a city with no working street lighting. */
  cars: number;
  /** Roofs above this height get a red aircraft warning lamp, in metres. */
  beaconMinHeightMetres: number;
}

export interface SiteStop {
  name: string;
  lat: number;
  lon: number;
  /**
   * Compass bearing to face on arrival, degrees, 0 = north.
   *
   * Point it at what you came to see. And CHECK IT AGAINST THE LAND MASK: three of Dubai's four
   * drop points had a Kaiju spawning in the Gulf, because the spawn ring puts one at each compass
   * point 1.8 km out and nobody had asked whether those points were dry.
   */
  facingDeg: number;
  /** Free text for the panel — what this district is and why you would fight here. */
  note?: string;
}

// ---------------------------------------------------------------------------------------------
// THE FIGHT
// ---------------------------------------------------------------------------------------------

/** One Kaiju in the roster. */
export interface KaijuSlot {
  /** Index into BREEDS in kaijuStats.ts. Agent 0 is always the player. */
  breed: number;
  /**
   * Height in game units. 1 unit = 100 m, so 3 = a 300 m Kaiju.
   *
   * Scale is dynamically similar, not linear: speed goes as the square root of size and animation
   * rate as its inverse, so a 600 m creature is not "twice as fast", it is 1.41x as fast and moves
   * at 0.71x the frame rate. That is what makes a giant look ponderous and still cross ground.
   */
  heightUnits?: number;
  /** Multiplies the breed's health. The player already gets 10x on top of this. */
  healthMul?: number;
  /** Multiplies the breed's damage. */
  damageMul?: number;
  /** Override the breed's weapon, if this site wants a different mix. */
  weapon?: WeaponId;
}

export interface BattleDef {
  /** Who is fighting. First entry is you. */
  roster: KaijuSlot[];
  /** Random seed, so a site's fight is reproducible and two runs can be compared. */
  seed: number;
  /** Spawn ring radius, in body-lengths. 6 puts a 300 m Kaiju 1.8 km out. */
  spreadBodies: number;
}

// ---------------------------------------------------------------------------------------------
// THE HUMANS
// ---------------------------------------------------------------------------------------------

/**
 * Ground and air forces.
 *
 * Geoff: "For the soldiers we'll [have] new things... helicopters, airplanes, tanks, humvees, etc."
 *
 * Only `soldiers` is built today. The rest are declared now, with counts of zero, on purpose: a
 * field that exists and reads 0 is a thing the panel can show as "none" and an agent can fill in,
 * where a field that does not exist yet means every city file written before it lands has to be
 * revisited. Declaring the shape early is cheap; migrating twelve city files is not.
 */
export interface GarrisonDef {
  /** Infantry. They shoot, they shout, and they are what gives a 300 m creature its scale. */
  soldiers: number;
  /**
   * HOW THEY ARRIVE.
   *
   * Geoff: "start with 200 soldiers in the US just like Dubai where they parachute in... For Costa
   * Rica, start them on the ground... no paratroopers."
   *
   * That is not decoration. A country with an army drops troops from aircraft; Costa Rica abolished
   * its military in 1948 and what turns out is the Fuerza Pública, who arrive in vehicles because
   * there is nothing to jump out of.
   */
  arrival: 'ground' | 'parachute';
  /** How many of `soldiers` come by air. Ignored when arrival is 'ground'. */
  paratroopers: number;
  /**
   * Canopy colours, as linear RGB triples.
   *
   * Geoff, for New York: "make their colors red, white and blue for the flag." Dubai's are its own
   * flag — red, green, white and black — and a city dropping the wrong nation's colours is the kind
   * of detail that is invisible until it is noticed, and then is all you can see.
   */
  chuteColours?: [number, number, number][];
  /**
   * How they are arranged.
   *
   * 'corridor' lines them along the approach, 'ring' surrounds the fight, 'scatter' spreads them
   * over the ground, 'none' leaves the site empty.
   */
  layout: 'corridor' | 'ring' | 'scatter' | 'none';
  /** Rounds per soldier per second. Real infantry is 1-2; higher reads as a machine gun. */
  fireRate: number;
  /** Wheeled, fast, light. NOT BUILT YET — see the note above. */
  humvees: number;
  /** Tracked, slow, a real gun. NOT BUILT YET. */
  tanks: number;
  /** Circle the fight, fire rockets, get swatted. NOT BUILT YET. */
  helicopters: number;
  /** Fast passes overhead. NOT BUILT YET. */
  jets: number;
  /** Free text for the panel: what this garrison is meant to feel like. */
  note?: string;
}

// ---------------------------------------------------------------------------------------------
// THE SITE
// ---------------------------------------------------------------------------------------------

export interface SiteDef {
  /**
   * The shortcode, as a KeyboardEvent.code. B then this key jumps here.
   *
   * Digit1-Digit9 only. Digit0 is taken by "reset Kaiju size", and a site put there would silently
   * never fire — which is a bug that looks exactly like the site being broken.
   */
  key: string;
  /** Lower-case, no spaces. Names the asset folder: public/siege/city/<slug>/. */
  slug: string;
  /** Shown in the panel and the arrival banner. */
  name: string;
  /** One line on why this site is worth fighting in. */
  blurb: string;
  /** The default drop point. For a city this is usually stops[0]. */
  lat: number;
  lon: number;
  facingDeg: number;
  /**
   * SCALE SHOT instead of a battle: camera at human eye height, the Kaiju 500 m off, a crowd between.
   * The Grand Canyon uses this; everywhere else stages a fight.
   */
  scaleShot?: boolean;
  ground: SiteGround;
  /** Absent for a wilderness site. Its absence is the only thing that makes Everest not a city. */
  city?: CityDef;
  battle: BattleDef;
  garrison: GarrisonDef;
}

// ---------------------------------------------------------------------------------------------
// DEFAULTS
// ---------------------------------------------------------------------------------------------

/**
 * Ground defaults for a site with no city, i.e. leave the planet alone.
 *
 * innerMetres 0 means "override nothing", which is what you want on a mountain: Everest's real
 * elevation data is excellent and inventing a flat plateau on it would be vandalism.
 */
export const WILDERNESS_GROUND: SiteGround = {
  groundMetres: 0, shallowSeaMetres: -30, innerMetres: 0, outerMetres: 0,
};

export const DEFAULT_GARRISON: GarrisonDef = {
  soldiers: 0, layout: 'none', fireRate: 1.5,
  // Ground, because it is the assumption that needs no aircraft: a site that has not said how its
  // troops arrive has not said it has an air force either.
  arrival: 'ground', paratroopers: 0,
  humvees: 0, tanks: 0, helicopters: 0, jets: 0,
};

/** The demo fight: you as a Bastion, then Sentinel, Reaver and Martyr. Four visibly different models. */
export const DEFAULT_BATTLE: BattleDef = {
  roster: [{ breed: 0 }, { breed: 2 }, { breed: 1 }, { breed: 4 }],
  seed: 0x5EED,
  spreadBodies: 6,
};

/** Does this site override the planet's terrain? */
export function siteOverridesGround(s: SiteDef): boolean {
  return s.ground.innerMetres > 0;
}
