// brushShapes — the dig-tool shapes. Each shape provides:
//   • shapeT(lx,lz,r): normalized distance in BRUSH-LOCAL space (0 = center, 1 = edge,
//     >1 = outside) so edge-blur falloff works for any shape.
//   • ext: half-extent multipliers (×radius) for the iteration bounds.
//   • outline(r): a flat line-loop (x,z points) for the on-ground indicator.
// Shapes are oriented to the player's facing (yaw) so a long rectangle digs a trench in
// the direction you look, a wedge points away from you, etc.

export type BrushShape = 'circle' | 'oval' | 'rect2' | 'rect10' | 'wedge';

export const BRUSH_SHAPES: { id: BrushShape; label: string }[] = [
  { id: 'circle', label: '● Circle' },
  { id: 'oval',   label: '⬭ Oval' },
  { id: 'rect2',  label: '▬ Rect 1×2' },
  { id: 'rect10', label: '━ Rect 1×10' },
  { id: 'wedge',  label: '◤ Wedge' },
];

// half-extents in radius units (x = across, z = along facing)
const EXT: Record<BrushShape, { x: number; z: number }> = {
  circle: { x: 1, z: 1 },
  oval:   { x: 1, z: 0.35 },
  rect2:  { x: 0.55, z: 1.1 },
  rect10: { x: 0.22, z: 2.2 },
  wedge:  { x: 1, z: 1.4 },
};

export const shapeExtent = (shape: BrushShape) => EXT[shape];

/** Normalized distance for a brush-local point (lx across, lz along). r = brush radius. */
export function shapeT(shape: BrushShape, lx: number, lz: number, r: number): number {
  const e = EXT[shape];
  const ax = e.x * r, az = e.z * r;
  switch (shape) {
    case 'circle':
    case 'oval':
      return Math.hypot(lx / ax, lz / az);
    case 'rect2':
    case 'rect10':
      return Math.max(Math.abs(lx) / ax, Math.abs(lz) / az);
    case 'wedge': {
      // Triangle: apex behind the player (lz = -az), widening to the front base (lz = +az).
      const u = (lz + az) / (2 * az);            // 0 at apex, 1 at base
      if (u < 0 || u > 1) return 2;
      const halfW = ax * u;
      return Math.max(Math.abs(lx) / (halfW + 1e-3), Math.abs(2 * u - 1));
    }
  }
}

/** Flat outline points (local x,z at radius r) for the ground indicator (line loop). */
export function shapeOutline(shape: BrushShape, r: number): number[] {
  const e = EXT[shape];
  const ax = e.x * r, az = e.z * r;
  const pts: number[] = [];
  if (shape === 'circle' || shape === 'oval') {
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push(Math.cos(a) * ax, 0, Math.sin(a) * az);
    }
  } else if (shape === 'wedge') {
    pts.push(0, 0, -az, ax, 0, az, -ax, 0, az);   // triangle
  } else { // rectangles
    pts.push(-ax, 0, -az, ax, 0, -az, ax, 0, az, -ax, 0, az);
  }
  return pts;
}
