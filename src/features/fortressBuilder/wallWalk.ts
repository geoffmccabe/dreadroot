// Wall-walk + stairs for the procedural fortress builder.
//
// Only meaningful when the wall thickness T >= 3 (the walkable interior width is T-2:
// one block of outer skin + one of inner skin are kept as parapets/walls).
//
// Wall-walk: an OPEN-TOPPED (no roof) walkway carved into the top of the walls. Its floor
// sits at the lowest point of the top edge around the whole perimeter ("the lowest hole"),
// so the ring is continuous all the way around. The outer and inner skins are left intact
// as the parapets; where the silhouette dips low you can look out/down over them.
//
// Stairs: a 2-wide flight that climbs 1-up-1-along the INNER face of the walls, hugging the
// courtyard just inboard of any inner extrusions, spiralling 90 degrees at the corners if a
// single wall isn't tall enough. At the top it forms a 2x3 landing and punches a door
// through the inner skin onto the walk.

export interface WallWalkCtx {
  F: number;                  // footprint size (F x F blocks)
  T: number;                  // wall thickness
  half: number;              // footprint -> local offset (floor(F/2))
  levels: number;            // grey tier count (for picking a block tier)
  topH: number[][];          // [wall 0..3][col 0..F-1] -> wall height in blocks
  innerProt: number;         // deepest inward extrusion (>= 0)
  // (w, column, depth) -> footprint (gx, gz). depth 0 = outer face, T-1 = inner face.
  coordFor: (w: number, col: number, d: number) => [number, number];
  place: (lx: number, y: number, lz: number, tier: number, light?: number) => void;
  removeAt: (lx: number, y: number, lz: number) => void;
}

interface RingCell { gx: number; gz: number; px: number; pz: number; } // px,pz = inward (into courtyard) unit

export function addWallWalk(ctx: WallWalkCtx): void {
  const { F, T, half, levels, topH, innerProt, coordFor, place, removeAt } = ctx;
  if (T < 3) return;
  const G = (g: number) => g - half; // footprint -> local coord
  const tier = Math.min(3, levels);

  // --- 1) Floor level = the lowest top edge around the perimeter. ---
  let topMin = Infinity;
  for (let w = 0; w < 4; w++) {
    for (let col = 0; col < F; col++) {
      const h = topH[w][col];
      if (h > 0 && h < topMin) topMin = h;
    }
  }
  if (!isFinite(topMin) || topMin < 3) return; // too short to carve a walk
  const walkSurface = topMin - 1;   // you stand here (feet at this Y)
  const floorY = walkSurface - 1;   // the solid floor block layer

  // --- 2) Carve the interior (d = 1..T-2) open above the floor → roofless walkway. ---
  for (let w = 0; w < 4; w++) {
    for (let col = 0; col < F; col++) {
      const h = topH[w][col];
      if (h <= walkSurface) continue;
      for (let d = 1; d <= T - 2; d++) {
        const [gx, gz] = coordFor(w, col, d);
        for (let y = walkSurface; y < h; y++) removeAt(G(gx), y, G(gz));
      }
    }
  }

  // --- 3) Continuous floor ring at floorY (repairs gaps from short columns / recesses). ---
  for (let w = 0; w < 4; w++) {
    for (let col = 0; col < F; col++) {
      if (topH[w][col] <= 0) continue;
      for (let d = 0; d <= T - 1; d++) {
        const [gx, gz] = coordFor(w, col, d);
        place(G(gx), floorY, G(gz), tier);
      }
    }
  }

  // --- 4) Switchback stairs hugging the inner courtyard edge, climbing to walkSurface. ---
  const B = T + innerProt;          // first courtyard ring inboard of walls + inner extrusions
  if (F - 1 - B - B < 2) return;    // courtyard too small for stairs (walk still built)

  // Build the inner ring at inset `b`, ordered front-left → along left, back, right, front.
  // Each cell carries the inward (into-courtyard) perpendicular so the 2nd stair-width and
  // the door always extend toward the courtyard, never into the wall.
  const ringAt = (b: number): RingCell[] => {
    const hi = F - 1 - b;
    if (hi - b < 1) return [];
    const ring: RingCell[] = [];
    for (let gz = b; gz <= hi; gz++) ring.push({ gx: b, gz, px: 1, pz: 0 });        // left wall, travel +z, inward +x
    for (let gx = b + 1; gx <= hi; gx++) ring.push({ gx, gz: hi, px: 0, pz: -1 });   // back wall, travel +x, inward -z
    for (let gz = hi - 1; gz >= b; gz--) ring.push({ gx: hi, gz, px: -1, pz: 0 });   // right wall, travel -z, inward -x
    for (let gx = hi - 1; gx >= b + 1; gx--) ring.push({ gx, gz: b, px: 0, pz: 1 }); // front wall, travel -x, inward +z
    return ring;
  };

  const placeStep = (c: RingCell, h: number) => {
    // 2-wide solid step (the cell + its inward neighbour), filled down to the ground.
    for (let y = 0; y < h; y++) {
      place(G(c.gx), y, G(c.gz), tier);
      place(G(c.gx + c.px), y, G(c.gz + c.pz), tier);
    }
  };

  let height = 1;
  let last: RingCell | null = null;
  let b = B;
  // Spiral inward one lap at a time until we reach the walk surface (or run out of room).
  while (height <= walkSurface && F - 1 - b - b >= 1) {
    const ring = ringAt(b);
    if (ring.length === 0) break;
    for (const c of ring) {
      if (height > walkSurface) break;
      placeStep(c, height);
      last = c;
      height++;
    }
    b += 2; // next lap hugs 2 blocks further in (stair width) so flights don't overlap
  }
  if (!last) return;

  // --- 5) Top landing (2x3) + door punched through the inner skin onto the walk. ---
  // Along-wall axis is perpendicular to the inward direction (px,pz).
  const alongX = last.pz !== 0 ? 1 : 0; // back/front walls run along X
  const alongZ = last.px !== 0 ? 1 : 0; // left/right walls run along Z
  for (let s = -1; s <= 1; s++) {        // 3 cells along the wall
    for (let dlt = 0; dlt <= 1; dlt++) { // 2 cells into the courtyard (landing depth)
      const gx = last.gx + alongX * s + last.px * dlt;
      const gz = last.gz + alongZ * s + last.pz * dlt;
      place(G(gx), floorY, G(gz), tier); // flush landing at the walk floor
    }
    // Door: clear the inner skin (+ any inner extrusions) from the landing into the walk,
    // 2 blocks tall, so you can step from the landing onto the walkway.
    for (let k = 1; k <= innerProt + 1; k++) {
      const gx = last.gx + alongX * s - last.px * k;
      const gz = last.gz + alongZ * s - last.pz * k;
      removeAt(G(gx), walkSurface, G(gz));
      removeAt(G(gx), walkSurface + 1, G(gz));
    }
  }
}
