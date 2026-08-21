// Regression guard for the pathfinding storm found in the 2026-Aug-21 trace.
// A* was 22% of all CPU and dominated every lag spike, because an entity with
// no path re-requested every frame AND fired more requests while one was
// already in flight. Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-pathfind-throttle.ts
// Read the source as TEXT rather than importing it: patrolAI pulls in THREE,
// which Node's type stripping cannot load. This still guards the real file —
// the constants and the guard clauses are asserted against what is on disk.
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/features/shtickman/lib/patrolAI.ts', import.meta.url), 'utf8');
const num = (name: string): number => {
  const m = SRC.match(new RegExp(`export const ${name} = (\\d+)`));
  if (!m) throw new Error(`${name} not found in patrolAI.ts`);
  return Number(m[1]);
};
const PATHFIND_INTERVAL_MS = num('PATHFIND_INTERVAL_MS');
const PATHFIND_RETRY_MS = num('PATHFIND_RETRY_MS');

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };

// The gate, replicated exactly as patrolWalk applies it.
function shouldRequest(s: { currentPath: unknown; lastPathfindAt: number; inFlight: boolean }, now: number): boolean {
  const dueForRefresh = now - s.lastPathfindAt > PATHFIND_INTERVAL_MS;
  const retryDue = now - s.lastPathfindAt > PATHFIND_RETRY_MS;
  return !s.inFlight && (dueForRefresh || (!s.currentPath && retryDue));
}

// The guard clauses must actually be present in the shipped file.
assert(SRC.includes('_pathfindInFlight'), 'the in-flight guard still exists in patrolAI');
assert(/if \(!inFlight && \(dueForRefresh \|\| \(!s\.currentPath && retryDue\)\)\)/.test(SRC),
  'the throttle condition is intact (not reverted to the every-frame form)');
assert(!/if \(!s\.currentPath \|\| now - s\.lastPathfindAt > PATHFIND_INTERVAL_MS\) \{/.test(SRC),
  'the ORIGINAL every-frame condition is gone');
assert(PATHFIND_RETRY_MS > 0, 'a retry interval exists at all');
assert(PATHFIND_RETRY_MS <= PATHFIND_INTERVAL_MS, 'retry is no slower than the normal refresh');

// 1. THE BUG: an entity with no path, simulated at 60 fps for one second.
//    Previously every frame fired a request (~60); now it is bounded.
{
  const s = { currentPath: null as unknown, lastPathfindAt: -1e9, inFlight: false };
  let fired = 0;
  for (let f = 0; f < 60; f++) {
    const now = f * (1000 / 60);
    if (shouldRequest(s, now)) { fired++; s.lastPathfindAt = now; s.inFlight = true; }
    // A reply lands ~50 ms later and still finds no path.
    if (s.inFlight && now - s.lastPathfindAt >= 50) s.inFlight = false;
  }
  assert(fired <= 3, `a pathless entity is throttled over one second (fired ${fired}, was ~60)`);
  assert(fired >= 1, 'it still retries at all — throttled, not disabled');
}

// 2. Nothing is fired while a request is outstanding, however long it takes.
{
  const s = { currentPath: null as unknown, lastPathfindAt: 0, inFlight: true };
  let fired = 0;
  for (let f = 0; f < 600; f++) if (shouldRequest(s, f * 16.7)) fired++;
  assert(fired === 0, 'no request is made while one is in flight (this was the feedback loop)');
}

// 3. An entity WITH a path still refreshes on the normal cadence.
{
  const s = { currentPath: [{}] as unknown, lastPathfindAt: 0, inFlight: false };
  assert(!shouldRequest(s, PATHFIND_INTERVAL_MS - 1), 'no refresh before the interval');
  assert(shouldRequest(s, PATHFIND_INTERVAL_MS + 1), 'refreshes once the interval passes');
}

// 4. Ten entities — the live cap — cannot exceed a sane request rate.
{
  const ents = Array.from({ length: 10 }, () => ({ currentPath: null as unknown, lastPathfindAt: -1e9, inFlight: false }));
  let fired = 0;
  for (let f = 0; f < 60; f++) {
    const now = f * (1000 / 60);
    for (const s of ents) {
      if (shouldRequest(s, now)) { fired++; s.lastPathfindAt = now; s.inFlight = true; }
      if (s.inFlight && now - s.lastPathfindAt >= 50) s.inFlight = false;
    }
  }
  assert(fired <= 30, `ten entities stay under ~30 searches/sec (fired ${fired}, was up to 600)`);
}

if (failures > 0) { console.error(`\n❌ pathfind throttle: ${failures} failure(s)`); process.exit(1); }
console.log('✅ pathfind throttle OK (pathless entity throttled / no in-flight pile-up / normal refresh intact / 10-entity rate bounded)');
