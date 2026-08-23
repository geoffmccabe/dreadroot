/**
 * GPU cost probe. Diagnostics only — changes nothing unless asked.
 *
 * A 32 ms GPU frame with roughly 1.24M triangles is far more than the geometry
 * should cost on its own, which points at FILL RATE (shading pixels) rather
 * than vertex work. Those two have completely different fixes, and picking the
 * wrong one means a large refactor that buys nothing:
 *
 *   fill-rate bound  -> overdraw. A depth pre-pass, or fewer overlapping
 *                       surfaces, is the fix. Resolution matters a lot.
 *   geometry bound   -> triangle count. Greedy meshing / per-face culling is
 *                       the fix. Resolution barely matters.
 *
 * The test separates them in one step. Halving the render scale quarters the
 * pixels shaded while leaving the triangle count identical:
 *
 *     __gpu.scale(0.5)   then read "GPU time" in a D-Flow report
 *     __gpu.scale(1)     restore
 *
 *   GPU time falls roughly 3-4x  -> fill-rate bound.
 *   GPU time barely moves        -> geometry bound.
 *
 * This is a MEASUREMENT, not a proposed fix: it deliberately lowers image
 * quality while active, and is not something to ship on.
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

let renderScale = 1;
let apply: (() => void) | null = null;

export function GpuProbe(): null {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);

  useEffect(() => {
    apply = () => {
      // Base is dpr 1 (set on the Canvas); the probe scales from there.
      gl.setPixelRatio(renderScale);
      gl.setSize(size.width, size.height, false);
    };
    apply();
    return () => { apply = null; };
  }, [gl, size.width, size.height]);

  return null;
}

if (typeof window !== 'undefined') {
  const w = window as unknown as { __gpu?: Record<string, unknown> };
  w.__gpu = w.__gpu || {};
  w.__gpu.scale = (n: number) => {
    renderScale = Math.max(0.25, Math.min(2, Number(n) || 1));
    apply?.();
    return `render scale ${renderScale} — take a D-Flow report and compare "GPU time". `
      + 'Big drop = fill-rate bound (overdraw). Little change = geometry bound (triangles).';
  };
  w.__gpu.scaleNow = () => renderScale;
}
