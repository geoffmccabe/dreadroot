// Performance Stall Observers - Detects long tasks, event loop lag, and GC stalls
// Used by D-Flow diagnostics to identify main-thread blocks
import { diagnostics } from '@/lib/diagnosticsLogger';

let started = false;
let stopFns: Array<() => void> = [];

export function startPerfStallObservers() {
  if (started) return;
  started = true;

  // 1) Long Task API (Chrome, Edge) - detects main thread blocks > 50ms
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as any[]) {
          // entry.duration is ms the main thread was blocked
          diagnostics.recordLongTask(entry.duration || 0);
        }
      });
      obs.observe({ entryTypes: ['longtask'] as any });
      stopFns.push(() => obs.disconnect());
    } catch {
      // Ignore if unsupported (Safari)
    }
  }

  // 2) Event-loop lag detector (cheap interval drift)
  // This detects pauses even when longtask API is unavailable
  let last = performance.now();
  const interval = setInterval(() => {
    const now = performance.now();
    const expected = last + 250;
    const lag = now - expected;
    last = now;

    // Ignore small drift; log big stalls (>30ms beyond expected)
    if (lag > 30) diagnostics.recordEventLoopLag(lag);
  }, 250);

  stopFns.push(() => clearInterval(interval));
}

export function stopPerfStallObservers() {
  for (const fn of stopFns) fn();
  stopFns = [];
  started = false;
}
