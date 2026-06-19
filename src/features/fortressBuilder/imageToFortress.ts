// Pure image -> fortress voxel algorithm (no DOM, no THREE). Shared by the live
// in-world preview and the eventual place-on-map step. Treats the image as a FRONT
// ELEVATION: each column's silhouette top sets the wall height there (peaks/towers),
// brightness is quantized to N grey tiers (1=lightest .. N=darkest). The profile is
// wrapped around all 4 walls and the interior is hollowed to thickness T.

export interface GrayGrid {
  /** brightness 0..1, indexed [row][col]; row 0 = TOP of the image. */
  gray: number[][];
  /** structure mask (true = solid, false = background/sky), [row][col]. */
  present: boolean[][];
  W: number; // columns
  H: number; // rows
}

export interface FortressBuildOpts {
  /** Overall square diameter in blocks (20% courtyard / 60% fortress / 20%). */
  D: number;
  /** Wall thickness in blocks (1..5). */
  T: number;
  /** Multiplies the silhouette height (slider). 1 = image proportions. */
  heightScale?: number;
  /** Number of grey tiers (default 5). */
  greyLevels?: number;
}

export interface FortressVoxel {
  x: number; // local, centered on the footprint (origin at center)
  y: number; // 0 = ground
  z: number;
  tier: number; // 1..greyLevels (1 lightest, N darkest)
}

export interface FortressBuildResult {
  voxels: FortressVoxel[];
  F: number;            // fortress footprint side (blocks)
  maxHeight: number;
  tierCounts: number[]; // index 1..N
}

const tierFor = (brightness: number, levels: number): number => {
  const t = Math.round((1 - brightness) * (levels - 1)) + 1;
  return Math.min(levels, Math.max(1, t));
};

export function buildFortressVoxels(grid: GrayGrid, opts: FortressBuildOpts): FortressBuildResult {
  const { D, T } = opts;
  const heightScale = opts.heightScale ?? 1;
  const levels = opts.greyLevels ?? 5;
  const F = Math.max(1, Math.round(0.6 * D));
  const { gray, present, H } = grid;

  // The grid is assumed already resampled to F columns (W === F). If not, sample.
  const W = grid.W;
  const colAt = (gx: number) => (W === F ? gx : Math.min(W - 1, Math.floor((gx / F) * W)));

  // Per-column top height (topmost present pixel), scaled.
  const topH = new Array<number>(F).fill(0);
  for (let gx = 0; gx < F; gx++) {
    const c = colAt(gx);
    for (let r = 0; r < H; r++) {
      if (present[r][c]) { topH[gx] = Math.round((H - r) * heightScale); break; }
    }
  }

  const voxels: FortressVoxel[] = [];
  const tierCounts = new Array<number>(levels + 1).fill(0);
  const half = Math.floor(F / 2);
  let maxHeight = 0;

  for (let gx = 0; gx < F; gx++) {
    for (let gz = 0; gz < F; gz++) {
      const dist = Math.min(gx, F - 1 - gx, gz, F - 1 - gz);
      if (dist >= T) continue; // hollow interior

      // Tallest adjoining wall wins at corners, and drives the facade column.
      let h = 0, srcCol = gx;
      const consider = (cand: number, col: number) => { if (cand > h) { h = cand; srcCol = col; } };
      if (gx < T) consider(topH[gz], gz);             // left  (runs along z)
      if (F - 1 - gx < T) consider(topH[gz], gz);     // right
      if (gz < T) consider(topH[gx], gx);             // front (runs along x)
      if (F - 1 - gz < T) consider(topH[gx], gx);     // back
      if (h <= 0) continue;
      if (h > maxHeight) maxHeight = h;

      const c = colAt(srcCol);
      const lx = gx - half;
      const lz = gz - half;
      for (let y = 0; y < h; y++) {
        // image row for this height (bottom row = y 0). undo the heightScale.
        const r = Math.min(H - 1, Math.max(0, H - 1 - Math.floor(y / Math.max(heightScale, 1e-6))));
        const b = gray[r][c];
        const tier = tierFor(b, levels);
        voxels.push({ x: lx, y, z: lz, tier });
        tierCounts[tier]++;
      }
    }
  }

  return { voxels, F, maxHeight, tierCounts };
}
