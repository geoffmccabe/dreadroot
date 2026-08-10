/**
 * check-globe-preset — the defaults must BE the Golden hour preset, value for value.
 *
 * The panel highlights whichever preset is active, and a fresh install starts on 'golden'. If the
 * defaults drifted even slightly from the preset they claim to be, the highlight would be a lie: the
 * panel would say Golden hour while showing something else, and the first thing anyone did would be
 * to press the button that was supposedly already selected — and see the scene change.
 *
 * Two lists of the same numbers in one file is exactly the kind of duplication that rots quietly, so
 * it is checked rather than trusted.
 *
 * Run: npm run check:globe-preset
 */

import { readFileSync } from 'node:fs';
const src = readFileSync('src/features/look/globeLookStore.ts', 'utf8');
const def = src.slice(src.indexOf('GLOBE_LOOK_DEFAULTS: GlobeLookState = {'), src.indexOf('const KEY ='));
const gold = src.slice(src.indexOf("key: 'golden'"), src.indexOf("key: 'day'"));
const num = (blob, k) => { const m = blob.match(new RegExp(`\\b${k}:\\s*([-\\d.]+|'[a-z]+')`)); return m ? m[1] : undefined; };
const keys = ['worldLights','skyMode','fillAmbient','fillHemi','sunIntensity','sunElevation','sunWarmth','skyBounce','hazeVisibilityKm','exposure','contrast','saturation','vignette'];
let bad = 0;
for (const k of keys) {
  const d = num(def, k), g = num(gold, k);
  const same = d === g;
  if (!same) bad++;
  console.log(`  ${same ? 'PASS' : 'FAIL'}  ${k.padEnd(18)} default ${String(d).padStart(9)}  golden ${String(g).padStart(9)}`);
}
console.log(bad === 0 ? '\nDEFAULTS MATCH THE GOLDEN HOUR PRESET' : `\n${bad} MISMATCH(ES)`);
process.exit(bad ? 1 : 0);
