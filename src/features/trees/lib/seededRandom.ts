// Seeded random number generator for deterministic tree growth
// Same seed always produces same tree shape

export function createSeededRandom(seed: number): () => number {
  let state = seed;
  
  return () => {
    // Linear congruential generator
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

// Utility functions using seeded random
export function seededShuffle<T>(array: T[], rng: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function seededChoice<T>(array: T[], rng: () => number): T {
  return array[Math.floor(rng() * array.length)];
}

export function seededRange(min: number, max: number, rng: () => number): number {
  return min + rng() * (max - min);
}

export function seededInt(min: number, max: number, rng: () => number): number {
  return Math.floor(seededRange(min, max + 1, rng));
}
