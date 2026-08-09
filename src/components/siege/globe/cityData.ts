// cityData — load the baked city, and give it a place to stand on a sphere.
//
// The file is what scripts/fetch-dubai-buildings.mjs produces: a 24-byte header holding the origin
// latitude, longitude and count, then six float32s per building — position east/south in metres from
// that origin, width, depth, rotation, height.
//
// THE LOCAL FRAME IS THE WHOLE DESIGN, and it is here rather than in the renderer because the
// physics will need exactly the same one.
//
// The planet's surface is 63,710 units from the world origin. Single-precision floats — which is
// what a GPU uses for every vertex, and what any physics engine would use — carry about seven
// significant digits, so at that distance the smallest step that can be represented is roughly
// 0.4 metres. Buildings placed directly in world coordinates would z-fight and shimmer, and falling
// debris would jitter instead of settling.
//
// So nothing is placed in world coordinates. A GROUP sits at Dubai, oriented so its own +Y is local
// up, and every building lives inside it at a few kilometres from ITS origin — where float32 has
// millimetre precision to spare. three.js composes the group's transform in JavaScript numbers,
// which are doubles, so the large offset is applied at full precision before anything reaches the
// GPU. The same frame is what makes gravity a constant downward vector when the shards come.

import * as THREE from 'three';
import { PLANET_RADIUS, METRES_PER_UNIT, latLonToDirection } from './cubeSphere';

/** One building. Metres and radians, exactly as baked. */
export interface Building {
  /** Metres east of the city origin. */
  x: number;
  /** Metres SOUTH of the city origin. Sign follows the bake; see the frame below. */
  z: number;
  w: number;
  d: number;
  /** Rotation of the long axis, in the (east, south) plane. */
  rot: number;
  h: number;
}

export interface City {
  lat: number;
  lon: number;
  buildings: Building[];
  /** Unit direction from the planet centre to the city origin. */
  dir: THREE.Vector3;
  /** The group transform: local +X east, +Y up, +Z south. */
  quaternion: THREE.Quaternion;
  /** Where the group sits, in world units. */
  position: THREE.Vector3;
}

let city: City | null = null;
let loading: Promise<City | null> | null = null;

export const cityDiag = { state: 'idle' as 'idle' | 'loading' | 'ready' | 'failed', count: 0, error: '' };

export function getCity(): City | null { return city; }

/**
 * Build the tangent frame at a latitude and longitude.
 *
 * `south` rather than north for local +Z, because that is the sign convention the bake uses: it
 * stores `-(lat - lat0)`, so a building further north has a NEGATIVE z. Matching the data rather
 * than flipping it at every use site means there is exactly one place this can be got wrong.
 *
 * Right-handed, which matters: east cross up is exactly south, so (east, up, south) is a valid
 * rotation and not a mirror. A mirrored basis would turn every building's rotation the wrong way
 * and the whole city would be subtly reflected — the kind of thing that looks almost right.
 */
export function cityFrame(lat: number, lon: number, groundMetres: number): {
  dir: THREE.Vector3; quaternion: THREE.Quaternion; position: THREE.Vector3;
} {
  const d = new Float64Array(3);
  latLonToDirection(lat, lon, d);
  const dir = new THREE.Vector3(d[0], d[1], d[2]).normalize();

  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir);
  if (east.lengthSq() < 1e-9) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(dir, east).normalize();
  const south = north.clone().negate();

  const m = new THREE.Matrix4().makeBasis(east, dir, south);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);
  const position = dir.clone().multiplyScalar(PLANET_RADIUS + groundMetres / METRES_PER_UNIT);
  return { dir, quaternion, position };
}

/**
 * Fetch and parse the city once.
 *
 * Deliberately returns null rather than throwing when the file is missing: a Kaiju map with no city
 * data should be a Kaiju map, not a white screen. The diagnostic says which happened.
 */
export function loadCity(url = '/siege/city/dubai.bin'): Promise<City | null> {
  if (city) return Promise.resolve(city);
  if (loading) return loading;
  cityDiag.state = 'loading';

  loading = fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const dv = new DataView(buf);
      const lat = dv.getFloat64(0);
      const lon = dv.getFloat64(8);
      const count = dv.getUint32(16);
      if (buf.byteLength !== 24 + count * 24) {
        throw new Error(`size mismatch: ${buf.byteLength} vs ${24 + count * 24}`);
      }
      const f = new Float32Array(buf, 24, count * 6);
      const buildings: Building[] = new Array(count);
      for (let i = 0; i < count; i++) {
        const o = i * 6;
        buildings[i] = { x: f[o], z: f[o + 1], w: f[o + 2], d: f[o + 3], rot: f[o + 4], h: f[o + 5] };
      }
      // Ground height is sampled ONCE for the whole city, at its origin. Dubai's terrain runs from
      // sea level to about 15 m across all four districts, which at 100 m to the unit is a seventh
      // of a unit — far less than the thickness of a building's ground floor. Sampling per building
      // would be forty thousand terrain lookups for a difference nobody can see.
      const frame = cityFrame(lat, lon, 0);
      city = { lat, lon, buildings, ...frame };
      cityDiag.state = 'ready';
      cityDiag.count = count;
      console.log(`[city] ${count.toLocaleString()} buildings at ${lat.toFixed(3)}, ${lon.toFixed(3)}`);
      return city;
    })
    .catch((err) => {
      cityDiag.state = 'failed';
      cityDiag.error = String(err.message ?? err);
      console.warn('[city] not loaded:', cityDiag.error);
      return null;
    });
  return loading;
}

/**
 * How far the camera is from the city, in units — so the renderer can skip it entirely from orbit.
 *
 * Angular rather than straight-line, because on a sphere the straight-line distance to somewhere on
 * the far side is smaller than the distance around, and a city on the opposite face of the planet
 * would otherwise measure as close.
 */
export function cityDistanceUnits(cameraPos: THREE.Vector3): number {
  if (!city) return Infinity;
  const len = cameraPos.length();
  if (len < 1e-6) return Infinity;
  const angle = cameraPos.clone().divideScalar(len).angleTo(city.dir);
  const along = angle * PLANET_RADIUS;
  const up = Math.abs(len - PLANET_RADIUS);
  return Math.hypot(along, up);
}
