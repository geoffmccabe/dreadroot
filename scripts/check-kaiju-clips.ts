/**
 * check-kaiju-clips — the right animation actually gets picked, on the REAL clip lists.
 *
 * Geoff: "instead of doing its slow motion swipe attack like it does in SWW, it's just twitching
 * really fast."
 *
 * The clip lists below are read straight out of the .glb files (see scripts/measure-glb-width.mjs,
 * which prints them). The Red Demon is the case that broke: its attack is called "Standing Melee
 * Attack Horizontal", the matcher demanded an exact match on "attack", and the fallback was
 * names[0] — the Mixamo container track, which is 1.6s of the whole armature and plays as a fit.
 *
 * Run: npm run check:kaiju-clips
 */

import { pickClip, resolveGait, isContainerClip, type ClipInfo } from '../src/components/siege/globe/kaijuClips';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

/** Verbatim from reddemon.glb. */
const RED_DEMON: ClipInfo[] = [
  { name: 'Armature|Armature|Armature|mixamo.com|Layer0', duration: 1.60 },
  { name: 'crawl', duration: 0.00 },
  { name: 'Idle', duration: 1.60 },
  { name: 'Standing Melee Attack Horizontal', duration: 1.93 },
  { name: 'Two Handed Sword Death', duration: 2.10 },
  { name: 'Walking', duration: 1.13 },
  { name: 'Zombie Reaction Hit', duration: 1.73 },
];

/** Verbatim from fortgolem.glb — the tidy case, which must not regress. */
const FORT_GOLEM: ClipInfo[] = [
  { name: 'breathidle', duration: 4.07 }, { name: 'crawl', duration: 1.87 },
  { name: 'death', duration: 0.93 }, { name: 'flex', duration: 4.70 },
  { name: 'hit', duration: 0.53 }, { name: 'idle', duration: 1.17 },
  { name: 'jumpattack', duration: 3.73 }, { name: 'punch', duration: 0.90 },
  { name: 'roar', duration: 5.43 }, { name: 'run', duration: 0.47 },
  { name: 'stand_to_crouch', duration: 4.10 }, { name: 'swipe', duration: 1.33 },
  { name: 'walk', duration: 0.67 }, { name: 'weapon_horizontal', duration: 1.33 },
  { name: 'weapon_strike1', duration: 0.53 }, { name: 'weapon_strike2', duration: 0.93 },
];

console.log('\n== The right clip gets picked on the real models ==\n');

console.log('-- Red Demon (Mixamo names) --');
ok(resolveGait(RED_DEMON, 'attack') === 'Standing Melee Attack Horizontal',
   'attack finds "Standing Melee Attack Horizontal"', String(resolveGait(RED_DEMON, 'attack')));
ok(resolveGait(RED_DEMON, 'walk') === 'Walking', 'walk finds "Walking"', String(resolveGait(RED_DEMON, 'walk')));
ok(resolveGait(RED_DEMON, 'idle') === 'Idle', 'idle finds "Idle"', String(resolveGait(RED_DEMON, 'idle')));
ok(resolveGait(RED_DEMON, 'dead') === 'Two Handed Sword Death',
   'dead finds "Two Handed Sword Death"', String(resolveGait(RED_DEMON, 'dead')));
// THE REGRESSION. Every one of these used to be the container track.
for (const gait of ['attack', 'walk', 'run', 'idle', 'dead', 'glide', 'land', 'swim']) {
  const got = resolveGait(RED_DEMON, gait);
  ok(got != null && !isContainerClip(got), `${gait} is never the Mixamo container track`, String(got));
}
// The zero-length clip must never be chosen either — it would freeze the model.
for (const gait of ['attack', 'walk', 'run', 'idle', 'dead', 'glide', 'land', 'swim']) {
  ok(resolveGait(RED_DEMON, gait) !== 'crawl', `${gait} avoids the 0.00s "crawl" clip`);
}

console.log('\n-- Fort Golem (tidy names) --');
ok(resolveGait(FORT_GOLEM, 'attack') === 'swipe', 'attack still prefers "swipe" over "jumpattack"',
   String(resolveGait(FORT_GOLEM, 'attack')));
ok(resolveGait(FORT_GOLEM, 'walk') === 'walk', 'walk finds "walk"');
ok(resolveGait(FORT_GOLEM, 'run') === 'run', 'run finds "run"');
ok(resolveGait(FORT_GOLEM, 'idle') === 'breathidle', 'idle prefers "breathidle"',
   String(resolveGait(FORT_GOLEM, 'idle')));
ok(resolveGait(FORT_GOLEM, 'dead') === 'death', 'dead finds "death"');

console.log('\n-- Rules --');
ok(isContainerClip('Armature|Armature|mixamo.com|Layer0'), 'a Mixamo container track is recognised');
ok(!isContainerClip('Standing Melee Attack Horizontal'), 'a real clip is not mistaken for one');
// Whole word beats substring: "hit" must not win over a dedicated attack when one exists.
ok(pickClip(RED_DEMON, ['attack']) === 'Standing Melee Attack Horizontal',
   'a keyword matches inside a multi-word clip name');
ok(pickClip([{ name: 'nothing', duration: 1 }], ['attack']) === null,
   'no match returns null rather than something arbitrary');
ok(pickClip([], ['idle']) === null, 'an empty model returns null');

console.log(`\n${failures === 0 ? 'CLIP CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
