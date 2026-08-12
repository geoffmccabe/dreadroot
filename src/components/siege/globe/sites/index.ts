// sites — the registry. Every battle site the game knows about, in one list.
//
// ADDING A SITE IS ADDING TWO LINES HERE plus one file. Nothing else in the codebase needs changing:
// the shortcode, the ground override, the land mask, the asset paths, the district tour, the roster
// and the panel all read this. See docs/BUILD_A_CITY.md for the whole procedure.
//
// THE ORDER IS THE SHORTCODE ORDER, and the key on each site is the authority. Do not renumber a
// site once it has shipped — Geoff tests by shortcode, and B3 silently becoming somewhere else is
// worse than B3 being missing.

import { EVEREST } from './b1-everest';
import { GRAND_CANYON } from './b2-grand-canyon';
import { DUBAI } from './b3-dubai';
import { SAN_JOSE } from './b4-san-jose';
import { NEW_YORK } from './b5-new-york';
import { SEATTLE } from './b6-seattle';

import type { SiteDef } from './siteTypes';

export * from './siteTypes';

/**
 * Digit1 through Digit9.
 *
 * Digit0 is NOT available: it is already "reset Kaiju size" earlier in the same switch, so a site
 * registered there would silently never fire — a bug indistinguishable from the site being broken.
 */
export const SITES: SiteDef[] = [
  EVEREST,
  GRAND_CANYON,
  DUBAI,
  SAN_JOSE,
  NEW_YORK,
  SEATTLE,
];

/** The site on a given number key, or undefined. */
export function siteForKey(code: string): SiteDef | undefined {
  return SITES.find((s) => s.key === code);
}

/** The site with a given slug, or undefined. Slugs name the asset folders. */
export function siteBySlug(slug: string): SiteDef | undefined {
  return SITES.find((s) => s.slug === slug);
}

/** Only the sites that actually have buildings. */
export function citySites(): SiteDef[] {
  return SITES.filter((s) => s.city);
}

/** Where a site's baked assets live. One folder per city, named by slug. */
export function cityAssetPath(slug: string, file: string): string {
  return `/siege/city/${slug}/${file}`;
}

/**
 * Which site the player is currently at, if any.
 *
 * Module state rather than React state, deliberately: the terrain samplers, the arena and the
 * renderers all need it, and they are not all inside the React tree. Set by the shortcode handler.
 */
let current: SiteDef | null = null;
const listeners = new Set<() => void>();
let version = 0;

export function setCurrentSite(s: SiteDef | null): void {
  if (current === s) return;
  current = s;
  version++;
  listeners.forEach((f) => f());
}
export function currentSite(): SiteDef | null { return current; }
export function subscribeSite(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
export function siteVersion(): number { return version; }

/**
 * Which stop of a city you are at. Pressing the shortcode again moves to the next.
 *
 * Geoff: "I don't see the Burj Khalifa and downtown area where it should be." It was there — but
 * 18.7 km from the drop point, which is a grey box on the horizon. A big city needs several drop
 * points and one press to move between them.
 */
const stopIndex = new Map<string, number>();

export function nextStop(s: SiteDef): { lat: number; lon: number; facingDeg: number; name: string } {
  const stops = s.city?.stops;
  if (!stops || !stops.length) {
    return { lat: s.lat, lon: s.lon, facingDeg: s.facingDeg, name: s.name };
  }
  const i = ((stopIndex.get(s.slug) ?? -1) + 1) % stops.length;
  stopIndex.set(s.slug, i);
  version++;
  listeners.forEach((f) => f());
  const st = stops[i];
  return { lat: st.lat, lon: st.lon, facingDeg: st.facingDeg, name: `${s.name} — ${st.name}` };
}

export function currentStopIndex(slug: string): number {
  return stopIndex.get(slug) ?? 0;
}
