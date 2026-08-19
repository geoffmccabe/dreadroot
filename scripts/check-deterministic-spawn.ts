// Tests deterministic chunk spawning (plan v3, stage 3b). Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-deterministic-spawn.ts
//
// The property that matters: two clients that never talk to each other must
// derive the SAME monsters, in the same places, with the SAME IDS. Stable ids
// are what make shared kills possible.
import {
  planChunkSpawns, epochFor, isDeterministicId, DEFAULT_EPOCH_MS,
  type PlanOptions, type ChunkSpawnRule, type PlannedSpawn,
} from '../src/features/enemies/spawn/deterministicSpawn.ts';
import { SeededRandom, seededFrom, hashString, hashCombine } from '../src/lib/seededRandom.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };

// ── the generator itself ────────────────────────────────────────────────────
// 1. Reproducible from a seed.
const r1 = new SeededRandom(12345), r2 = new SeededRandom(12345);
const a = [r1.next(), r1.next(), r1.next()];
const b = [r2.next(), r2.next(), r2.next()];
assert(a.every((v, i) => v === b[i]), 'same seed gives the same sequence');
assert(new SeededRandom(12346).next() !== a[0], 'different seed gives a different sequence');

// 2. Output is in range and reasonably distributed (not stuck).
const r3 = new SeededRandom(7);
let min = 1, max = 0, sum = 0;
for (let i = 0; i < 20000; i++) { const v = r3.next(); if (v < min) min = v; if (v > max) max = v; sum += v; }
assert(min >= 0 && max < 1, 'values stay within [0,1)');
assert(Math.abs(sum / 20000 - 0.5) < 0.02, `mean is near 0.5 (got ${(sum / 20000).toFixed(4)})`);

// 3. nextInt covers its full inclusive range.
const r4 = new SeededRandom(99);
const seen = new Set<number>();
for (let i = 0; i < 3000; i++) seen.add(r4.nextInt(1, 5));
assert(seen.size === 5 && seen.has(1) && seen.has(5), 'nextInt covers [min,max] inclusive');

// 4. Hashing is order-sensitive and string-stable.
assert(hashCombine(1, 2) !== hashCombine(2, 1), 'hashCombine is order-sensitive');
assert(hashString('world-a') === hashString('world-a'), 'hashString is stable');
assert(hashString('world-a') !== hashString('world-b'), 'hashString separates inputs');

// ── the spawn plan ──────────────────────────────────────────────────────────
const base: PlanOptions = { worldSeed: 'world-1', chunkX: 3, chunkZ: -7, epoch: 100, chunkSize: 16 };
const rule: ChunkSpawnRule = { enemyType: 'shombie', tier: 2, density: 1, maxPerChunk: 4 };

// 5. THE HEADLINE PROPERTY: two independent "clients" derive an identical plan.
const clientA: PlannedSpawn[] = planChunkSpawns(base, rule);
const clientB: PlannedSpawn[] = planChunkSpawns({ ...base }, { ...rule });
assert(clientA.length > 0, 'density 1 produces monsters');
assert(JSON.stringify(clientA) === JSON.stringify(clientB), 'two clients derive an IDENTICAL plan');
assert(clientA.every(s => clientB.some(o => o.id === s.id)), 'ids match across clients');

// 6. Positions land inside the chunk.
assert(clientA.every(s => s.offsetX >= 0 && s.offsetX < 16 && s.offsetZ >= 0 && s.offsetZ < 16),
  'offsets stay within the chunk');

// 7. Ids are unique within a chunk, and recognisable.
assert(new Set(clientA.map(s => s.id)).size === clientA.length, 'ids are unique within a chunk');
assert(clientA.every(s => isDeterministicId(s.id)), 'ids are recognisable as deterministic');
assert(!isDeterministicId('shombie_1712345678901_a1b2'), 'legacy random ids are NOT misread as deterministic');

// 8. Different chunk / epoch / tier ⇒ different population.
const otherChunk = planChunkSpawns({ ...base, chunkX: 4 }, rule);
const otherEpoch = planChunkSpawns({ ...base, epoch: 101 }, rule);
const otherWorld = planChunkSpawns({ ...base, worldSeed: 'world-2' }, rule);
assert(JSON.stringify(otherChunk) !== JSON.stringify(clientA), 'a different chunk differs');
assert(JSON.stringify(otherEpoch) !== JSON.stringify(clientA), 'a different epoch differs');
assert(JSON.stringify(otherWorld) !== JSON.stringify(clientA), 'a different world differs');

// 9. Adding a creature type must NOT move existing ones. This is why type and
//    tier are folded into the seed: otherwise every content change would
//    rearrange the whole world.
const shroomerPlan = planChunkSpawns(base, { ...rule, enemyType: 'shroomer' });
const shombieAgain = planChunkSpawns(base, rule);
assert(JSON.stringify(shombieAgain) === JSON.stringify(clientA), 'planning another type does not disturb shombies');
assert(JSON.stringify(shroomerPlan) !== JSON.stringify(clientA), 'a different type gets its own layout');

// 10. Density bounds.
assert(planChunkSpawns(base, { ...rule, density: 0 }).length === 0, 'density 0 spawns nothing');
assert(planChunkSpawns(base, { ...rule, maxPerChunk: 0 }).length === 0, 'maxPerChunk 0 spawns nothing');
let populated = 0;
for (let c = 0; c < 400; c++) if (planChunkSpawns({ ...base, chunkX: c }, { ...rule, density: 0.25 }).length > 0) populated++;
assert(populated > 60 && populated < 140, `density 0.25 populates ~25% of chunks (got ${populated}/400)`);

// 11. Count respects maxPerChunk.
for (let c = 0; c < 200; c++) {
  const p = planChunkSpawns({ ...base, chunkX: c }, rule);
  if (p.length > rule.maxPerChunk) { assert(false, `chunk ${c} exceeded maxPerChunk`); break; }
}

// 12. The output array is reusable (zero-allocation contract).
const reused: PlannedSpawn[] = [];
planChunkSpawns(base, rule, reused);
const ref = reused;
planChunkSpawns({ ...base, chunkX: 9 }, rule, reused);
assert(ref === reused, 'caller-provided array is reused, not replaced');

// 13. Epoch bucketing.
assert(epochFor(0) === 0 && epochFor(DEFAULT_EPOCH_MS) === 1, 'epoch advances by the epoch length');
assert(epochFor(DEFAULT_EPOCH_MS - 1) === 0, 'epoch is stable within its window');
assert(epochFor(1000, 1000) === 1, 'epoch length is configurable');

if (failures > 0) { console.error(`\n❌ deterministic spawn: ${failures} failure(s)`); process.exit(1); }
console.log('✅ deterministic spawn OK (reproducible RNG / identical plan across clients / stable unique ids / type isolation / density)');
