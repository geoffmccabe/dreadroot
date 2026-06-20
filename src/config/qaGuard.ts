// After a siege spawn command (e.g. !13 = type 1, qty 3), a trailing digit the
// user types can leak into the Quick-Access number-key handler and pick a QS slot
// (or count toward a triple-tap). SiegeSpawner calls suppressQA() on each spawn;
// the QA number-key handlers ignore 1-6 while suppressed.
let suppressUntil = 0;

export function suppressQA(ms = 1000): void { suppressUntil = performance.now() + ms; }
export function isQASuppressed(): boolean { return performance.now() < suppressUntil; }
