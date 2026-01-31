// Chunk loader tuning constants.
// Extracted from useChunkLoader.ts to keep the hook file smaller and reduce re-ingestion cost.

export const LOAD_RADIUS = 4; // Chunks to load around player (9x9 = 81 chunks max)
export const UNLOAD_RADIUS = 6; // Hysteresis: don't unload until this far away
export const POSITION_UPDATE_THROTTLE = 200; // ms between position updates

// Phase 3A: Eviction configuration
// MAX must be >= (2*UNLOAD_RADIUS+1)^2 = 169, plus buffer
export const MAX_LOADED_CHUNKS = 220;
export const EVICTION_BATCH_SIZE = 10;

// Phase 3D: Cache configuration
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Phase 3E: Velocity-based prefetch configuration
export const PREFETCH_DISTANCE = 2; // Chunks beyond LOAD_RADIUS to prefetch
export const PREFETCH_MIN_SPEED = 2.0; // Blocks/sec threshold (ignore micro-jitter)
export const PREFETCH_BATCH_SIZE = 2; // Max chunks per idle callback
export const PREFETCH_DEBOUNCE_MS = 300; // Debounce rapid direction changes
export const POSITION_HISTORY_SIZE = 5; // Ring buffer size for velocity calc
export const PREFETCH_HEADROOM = 20; // Don't prefetch if within this many of MAX
