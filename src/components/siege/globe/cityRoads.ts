// cityRoads — loading Dubai's street network, once.
//
// The bake is in scripts/make-city-roads.mjs; this is only the reader. Two things use it and they
// want different halves of it: KaijuCityRoads draws the asphalt, KaijuCityLights runs the traffic
// along the same centre lines. Loading it twice would be two copies of 224 KB and, worse, two
// chances for the cars and the road under them to disagree about where the road is.

/** Widths in metres, indexed by the class byte the bake writes. Real widths — see the bake. */
export const ROAD_WIDTH_M = [44, 40, 28, 20, 15, 9, 9, 12, 12, 11];

/**
 * How much traffic a class carries, relative to its length.
 *
 * A motorway kilometre holds many times the cars of a residential kilometre, and without this the
 * traffic spreads evenly over 5,921 km of road and every street gets the same sparse trickle —
 * which is the one thing that would stop it reading as a city.
 */
export const ROAD_TRAFFIC = [1.0, 1.0, 0.8, 0.5, 0.3, 0.08, 0.08, 0.25, 0.25, 0.2];

export interface Road {
  /** Index into ROAD_WIDTH_M / ROAD_TRAFFIC. */
  cls: number;
  /** Flat [x0,z0, x1,z1, ...] in metres east/south of the city origin. */
  pts: Float32Array;
  /** Cumulative length at each point, so a distance maps to a segment without searching. */
  cum: Float32Array;
  length: number;
}

let roads: Road[] | null = null;
let loading: Promise<Road[]> | null = null;

export function getRoads(): Road[] | null { return roads; }

export function loadRoads(url = '/siege/city/dubai-roads.bin'): Promise<Road[]> {
  if (roads) return Promise.resolve(roads);
  if (loading) return loading;
  loading = fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const dv = new DataView(buf);
      let o = 0;
      const n = dv.getUint32(o, true); o += 4;
      const out: Road[] = [];
      for (let i = 0; i < n; i++) {
        const cls = dv.getUint8(o); o += 1;
        const count = dv.getUint16(o, true); o += 2;
        const pts = new Float32Array(count * 2);
        for (let k = 0; k < count; k++) {
          pts[k * 2] = dv.getInt16(o, true); o += 2;
          pts[k * 2 + 1] = dv.getInt16(o, true); o += 2;
        }
        // Lengths are measured here rather than stored: it is one pass over data already in memory,
        // and storing them would be another four bytes a point for a number the reader can derive.
        const cum = new Float32Array(count);
        let s = 0;
        for (let k = 1; k < count; k++) {
          s += Math.hypot(pts[k * 2] - pts[(k - 1) * 2], pts[k * 2 + 1] - pts[(k - 1) * 2 + 1]);
          cum[k] = s;
        }
        out.push({ cls, pts, cum, length: s });
      }
      roads = out;
      const km = out.reduce((a, r) => a + r.length, 0) / 1000;
      console.log(`[city] ${out.length.toLocaleString()} roads, ${km.toFixed(0)} km`);
      return out;
    })
    .catch((err) => {
      // Scenery. A city with no road markings is worse than a city with them and better than no
      // city at all, so this never rejects into the render tree.
      console.error('[city] roads failed to load', err);
      roads = [];
      return roads;
    });
  return loading;
}
