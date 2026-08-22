/**
 * Watches for the browser taking the GPU away from us.
 *
 * Symptom this exists for (Geoff, 2026-Aug-21): the game is running fine, the
 * screen goes flat grey, SOUND KEEPS PLAYING, moving does nothing, and some
 * time later it comes back by itself. That is a lost WebGL context: the page
 * loses its GPU, so nothing renders, while game logic and audio carry on
 * underneath. It is not a crash and not an empty world.
 *
 * Until now this happened SILENTLY — no console message, nothing in the
 * diagnostics, nothing in a trace. An invisible failure is the worst kind,
 * because every guess about it is unfalsifiable.
 *
 * Two jobs:
 *   1. Make it loud: log it, timestamp it, and record how long the blackout
 *      lasted, so "did it happen?" stops being a matter of opinion.
 *   2. Call preventDefault on the loss event. The browser only ATTEMPTS to
 *      restore a context if the page asks it to; three.js does this for its
 *      own renderer, and this guarantees it regardless.
 *
 * Read the history from the console at any time with `__gpu.history()`.
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

interface GpuEvent {
  at: string;
  kind: 'lost' | 'restored' | 'page-hidden' | 'page-visible';
  /** For a restore, how long the screen was dead, in seconds. */
  blackoutSeconds?: number;
  /** Rough memory at the moment, to correlate with pressure. */
  heapMB?: number;
}

const history: GpuEvent[] = [];
let lostAt = 0;

function heapMB(): number | undefined {
  const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
  return perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1048576) : undefined;
}

export function WebGLContextWatch(): null {
  const gl = useThree((s) => s.gl);

  // ── Page visibility ──────────────────────────────────────────────────────
  // Measured cause of the 2026-Aug-21 grey screens, from Geoff's trace: the
  // page was marked HIDDEN by the browser at 307.8s and 343.6s, and became
  // visible again at 325.7s and 369.1s. Those windows match the blackouts to
  // a tenth of a second.
  //
  // Browsers stop requestAnimationFrame completely for a hidden page. This
  // game drives BOTH rendering and its whole simulation from rAF, so when the
  // page is hidden: nothing draws (grey), nothing simulates (no monsters
  // spawn), but audio and timers carry on — which is exactly the reported
  // symptom, including still being able to hear it.
  //
  // A page can be marked hidden without the user switching tabs: another
  // window fully covering it counts as occluded, and under heavy system
  // memory pressure the browser may also release the tab's drawing surface,
  // which is what leaves flat grey rather than the last frame.
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = (): void => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        history.push({ at: new Date().toISOString(), kind: 'page-hidden', heapMB: heapMB() });
        console.warn(
          '[RENDER] The browser marked this page HIDDEN. Animation frames stop while hidden, ' +
          'so nothing will draw and the simulation pauses (no monster spawns) until it is ' +
          'visible again. Sound keeps playing. Causes: switching tab or app, another window ' +
          'fully covering this one, or the system reclaiming the drawing surface under memory pressure.',
        );
      } else {
        const secs = hiddenAt ? (Date.now() - hiddenAt) / 1000 : undefined;
        history.push({ at: new Date().toISOString(), kind: 'page-visible', blackoutSeconds: secs, heapMB: heapMB() });
        console.warn(`[RENDER] Page visible again after ${secs?.toFixed(1) ?? '?'}s hidden — rendering resumes.`);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    const canvas = gl?.domElement;
    if (!canvas) return;

    const onLost = (e: Event): void => {
      // REQUIRED: without this the browser will not try to give the context
      // back, and the grey screen would be permanent rather than temporary.
      e.preventDefault();
      lostAt = Date.now();
      const ev: GpuEvent = { at: new Date().toISOString(), kind: 'lost', heapMB: heapMB() };
      history.push(ev);
      console.error(
        '[GPU] WebGL CONTEXT LOST — the browser took the GPU away. The screen will be grey ' +
        'until it is returned; sound and game logic keep running. ' +
        `JS heap at the time: ${ev.heapMB ?? '?'} MB. This is usually memory pressure.`,
      );
    };

    const onRestored = (): void => {
      const secs = lostAt ? (Date.now() - lostAt) / 1000 : undefined;
      history.push({ at: new Date().toISOString(), kind: 'restored', blackoutSeconds: secs, heapMB: heapMB() });
      console.warn(`[GPU] WebGL context RESTORED after ${secs?.toFixed(1) ?? '?'}s of grey screen.`);
    };

    canvas.addEventListener('webglcontextlost', onLost as EventListener, false);
    canvas.addEventListener('webglcontextrestored', onRestored as EventListener, false);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost as EventListener);
      canvas.removeEventListener('webglcontextrestored', onRestored as EventListener);
    };
  }, [gl]);

  return null;
}

if (typeof window !== 'undefined') {
  (window as unknown as { __gpu: unknown }).__gpu = {
    history: () => history.slice(),
    /** Is the browser currently willing to draw this page at all? */
    visible: () => (typeof document !== 'undefined' ? document.visibilityState : 'unknown'),
    /** Deliberately drop the context, to prove recovery works. */
    forceLose: () => {
      const c = document.querySelector('canvas') as HTMLCanvasElement | null;
      const ctx = c?.getContext('webgl2') ?? c?.getContext('webgl');
      const ext = (ctx as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context');
      if (!ext) return 'could not reach the lose-context extension';
      ext.loseContext();
      setTimeout(() => ext.restoreContext(), 2000);
      return 'context dropped; restoring in 2s — watch the console';
    },
  };
}
