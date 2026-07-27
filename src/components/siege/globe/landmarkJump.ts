// landmarkJump — fly straight to any of the 226 real landmarks.
//
// Added because the Mini Earth spawns over Houston, which is one of the flattest places on the
// planet: coastal plain at about 10 m for hundreds of kilometres in every direction. Looking for
// "3D topology" from there is looking at ground that genuinely has none, and the 225 regions
// carrying real 30 m Copernicus data are exactly the places worth judging the terrain from.
//
// Ordered so the first few are the most dramatic, because the point of this is to answer "does
// the terrain work" in one keypress rather than after a tour.

import { ASSET_BASE } from '@/config/assetBase';

export interface Landmark {
  n: string;
  lat: number;
  lon: number;
  r: number;
  /** Marked in landmarks.json where Copernicus has no public coverage. */
  glo30?: boolean;
}

/** Shown first: unmistakable relief, so one press proves or disproves the terrain. */
const HEADLINE = [
  'Grand Canyon', 'Yosemite Valley / Half Dome', 'Mount Everest', 'Matterhorn',
  'Torres del Paine', 'Fish River Canyon', 'Milford Sound', 'Zhangjiajie',
  'Colca Canyon', 'Aoraki / Mount Cook', 'Bryce Canyon', 'Monument Valley',
];

let list: Landmark[] = [];
let index = 0;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }

export function subscribeLandmark(fn: () => void): () => void {
  listeners.add(fn); return () => { listeners.delete(fn); };
}

export function getLandmarks(): Landmark[] { return list; }
export function currentLandmark(): Landmark | null { return list[index] ?? null; }

export function loadLandmarks(): Promise<Landmark[]> {
  if (list.length) return Promise.resolve(list);
  return fetch(`${ASSET_BASE}/siege/earth/landmarks.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`landmarks ${r.status}`))))
    .then((d) => {
      const all: Landmark[] = d.landmarks ?? [];
      const rank = new Map(HEADLINE.map((n, i) => [n, i]));
      list = all.slice().sort((a, b) =>
        (rank.get(a.n) ?? 1e6) - (rank.get(b.n) ?? 1e6) || a.n.localeCompare(b.n));
      emit();
      return list;
    })
    .catch((e) => { console.warn('[earth] landmarks unavailable', e); return []; });
}

/** Step through the list. Returns the landmark now selected. */
export function stepLandmark(dir: number): Landmark | null {
  if (!list.length) return null;
  index = ((index + dir) % list.length + list.length) % list.length;
  emit();
  return list[index];
}
