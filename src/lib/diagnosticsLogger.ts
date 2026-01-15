// D-Flow Diagnostic Logger
// Zero-allocation performance diagnostic system
// Toggle with Shift+3 (#) key

const BUFFER_SIZE = 600; // 60 seconds at 10 samples/sec
const METRICS = 25; // Numbers per sample (21 + 4 timing metrics)

class DiagnosticsLogger {
  enabled = false;
  buffer = new Float32Array(BUFFER_SIZE * METRICS);
  ticker = 0;
  frameCount = 0;
  useFrameCallCount = 0;
  lastSampleTime = 0;
  startTime = 0;
  elapsedSeconds = 0;
  
  // Event counters (reset each sample) - 12 event types
  e1 = 0;  // checkAxisCollision calls
  e2 = 0;  // findStepUpTarget calls
  e3 = 0;  // raycast calls (useRaycaster)
  e4 = 0;  // Set/Map allocations or chunk updates
  e5 = 0;  // Block collider iterations (inner loop count)
  e6 = 0;  // useMemo recalculations
  e7 = 0;  // React re-renders (component mount/update)
  e8 = 0;  // Audio play calls
  e9 = 0;  // Texture operations
  e10 = 0; // Animation mixer updates
  e11 = 0; // Network/broadcast calls
  e12 = 0; // Object3D matrix updates
  
  // Frame timing (in ms, accumulated per sample)
  frameStartTime = 0;
  timeControls = 0;    // Controls/physics time
  timeCoins = 0;       // Coins update time
  timeWaterfall = 0;   // Waterfall update time
  timeBlocks = 0;      // Block rendering time
  
  // Metrics set by components (just number assignments, no allocations)
  cameraX = 0;
  cameraY = 0;
  cameraZ = 0;
  visibleBlocks = 0;
  particleCount = 0;
  coinCount = 0;
  
  startTiming() {
    if (this.enabled) this.frameStartTime = performance.now();
  }
  
  recordTiming(system: 'controls' | 'coins' | 'waterfall' | 'blocks') {
    if (!this.enabled) return;
    const elapsed = performance.now() - this.frameStartTime;
    switch (system) {
      case 'controls': this.timeControls += elapsed; break;
      case 'coins': this.timeCoins += elapsed; break;
      case 'waterfall': this.timeWaterfall += elapsed; break;
      case 'blocks': this.timeBlocks += elapsed; break;
    }
    this.frameStartTime = performance.now();
  }
  
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
      this.e5 = 0;
      this.e6 = 0;
      this.e7 = 0;
      this.e8 = 0;
      this.e9 = 0;
      this.e10 = 0;
      this.e11 = 0;
      this.e12 = 0;
      this.timeControls = 0;
      this.timeCoins = 0;
      this.timeWaterfall = 0;
      this.timeBlocks = 0;
      this.startTime = performance.now();
      this.lastSampleTime = this.startTime;
      this.elapsedSeconds = 0;
    } else {
      this.print();
    }
  }
  
  tick() {
    if (!this.enabled) return;
    this.frameCount++;
    const now = performance.now();
    this.elapsedSeconds = Math.floor((now - this.startTime) / 1000);
    if (now - this.lastSampleTime >= 100) {
      const i = (this.ticker % BUFFER_SIZE) * METRICS;
      const fps = (this.frameCount / (now - this.lastSampleTime)) * 1000;
      
      // Data format: ticker fps useFrameCalls camX camY camZ blocks particles coins E1-E12 T1-T4
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
      this.buffer[i+13] = this.e5;
      this.buffer[i+14] = this.e6;
      this.buffer[i+15] = this.e7;
      this.buffer[i+16] = this.e8;
      this.buffer[i+17] = this.e9;
      this.buffer[i+18] = this.e10;
      this.buffer[i+19] = this.e11;
      this.buffer[i+20] = this.e12;
      // Timing metrics (ms per sample period)
      this.buffer[i+21] = this.timeControls;
      this.buffer[i+22] = this.timeCoins;
      this.buffer[i+23] = this.timeWaterfall;
      this.buffer[i+24] = this.timeBlocks;
      
      this.ticker++;
      this.frameCount = 0;
      this.useFrameCallCount = 0;
      this.e1 = 0;
      this.e2 = 0;
      this.e3 = 0;
      this.e4 = 0;
      this.e5 = 0;
      this.e6 = 0;
      this.e7 = 0;
      this.e8 = 0;
      this.e9 = 0;
      this.e10 = 0;
      this.e11 = 0;
      this.e12 = 0;
      this.timeControls = 0;
      this.timeCoins = 0;
      this.timeWaterfall = 0;
      this.timeBlocks = 0;
      this.lastSampleTime = now;
    }
  }
  
  lastOutput = '';
  showOutput = false;
  
  print() {
    const n = Math.min(this.ticker, BUFFER_SIZE);
    const lines: string[] = [];
    lines.push('ticker fps uF camX camY camZ blocks e1 e4 e5 tCtrl tCoin tWF tBlk');
    for (let s = 0; s < n; s++) {
      const i = s * METRICS;
      lines.push(
        `${this.buffer[i]} ${this.buffer[i+1].toFixed(0)} ${this.buffer[i+2]} ` +
        `${this.buffer[i+3].toFixed(0)} ${this.buffer[i+4].toFixed(0)} ${this.buffer[i+5].toFixed(0)} ` +
        `${this.buffer[i+6]} ${this.buffer[i+9]} ${this.buffer[i+12]} ${this.buffer[i+13]} ` +
        `${this.buffer[i+21].toFixed(1)} ${this.buffer[i+22].toFixed(1)} ${this.buffer[i+23].toFixed(1)} ${this.buffer[i+24].toFixed(1)}`
      );
    }
    this.lastOutput = lines.join('\n');
    this.showOutput = true;
    console.log('DFLOW_READY: ' + n + ' samples');
    console.log('Timing Legend: tCtrl=controls tCoin=coins tWF=waterfall tBlk=blocks (ms/100ms)');
  }
  
  dismissOutput() {
    this.showOutput = false;
  }
}

export const diagnostics = new DiagnosticsLogger();

// Expose globally for console access
(window as any).__d = diagnostics;
