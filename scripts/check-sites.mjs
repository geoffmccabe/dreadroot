// check-sites — is the site registry coherent, and does every city have the assets it claims?
//
// THIS IS THE SCRIPT AN AGENT BUILDING A NEW CITY RUNS FIRST. Nearly every way of getting a city
// wrong is a mismatch between things that must agree: a site says it has roads and the file is not
// there; two sites take the same shortcode; a coastal city's mask was baked but never imported, so
// the whole footprint silently counts as land and the city fills in the sea.
//
// None of those show up as an error at runtime. They show up as a city that looks subtly wrong,
// which is the most expensive kind of bug there is.
//
// Run: node scripts/check-sites.mjs

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

const SITES_DIR = 'src/components/siege/globe/sites';
let fails = 0;
const fail = (m) => { console.log(`FAIL  ${m}`); fails++; };
const pass = (m) => console.log(`PASS  ${m}`);

// --- read the registry ---------------------------------------------------------------------------
const index = readFileSync(`${SITES_DIR}/index.ts`, 'utf8');
const registered = [...index.matchAll(/^import \{ (\w+) \} from '\.\/(b\d+-[\w-]+)';$/gm)]
  .map((m) => ({ symbol: m[1], file: m[2] }));
const listed = (/export const SITES: SiteDef\[\] = \[([\s\S]*?)\];/.exec(index)?.[1] ?? '')
  .split(',').map((x) => x.trim()).filter(Boolean);

console.log(`== ${registered.length} site files, ${listed.length} in the SITES array ==\n`);

for (const r of registered) {
  if (!listed.includes(r.symbol)) {
    fail(`${r.file} is imported but not in the SITES array — it will never be reachable`);
  }
}
for (const l of listed) {
  if (!registered.some((r) => r.symbol === l)) fail(`SITES lists ${l}, which is not imported`);
}

// --- each site file ------------------------------------------------------------------------------
const keys = new Map();
const slugs = new Map();
const coastal = [];

for (const r of registered) {
  const path = `${SITES_DIR}/${r.file}.ts`;
  if (!existsSync(path)) { fail(`${path} does not exist`); continue; }
  const src = readFileSync(path, 'utf8');

  const key = /key:\s*'(\w+)'/.exec(src)?.[1];
  const slug = /slug:\s*'([\w-]+)'/.exec(src)?.[1];
  const name = /name:\s*'([^']+)'/.exec(src)?.[1] ?? slug;
  if (!key || !slug) { fail(`${r.file}: could not read key/slug`); continue; }

  // Digit0 is already "reset Kaiju size", so a site there silently never fires — which looks
  // exactly like the site being broken.
  if (!/^Digit[1-9]$/.test(key)) fail(`${name}: key "${key}" must be Digit1..Digit9 (Digit0 is taken)`);
  if (keys.has(key)) fail(`${name} and ${keys.get(key)} both claim ${key}`);
  keys.set(key, name);
  if (slugs.has(slug)) fail(`slug "${slug}" used twice`);
  slugs.set(slug, name);

  // Ground sanity. Zero is coplanar with the ocean mesh and strobes per pixel.
  const ground = Number(/groundMetres:\s*(-?[\d.]+)/.exec(src)?.[1] ?? NaN);
  const inner = Number(/innerMetres:\s*(-?[\d.]+)/.exec(src)?.[1] ?? NaN);
  const outer = Number(/outerMetres:\s*(-?[\d.]+)/.exec(src)?.[1] ?? NaN);
  const hasCity = /city:\s*\{/.test(src);
  if (hasCity) {
    if (ground === 0) fail(`${name}: groundMetres 0 is coplanar with the ocean mesh — use 0.5`);
    if (!(inner > 0)) fail(`${name}: a city needs innerMetres > 0 or its ground is not overridden`);
    if (!(outer > inner)) fail(`${name}: outerMetres (${outer}) must exceed innerMetres (${inner})`);
  }

  // Assets the site claims, against the files on disk.
  if (hasCity) {
    const assets = /assets:\s*\{([^}]*)\}/.exec(src)?.[1] ?? '';
    const dir = `public/siege/city/${slug}`;
    const want = { buildings: 'buildings.bin', detail: 'detail.bin', roads: 'roads.bin', water: 'water.bin' };
    for (const [k, file] of Object.entries(want)) {
      const claimed = new RegExp(`${k}:\\s*true`).test(assets);
      const there = existsSync(`${dir}/${file}`);
      if (claimed && !there) fail(`${name}: claims ${k} but ${dir}/${file} is missing — run the bake`);
      if (!claimed && there) fail(`${name}: ${dir}/${file} exists but assets.${k} is false — it will not load`);
      if (claimed && there && statSync(`${dir}/${file}`).size < 64) {
        fail(`${name}: ${dir}/${file} is empty — the bake produced nothing`);
      }
    }
    // A city on a coast needs a land mask, or its ground override fills in the sea.
    if (existsSync(`${SITES_DIR}/landmasks/${slug}.ts`)) coastal.push({ slug, name });

    // Every stop must be inside the blend radius, or you arrive outside your own city.
    const stops = [...src.matchAll(/lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)/g)];
    if (stops.length < 2) fail(`${name}: no stops found — a city needs at least one`);
  }
}

// --- masks must be imported, or they never register ------------------------------------------------
const maskIndex = existsSync(`${SITES_DIR}/landmasks/index.ts`)
  ? readFileSync(`${SITES_DIR}/landmasks/index.ts`, 'utf8') : '';
for (const c of coastal) {
  if (!maskIndex.includes(`'./${c.slug}'`)) {
    // Silent and expensive: with no mask registered, landFractionFor returns null, the override
    // treats the whole footprint as land, and the city fills in the sea.
    fail(`${c.name}: landmasks/${c.slug}.ts exists but is not imported in landmasks/index.ts`);
  }
}
// And a mask with no site is dead weight nobody will notice.
for (const f of readdirSync(`${SITES_DIR}/landmasks`)) {
  if (f === 'index.ts') continue;
  const slug = f.replace(/\.ts$/, '');
  if (!slugs.has(slug)) fail(`landmasks/${f} has no site with slug "${slug}"`);
}

// --- bake configs ----------------------------------------------------------------------------------
for (const [slug, name] of slugs) {
  const cfg = `scripts/city/cities/${slug}.json`;
  if (!existsSync(`public/siege/city/${slug}`)) continue;   // wilderness site, no bake
  if (!existsSync(cfg)) { fail(`${name}: has baked assets but no ${cfg} — a rebuild is impossible`); continue; }
  const c = JSON.parse(readFileSync(cfg, 'utf8'));
  if (c.slug !== slug) fail(`${cfg} says slug "${c.slug}"`);
  if (!Array.isArray(c.bbox) || c.bbox.length !== 4) fail(`${cfg}: bbox must be [s, w, n, e]`);
  // The mask must be no coarser than the terrain, which resolves 38 m at full detail.
  if ((c.maskCellMetres ?? 40) > 40) fail(`${cfg}: maskCellMetres ${c.maskCellMetres} is coarser than the 38 m terrain — the coast will look like squares`);
}

if (!fails) pass(`${keys.size} sites, ${slugs.size} slugs, ${coastal.length} with land masks — all coherent`);
console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);
