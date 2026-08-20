// Tests the deterministic spawn CONTROLLER (plan v3, stage 3b). Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-spawn-controller.ts
//
// Every assertion below corresponds to a bug found in self-audit, so these are
// regression guards rather than speculation.
import { DeterministicSpawnController, type DeterministicRule } from '../src/features/enemies/spawn/deterministicSpawnController.ts';
import type { PlannedSpawn } from '../src/features/enemies/spawn/deterministicSpawn.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };

const rule = (over: Partial<DeterministicRule> = {}): DeterministicRule => ({
  enemyType: 'shombie', tier: 1, spawnChancePerMinute: 1, maxPerChunk: 1,
  minChunkDistance: 2, maxChunkDistance: 4, ...over,
});
const collect = (c: DeterministicSpawnController, now: number, rules: DeterministicRule[]): PlannedSpawn[] => {
  const got: PlannedSpawn[] = [];
  c.tick({ playerChunkX: 0, playerChunkZ: 0, chunkSize: 16, rules }, now, (s) => got.push(s));
  return got;
};

// 1. Disabled is completely inert (the shipping default).
const off = new DeterministicSpawnController();
assert(collect(off, 0, [rule()]).length === 0, 'disabled controller emits nothing');

// 2. BUG GUARD: each rule keeps its OWN chunk range. An earlier version read
//    the FIRST rule's range and applied it to every rule, so a short-range
//    creature spawned out to a long-range creature's distance.
const c2 = new DeterministicSpawnController();
c2.enable();
c2.setDensityMultiplier(10000); // force spawns so ranges are observable
const near = rule({ enemyType: 'near', minChunkDistance: 0, maxChunkDistance: 1 });
const far = rule({ enemyType: 'far', minChunkDistance: 5, maxChunkDistance: 6 });
const both = collect(c2, 0, [near, far]);
const nearRing = (s: PlannedSpawn) => Math.max(Math.abs(s.chunkX), Math.abs(s.chunkZ));
assert(both.some(s => s.enemyType === 'near') && both.some(s => s.enemyType === 'far'), 'both rules produce spawns');
assert(both.filter(s => s.enemyType === 'near').every(s => nearRing(s) <= 1),
  'short-range rule stays within ITS OWN range');
assert(both.filter(s => s.enemyType === 'far').every(s => nearRing(s) >= 5 && nearRing(s) <= 6),
  'long-range rule stays within ITS OWN range');

// 3. BUG GUARD: density is calibrated against the legacy spawn rate.
//    Legacy expects (chance/100) * epochMinutes spawns per epoch for the whole
//    rule. Naively reusing chance/100 as a PER-CHUNK density multiplied the
//    population by the chunk count (~14x measured).
const c3 = new DeterministicSpawnController();
c3.enable();
c3.setEpochMs(5 * 60 * 1000);
// chance 100%/min over a 5 min epoch = 5 expected creatures for the rule.
const loud = rule({ spawnChancePerMinute: 100, maxPerChunk: 1 });
let total = 0;
const TRIALS = 300;
for (let i = 0; i < TRIALS; i++) {
  const c = new DeterministicSpawnController();
  c.enable();
  c.setEpochMs(5 * 60 * 1000);
  c.setWorldSeed(`seed-${i}`);
  total += collect(c, 0, [loud]).length;
}
const mean = total / TRIALS;
assert(mean > 3.5 && mean < 6.5, `population matches the legacy expectation ~5 (got ${mean.toFixed(2)})`);

// 3b. BUG GUARD: calibration must hold for maxPerChunk > 1 too. A populated
//     chunk yields nextInt(1, maxPerChunk), averaging (1+maxPerChunk)/2 — not
//     1. An earlier version divided by chunk count only, so raising
//     maxPerChunk to 4 silently inflated the population by 2.5x. Invisible
//     while every live rule used maxPerChunk = 1.
const meanFor = (maxPerChunk: number): number => {
  let t = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const c = new DeterministicSpawnController();
    c.enable(); c.setEpochMs(5 * 60 * 1000); c.setWorldSeed(`mpc-${maxPerChunk}-${i}`);
    t += collect(c, 0, [rule({ spawnChancePerMinute: 100, maxPerChunk })]).length;
  }
  return t / N;
};
const mpc1 = meanFor(1);
const mpc4 = meanFor(4);
assert(mpc1 > 3.5 && mpc1 < 6.5, `maxPerChunk=1 matches expectation ~5 (got ${mpc1.toFixed(2)})`);
assert(mpc4 > 3.5 && mpc4 < 6.5, `maxPerChunk=4 ALSO matches ~5, not 2.5x it (got ${mpc4.toFixed(2)})`);
assert(Math.abs(mpc4 - mpc1) < 2, `population is stable across maxPerChunk (${mpc1.toFixed(2)} vs ${mpc4.toFixed(2)})`);

// 3c. The killed set cannot grow without bound while disabled.
const cK = new DeterministicSpawnController();
for (let i = 0; i < 9000; i++) cK.markKilled(`shombie_t1_0_0_e1_${i}`);
assert(cK.status().killed <= 4096, `killed set is capped (got ${cK.status().killed})`);

// 4. The multiplier scales the population as advertised.
const meanAt = (mult: number): number => {
  let t = 0;
  for (let i = 0; i < 200; i++) {
    const c = new DeterministicSpawnController();
    c.enable(); c.setEpochMs(5 * 60 * 1000); c.setDensityMultiplier(mult); c.setWorldSeed(`m-${i}`);
    t += collect(c, 0, [loud]).length;
  }
  return t / 200;
};
const m1 = meanAt(1), m2 = meanAt(2);
assert(m2 > m1 * 1.4, `doubling the multiplier increases population (${m1.toFixed(2)} -> ${m2.toFixed(2)})`);

// 5. Nothing is emitted twice within an epoch.
const c5 = new DeterministicSpawnController();
c5.enable(); c5.setDensityMultiplier(10000);
const firstPass = collect(c5, 0, [rule()]);
const secondPass = collect(c5, 1000, [rule()]);
assert(firstPass.length > 0, 'first pass spawns');
assert(secondPass.length === 0, 'second pass in the same epoch emits nothing new');

// 6. A killed creature does not come back within its epoch.
const c6 = new DeterministicSpawnController();
c6.enable(); c6.setDensityMultiplier(10000);
const got6 = collect(c6, 0, [rule()]);
c6.markKilled(got6[0].id);
c6.reset();                      // forget what we emitted, keep the kill? (reset clears both)
c6.enable();                     // re-enable after reset
c6.setDensityMultiplier(10000);
const again = collect(c6, 0, [rule()]);
assert(again.some(s => s.id === got6[0].id), 'reset clears kills too (documented behaviour)');

const c6b = new DeterministicSpawnController();
c6b.enable(); c6b.setDensityMultiplier(10000);
const got6b = collect(c6b, 0, [rule()]);
const victim = got6b[0].id;
c6b.markKilled(victim);
// Force a re-emit opportunity WITHOUT clearing kills: same epoch, fresh scan.
const after = collect(c6b, 500, [rule()]);
assert(!after.some(s => s.id === victim), 'a killed creature is not re-emitted in its epoch');

// 7. A new epoch repopulates (so cleared areas recover).
const c7 = new DeterministicSpawnController();
c7.enable(); c7.setDensityMultiplier(10000); c7.setEpochMs(1000);
const e0 = collect(c7, 0, [rule()]);
const e1 = collect(c7, 1500, [rule()]);
assert(e0.length > 0 && e1.length > 0, 'a new epoch repopulates');
assert(e0[0].id !== e1[0].id, 'new epoch produces new ids');

// 8. Empty rule list is safe.
const c8 = new DeterministicSpawnController();
c8.enable();
assert(collect(c8, 0, []).length === 0, 'no rules is a no-op');

if (failures > 0) { console.error(`\n❌ spawn controller: ${failures} failure(s)`); process.exit(1); }
console.log('✅ spawn controller OK (per-rule ranges / density calibrated to legacy / no repeats / kills suppressed / epoch rollover)');
