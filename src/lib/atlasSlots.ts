// THE one definition of how the texture atlas is carved up.
//
// The atlas is ONE 8192-square texture = 1024 fixed 256-square slots. Two very
// different things read this table, which is why it lives in its own module
// with no imports: if either copy drifts from the other, textures are drawn
// into another category's slots and monsters come out wearing tree bark.
//
//   1. DETERMINISTIC categories (tree, fungal_tree, wide_tree). Their slot is
//      a formula - tier N, part P always lands on the same slot - so the three
//      tree kinds can be looked up without consulting the atlas. Those formulas
//      live in atlasLookup.ts and MUST start from the values here. Each needs
//      exactly tiers x 3 slots, no more and no less, and cannot be animated.
//
//   2. ALLOCATED categories (everything else). atlasManager hands out slots on
//      demand from `nextFreeSlot`, which atlasStorage seeds from `start` here.
//      An animated tier costs one slot PER FRAME, up to 24, so these need real
//      headroom.
//
// MEASURED DEMAND, 2026-Nov-15, frames counted from the _<n>f_ in each texture
// URL across the live blocks / seed_definitions / *_definitions tables (both
// games share them, so the numbers are the same for DreadRoot and Pinkland):
//
//   DETERMINISTIC (fixed, independent of what is in the database):
//     tree 30 tiers x 3 = 90 · fungal_tree 30 x 3 = 90 · wide_tree 10 x 3 = 30
//   ALLOCATED (grows with content):
//     shombie 152 · shroomer 128 · shnake 81 · shwarm 50 · block 48
//     global ~6 · vortax 1 · walapa 0
//   TOTAL 676 of 1024.
//
// The split before this file existed was written before animated tiers and
// never revisited: block held 270 slots for 48 textures and shwarm 250 for 50,
// while shombie had 30 for a demand of 152 and shroomer 30 for 128. Both
// overflowed on every load and rendered as flat colour, and wide_tree was 4
// slots short without anyone noticing.
//
// ⚠ Bump ATLAS_SCHEMA_VERSION in atlasStorage.ts whenever these move, or
// clients keep an atlas built against the old layout and draw wrong textures.
//
// ⚠ The 1024 ceiling is real and this only buys room inside it. The permanent
// fix is the DataArrayTexture backend (src/config/textureBackend.ts), which has
// no slot limit. The numbers above say when it stops being optional: roughly
// 350 more animated frames.
export const SLOT_RANGES: Record<string, { start: number; end: number }> = {
  // ── Deterministic. Slot = a formula of tier and part, so these must be
  //    reserved, contiguous, and exactly big enough. They are never animated.
  tree:        { start: 0,   end: 89 },   // 30 tiers x 3, exactly 90
  fungal_tree: { start: 90,  end: 179 },  // 30 tiers x 3, exactly 90
  wide_tree:   { start: 180, end: 209 },  // 10 tiers x 3, exactly 30

  // ── Everything else shares ONE pool, below. These entries exist so the
  //    debug panel and the stored metadata keep working, and so allocation
  //    STARTS in a sensible place, but running past the end is no longer
  //    fatal: allocateSlot falls through to the shared pool.
  block:       { start: 210, end: 269 },
  global:      { start: 270, end: 289 },
  shwarm:      { start: 290, end: 359 },
  shombie:     { start: 360, end: 539 },
  shnake:      { start: 540, end: 719 },
  shroomer:    { start: 720, end: 879 },
  vortax:      { start: 880, end: 889 },
  walapa:      { start: 890, end: 899 },
  misc:        { start: 900, end: 1023 }, // 124 slots of shared spare
};

/** First slot that is NOT reserved by a deterministic formula. */
export const DYNAMIC_POOL_START = 210;
export const ATLAS_SLOT_COUNT = 1024;

/** Categories whose slot index is computed, not allocated. */
export const DETERMINISTIC_CATEGORIES = new Set(['tree', 'fungal_tree', 'wide_tree']);

/** Slots in a category's range. */
export function slotRangeSize(category: string): number {
  const r = SLOT_RANGES[category];
  return r ? r.end - r.start + 1 : 0;
}

// Tiers the deterministic categories reserve slots for, whatever the database
// holds. Changing one of these without widening its range above silently walks
// the formula into the next category, so they are checked below at module load.
export const TREE_TIERS = 30;
export const FUNGAL_TREE_TIERS = 30;
export const WIDE_TREE_TIERS = 10;

const DETERMINISTIC: [string, number][] = [
  ['tree', TREE_TIERS],
  ['fungal_tree', FUNGAL_TREE_TIERS],
  ['wide_tree', WIDE_TREE_TIERS],
];

/**
 * Checks the table is sane: contiguous, filling 0..1023 exactly, and every
 * deterministic category wide enough for its formula. Returns the problems
 * rather than throwing, so a bad edit degrades to a loud console error instead
 * of a white screen.
 */
export function validateSlotRanges(): string[] {
  const problems: string[] = [];
  const entries = Object.entries(SLOT_RANGES);
  let expected = 0;
  for (const [name, r] of entries) {
    if (r.start !== expected) {
      problems.push(`${name} starts at ${r.start}, expected ${expected} (gap or overlap)`);
    }
    if (r.end < r.start) problems.push(`${name} ends before it starts`);
    expected = r.end + 1;
  }
  if (expected !== 1024) problems.push(`ranges cover ${expected} slots, expected exactly 1024`);
  for (const [name, tiers] of DETERMINISTIC) {
    const need = tiers * 3;
    if (slotRangeSize(name) < need) {
      problems.push(`${name} has ${slotRangeSize(name)} slots but its formula needs ${need}`);
    }
  }
  return problems;
}

const _problems = validateSlotRanges();
if (_problems.length > 0) {
  console.error('[AtlasSlots] SLOT_RANGES is invalid, textures will be drawn into the wrong slots:', _problems);
}
