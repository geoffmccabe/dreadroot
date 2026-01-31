/**
 * Centralized Frame Loop Registry
 * 
 * Instead of having 11+ separate useFrame hooks (each with R3F overhead),
 * components register their update functions here and a single master
 * useFrame calls them all.
 * 
 * This dramatically reduces R3F scheduler overhead.
 */

type FrameCallback = (delta: number, elapsedTime: number) => void;

interface RegisteredCallback {
  id: string;
  callback: FrameCallback;
  priority: number; // Lower = runs first
}

class FrameLoopRegistry {
  private callbacks: RegisteredCallback[] = [];
  private sorted = true;
  
  /**
   * Register a frame callback
   * @param id Unique identifier for this callback
   * @param callback The function to call each frame
   * @param priority Lower priority runs first (default 50)
   * @returns Unregister function
   */
  register(id: string, callback: FrameCallback, priority = 50): () => void {
    // Remove existing callback with same id
    this.unregister(id);
    
    this.callbacks.push({ id, callback, priority });
    this.sorted = false;
    
    return () => this.unregister(id);
  }
  
  /**
   * Unregister a callback by id
   */
  unregister(id: string): void {
    const index = this.callbacks.findIndex(c => c.id === id);
    if (index !== -1) {
      // Swap with last and pop (faster than splice)
      this.callbacks[index] = this.callbacks[this.callbacks.length - 1];
      this.callbacks.pop();
      this.sorted = false;
    }
  }
  
  // Per-callback timing for diagnostics
  private callbackTimes: Map<string, number> = new Map();

  /**
   * Run all registered callbacks
   * Called from the single master useFrame hook
   */
  tick(delta: number, elapsedTime: number): void {
    // Sort by priority if needed (rare - only after register/unregister)
    if (!this.sorted) {
      this.callbacks.sort((a, b) => a.priority - b.priority);
      this.sorted = true;
    }

    // F1: Update diagnostic counter with current callback count
    // Import would create circular dependency, so access via window
    const diag = (window as any).__d;
    if (diag) {
      diag.frameLoopCallbacks = this.callbacks.length;
    }

    // Call all callbacks with optional timing
    const shouldTime = diag?.enabled;
    for (let i = 0; i < this.callbacks.length; i++) {
      const cb = this.callbacks[i];
      if (shouldTime) {
        const start = performance.now();
        cb.callback(delta, elapsedTime);
        const elapsed = performance.now() - start;
        this.callbackTimes.set(cb.id, (this.callbackTimes.get(cb.id) || 0) + elapsed);
      } else {
        cb.callback(delta, elapsedTime);
      }
    }
  }

  /**
   * Get timing report for diagnostics
   */
  getTimingReport(): { id: string; time: number }[] {
    const report = Array.from(this.callbackTimes.entries())
      .map(([id, time]) => ({ id, time }))
      .sort((a, b) => b.time - a.time);
    return report;
  }

  /**
   * Reset timing data
   */
  resetTiming(): void {
    this.callbackTimes.clear();
  }
  
  /**
   * Get count of registered callbacks (for diagnostics)
   */
  get count(): number {
    return this.callbacks.length;
  }
}

// Singleton instance
export const frameLoop = new FrameLoopRegistry();

// Expose to window for diagnostics access
(window as any).frameLoop = frameLoop;
