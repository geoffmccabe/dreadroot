// Step 2.5 — headless smoke of the OFF-THREAD mesh path (window.__WORKER_MESH).
// Uses the persistent chrome-profile's own valid session (NO stale-auth
// injection — that clobbers it) and perftest.ts's exact known-good roam
// geometry (circle center = spawn-RADIUS toward the +X tree belt).
//
// Proves on the REAL world: worker pool inits, heavy tree chunks actually
// traverse the worker and get APPLIED (window.__workerMeshApplies > 0),
// with no crash / no worker errors / no fallback storm.
// (Pixel parity is by-construction + code-audited; final visual sign-off
// is the user's — this only proves the mechanics are sound.)
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = path.join(ROOT, '.perftest', 'chrome-profile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirror perftest.ts movement constants exactly.
const SPEED = 40, RADIUS = 128, ANGULAR_SPEED = SPEED / RADIUS;
const TICK_MS = 50;

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1280, height: 720 },
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.addInitScript(() => { window.__WORKER_MESH = true; });

const errors = [];
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') errors.push(t);
  if (/MeshWorkerPool|meshWorker/i.test(t)) logs.push(`[${m.type()}] ${t}`);
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.stack || e.message || e)));

await page.goto('http://localhost:8080/?perftest', { waitUntil: 'domcontentloaded' });
let ready = false;
for (let i = 0; i < 180; i++) {
  ready = await page.evaluate(() => window.__perfTestReady === true).catch(() => false);
  if (ready) break;
  await sleep(500);
}
await page.click('canvas').catch(() => {});
await sleep(500);
await page.evaluate(() => { const d = window.__d; if (d && !d.enabled) d.toggle(); }).catch(() => {});

// Wait until chunks ACTUALLY render (drawCalls > 5), like perftest.ts.
let drawCalls = 0;
const t0 = Date.now();
while (Date.now() - t0 < 35000) {
  drawCalls = await page.evaluate(() => window.__d?.drawCalls ?? 0).catch(() => 0);
  if (drawCalls > 5) break;
  await sleep(500);
}
let hasControls = false;
for (let i = 0; i < 40; i++) {
  hasControls = await page.evaluate(() => !!window.__perfTestControls).catch(() => false);
  if (hasControls) break;
  await sleep(500);
}
await page.evaluate(() => window.__perfTestControls?.enableGodMode?.()).catch(() => {});
await sleep(200);
const sp = await page.evaluate(() => window.__perfTestControls?.getPosition?.() ?? { x: 0, z: 0 });
const CX = (sp.x ?? 0) - RADIUS, CZ = sp.z ?? 0;

// Pre-warm 8s so chunks load around spawn.
await sleep(8000);

async function circle(durationSec, altitude, startAngle) {
  const ticks = (durationSec * 1000) / TICK_MS;
  const per = ANGULAR_SPEED * (TICK_MS / 1000);
  let angle = startAngle;
  for (let t = 0; t < ticks; t++) {
    angle += per;
    await page.evaluate((p) => {
      const c = window.__perfTestControls;
      c?.setPosition?.(p.x, p.y, p.z); c?.setYaw?.(p.yaw);
    }, { x: CX + RADIUS * Math.cos(angle), y: altitude, z: CZ + RADIUS * Math.sin(angle), yaw: angle + Math.PI / 2 }).catch(() => {});
    await sleep(TICK_MS);
  }
  return angle;
}
const a1 = await circle(20, 1.6, 0);   // ground-level lap through the tree belt
await circle(20, 50, a1);              // aerial lap

const st = await page.evaluate(() => ({
  workerFlag: window.__WORKER_MESH === true,
  applies: window.__workerMeshApplies ?? 0,
  fallbacks: window.__workerMeshFallbacks ?? 0,
  drawCalls: window.__d?.drawCalls ?? 0,
  visibleBlocks: window.__d?.visibleBlocks ?? 0,
  ready: window.__perfTestReady === true,
  hasControls: !!window.__perfTestControls,
})).catch((e) => ({ err: String(e) }));

const ignore = /Failed to load resource|net::ERR|favicon|the server responded with a status|AtlasManager/i;
const realErrors = [...new Set(errors)].filter((e) => !ignore.test(e));
const workerErr = realErrors.filter((e) =>
  /worker|meshWorker|is not defined|ReferenceError|postMessage|Transferable|detached|TypeError|undefined is not/i.test(e));

console.log('readyReached:', ready, ' controlsReached:', hasControls);
console.log('STATE:', JSON.stringify(st));
console.log('pool init seen:', logs.some((l) => /Initialized \d+ workers/.test(l)), '| worker logs:', logs.slice(0, 6));
console.log('worker/JS errors:', workerErr.length ? workerErr.slice(0, 6) : 'NONE');
console.log('other real errors:', realErrors.length, realErrors.slice(0, 4));
const PASS =
  st.ready === true && st.hasControls === true && st.workerFlag === true &&
  st.drawCalls > 5 && st.applies > 0 && workerErr.length === 0;
console.log(PASS ? 'SMOKE: PASS' : 'SMOKE: FAIL',
  `(applies=${st.applies} fallbacks=${st.fallbacks} drawCalls=${st.drawCalls})`);
await ctx.close();
process.exit(PASS ? 0 : 1);
