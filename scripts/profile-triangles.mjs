// Where do the triangles actually come from? Walks the live three.js scene and totals
// triangles per object, so "2.5M triangles" becomes a named list instead of a guess.
import { chromium } from 'playwright';
import path from 'path';
const ROOT = '/Users/geoffreymccabe/dreadroot';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctx = await chromium.launchPersistentContext(path.join(ROOT, '.perftest', 'chrome-profile'), {
  // Headless by DEFAULT. A visible window steals the GPU from whatever the user is
  // testing in their own browser — and a checker that degrades the thing being checked
  // is worse than no checker. SHOW=1 to watch it.
  headless: !process.env.SHOW, viewport: { width: 1280, height: 720 },
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('http://localhost:8080/?perftest', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 20; i++) {
  const b = page.getByRole('button', { name: /START GAME|LOGIN/i }).first();
  if (await b.count().catch(() => 0)) { await b.click({ timeout: 5000 }).catch(() => {}); break; }
  await sleep(500);
}
for (let i = 0; i < 90; i++) {
  if (await page.evaluate(() => !!window.__perftestReady).catch(() => false)) break;
  await sleep(1000);
}
await sleep(5000);

const out = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const r3f = c && c.__r3f;
  const scene = r3f?.root?.getState?.().scene ?? r3f?.store?.getState?.().scene;
  if (!scene) return { error: 'no scene on canvas.__r3f' };
  const rows = [];
  let total = 0;
  scene.traverse((o) => {
    const g = o.geometry;
    if (!g) return;
    const idx = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
    let tris = idx / 3;
    if (o.isInstancedMesh) tris *= o.count;
    if (!tris || !o.visible) return;
    // walk up for a readable owner name
    let n = o.name, p = o.parent, depth = 0;
    while ((!n || n === '') && p && depth++ < 6) { n = p.name; p = p.parent; }
    rows.push({ name: n || o.type, type: o.type, tris: Math.round(tris),
                count: o.isInstancedMesh ? o.count : 1, frustumCulled: o.frustumCulled });
    total += tris;
  });
  const byName = {};
  for (const r of rows) {
    const k = `${r.name} [${r.type}]`;
    byName[k] = byName[k] || { tris: 0, objects: 0, instances: 0 };
    byName[k].tris += r.tris; byName[k].objects++; byName[k].instances += r.count;
  }
  const top = Object.entries(byName).sort((a, b) => b[1].tris - a[1].tris).slice(0, 20);
  return { totalTris: Math.round(total), objects: rows.length, top };
});
console.log(JSON.stringify(out, null, 1));
await ctx.close();
