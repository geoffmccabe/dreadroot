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
const PROFILE = path.join(ROOT, '.perftest', 'chrome-profile-lineup');
const URL_ = process.env.CHECK_URL ?? 'http://localhost:8080/?perftest';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  // Headless by DEFAULT. A visible window steals the GPU from whatever the user is
  // testing in their own browser — and a checker that degrades the thing being checked
  // is worse than no checker. SHOW=1 to watch it.
  headless: !process.env.SHOW, viewport: { width: 1280, height: 720 },
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

// Put the tool back on the weapon under test. The sweep above walks every weapon, so without
// this the final verdict describes whatever it happened to stop on rather than what was asked for.
await page.evaluate(async (i) => {
  window.__lineupSetWeapon(Number(i));
  await new Promise((r) => setTimeout(r, 1500));
}, process.env.CHECK_WEAPON ?? 14);
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
// Select the weapon named by CHECK_WEAPON (default: whatever the tool opens on) before reading,
// so a freshly baked gun can be verified per character instead of only the opening one.
if (process.env.CHECK_WEAPON) {
  await page.evaluate(async (i) => {
    window.__lineupSetWeapon(Number(i));
    await new Promise((r) => setTimeout(r, 1500));
  }, process.env.CHECK_WEAPON);
}
const asLoaded = await page.evaluate(() => ({
  guns: (window.__lineupWeaponSizes() || []).map((w) => `${w.char}: rot[${w.rot}] tex=${w.textured}`),
  arms: window.__lineupHands(),
}));
console.log('as loaded :');
for (const g of asLoaded.guns.sort()) console.log('    ', g);
for (const [k, v] of Object.entries(asLoaded.arms).sort()) console.log('    ', k, JSON.stringify(v));

// DO THE ARROW KEYS MOVE THINGS THE WAY THEY LOOK? The offsets are stored along bone axes that
// point wherever the skeleton says, so "left" moving the gun upward is exactly the failure to
// catch. Right arrow must move it along the camera's right, up arrow along world up, and so on.
const dirs = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const gunPos = () => (window.__lineupWeaponSizes() || []).find((w) => w.char === 'Ash')?.world;
  const step = async (key, n) => {
    const a = gunPos();
    for (let i = 0; i < n; i++) { fire(key); await wait(60); }
    await wait(300);
    const b = gunPos();
    return a && b ? { dx: +(b[0]-a[0]).toFixed(3), dy: +(b[1]-a[1]).toFixed(3), dz: +(b[2]-a[2]).toFixed(3) } : null;
  };
  fire('1'); await wait(200);                       // target Ash only
  const right = await step('ArrowRight', 10);
  const left  = await step('ArrowLeft', 10);
  const up    = await step('ArrowUp', 10);
  const down  = await step('ArrowDown', 10);
  const inn   = await step('.', 10);
  const out   = await step(',', 10);
  return { right, left, up, down, in: inn, out, camDir: window.__lineupCam ? window.__lineupCam() : null };
});
console.log('gun dirs  :', JSON.stringify(dirs, null, 1));

// THE ELBOW SWIVEL.
// THE ELBOW SWIVEL. A pole angle is only correct if it swings the elbow while leaving the hand
// exactly where the IK put it — if the hand moves too, the rotation axis is wrong.
const swivel = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const read = () => { const h = window.__lineupHands()['Ash']; return { hand: h.leftHand, elbow: h.leftElbow }; };
  fire("'"); await wait(250);                                            // gun -> arm
  const before = read();
  for (let i = 0; i < 4; i++) { fire('>'); await wait(90); }             // 20 degrees of swivel
  await wait(400);
  const after = read();
  const d = (p, q) => (p && q ? Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]) : null);
  return { handMovedCm: +(d(before.hand, after.hand) * 100).toFixed(2),
           elbowMovedCm: +(d(before.elbow, after.elbow) * 100).toFixed(2) };
});
console.log('swivel    :', JSON.stringify(swivel));

// Do ( and ) step the weapon list both ways?
const cycle = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const at = () => window.__lineup().weaponIndex;
  const start = at();
  fire(')'); await wait(250); const fwd = at();
  fire('('); await wait(250); const back = at();
  fire('('); await wait(250); const back2 = at();
  return { start, afterForward: fwd, afterBack: back, afterBackAgain: back2 };
});
console.log('( ) cycle :', JSON.stringify(cycle));

// Do the SHOULDER keys move anything? The tuning state recorded the presses last time while the
// pose visibly did not change, so recording the value proves nothing — measure the hands.
const shoulders = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const gap = () => window.__lineupHands()['Ash'];
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
const wantPistol = (process.env.CHECK_WEAPON ?? '14') === '14';
if (wantPistol && (!st.clip || !st.clip.startsWith('pistol_'))) {
  console.log(`\nRESULT: WRONG POSE — clip is "${st.clip}".`);
  process.exit(1);
}
if (!held || held.length === 0) {
  console.log('\nRESULT: PISTOL POSE but EMPTY HANDS — no weapon model attached.');
  process.exit(1);
}
console.log(`\nRESULT: clip "${st.clip}", ${held.length} weapon(s) in hand.`);
