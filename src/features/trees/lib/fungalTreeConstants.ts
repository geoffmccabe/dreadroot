/**
 * Fungal Tree Constants
 *
 * Configuration for giant hollow mushroom trees.
 * Currently configured for the 11-block wide version.
 */

// ========== STEM DIMENSIONS (tier-dependent) ==========
// Stem width scales by 2 blocks per tier:
// Tier 1 = 11 blocks wide (radius 5)
// Tier 2 = 13 blocks wide (radius 6)
// ...
// Tier 10 = 29 blocks wide (radius 14)
// Formula: diameter = 11 + (tier - 1) * 2, radius = 4 + tier
// These constants are for reference only - actual values are calculated in fungalTreeGenerator.ts
export const FUNGAL_STEM_DIAMETER_TIER1 = 11;
export const FUNGAL_STEM_RADIUS_TIER1 = 5;

// ========== HEIGHT RANGE ==========
export const FUNGAL_MIN_HEIGHT = 30;
export const FUNGAL_MAX_HEIGHT = 60;

// ========== DECORATIVE RINGS ==========
// Two rings at 2/3 height, protruding outward
export const FUNGAL_RING_HEIGHT_RATIO = 0.66; // 2/3 up the stem
export const FUNGAL_RING_PROTRUSION = 2; // extra blocks outward
export const FUNGAL_RING_SPACING = 3; // blocks between the two rings
export const FUNGAL_RING_COUNT = 2;

// ========== CAP DIMENSIONS ==========
export const FUNGAL_MIN_CAP_WIDTH = 40;  // 2x wider (was 20)
export const FUNGAL_MAX_CAP_WIDTH = 100; // 2x wider (was 50)
export const FUNGAL_CAP_THICKNESS = 10;
export const FUNGAL_CAP_GAP = 0; // no gap - cap sits directly on columns

// ========== SUPPORT COLUMNS ==========
// Columns connect stem top to cap
export const FUNGAL_COLUMN_SPACING = 3; // every 3rd block on stem perimeter
export const FUNGAL_COLUMN_HEIGHT = 3; // blocks tall

// ========== DOOR ==========
export const FUNGAL_DOOR_WIDTH = 2;
export const FUNGAL_DOOR_HEIGHT = 3;

// ========== SPIRAL STAIRCASE ==========
export const FUNGAL_STAIR_WIDTH = 2; // blocks wide
export const FUNGAL_STAIR_INNER_RADIUS = 2; // leave center hollow for light
export const FUNGAL_STAIR_BLOCKS_PER_ROTATION = 16; // blocks to complete one full rotation
export const FUNGAL_STAIR_RISE_PER_BLOCK = 1; // 1 block up per step

// ========== TIER LIMITS ==========
// Fungal trees only have 10 tiers
export const FUNGAL_MAX_TIERS = 10;

// ========== BLOCK TYPE MAPPINGS ==========
// What block type to use for each fungal tree part
export const FUNGAL_BLOCK_TYPES = {
  STEM: 'fungal_stem',      // Outer stem wall (uses fungal stem texture)
  RINGS: 'fungal_stem',    // Decorative protruding rings (same texture as stem)
  COLUMNS: 'fungal_stem',  // Support columns from stem to cap
  CAP_TOP: 'fungal_cap_top',   // Top surface of cap (uses fungal cap_top texture)
  CAP_BOTTOM: 'fungal_cap_underside', // Underside of cap (uses fungal cap_underside texture)
  STAIRS: 'fungal_stem',   // Spiral staircase blocks (same texture as stem)
  DOOR_FRAME: 'fungal_stem', // Door frame (same as stem)
} as const;
