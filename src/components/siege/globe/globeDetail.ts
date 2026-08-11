// globeDetail — procedural terrain amplification for the Mini Earth.
//
// WHY THIS EXISTS (see docs/MINI_EARTH_PLAN.md §2a)
// ------------------------------------------------
// The real elevation data is one sample every 2.44 km. Against a 300 m Kaiju that is 0.12
// samples per body height, so measured data alone renders a perfectly flat plane at ground
// level. Crucially this is NOT solved by better data: even Copernicus GLO-30, the finest free
// global set that exists, is 30 m and gives only 10 samples per Kaiju. Detail at creature scale
// has to be invented. That is the whole point of terrain amplification.
//
// DESIGN
// ------
//  • Noise is a function of the UNIT DIRECTION from the planet centre, not of face/uv. That makes
//    it inherently seamless across cube-face boundaries and across every LOD level, with no
//    stitching: two patches that meet ask the same function about the same point in space.
//  • Deterministic and stateless, so the CPU ground sampler (what the Kaiju stands on) and the
//    mesh builder (what you see) agree exactly, with no shared state to drift. When this later
//    moves to the GPU or a server tick, the same integer hash reproduces it there.
//  • Band-limited per LOD: a patch only adds octaves it can actually represent, i.e. wavelengths
//    longer than about twice its vertex spacing. Finer octaves appear as you zoom in, rather than
//    aliasing into noise at range.
//  • Land only. Amplitude fades to zero at the coast so the sea stays flat and the shoreline does
//    not develop procedural cliffs.

import { cityFlatness } from './cityGround';

/**
 * Coarsest procedural wavelength, in game units. 60 u = 6 real km.
 *
 * Deliberately close to the DATA resolution (2.44 km per sample) rather than far above it. The
 * measured elevation already supplies every feature coarser than that, so starting the noise at
 * 40 km, as I first did, spent nearly all the amplitude duplicating shapes we already have and
 * left only 8 m of relief at the kilometre scales a Kaiju actually walks through. Starting near
 * the data floor puts the amplitude where the data runs out, which is the whole point.
 */
const BASE_WAVELENGTH = 60;
/** Amplitude of that coarsest octave, in metres of real elevation. */
const BASE_AMPLITUDE_M = 220;
/** Each octave halves in wavelength and drops by this factor in amplitude. */
const PERSISTENCE = 0.55;
/** Hard cap on octaves, so a very deep patch cannot spiral in cost. */
const MAX_OCTAVES = 9;
/** Elevation over which terrain is treated as fully rugged (metres). */
const RUGGED_FULL_M = 1800;
/** Coastal fade: no detail at sea level, full detail this far inland/up (metres). */
const COAST_FADE_M = 120;

/** Integer hash -> [-1, 1]. Cheap, stable across platforms, no float accumulation. */
function hash3(ix: number, iy: number, iz: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) | 0;
  return (h / 2147483647);
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Value noise in 3D, trilinear with a smoothstep fade. Returns roughly [-1, 1]. */
function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);

  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);

  const x00 = c000 + (c100 - c000) * xf, x10 = c010 + (c110 - c010) * xf;
  const x01 = c001 + (c101 - c001) * xf, x11 = c011 + (c111 - c011) * xf;
  const y0 = x00 + (x10 - x00) * yf, y1 = x01 + (x11 - x01) * yf;
  return y0 + (y1 - y0) * zf;
}

/**
 * Extra elevation in METRES to add on top of the measured value.
 *
 * @param dx,dy,dz   unit direction from the planet centre
 * @param radiusUnits planet radius in game units (noise is evaluated in world-ish space)
 * @param baseMetres  the measured elevation here, which gates land/sea and ruggedness
 * @param spacingUnits the vertex spacing of the patch asking, which band-limits the octaves
 */
export function detailMetres(
  dx: number, dy: number, dz: number,
  radiusUnits: number, baseMetres: number, spacingUnits: number,
): number {
  // Sea and the immediate shoreline stay flat: the ocean surface is a clamped plane, and adding
  // relief across the coastline would carve procedural cliffs into every beach.
  if (baseMetres <= 0) return 0;

  // A CITY HAS ALREADY DECLARED ITS GROUND, and anything laid on top contradicts it.
  //
  // Dubai never needed this and could never have revealed it: its ground is half a metre, where the
  // coastal fade above already zeroes the relief. San Jose stands at 1,160 m, and at that elevation
  // this function offers up to 345 metres of it — over a city whose buildings are three to fifteen
  // metres tall. It would not have looked bumpy, it would have been buried.
  const flat = cityFlatness(dx, dy, dz);
  if (flat >= 1) return 0;
  const coast = baseMetres >= COAST_FADE_M ? 1 : baseMetres / COAST_FADE_M;

  // Lowlands get gentle relief, mountains get a lot. Uses the real data, so the Alps stay rugged
  // and the Amazon basin stays flat, which is what keeps this looking like Earth rather than noise.
  const rugged = 0.18 + 0.82 * Math.min(1, baseMetres / RUGGED_FULL_M);

  let sum = 0;
  let wavelength = BASE_WAVELENGTH;
  let amplitude = BASE_AMPLITUDE_M;

  for (let o = 0; o < MAX_OCTAVES; o++) {
    // Band limit: stop once the octave is finer than this patch can represent. Without this,
    // distant patches would sample high-frequency noise at random phase and shimmer.
    if (wavelength < spacingUnits * 2) break;
    const f = radiusUnits / wavelength;
    sum += valueNoise(dx * f, dy * f, dz * f) * amplitude;
    wavelength *= 0.5;
    amplitude *= PERSISTENCE;
  }

  return sum * rugged * coast * (1 - flat);
}

/**
 * The finest wavelength this system will ever produce, in units. Used to decide how deep the
 * render quadtree is allowed to go: subdividing past the point where no new detail appears
 * costs triangles for nothing.
 */
export function finestDetailWavelength(): number {
  return BASE_WAVELENGTH / Math.pow(2, MAX_OCTAVES - 1);
}
