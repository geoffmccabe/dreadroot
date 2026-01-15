// D-Flow Diagnostic Logger
// Zero-allocation performance diagnostic system
// Toggle with Shift+3 (#) key

const BUFFER_SIZE = 600; // 60 seconds at 10 samples/sec
const METRICS = 13; // Numbers per sample

class DiagnosticsLogger {
  enabled = false;
  buffer = new Float32Array(BUFFER_SIZE * METRICS);
  ticker = 0;
  frameCount = 0;
  useFrameCallCount = 0;
  lastSampleTime = 0;
  
  // Event counters (reset each sample)
  e1 = 0; // checkAxisCollision calls
  e2 = 0; // findStepUpTarget calls
  e3 = 0; // raycast calls
  e4 = 0; // Set allocations / chunk updates
  
  // Metrics set by components (just number assignments, no allocations)
  cameraX = 0;
  cameraY = 0;
  cameraZ = 0;
  visibleBlocks = 0;
  particleCount = 0;
  coinCount = 0;
  
  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.buffer.fill(0);
      this.ticker = 0;
      this.frameCount = 0;
      this.useFrameCallCount = 0;
      this.e1 = 0;
      this.e2 = 0;
      this.e3 = 0;
      this.e4 = 0;
      this.lastSampleTime = performance.now();
      console.log('DFLOW ON');
    } else {
      console.log('DFLOW OFF');
      this.print();
    }
  }
  
  tick() {
    if (!this.enabled) return;
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastSampleTime >= 100) {
      const i = (this.ticker % BUFFER_SIZE) * METRICS;
      const fps = (this.frameCount / (now - this.lastSampleTime)) * 1000;
      
      // Data format: ticker fps useFrameCalls camX camY camZ blocks particles coins E1 E2 E3 E4
      this.buffer[i] = this.ticker;
      this.buffer[i+1] = fps;
      this.buffer[i+2] = this.useFrameCallCount;
      this.buffer[i+3] = this.cameraX;
      this.buffer[i+4] = this.cameraY;
      this.buffer[i+5] = this.cameraZ;
      this.buffer[i+6] = this.visibleBlocks;
      this.buffer[i+7] = this.particleCount;
      this.buffer[i+8] = this.coinCount;
      this.buffer[i+9] = this.e1;
      this.buffer[i+10] = this.e2;
      this.buffer[i+11] = this.e3;
      this.buffer[i+12] = this.e4;
      
      this.ticker++;
      this.frameCount = 0;
      this.useFrameCallCount = 0;
      this.e1 = 0;
      this.e2 = 0;
      this.e3 = 0;
      this.e4 = 0;
      this.lastSampleTime = now;
    }
  }
  
  print() {
    const n = Math.min(this.ticker, BUFFER_SIZE);
    let out = '';
    for (let s = 0; s < n; s++) {
      const i = s * METRICS;
      out += this.buffer[i] + ' ' + 
             this.buffer[i+1].toFixed(0) + ' ' +
             this.buffer[i+2] + ' ' +
             this.buffer[i+3].toFixed(0) + ' ' +
             this.buffer[i+4].toFixed(0) + ' ' +
             this.buffer[i+5].toFixed(0) + ' ' +
             this.buffer[i+6] + ' ' +
             this.buffer[i+7] + ' ' +
             this.buffer[i+8] + ' ' +
             this.buffer[i+9] + ' ' +
             this.buffer[i+10] + ' ' +
             this.buffer[i+11] + ' ' +
             this.buffer[i+12] + '\n';
    }
    console.log(out);
  }
}

export const diagnostics = new DiagnosticsLogger();

// Expose globally for console access
(window as any).__d = diagnostics;
