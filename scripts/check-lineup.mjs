/**
 * Does the character lineup tool open in the pose we think it does?
 *
 * It is keyboard-only, lives inside the Canvas, and has no DOM — so "it opened
 * holding a rifle" was only discoverable by a human looking at it. Twice. This
 * boots the real app, presses "&&&", and reports the weapon, the clip and the
 * ground height the tool actually chose.
 *
 *   npm run check:lineup
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = path.join(ROOT, '.perftest', 'chrome-profile');
const URL_ = process.env.CHECK_URL ?? 'http://localhost:8080/?perftest';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, viewport: { width: 1280, height: 720 },
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message || e)));

await page.goto(URL_, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 20; i++) {
  const btn = page.getByRole('button', { name: /START GAME|LOGIN/i }).first();
  if (await btn.count().catch(() => 0)) { await btn.click({ timeout: 5000 }).catch(() => {}); break; }
  await sleep(500);
}
// Let the world stream in far enough that the collision grid has ground in it —
// the lineup's feet are placed off that grid.
for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => !!document.querySelector('canvas')).catch(() => false)) break;
  await sleep(500);
}
// The lineup stands on the block collision grid, so the world has to have
// streamed in before the anchor is taken. Init measured ~19s.
for (let i = 0; i < 90; i++) {
  if (await page.evaluate(() => !!window.__perftestReady).catch(() => false)) break;
  await sleep(1000);
}
await sleep(4000);

// Dispatch "&" straight at the window rather than typing it: the listener is a
// capture-phase window handler, and a real keypress depends on the browser's
// keyboard layout mapping Shift+7, which is not something this check should be
// testing.
await page.evaluate(() => {
  for (let i = 0; i < 3; i++) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '&', code: 'Digit7', shiftKey: true, bubbles: true }));
  }
});
await sleep(6000);

const st = await page.evaluate(() => (window.__lineup ? window.__lineup() : null));
const probe = await page.evaluate((s) => {
  if (!window.__lineupProbe || !s) return null;
  return { row: window.__lineupProbe(s.anchorX, s.anchorZ, s.anchorY + 5) };
}, st);
if (probe) console.log('probe     :', JSON.stringify(probe));
const held = await page.evaluate(() => (window.__lineupWeapons ? window.__lineupWeapons() : null));
console.log('in hands  :', JSON.stringify(held));
// Walk every weapon by INDEX and report what actually got rendered: world size of the model
// in the hand (gizmo included, so compare weapons against each other, not against lengthM) and
// whether its material ended up with a texture. A weapon whose registry length is wrong shows
// up here in the wrong size cluster, which is otherwise only visible by eye.
// The wrap's rotation as loaded, BEFORE any key is pressed. It must equal the baked rotDeg
// exactly. Anything else means a saved browser tune is composing on top of the baked value —
// the doubling that BAKE_VERSION / BAKED_URLS exist to prevent.
const asLoaded = await page.evaluate(() => (window.__lineupWeaponSizes() || [])[0] ?? null);
console.log('as loaded :', JSON.stringify(asLoaded));

// Do the SHOULDER keys move anything? The tuning state recorded the presses last time while the
// pose visibly did not change, so recording the value proves nothing — measure the hands.
const shoulders = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const gap = () => window.__lineupHands()['Rajax'];
  fire('0');                       // target ALL characters
  await wait(200);
  const before = gap();
  for (let i = 0; i < 4; i++) { fire(']'); await wait(80); }   // spread +12°
  await wait(300);
  const afterSpread = gap();
  for (let i = 0; i < 4; i++) { fire('{'); await wait(80); }   // pitch down 12°
  await wait(300);
  const afterPitch = gap();
  return { before, afterSpread, afterPitch };
});
console.log('shoulders :', JSON.stringify(shoulders));

// Do the rotation keys fire? Alt/Shift + X/Y/Z are the tuning nudges; a modifier the browser
// or OS eats is indistinguishable from a broken handler without measuring the result.
const rotTest = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rot = () => (window.__lineupWeaponSizes() || [{}])[0]?.rot;
  const fire = (code, mods) => window.dispatchEvent(new KeyboardEvent('keydown',
    { key: code.slice(3).toLowerCase(), code, bubbles: true, ...mods }));
  const before = rot();
  fire('KeyX', { altKey: true }); await wait(300);
  const afterAlt = rot();
  fire('KeyX', { shiftKey: true }); await wait(300);
  const afterShift = rot();
  fire('KeyX', {}); await wait(300);
  const afterBare = rot();
  return { before, afterAlt, afterShift, afterBare };
});
console.log('rot keys  :', JSON.stringify(rotTest));

const sizes = await page.evaluate(async (n) => {
  const out = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < n; i++) {
    window.__lineupSetWeapon(i);
    await wait(400);
    const w = window.__lineupWeaponSizes ? window.__lineupWeaponSizes() : null;
    out.push(w && w.length ? { i, ...w[0] } : { i, missing: true });
  }
  return out;
}, 26);
console.log('per weapon:');
for (const w of sizes || []) console.log('   ', JSON.stringify(w));
console.log('\n=== LINEUP CHECK ===');
console.log(st ? JSON.stringify(st, null, 2) : 'window.__lineup MISSING — state module never loaded');
if (errors.length) { console.log('page errors:'); for (const e of errors.slice(0, 5)) console.log('  -', e.slice(0, 200)); }
// The key tests above WRITE tunes to localStorage, which would then compose on top of the baked
// values on the next run and make "as loaded" report a doubling that is this script's own doing.
await page.evaluate(() => {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('siege_weapon_tune::') || k.startsWith('siege_weapon_pos::'))) localStorage.removeItem(k);
  }
});
await page.screenshot({ path: process.env.SHOT ?? '/tmp/lineup.png' });
console.log('screenshot :', process.env.SHOT ?? '/tmp/lineup.png');
await ctx.close();

if (!st?.enabled) { console.log('\nRESULT: the lineup did NOT open.'); process.exit(1); }
if (!st.clip || !st.clip.startsWith('pistol_')) {
  console.log(`\nRESULT: WRONG POSE — clip is "${st.clip}".`);
  process.exit(1);
}
if (!held || held.length === 0) {
  console.log('\nRESULT: PISTOL POSE but EMPTY HANDS — no weapon model attached.');
  process.exit(1);
}
console.log(`\nRESULT: pistol pose, ${held.length} weapon(s) in hand.`);
