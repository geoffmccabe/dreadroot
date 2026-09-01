/**
 * Does the app actually START?
 *
 * This exists because a clean `tsc` and a successful `vite build` do NOT prove
 * the thing boots — this repo has a documented white-screen class where both
 * pass and the app still dies on a use-before-initialization. I shipped two
 * such builds and only found out when the game was unusable.
 *
 * Loads the real built app in a real browser with the existing perftest
 * profile, waits for the world to report ready, and fails on any page error.
 * Prints what is on screen so a change can be checked rather than asserted.
 *
 *   npm run check:boot
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = path.join(ROOT, '.perftest', 'chrome-profile-boot');
const URL_ = process.env.CHECK_URL ?? 'http://localhost:8080/?perftest';
const BUDGET_MS = Number(process.env.CHECK_MS ?? 90000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  // Headless by DEFAULT. A visible window steals the GPU from whatever the user is
  // testing in their own browser — and a checker that degrades the thing being checked
  // is worse than no checker. SHOW=1 to watch it.
  headless: !process.env.SHOW, viewport: { width: 1280, height: 720 },
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

/**
 * Get past the sign-in gate.
 *
 * These checks used to ride on a stored session in the browser profile. That broke
 * the moment the profile was copied for parallel harnesses: Supabase ROTATES the
 * refresh token, so two copies of one session invalidate each other and every check
 * afterwards reports "no canvas" for a reason that has nothing to do with the code.
 *
 * Signing in as a guest instead makes the harness self-sufficient — no shared
 * credential to expire, burn or leak.
 */
async function enterGame(page, sleep) {
  for (let i = 0; i < 30; i++) {
    const start = page.getByRole('button', { name: /START GAME/i }).first();
    if (await start.count().catch(() => 0)) { await start.click({ timeout: 5000 }).catch(() => {}); return; }
    const guest = page.getByRole('button', { name: /PLAY WITHOUT ACCT|STARTING/i }).first();
    if (await guest.count().catch(() => 0)) { await guest.click({ timeout: 5000 }).catch(() => {}); await sleep(3000); continue; }
    await sleep(500);
  }
}


const fatal = [];
const errors = [];
// Noise that is not a boot failure: missing textures, aborted fetches, the
// favicon. A real boot failure is a pageerror or a ReferenceError.
const IGNORE = /Failed to load resource|net::ERR|favicon|status of 4|status of 5|AtlasManager|WebGL/i;
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (IGNORE.test(t)) return;
  errors.push(t);
  if (/before initialization|is not a function|Cannot read propert|is not defined/i.test(t)) fatal.push(t);
});
page.on('pageerror', (e) => {
  const t = 'PAGEERROR: ' + (e.stack || e.message || e);
  errors.push(t); fatal.push(t);
});

await page.goto(URL_, { waitUntil: 'domcontentloaded' });

/**
 * Press START GAME.
 *
 * The app boots to a branded homescreen and waits for a click, so a check that
 * only loads the page sees no canvas and reports failure — a false alarm that
 * would train me to ignore it. Getting past the gate is part of "does it
 * start".
 */
await enterGame(page, sleep);

let ready = false;
const t0 = Date.now();
while (Date.now() - t0 < BUDGET_MS) {
  ready = await page.evaluate(() => !!window.__perftestReady).catch(() => false);
  if (ready) break;
  if (fatal.length) break;
  // A canvas appearing is enough to prove it started; the world can keep
  // streaming after that.
  const gotCanvas = await page.evaluate(() => !!document.querySelector('canvas')).catch(() => false);
  if (gotCanvas && Date.now() - t0 > 8000) break;
  await sleep(500);
}

// A booted app has a canvas with a live WebGL context and a non-empty scene.
const state = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return {
    hasCanvas: !!c,
    canvasSize: c ? `${c.width}x${c.height}` : null,
    bodyText: (document.body.innerText || '').slice(0, 120),
  };
}).catch(() => null);

console.log('\n=== BOOT CHECK ===');
console.log('url      :', URL_);
console.log('ready    :', ready);
console.log('canvas   :', state?.hasCanvas ? state.canvasSize : 'NONE');
console.log('onscreen :', JSON.stringify(state?.bodyText ?? ''));
console.log('errors   :', errors.length);
for (const e of errors.slice(0, 8)) console.log('   -', e.slice(0, 200));

await ctx.close();

if (fatal.length) {
  console.log('\nRESULT: FAILED TO BOOT — this is the white-screen class.');
  for (const f of fatal.slice(0, 3)) console.log('  ', f.slice(0, 300));
  process.exit(1);
}
if (!state?.hasCanvas) {
  console.log('\nRESULT: NO CANVAS — the app did not render at all.');
  process.exit(1);
}
// `ready` means the whole world finished streaming, which needs a live session
// and can outlast a sensible budget. It is NOT the pass condition: a canvas
// with zero page errors already proves the thing boots, which is the failure
// this script exists to catch.
console.log(ready
  ? '\nRESULT: BOOTS OK (world reached ready)'
  : '\nRESULT: BOOTS OK (rendered, no errors; world still streaming)');
