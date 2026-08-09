/**
 * bench-arena-gc — how much GARBAGE does a battle make?
 *
 * Geoff's traces show twenty seconds of young-generation GC against four of the old. That ratio is
 * the signature of churn — a hot loop allocating and discarding — not of a leak, and the two need
 * completely different fixes. This counts the collections a fixed battle causes, so a change can be
 * shown to have helped rather than asserted to have.
 *
 * Run: npm run bench:arena-gc
 */
import { PerformanceObserver } from 'node:perf_hooks';
import { initArenaWith, stepArena } from '../src/components/siege/globe/kaijuArena';
import { BREEDS } from '../src/components/siege/globe/kaijuStats';

let minor = 0, major = 0, gcMs = 0;
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    const kind = (e as unknown as { detail?: { kind?: number } }).detail?.kind;
    gcMs += e.duration;
    if (kind === 1) minor++; else major++;
  }
}).observe({ entryTypes: ['gc'] });

initArenaWith([BREEDS[0], BREEDS[2], BREEDS[1], BREEDS[4]], 0x5EED, 6);
const FRAMES = 3600;                       // one minute at 60 fps
const t0 = Date.now();
for (let f = 0; f < FRAMES; f++) stepArena(1 / 60, false);
const ms = Date.now() - t0;

setTimeout(() => {
  console.log(`\n  ${FRAMES} frames (one minute of battle) in ${ms} ms — ${(ms / FRAMES).toFixed(3)} ms/frame`);
  console.log(`  garbage collections: ${minor} minor, ${major} major, ${gcMs.toFixed(0)} ms total`);
  console.log(`  collections per simulated second: ${((minor + major) / (FRAMES / 60)).toFixed(2)}\n`);
}, 50);
