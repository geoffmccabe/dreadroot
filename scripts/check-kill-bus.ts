// Tests shared kills (plan v3, stage 3c). Run:
//   node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/check-kill-bus.ts
import { EnemyKillBus } from '../src/features/enemies/kill/enemyKillBus.ts';
import { deterministicSpawnController } from '../src/features/enemies/spawn/deterministicSpawnController.ts';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); failures++; } };

const DET = 'shombie_t2_3_-7_e100_0';        // deterministic: shared name
const DET2 = 'shombie_t2_3_-7_e100_1';
const LEGACY = 'shombie_1712345678901_a1b2';  // legacy: exists in one browser only

// 1. A local kill is announced, once.
const bus = new EnemyKillBus();
const sent: string[] = [];
bus.onOutgoing((id) => sent.push(id));
bus.publishLocalKill(DET);
assert(sent.length === 1 && sent[0] === DET, 'local kill is announced');

// 2. Announcing the same kill again is suppressed (no duplicate traffic).
bus.publishLocalKill(DET);
assert(sent.length === 1, 'repeat kill is not re-announced');

// 3. LEGACY ids are never announced — they mean nothing to anyone else, and
//    could collide with an unrelated creature in another browser.
bus.publishLocalKill(LEGACY);
assert(sent.length === 1, 'legacy random id is never broadcast');

// 4. A remote kill removes the creature locally.
const bus2 = new EnemyKillBus();
const removed: string[] = [];
bus2.registerRemover((id) => { removed.push(id); return true; });
assert(bus2.applyRemoteKill(DET) === true, 'remote kill reports removal');
assert(removed.length === 1 && removed[0] === DET, 'remover was called with the id');

// 5. A remote kill is NOT re-announced — this is the loop that would otherwise
//    bounce a kill between two clients forever.
const echoed: string[] = [];
bus2.onOutgoing((id) => echoed.push(id));
bus2.applyRemoteKill(DET2);
assert(echoed.length === 0, 'remote kill is never rebroadcast (no echo loop)');

// 6. Hostile / malformed input is rejected rather than thrown on.
assert(bus2.applyRemoteKill(LEGACY) === false, 'legacy id rejected from the network');
assert(bus2.applyRemoteKill('') === false, 'empty id rejected');
assert(bus2.applyRemoteKill('../../etc/passwd') === false, 'junk id rejected');
assert(bus2.applyRemoteKill(123 as unknown as string) === false, 'non-string rejected');

// 7. Several systems can each offer to remove; all are asked.
const bus3 = new EnemyKillBus();
let askedA = false, askedB = false;
bus3.registerRemover((id) => { askedA = true; return false; });  // not mine
bus3.registerRemover((id) => { askedB = true; return true; });   // mine
assert(bus3.applyRemoteKill(DET) === true, 'removal succeeds when any system owns it');
assert(askedA && askedB, 'every registered system is asked');

// 8. Unregistering actually detaches.
const bus4 = new EnemyKillBus();
let calls = 0;
const off = bus4.registerRemover(() => { calls++; return true; });
bus4.applyRemoteKill(DET);
off();
bus4.applyRemoteKill(DET2);
assert(calls === 1, 'unregistered remover stops being called');

// 9. A kill suppresses respawn, so the creature does not instantly return.
deterministicSpawnController.reset();
deterministicSpawnController.enable();
const bus5 = new EnemyKillBus();
bus5.applyRemoteKill(DET);
assert(deterministicSpawnController.status().killed >= 1, 'kill is recorded against respawn');
deterministicSpawnController.disable();

// 10. The dedup memory is bounded (cannot grow forever in a long session).
const bus6 = new EnemyKillBus();
for (let i = 0; i < 2000; i++) bus6.applyRemoteKill(`shombie_t1_0_0_e1_${i}`);
assert(bus6.stats().remembered <= 512, `dedup memory is capped (got ${bus6.stats().remembered})`);

if (failures > 0) { console.error(`\n❌ kill bus: ${failures} failure(s)`); process.exit(1); }
console.log('✅ kill bus OK (announce once / no echo loop / legacy+hostile ids rejected / suppresses respawn / bounded memory)');
