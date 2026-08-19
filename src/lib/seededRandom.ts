/**
 * Deterministic pseudo-randomness.
 *
 * Every client must be able to compute the SAME answer from the same inputs,
 * on any browser, with no coordination. That rules out `Math.random()` (each
 * client rolls its own world) and it also rules out the common
 * `Math.sin(seed) * 10000 % 1` hash trick: the ECMAScript spec does NOT pin
 * down the results of the transcendental maths functions, so `Math.sin` is
 * allowed to differ between JavaScript engines. A value that differs between
 * Chrome and Safari would put two players in different worlds.
 *
 * Everything here is 32-bit integer arithmetic via Math.imul, which IS exactly
 * specified, plus one final division by 2^32 that is exact in a double. Same
 * inputs give bit-identical outputs everywhere.
 *
 * This is the foundation for both "everyone sees the same monsters" (stage 3)
 * and for server-authoritative simulation later, where the server and the
 * client must agree on any roll.
 */

/** Mix a 32-bit integer into a well-distributed 32-bit hash (MurmurHash3 finalizer). */
export function hashInt(x: number): number {
  let h = x | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Combine several integers into one 32-bit seed, order-sensitive. */
export function hashCombine(...values: number[]): number {
  let h = 0x9e3779b9 | 0;
  for (let i = 0; i < values.length; i++) {
    h = Math.imul(h ^ hashInt(values[i] | 0), 0x27220a95) | 0;
    h = (h << 13) | (h >>> 19);
  }
  return hashInt(h);
}

/** Hash a string to a 32-bit integer (FNV-1a). For world ids / uuids. */
export function hashString(s: string): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A small, fast, fully deterministic generator (mulberry32).
 *
 * Not cryptographically secure, and deliberately so: it must be reproducible.
 * Anything where unpredictability matters for money (loot value, drop rolls)
 * belongs on the server with a proper secure generator, never here.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Next integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Next float in [min, max). */
  nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with the given probability. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick an element deterministically. Returns undefined for an empty array. */
  pick<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  }
}

/** Build a generator from any mix of numbers and strings. */
export function seededFrom(...parts: Array<number | string>): SeededRandom {
  const nums: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    nums.push(typeof p === 'string' ? hashString(p) : (p | 0));
  }
  return new SeededRandom(hashCombine(...nums));
}
