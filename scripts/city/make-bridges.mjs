// make-bridges — the spans, which are the other half of New York's silhouette.
//
// Geoff: "for NYC can you add their famous bridges?"
//
// They were not merely unbuilt, they were actively WRONG: a bridge is tagged in OSM as an ordinary
// highway with bridge=yes, so the road bake had already swallowed the Brooklyn, Manhattan,
// Williamsburg and Queensboro and painted them flat on the water at two-tenths of a metre. Four of
// the most recognisable structures on Earth, drawn as puddles.
//
// So bridges come out of the road network and get their own pass.
//
// WHAT IS AND IS NOT A BRIDGE HERE. OSM calls every motorway overpass a bridge, and Manhattan has
// thousands. A twenty-metre slip-road deck is invisible from a Kaiju's eye and there are enough of
// them to bury the ones that matter, so only spans over MIN_SPAN_M are kept.
//
// THE DECK HEIGHT IS DERIVED, NOT READ, and that is a real limitation stated plainly. OSM almost
// never records how high a bridge deck is — it records that a bridge exists. So the profile is
// built: flat at the abutments, rising to a crown at mid-span, with the crown scaled by the span's
// own length and capped. That gives the Brooklyn Bridge about 45 m at its middle against a real 41,
// and the George Washington about 60 against a real 65. Right in character, wrong in the third
// digit, and far better than lying flat on the river.
//
// TOWERS for anything long enough to need them, placed at the quarter points, which is where a
// suspension bridge actually puts them. No cables: at a hundred metres to the game unit a
// suspender is a hundredth of a pixel.
//
// Run:    node scripts/city/make-bridges.mjs <slug>
// Writes: public/siege/city/<slug>/bridges.bin

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadCity, slugFromArgv, overpassTiled } from './cityConfig.mjs';

const city = loadCity(slugFromArgv());
const RAW = `${city.rawDir}/bridges.json`;
const OUT = `${city.outDir}/bridges.bin`;
const MAX_RANGE_M = city.maxRangeMetres ?? 26000;

/** Shorter than this is an overpass, not a bridge. */
const MIN_SPAN_M = 180;
/** A span longer than this gets towers. Below it, a plain deck is the honest model. */
const TOWER_SPAN_M = 400;

{
  console.error(`fetching bridges for ${city.slug}...`);
  const data = await overpassTiled(city, 'bridges', 0.04, (s, w, n, e) => `[out:json][timeout:120];
(way["bridge"]["highway"](${s},${w},${n},${e});
 way["bridge"]["railway"](${s},${w},${n},${e}););
out geom;`);
  if (!data.elements.length) { console.error('nothing came back — re-run when Overpass is quieter'); process.exit(1); }
  writeFileSync(RAW, JSON.stringify(data));
}

const els = JSON.parse(readFileSync(RAW, 'utf8')).elements ?? [];

/** Deck width in metres, from lane count where OSM gives one. */
function widthOf(t) {
  const w = parseFloat(t.width ?? t['est_width'] ?? '');
  if (isFinite(w) && w > 3 && w < 90) return w;
  const lanes = parseInt(t.lanes ?? '', 10);
  if (isFinite(lanes) && lanes > 0) return Math.min(60, 3.7 * lanes + 4);
  if (t.railway) return 12;
  if (/motorway|trunk/.test(t.highway ?? '')) return 30;
  if (/primary|secondary/.test(t.highway ?? '')) return 20;
  return 12;
}

// IS IT OVER WATER? That is what separates a bridge from a viaduct, and without asking it the
// longest "bridges" in New York come out as the BMT Jamaica Line and the IRT Flushing Line — three
// kilometres of elevated subway over Queens, handed a seventy-metre crown by a rule meant for a
// river crossing. An el runs about twelve metres up, all the way along, and looks nothing like a
// suspension bridge.
//
// The land mask already knows where the water is, so read it rather than guessing from the name.
let landAt = null;
{
  const maskPath = `src/components/siege/globe/sites/landmasks/${city.slug}.ts`;
  if (existsSync(maskPath)) {
    const src = readFileSync(maskPath, 'utf8');
    const CELL = Number(/MASK_CELL_METRES = (\d+)/.exec(src)[1]);
    const HALF = Number(/MASK_HALF_METRES = (\d+)/.exec(src)[1]);
    const N = Number(/MASK_N = (\d+)/.exec(src)[1]);
    const bits = Buffer.from(/const PACKED = '([^']+)'/.exec(src)[1], 'base64');
    landAt = (x, z) => {
      const cx = Math.max(0, Math.min(N - 1, Math.floor((x + HALF) / CELL)));
      const cy = Math.max(0, Math.min(N - 1, Math.floor((z + HALF) / CELL)));
      const k = cy * N + cx;
      return (bits[k >> 3] & (1 << (k & 7))) !== 0;
    };
    console.error('using the land mask to tell river crossings from elevated viaducts');
  } else {
    console.error('NO LAND MASK — every span will be treated as a viaduct, which is the safe guess');
  }
}

// WHICH NAMES ARE FLOATING. OSM tags only SOME member ways of a floating bridge as floating: two of
// the Evergreen Point's ways carry it and the rest do not, and the Lacey V. Murrow carries it on
// none at all. Taking each way at its word therefore arches half of a pontoon bridge into the sky
// and leaves the other half on the water, which is worse than getting it uniformly wrong.
//
// So the flag is propagated BY NAME — one tagged way makes every way of that name floating — and a
// city may name the stubborn ones in its config, which is the honest place for a fact that OSM
// simply does not record.
const floatingNames = new Set();
for (const e of els) {
  const t = e.tags ?? {};
  if (!t.name) continue;
  if (t.bridge === 'floating' || /floating|pontoon/.test(t['bridge:structure'] ?? '')) {
    floatingNames.add(t.name);
  }
}
const configFloating = (city.floatingBridges ?? []).map((n) => n.toLowerCase());
if (floatingNames.size || configFloating.length) {
  console.error(`floating: ${[...floatingNames].join(', ') || '(none tagged)'}`
    + (configFloating.length ? `  + named in config: ${city.floatingBridges.join(', ')}` : ''));
}

const bridges = [];
let dropped = 0;
for (const e of els) {
  const g = e.geometry ?? [];
  if (g.length < 2) continue;
  const t = e.tags ?? {};
  const pts = g.map(city.project).filter(([x, z]) => Math.abs(x) < MAX_RANGE_M && Math.abs(z) < MAX_RANGE_M);
  if (pts.length < 2) continue;
  let span = 0;
  for (let i = 1; i < pts.length; i++) span += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (span < MIN_SPAN_M) { dropped++; continue; }

  // How much of this span is over water? A river crossing is mostly water in the middle; an el is
  // land the whole way.
  let wet = 0, tested = 0;
  if (landAt) {
    for (let k = 1; k < 9; k++) {
      const t2 = k / 9;
      const i = Math.min(pts.length - 1, Math.floor(t2 * (pts.length - 1)));
      tested++;
      if (!landAt(pts[i][0], pts[i][1])) wet++;
    }
  }
  const overWater = tested > 0 && wet / tested >= 0.3;

  // FORTY-TWO METRES, FLAT, and scaling it by length was a mistake worth explaining. The obvious
  // rule — taller crown for a longer span — is defeated by what `span` actually measures: the
  // length of the OSM WAY, which includes the approach viaducts. The Manhattan Bridge's path way is
  // 1,770 m where its river span is 448 m, so span/12 handed it a seventy-metre crown against a real
  // deck height of 41 m.
  //
  // The East River bridges — Brooklyn, Manhattan, Williamsburg, Queensboro — are all within a metre
  // or two of 41 m, because they were all built to clear the same shipping channel. So that is the
  // number. The George Washington is genuinely 65 m and will read a little low; one bridge slightly
  // short is a far better error than four of them arched like rainbows.
  // A FLOATING BRIDGE DOES NOT ARCH, and Seattle is the one city on Earth where this matters.
  //
  // The Evergreen Point and the Lacey V. Murrow are the two longest floating bridges in the world,
  // and they are famous precisely because they lie FLAT ON Lake Washington rather than spanning it —
  // the lake is too deep and too soft-bottomed for piers. Handed the ordinary 42 m crown they would
  // arch two and a half kilometres into the sky over a lake, which is about the most conspicuous
  // thing that could be wrong with Seattle. OSM says so directly.
  const name = t.name ?? '';
  const floating = t.bridge === 'floating'
    || /floating|pontoon/.test(t['bridge:structure'] ?? '')
    || (name && floatingNames.has(name))
    || (name && configFloating.some((f) => name.toLowerCase().includes(f)));

  // Two metres: a pontoon deck sits just clear of the water it rests on.
  const crown = floating ? 2 : (overWater ? 42 : 12);
  bridges.push({
    name: t.name ?? '', pts, width: widthOf(t), span, crown,
    // Towers belong to long WATER crossings. An elevated railway has piers, not towers.
    // No towers on a pontoon either — it has no suspension to hang from.
    towers: !floating && overWater && span >= TOWER_SPAN_M,
    overWater, floating,
  });
}

// A STRUCTURE'S UNNAMED CARRIAGEWAYS ARE THE SAME STRUCTURE. Naming catches the Evergreen Point and
// the Lacey V. Murrow, and leaves the two 2.6 km unnamed ways beside them — the I-90 roadway decks —
// arching 42 m over a lake their own bridge lies flat on. That is not a naming problem, it is a
// geometric fact: they run alongside something already known to float.
//
// So a water crossing whose middle sits close to a floating one, and which is of comparable length,
// floats too. Distance rather than name, because OSM's names here are simply absent.
{
  const mid = (b) => b.pts[Math.floor(b.pts.length / 2)];
  const floats = bridges.filter((b) => b.floating);
  let adopted = 0;
  for (const b of bridges) {
    if (b.floating || !b.overWater || b.span < 800) continue;
    const m = mid(b);
    for (const f of floats) {
      const fm = mid(f);
      // 250 m: wide enough to take a parallel carriageway of the same crossing, narrow enough that
      // an unrelated bridge a quarter-kilometre away is not swept up with it.
      if (Math.hypot(m[0] - fm[0], m[1] - fm[1]) < 250 && b.span > f.span * 0.5) {
        b.floating = true; b.crown = 2; b.towers = false; adopted++;
        break;
      }
    }
  }
  if (adopted) console.error(`${adopted} unnamed spans adopted as floating by proximity`);
}

bridges.sort((a, b) => b.span - a.span);
console.error(`${bridges.length} spans over ${MIN_SPAN_M} m (dropped ${dropped} overpasses)`);
const water = bridges.filter((b) => b.overWater);
console.error(`${water.length} of them cross water; the rest are viaducts at a level 12 m`);
console.error('longest water crossings:');
for (const b of water.slice(0, 10)) {
  console.error(`  ${Math.round(b.span).toString().padStart(5)} m  crown ${Math.round(b.crown)} m  ${b.width} m wide  ${b.towers ? 'towers  ' : b.floating ? 'FLOATING' : '        '}${b.name || '(unnamed)'}`);
}

// uint32 count, then per bridge: uint8 flags(1=towers), uint16 points, int16 width, int16 crown,
// then int16 x,z pairs.
let bytes = 4;
for (const b of bridges) bytes += 7 + b.pts.length * 4;
const out = new Uint8Array(bytes);
const dv = new DataView(out.buffer);
let o = 0;
dv.setUint32(o, bridges.length, true); o += 4;
const c16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
for (const b of bridges) {
  dv.setUint8(o, b.towers ? 1 : 0); o += 1;
  dv.setUint16(o, b.pts.length, true); o += 2;
  dv.setInt16(o, c16(b.width), true); o += 2;
  dv.setInt16(o, c16(b.crown), true); o += 2;
  for (const [x, z] of b.pts) { dv.setInt16(o, c16(x), true); o += 2; dv.setInt16(o, c16(z), true); o += 2; }
}
writeFileSync(OUT, Buffer.from(out));
console.error(`wrote ${OUT} — ${(bytes / 1024).toFixed(0)} KB`);
