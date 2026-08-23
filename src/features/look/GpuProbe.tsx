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
import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { diagnostics } from '@/lib/diagnosticsLogger';

let renderScale = 1;
let apply: (() => void) | null = null;

/** Result of the automatic bottleneck test. */
export interface GpuVerdict {
  ran: boolean;
  fullMs: number;
  halfMs: number;
  ratio: number;
  /** 'fill' | 'geometry' | 'mixed' | 'unknown' */
  bound: string;
  summary: string;
}
let verdict: GpuVerdict = {
  ran: false, fullMs: 0, halfMs: 0, ratio: 0, bound: 'unknown',
  summary: 'not measured yet',
};
export function gpuVerdict(): GpuVerdict { return verdict; }

// Phases: settle at full res, sample, settle at half res, sample, restore.
const SETTLE_FRAMES = 25;
const SAMPLE_FRAMES = 45;

export function GpuProbe(): null {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const phase = useRef(0);       // 0 wait, 1 settle-full, 2 sample-full, 3 settle-half, 4 sample-half, 5 done
  const n = useRef(0);
  const acc = useRef(0);
  const cnt = useRef(0);
  const startAt = useRef(0);

  useEffect(() => {
    apply = () => {
      // Base is dpr 1 (set on the Canvas); the probe scales from there.
      gl.setPixelRatio(renderScale);
      gl.setSize(size.width, size.height, false);
    };
    apply();
    return () => { apply = null; };
  }, [gl, size.width, size.height]);

  /**
   * Runs ITSELF, once, a few seconds after the world settles. Nothing to type.
   *
   * The half-resolution half of the test lasts about a second and is visibly
   * softer while it runs; it restores itself immediately afterwards. That is
   * the cost of learning, without a rewrite, whether the GPU is spending its
   * time on pixels or on triangles.
   */
  useFrame(() => {
    if (phase.current === 5) return;
    const rt = diagnostics.getRenderTimingStats();
    if (!rt.gpuSupported) return;   // no hardware timer -> cannot measure

    if (phase.current === 0) {
      if (startAt.current === 0) startAt.current = Date.now();
      // Let chunk streaming finish before measuring, or the numbers are noise.
      if (Date.now() - startAt.current < 8000) return;
      phase.current = 1; n.current = 0; return;
    }

    if (phase.current === 1 || phase.current === 3) {
      if (++n.current < SETTLE_FRAMES) return;
      n.current = 0; acc.current = 0; cnt.current = 0;
      phase.current += 1;
      return;
    }

    acc.current += rt.gpuMs; cnt.current += 1;
    if (cnt.current < SAMPLE_FRAMES) return;
    const mean = acc.current / cnt.current;

    if (phase.current === 2) {
      verdict.fullMs = +mean.toFixed(2);
      renderScale = 0.5; apply?.();
      n.current = 0; phase.current = 3;
      return;
    }

    // phase 4 — finished
    verdict.halfMs = +mean.toFixed(2);
    renderScale = 1; apply?.();
    phase.current = 5;

    const r = verdict.halfMs > 0 ? verdict.fullMs / verdict.halfMs : 0;
    verdict.ratio = +r.toFixed(2);
    verdict.ran = true;
    // Quartering the pixels while keeping every triangle: a big drop means the
    // cost is per-pixel (overdraw), a small one means it is per-triangle.
    if (r >= 2.5) {
      verdict.bound = 'fill';
      verdict.summary = `FILL-RATE bound — GPU ${verdict.fullMs}ms -> ${verdict.halfMs}ms at quarter the pixels (${verdict.ratio}x). `
        + 'The cost is shading the same pixels repeatedly (overdraw), not triangle count. '
        + 'A depth pre-pass is the fix: no visual change, no geometry rewrite.';
    } else if (r <= 1.5) {
      verdict.bound = 'geometry';
      verdict.summary = `GEOMETRY bound — GPU ${verdict.fullMs}ms -> ${verdict.halfMs}ms at quarter the pixels (${verdict.ratio}x). `
        + 'Resolution barely matters, so the cost is triangle count. '
        + 'Greedy meshing / per-face culling is the fix; a depth pre-pass would not help.';
    } else {
      verdict.bound = 'mixed';
      verdict.summary = `MIXED — GPU ${verdict.fullMs}ms -> ${verdict.halfMs}ms at quarter the pixels (${verdict.ratio}x). `
        + 'Both overdraw and triangle count contribute; the depth pre-pass is the cheaper first move.';
    }
  });

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
  w.__gpu.verdict = () => verdict;
}
