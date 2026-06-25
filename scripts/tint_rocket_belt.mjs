// One-off: generate placeholder tier sprites for the Rocket Belt (T2–T10) by tinting the
// real T1 art (239.webp) to each tier's canonical color (src/features/shombie/constants.ts
// TIER_COLORS). sharp.tint() shifts chroma while preserving luminance + alpha, so the belt
// keeps its shape/shading and just changes color. T1 (239) is left untouched (real art).
import sharp from 'sharp';

const DIR = new URL('../public/item-sprites/', import.meta.url).pathname;
const SRC = DIR + '239.webp';

// item_number → { tint: [r,g,b], brightness? }  (tiers 2–10 → 240–248)
// Multi-color tiers (8 rainbow, 9 apocalyptic) use a distinct flat stand-in for now.
const TIERS = {
  240: { tint: [0, 255, 0] },     // T2 Uncommon - Green
  241: { tint: [0, 136, 255] },   // T3 Rare - Blue
  242: { tint: [139, 0, 255] },   // T4 Epic - Purple
  243: { tint: [255, 0, 0] },     // T5 Legendary - Red
  244: { tint: [255, 255, 255] }, // T6 Divine - White (desaturates)
  245: { tint: [255, 105, 180] }, // T7 Mystic - Pink
  246: { tint: [255, 127, 0] },   // T8 Rainbow - orange stand-in (flat can't do rainbow)
  247: { tint: [120, 0, 0], brightness: 0.5 }, // T9 Apocalyptic - dark red
  248: { tint: [255, 215, 0] },   // T10 Cosmic - Gold
};

for (const [num, cfg] of Object.entries(TIERS)) {
  let img = sharp(SRC).tint({ r: cfg.tint[0], g: cfg.tint[1], b: cfg.tint[2] });
  if (cfg.brightness) img = img.modulate({ brightness: cfg.brightness });
  await img.webp({ quality: 90 }).toFile(DIR + `${num}.webp`);
  console.log(`wrote ${num}.webp  tint=${cfg.tint}${cfg.brightness ? ` brightness=${cfg.brightness}` : ''}`);
}
console.log('done');
