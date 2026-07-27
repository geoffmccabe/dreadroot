// kaijuRandom — one seeded random source for the whole Kaiju simulation.
//
// WHY THIS EXISTS, AND WHY IT IS NOT Math.random.
//
// Two separate requirements force it, and both are load-bearing:
//
// 1. BALANCE TESTING. Comparing two Kaiju builds means running the same fight many times and
//    counting wins. If the randomness is not reproducible, a build that looks 3% stronger might
//    just be a lucky run, and there is no way to tell. With a seed, a change to the numbers is the
//    ONLY thing that can change the result.
//
// 2. OFFLINE RESOLUTION. Kaiju are meant to fight while nobody is watching, which means the server
//    will not tick them — it will store what they were doing and work out later what must have
//    happened (see docs/KAIJU_STATS_AND_ECONOMY.md). That only works if the outcome is a pure
//    function of state, elapsed time and a stored seed. Two players opening the same region have
//    to get the same answer, and the answer must not depend on who looked first.
//
// Retrofitting determinism onto a simulation is much harder than starting with it, so it starts
// with it.

/** mulberry32: small, fast, good enough distribution, and trivially reproducible. */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let next = mulberry32(0x5EED);

/** Reset the stream. Call at the start of any fight that needs to be reproducible. */
export function seedKaiju(seed: number): void {
  next = mulberry32(seed >>> 0);
}

/** Uniform in [0, 1). */
export function rand(): number { return next(); }

/** Uniform in [lo, hi). */
export function randRange(lo: number, hi: number): number { return lo + next() * (hi - lo); }

/** Uniform in [-half, +half). */
export function randSigned(half: number): number { return (next() * 2 - 1) * half; }
