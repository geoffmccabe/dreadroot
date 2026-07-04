// Turns a flood-fill footprint (floodFill.ts) into ONE smooth, continuous water-surface geometry.
//
// The first version emitted an overlapping quad per grid-row: coplanar transparent strips that
// double-blended into visible horizontal stripes, with raw 90° cell steps at the shore. This traces
// the filled region's outline instead, rounds it with Chaikin corner-cutting (so a 0.5 m stair-step
// shore reads as a smooth curve), and triangulates the whole thing as a single Shape — no overlaps
// (no stripes), soft edges. Vertices are world XZ at y=0; the caller renders at the water level so the
// surface can be raised/lowered live. Falls back to a shared-vertex grid mesh if tracing ever fails.
import * as THREE from 'three';
import type { FloodData } from './floodFill';

const CHAIKIN_PASSES = 2;   // corner-cutting rounds off the grid stair-steps (2 = smooth, minimal shrink)

type Pt = [number, number];

export function buildFloodGeometry(d: FloodData): THREE.BufferGeometry | null {
  const fill = rebuildGrid(d);
  let loops: Pt[][] = [];
  try { loops = traceLoops(fill, d.cols, d.rows); } catch { loops = []; }
  if (!loops.length) return buildGridFallback(d, fill);
  // Grid cells → world XZ, then smooth each closed outline.
  const world = loops.map((lp) =>
    chaikinClosed(lp.map(([c, r]) => [d.minX + c * d.cell, d.minZ + r * d.cell] as Pt), CHAIKIN_PASSES));
  const ranked = world.map((pts) => ({ pts, area: Math.abs(signedArea(pts)) })).sort((a, b) => b.area - a.area);
  try {
    const shape = new THREE.Shape(ensureWinding(ranked[0].pts, true).map(([x, z]) => new THREE.Vector2(x, z)));
    for (let i = 1; i < ranked.length; i++) {
      shape.holes.push(new THREE.Path(ensureWinding(ranked[i].pts, false).map(([x, z]) => new THREE.Vector2(x, z))));
    }
    const sg = new THREE.ShapeGeometry(shape);
    const geo = toHorizontal(sg);
    sg.dispose();
    return geo;
  } catch {
    return buildGridFallback(d, fill);
  }
}

// --- footprint → grid ---
function rebuildGrid(d: FloodData): Uint8Array {
  const g = new Uint8Array(d.cols * d.rows);
  for (let i = 0; i < d.runs.length; i += 3) {
    const row = d.runs[i], start = d.runs[i + 1], len = d.runs[i + 2];
    for (let c = start; c < start + len; c++) g[row * d.cols + c] = 1;
  }
  return g;
}

// --- boundary tracing: collect the directed cell-edges between filled and empty, stitch into loops ---
function traceLoops(fill: Uint8Array, cols: number, rows: number): Pt[][] {
  const W = cols + 1;
  const isFill = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && fill[r * cols + c] === 1;
  const out = new Map<number, number[]>();
  const add = (ac: number, ar: number, bc: number, br: number) => {
    const a = ar * W + ac, b = br * W + bc;
    const arr = out.get(a); if (arr) arr.push(b); else out.set(a, [b]);
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (fill[r * cols + c] !== 1) continue;
    if (!isFill(c, r - 1)) add(c, r, c + 1, r);           // top    A→B
    if (!isFill(c + 1, r)) add(c + 1, r, c + 1, r + 1);   // right  B→C
    if (!isFill(c, r + 1)) add(c + 1, r + 1, c, r + 1);   // bottom C→D
    if (!isFill(c - 1, r)) add(c, r + 1, c, r);           // left   D→A
  }
  const loops: Pt[][] = [];
  for (const startKey of Array.from(out.keys())) {
    let bucket = out.get(startKey);
    while (bucket && bucket.length) {
      const keys: number[] = [];
      let cur = startKey, guard = 0;
      while (guard++ < 1_000_000) {
        const nexts = out.get(cur);
        if (!nexts || !nexts.length) break;
        keys.push(cur);
        cur = nexts.pop() as number;
        if (cur === startKey) break;
      }
      if (keys.length >= 3) loops.push(keys.map((k) => [k % W, (k / W) | 0] as Pt));
      bucket = out.get(startKey);
    }
  }
  return loops;
}

// --- geometry helpers ---
function chaikinClosed(pts: Pt[], passes: number): Pt[] {
  let p = pts;
  for (let k = 0; k < passes; k++) {
    const n = p.length; if (n < 3) break;
    const np: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      np.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      np.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = np;
  }
  return p;
}

function signedArea(pts: Pt[]): number {
  let a = 0; const n = pts.length;
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

function ensureWinding(pts: Pt[], wantPositive: boolean): Pt[] {
  return (signedArea(pts) >= 0) === wantPositive ? pts : pts.slice().reverse();
}

// Lay the flat XY ShapeGeometry into the horizontal XZ plane at y=0, normals up.
function toHorizontal(sg: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = sg.getAttribute('position');
  const n = src.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = src.getX(i), z = src.getY(i);
    pos[i * 3] = x; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = z;
    nor[i * 3 + 1] = 1;
    uv[i * 2] = x; uv[i * 2 + 1] = z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const idx = sg.getIndex(); if (idx) g.setIndex(idx.clone());
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// Fallback: one shared-vertex mesh (deduped corners → no overlapping strips, so still no stripes),
// used only if outline tracing/triangulation fails. Blocky edges, but correct and seam-free.
function buildGridFallback(d: FloodData, fill: Uint8Array): THREE.BufferGeometry | null {
  const W = d.cols + 1;
  const idxOf = new Map<number, number>();
  const verts: number[] = [], tris: number[] = [];
  const vid = (c: number, r: number) => {
    const k = r * W + c; let id = idxOf.get(k);
    if (id === undefined) { id = verts.length / 3; verts.push(d.minX + c * d.cell, 0, d.minZ + r * d.cell); idxOf.set(k, id); }
    return id;
  };
  for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) {
    if (fill[r * d.cols + c] !== 1) continue;
    const a = vid(c, r), b = vid(c + 1, r), cc = vid(c + 1, r + 1), dd = vid(c, r + 1);
    tris.push(a, cc, b, a, dd, cc);
  }
  if (!tris.length) return null;
  const pos = new Float32Array(verts);
  const uv = new Float32Array((verts.length / 3) * 2);
  for (let i = 0; i < verts.length / 3; i++) { uv[i * 2] = pos[i * 3]; uv[i * 2 + 1] = pos[i * 3 + 2]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(tris);
  g.computeVertexNormals();
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
