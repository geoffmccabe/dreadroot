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
  // Solid corner towers already built; the walk drills a passage through each so the
  // rampart ring stays continuous. cgx/cgz = footprint corner, rad = half-width, top = height.
  parapets?: Array<{ cgx: number; cgz: number; rad: number; top: number }>;
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

  // --- 3b) Drill the walk THROUGH each corner parapet so the ring is continuous. ---
  // The tower is a solid plug; carve an L of the walk band (depth 1..T-2) reaching from
  // the corner inward along BOTH walls, leaving the outer skin, the floor below and a roof
  // above intact (a covered gateway through the tower). Heading only inward (ix/iz) means
  // we never punch a hole in the tower's outboard corner.
  if (ctx.parapets && ctx.parapets.length) {
    const PASS_H = 4; // walk-band opening height (feet + headroom)
    for (const t of ctx.parapets) {
      const X = t.cgx, Z = t.cgz;
      const ix = X === 0 ? 1 : -1;
      const iz = Z === 0 ? 1 : -1;
      const passTop = Math.min(t.top, walkSurface + PASS_H);
      if (passTop <= walkSurface) continue;
      for (let d = 1; d <= T - 2; d++) {
        const gzBand = Z + iz * d;            // slot along the X-running wall
        for (let s = 0; s <= t.rad; s++) {
          const gx = X + ix * s;
          for (let y = walkSurface; y < passTop; y++) removeAt(G(gx), y, G(gzBand));
        }
        const gxBand = X + ix * d;            // slot along the Z-running wall
        for (let s = 0; s <= t.rad; s++) {
          const gz = Z + iz * s;
          for (let y = walkSurface; y < passTop; y++) removeAt(G(gxBand), y, G(gz));
        }
      }
    }
  }

  // --- 4) Floating stairs hugging the inner courtyard edge, climbing to the walk floor. ---
  // Start 2 blocks off the wall (room for a base landing). Steps are 2-wide floating treads
  // (just the tread, NOT filled down to the ground).
  const B = T + innerProt + 2;      // first courtyard ring, 2 off the inner wall/extrusions
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

  const placeTread = (c: RingCell, ty: number) => {
    // 2-wide floating tread (the cell + its inward neighbour) at a single height.
    place(G(c.gx), ty, G(c.gz), tier);
    place(G(c.gx + c.px), ty, G(c.gz + c.pz), tier);
  };

  let ring = ringAt(B);
  if (ring.length < 2) return;
  // 2x2 base landing at ground level (two consecutive 2-wide cells) — you step onto this
  // from the courtyard, then climb.
  placeTread(ring[0], 0);
  placeTread(ring[1], 0);

  // Each tread rises 1 and advances 1 along the ring; the top tread sits at the walk floor
  // (floorY) so you step straight onto the walk — no jump up at the end.
  let ty = 1;
  let last: RingCell = ring[1];
  let lastB = B;
  let b = B;
  let idx = 2;                       // continue past the 2-cell base landing
  while (ty <= floorY && F - 1 - b - b >= 1) {
    if (idx >= ring.length) { b += 2; ring = ringAt(b); idx = 0; if (ring.length === 0) break; continue; }
    const c = ring[idx++];
    placeTread(c, ty);
    last = c; lastB = b;
    ty++;
  }

  // --- 5) Top landing + bridge/door across to the wall walk (4 blocks tall). ---
  // Along-wall axis is perpendicular to the inward direction (px,pz).
  const alongX = last.pz !== 0 ? 1 : 0; // back/front walls run along X
  const alongZ = last.px !== 0 ? 1 : 0; // left/right walls run along Z
  const gap = Math.max(1, lastB - (T - 1)); // blocks from the stair top out to the inner skin
  for (let s = -1; s <= 1; s++) {        // 3 cells along the wall
    for (let dlt = 0; dlt <= 1; dlt++) { // 2 cells into the courtyard (landing depth)
      const gx = last.gx + alongX * s + last.px * dlt;
      const gz = last.gz + alongZ * s + last.pz * dlt;
      place(G(gx), floorY, G(gz), tier); // top landing flush with the walk floor
    }
    // Bridge the gap to the wall (floor at walk level) and punch a 4-tall opening through it
    // and the inner skin so you can walk straight onto the rampart.
    for (let k = 1; k <= gap; k++) {
      const gx = last.gx + alongX * s - last.px * k;
      const gz = last.gz + alongZ * s - last.pz * k;
      place(G(gx), floorY, G(gz), tier);
      for (let h = 0; h < 4; h++) removeAt(G(gx), walkSurface + h, G(gz));
    }
  }
}
