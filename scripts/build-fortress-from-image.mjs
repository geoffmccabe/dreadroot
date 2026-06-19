// Image -> fortress voxel builder (first-slice pipeline).
//
// Decodes an image with sharp, treats it as a FRONT ELEVATION: each column's
// silhouette top sets the wall height there (peaks/crenellations), brightness is
// quantized to 5 grey stone tiers (white->black). The profile is wrapped around all
// 4 walls and the interior is hollowed (walls of thickness T). Emits seeding SQL.
//
// Usage:
//   node scripts/build-fortress-from-image.mjs --synthetic           # validate logic, no image
//   node scripts/build-fortress-from-image.mjs --img public/x.webp --d 40 --t 2 \
//        --cx 0 --cz -20 --world <world_id> --user <user_id> --out scripts/out.sql
//
// Layout: diameter D (square). Fortress footprint F = round(0.6*D), 20% courtyard
// each side. Heights derived from the image aspect so it isn't stretched.

import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]]);
    return acc;
  }, [])
);

const D = Number(args.d ?? 40);
const T = Number(args.t ?? 2);
const CX = Number(args.cx ?? 0);
const CZ = Number(args.cz ?? -20);
const BASE_Y = Number(args.basey ?? 0);
const GREY_LEVELS = 5;
const F = Math.round(0.6 * D);

// Grey block keys, lightest (tier 1) -> darkest (tier 5).
const TIER_KEY = ['fortress_g1', 'fortress_g2', 'fortress_g3', 'fortress_g4', 'fortress_g5'];

// --- 1. obtain a grayscale grid (gray 0..1) + present mask, F columns x H rows ---
async function loadGrid() {
  if (args.synthetic) {
    // A castle elevation: flat curtain wall with a tall central peak + corner towers
    // + crenellations, shaded lighter at top. Validates the whole pipeline offline.
    const H = Math.round(F * 0.6);
    const gray = [], present = [];
    for (let r = 0; r < H; r++) {
      gray[r] = []; present[r] = [];
      for (let c = 0; c < F; c++) {
        const yFromBottom = H - 1 - r;
        const u = c / (F - 1);                  // 0..1 across
        // silhouette top height for this column:
        const wall = H * 0.55;                   // base curtain wall
        const peak = H * 0.95 * Math.exp(-((u - 0.5) ** 2) / 0.01); // central peak
        const towers = (u < 0.12 || u > 0.88) ? H * 0.8 : 0;        // corner towers
        let top = Math.max(wall, peak, towers);
        // crenellations on the curtain wall top
        if (Math.abs(yFromBottom - wall) < H * 0.05 && Math.floor(c / 2) % 2 === 0) top += H * 0.05;
        const isPresent = yFromBottom <= top;
        present[r][c] = isPresent;
        // shading: lighter toward the top
        gray[r][c] = isPresent ? 0.45 + 0.5 * (yFromBottom / H) : 1.0;
      }
    }
    return { gray, present, H };
  }

  const imgPath = args.img;
  if (!imgPath) throw new Error('Provide --img <path> or --synthetic');
  const meta = await sharp(imgPath).metadata();
  const H = Math.max(1, Math.round(F * (meta.height / meta.width)));
  const { data, info } = await sharp(imgPath)
    .resize(F, H, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels; // 4 (RGBA)
  const gray = [], present = [];
  // Background detection: if alpha varies, use it; else decide by corner brightness.
  let alphaVaries = false;
  for (let i = 3; i < data.length; i += ch) if (data[i] < 200) { alphaVaries = true; break; }
  const corners = [0, F - 1, (H - 1) * F, (H - 1) * F + (F - 1)].map((p) => {
    const o = p * ch; return (data[o] + data[o + 1] + data[o + 2]) / (3 * 255);
  });
  const cornerAvg = corners.reduce((a, b) => a + b, 0) / corners.length;
  const bgIsDark = cornerAvg < 0.5; // structure is the BRIGHT pixels if bg dark
  for (let r = 0; r < H; r++) {
    gray[r] = []; present[r] = [];
    for (let c = 0; c < F; c++) {
      const o = (r * F + c) * ch;
      const b = (data[o] + data[o + 1] + data[o + 2]) / (3 * 255);
      const a = data[o + 3] / 255;
      gray[r][c] = b;
      present[r][c] = alphaVaries ? a > 0.5 : (bgIsDark ? b > 0.30 : b < 0.70);
    }
  }
  return { gray, present, H };
}

const brightnessToTier = (b) => {
  // white(1)->tier1 ... black(0)->tier5
  const t = Math.round((1 - b) * (GREY_LEVELS - 1)) + 1;
  return Math.min(GREY_LEVELS, Math.max(1, t));
};

(async () => {
  const { gray, present, H } = await loadGrid();

  // --- 2. per-column top height (topmost present pixel) ---
  const topH = new Array(F).fill(0);
  for (let c = 0; c < F; c++) {
    for (let r = 0; r < H; r++) {
      if (present[r][c]) { topH[c] = H - r; break; } // H-r = height from bottom
    }
  }

  // --- 3. build ring (fill footprint up to profile, hollow interior of thickness T) ---
  const blocks = []; // {x,y,z,tier}
  const tierCount = [0, 0, 0, 0, 0, 0];
  for (let gx = 0; gx < F; gx++) {
    for (let gz = 0; gz < F; gz++) {
      const dist = Math.min(gx, F - 1 - gx, gz, F - 1 - gz);
      if (dist >= T) continue; // interior subtracted
      // which wall(s) -> column along that wall; corner = tallest wins (and drives grey)
      let h = 0, col = gx, fromX = true;
      const consider = (cand, candCol, candFromX) => {
        if (cand > h) { h = cand; col = candCol; fromX = candFromX; }
      };
      if (gx < T) consider(topH[gz], gz, false);            // left wall (runs along z)
      if (F - 1 - gx < T) consider(topH[gz], gz, false);    // right wall
      if (gz < T) consider(topH[gx], gx, true);             // front wall (runs along x)
      if (F - 1 - gz < T) consider(topH[gx], gx, true);     // back wall
      const wx = CX - Math.floor(F / 2) + gx;
      const wz = CZ - Math.floor(F / 2) + gz;
      for (let y = 0; y < h; y++) {
        const row = H - 1 - y;                 // image row for this height
        const b = (row >= 0 && row < H) ? gray[row][col] : 0.5;
        const tier = brightnessToTier(b);
        blocks.push({ x: wx, y: BASE_Y + y, z: wz, tier });
        tierCount[tier]++;
      }
    }
  }

  // --- preview + stats ---
  console.log(`Layout: D=${D} -> footprint F=${F}, wall thickness T=${T}, image rows H=${H}`);
  console.log(`Top profile (cols): min=${Math.min(...topH)} max=${Math.max(...topH)}`);
  console.log(`TOTAL blocks: ${blocks.length}  per tier(1..5): ${tierCount.slice(1).join(', ')}`);
  // ASCII front silhouette (downsampled to <=60 cols)
  const step = Math.max(1, Math.ceil(F / 60));
  let preview = '';
  const maxH = Math.max(...topH, 1);
  for (let yy = maxH; yy > 0; yy -= Math.max(1, Math.ceil(maxH / 20))) {
    for (let c = 0; c < F; c += step) preview += topH[c] >= yy ? '#' : ' ';
    preview += '\n';
  }
  console.log('Front silhouette preview:\n' + preview);

  // --- SQL (grouped per tier) ---
  if (args.out && args.world && args.user) {
    const byTier = [[], [], [], [], [], []];
    for (const b of blocks) byTier[b.tier].push(`(${b.x},${b.y},${b.z})`);
    let sql = `-- Image fortress: ${blocks.length} blocks. world=${args.world}\n`;
    for (let t = 1; t <= GREY_LEVELS; t++) {
      if (!byTier[t].length) continue;
      sql += `INSERT INTO placed_blocks (world_id,user_id,block_type,position_x,position_y,position_z)\n`;
      sql += `SELECT '${args.world}'::uuid,'${args.user}'::uuid,'${TIER_KEY[t - 1]}',v.x,v.y,v.z\n`;
      sql += `FROM (VALUES ${byTier[t].map((p) => p.replace('(', '(').replace(')', ')')).join(',')}) AS v(x,y,z)\n`;
      sql += `ON CONFLICT (world_id,position_x,position_y,position_z) DO NOTHING;\n`;
    }
    writeFileSync(args.out, sql);
    console.log(`Wrote SQL -> ${args.out} (${(sql.length / 1024).toFixed(0)} KB)`);
  } else {
    console.log('(no SQL written — pass --out --world --user to emit seeding SQL)');
  }
})();
