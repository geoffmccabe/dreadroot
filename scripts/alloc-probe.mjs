// Allocation probe: the heap snapshot proved there's no retained leak (~220MB
// post-GC) — the ~900MB is churn-driven GC pressure. This samples WHERE
// allocations come from (by call stack) during heavy chunk churn + combat,
// so we fix the real churn sources.  Run: node scripts/alloc-probe.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEV_URL = 'http://localhost:8080/?perftest';
const AUTH = path.join(ROOT, '.perftest', 'auth.json');
const PROFILE = path.join(ROOT, '.perftest', 'chrome-profile');
const OUT = path.join(ROOT, 'perftest-results');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 720 },
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

if (fs.existsSync(AUTH)) {
  const s = JSON.parse(fs.readFileSync(AUTH, 'utf8'));
  await ctx.addCookies(s.cookies || []);
  if (s.origins?.[0]?.localStorage) {
    await page.goto('http://localhost:8080/auth', { waitUntil: 'domcontentloaded' });
    await page.evaluate((items) => { for (const i of items) localStorage.setItem(i.name, i.value); },
      s.origins[0].localStorage);
  }
}

console.log('[alloc] loading game...');
await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 }).catch(() => {});
for (let i = 0; i < 120; i++) {
  if (await page.evaluate(() => (window).__perfTestReady === true).catch(() => false)) break;
  await sleep(500);
}
await page.evaluate(() => (window).__perfTestControls?.enableGodMode?.()).catch(() => {});
await sleep(1500);

const cdp = await ctx.newCDPSession(page);
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768 });

// Heavy churn: keep crossing chunk boundaries (constant load/unload + mesh
// rebuilds) for ~45s — this is what balloons the heap in real play.
console.log('[alloc] churning (cross-chunk roam) 45s...');
const start = await page.evaluate(() => (window).__perfTestControls?.getPosition?.() ?? { x: 0, z: 0 });
for (let t = 0; t < 450; t++) {
  const a = (t / 450) * Math.PI * 8;
  const rad = 50 + 150 * Math.abs(Math.sin(t / 30));
  await page.evaluate((p) => {
    const c = (window).__perfTestControls;
    c?.setPosition?.(p.x, 45, p.z); c?.setYaw?.(p.yaw);
  }, { x: start.x + rad * Math.cos(a), z: start.z + rad * Math.sin(a), yaw: a }).catch(() => {});
  await sleep(100);
}

const { profile } = await cdp.send('HeapProfiler.stopSampling');
fs.mkdirSync(OUT, { recursive: true });
const p = path.join(OUT, `alloc-${new Date().toISOString().replace(/[:.]/g, '-')}.heapprofile`);
fs.writeFileSync(p, JSON.stringify(profile));
await ctx.close();

// Aggregate self-allocated bytes by call frame.
const agg = new Map();
let total = 0;
(function walk(n) {
  const f = n.callFrame || {};
  const key = `${f.functionName || '(anon)'}  @${(f.url || '').split('/').pop()}:${(f.lineNumber ?? 0) + 1}`;
  const s = n.selfSize || 0;
  if (s) { total += s; agg.set(key, (agg.get(key) || 0) + s); }
  (n.children || []).forEach(walk);
})(profile.head);
const rows = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log(`\n=== ALLOCATIONS sampled total ${(total / 1048576).toFixed(0)} MB (45s churn) -> ${p.split('/').pop()} ===`);
for (const [k, b] of rows) {
  console.log(`  ${(b / 1048576).toFixed(1).padStart(8)} MB  ${(100 * b / total).toFixed(1).padStart(5)}%  ${k}`);
}
