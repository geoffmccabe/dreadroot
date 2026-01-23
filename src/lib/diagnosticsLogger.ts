// D-Flow Diagnostic Logger v2.0
// Comprehensive zero-allocation performance diagnostic system
// Toggle with Shift+3 (#) key

const BUFFER_SIZE = 600; // 60 seconds at 10 samples/sec
const METRICS = 50; // Expanded from 25 to track more systems

type TimingSystem = 
  | 'controls' | 'coins' | 'waterfall' | 'blocks' | 'frame'
  | 'enemyAI' | 'particles' | 'trees' | 'bullets' | 'matrix' | 'render';

class DiagnosticsLogger {
  enabled = false;
  buffer = new Float32Array(BUFFER_SIZE * METRICS);
  ticker = 0;
  frameCount = 0;
  masterFrameCount = 0;
  lastSampleTime = 0;
  startTime = 0;
  elapsedSeconds = 0;
  
  // === Event counters (reset each sample) - 12 event types ===
  e1 = 0;  // checkAxisCollision calls
  e2 = 0;  // findStepUpTarget calls
  e3 = 0;  // raycast calls (useRaycaster)
  e4 = 0;  // Set/Map allocations or chunk updates
  e5 = 0;  // Block collider iterations (inner loop count)
  e6 = 0;  // Physics resolution / step-up success
  e7 = 0;  // React re-renders (component mount/update)
  e8 = 0;  // Audio play calls
  e9 = 0;  // Texture operations
  e10 = 0; // Animation mixer updates
  e11 = 0; // Network/broadcast calls
  e12 = 0; // Object3D matrix updates (InstancedMesh.setMatrixAt)
  
  // === Frame timing (in ms, accumulated per sample) ===
  timingStarts: { [key: string]: number } = {};
  timeControls = 0;
  timeCoins = 0;
  timeWaterfall = 0;
  timeBlocks = 0;
  timeFrame = 0;
  timeEnemyAI = 0;
  timeParticles = 0;
  timeTrees = 0;
  timeBullets = 0;
  timeMatrix = 0;
  timeRender = 0;
  
  // === Metrics set by components ===
  cameraX = 0;
  cameraY = 0;
  cameraZ = 0;
  visibleBlocks = 0;
  particleCount = 0;
  coinCount = 0;
  frameLoopCallbacks = 0;
  
  // === GPU/Renderer metrics ===
  drawCalls = 0;
  triangles = 0;
  geometries = 0;
  textures = 0;
  jsHeapUsed = 0;
  jsHeapTotal = 0;
  
  // === Enemy AI metrics ===
  enemyCount = 0;
  enemiesFullLOD = 0;
  enemiesThrottled = 0;
  enemiesFrozen = 0;
  behaviorTransitions = 0;
  spatialQueries = 0;
  
  // === Collision grid metrics ===
  worldGridSize = 0;
  entityGridSize = 0;
  gridCacheHits = 0;
  gridCacheMisses = 0;
  gridGeneration = 0;
  
  // === Frame time analysis ===
  private frameTimes = new Float32Array(100);
  private frameTimeIndex = 0;
  longFrameCount = 0; // Frames > 33ms
  frameTimeMax = 0;
  
  // === Real-time metrics for overlay ===
  currentFps = 0;
  avgFrameTime = 0;
  
  startTiming(system: TimingSystem): void {
    if (this.enabled) this.timingStarts[system] = performance.now();
  }
  
  recordTiming(system: TimingSystem): void {
    if (!this.enabled) return;
    const start = this.timingStarts[system];
    if (start === undefined) return;
    const elapsed = performance.now() - start;
    switch (system) {
      case 'controls': this.timeControls += elapsed; break;
      case 'coins': this.timeCoins += elapsed; break;
      case 'waterfall': this.timeWaterfall += elapsed; break;
      case 'blocks': this.timeBlocks += elapsed; break;
      case 'frame': this.timeFrame += elapsed; break;
      case 'enemyAI': this.timeEnemyAI += elapsed; break;
      case 'particles': this.timeParticles += elapsed; break;
      case 'trees': this.timeTrees += elapsed; break;
      case 'bullets': this.timeBullets += elapsed; break;
      case 'matrix': this.timeMatrix += elapsed; break;
      case 'render': this.timeRender += elapsed; break;
    }
  }
  
  recordFrameTime(ms: number): void {
    if (!this.enabled) return;
    this.frameTimes[this.frameTimeIndex++ % 100] = ms;
    if (ms > 33) this.longFrameCount++;
    if (ms > this.frameTimeMax) this.frameTimeMax = ms;
  }
  
  captureRendererStats(renderer: THREE.WebGLRenderer): void {
    if (!this.enabled || !renderer) return;
    this.drawCalls = renderer.info.render.calls;
    this.triangles = renderer.info.render.triangles;
    this.geometries = renderer.info.memory.geometries;
    this.textures = renderer.info.memory.textures;
  }
  
  captureMemoryStats(): void {
    if (!this.enabled) return;
    const mem = (performance as any).memory;
    if (mem) {
      this.jsHeapUsed = mem.usedJSHeapSize / 1048576;
      this.jsHeapTotal = mem.totalJSHeapSize / 1048576;
    }
  }
  
  captureGridStats(worldSize: number, entitySize: number): void {
    if (!this.enabled) return;
    this.worldGridSize = worldSize;
    this.entityGridSize = entitySize;
  }
  
  captureEnemyStats(count: number, full: number, throttled: number, frozen: number): void {
    if (!this.enabled) return;
    this.enemyCount = count;
    this.enemiesFullLOD = full;
    this.enemiesThrottled = throttled;
    this.enemiesFrozen = frozen;
  }
  
  toggle(): void {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.buffer.fill(0);
      this.ticker = 0;
      this.frameCount = 0;
      this.masterFrameCount = 0;
      this.resetEventCounters();
      this.resetTimingCounters();
      this.frameTimes.fill(0);
      this.frameTimeIndex = 0;
      this.longFrameCount = 0;
      this.frameTimeMax = 0;
      this.startTime = performance.now();
      this.lastSampleTime = this.startTime;
      this.elapsedSeconds = 0;
      console.log('[D-Flow] Recording started... (Shift+3 to stop and print)');
    } else {
      this.print();
    }
  }
  
  private resetEventCounters(): void {
    this.e1 = 0; this.e2 = 0; this.e3 = 0; this.e4 = 0;
    this.e5 = 0; this.e6 = 0; this.e7 = 0; this.e8 = 0;
    this.e9 = 0; this.e10 = 0; this.e11 = 0; this.e12 = 0;
    this.gridCacheHits = 0;
    this.gridCacheMisses = 0;
    this.behaviorTransitions = 0;
    this.spatialQueries = 0;
  }
  
  private resetTimingCounters(): void {
    this.timeControls = 0;
    this.timeCoins = 0;
    this.timeWaterfall = 0;
    this.timeBlocks = 0;
    this.timeEnemyAI = 0;
    this.timeParticles = 0;
    this.timeTrees = 0;
    this.timeBullets = 0;
    this.timeMatrix = 0;
    this.timeRender = 0;
  }
  
  tick(): void {
    if (!this.enabled) return;
    this.masterFrameCount++;
    const now = performance.now();
    this.elapsedSeconds = Math.floor((now - this.startTime) / 1000);
    
    // Capture memory stats each frame
    this.captureMemoryStats();
    
    if (now - this.lastSampleTime >= 100) {
      const i = (this.ticker % BUFFER_SIZE) * METRICS;
      const fps = (this.masterFrameCount / (now - this.lastSampleTime)) * 1000;
      
      // Buffer layout (50 metrics):
      // [0-8]   Core: ticker, fps, frames, camXYZ, blocks, particles, coins
      this.buffer[i] = this.ticker;
      this.buffer[i+1] = fps;
      this.buffer[i+2] = this.masterFrameCount;
      this.buffer[i+3] = this.cameraX;
      this.buffer[i+4] = this.cameraY;
      this.buffer[i+5] = this.cameraZ;
      this.buffer[i+6] = this.visibleBlocks;
      this.buffer[i+7] = this.particleCount;
      this.buffer[i+8] = this.coinCount;
      
      // [9-20]  Events: e1-e12
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
      
      // [21-31] Timing: controls, coins, waterfall, blocks, enemyAI, particles, trees, bullets, matrix, render, frame
      this.buffer[i+21] = this.timeControls;
      this.buffer[i+22] = this.timeCoins;
      this.buffer[i+23] = this.timeWaterfall;
      this.buffer[i+24] = this.timeBlocks;
      this.buffer[i+25] = this.timeEnemyAI;
      this.buffer[i+26] = this.timeParticles;
      this.buffer[i+27] = this.timeTrees;
      this.buffer[i+28] = this.timeBullets;
      this.buffer[i+29] = this.timeMatrix;
      this.buffer[i+30] = this.timeRender;
      this.buffer[i+31] = this.timeFrame;
      
      // [32-37] GPU: drawCalls, triangles, geometries, textures, jsHeapUsed, jsHeapTotal
      this.buffer[i+32] = this.drawCalls;
      this.buffer[i+33] = this.triangles;
      this.buffer[i+34] = this.geometries;
      this.buffer[i+35] = this.textures;
      this.buffer[i+36] = this.jsHeapUsed;
      this.buffer[i+37] = this.jsHeapTotal;
      
      // [38-43] Enemy AI: count, fullLOD, throttled, frozen, transitions, spatialQueries
      this.buffer[i+38] = this.enemyCount;
      this.buffer[i+39] = this.enemiesFullLOD;
      this.buffer[i+40] = this.enemiesThrottled;
      this.buffer[i+41] = this.enemiesFrozen;
      this.buffer[i+42] = this.behaviorTransitions;
      this.buffer[i+43] = this.spatialQueries;
      
      // [44-47] Grid: worldGridSize, entityGridSize, cacheHits, cacheMisses
      this.buffer[i+44] = this.worldGridSize;
      this.buffer[i+45] = this.entityGridSize;
      this.buffer[i+46] = this.gridCacheHits;
      this.buffer[i+47] = this.gridCacheMisses;
      
      // [48-49] Frame analysis: longFrameCount, frameTimeMax
      this.buffer[i+48] = this.longFrameCount;
      this.buffer[i+49] = this.frameTimeMax;
      
      this.ticker++;
      this.masterFrameCount = 0;
      this.resetEventCounters();
      this.resetTimingCounters();
      this.longFrameCount = 0;
      this.frameTimeMax = 0;
      this.lastSampleTime = now;
    }
  }
  
  lastOutput = '';
  showOutput = false;
  
  print(): void {
    const n = Math.min(this.ticker, BUFFER_SIZE);
    const duration = (performance.now() - this.startTime) / 1000;
    
    // Calculate summary stats
    let fpsSum = 0, fpsMin = Infinity, fpsMax = 0, fpsMinSample = 0;
    let below30Count = 0;
    let tControlsSum = 0, tAISum = 0, tBlocksSum = 0, tRenderSum = 0;
    let maxDrawCalls = 0, drawCallsSum = 0;
    let heapStart = 0, heapEnd = 0;
    let maxWorldGrid = 0, maxEntityGrid = 0;
    
    for (let s = 0; s < n; s++) {
      const i = s * METRICS;
      const fps = this.buffer[i+1];
      fpsSum += fps;
      if (fps < fpsMin) { fpsMin = fps; fpsMinSample = s; }
      if (fps > fpsMax) fpsMax = fps;
      if (fps < 30) below30Count++;
      
      tControlsSum += this.buffer[i+21];
      tAISum += this.buffer[i+25];
      tBlocksSum += this.buffer[i+24];
      tRenderSum += this.buffer[i+30];
      
      drawCallsSum += this.buffer[i+32];
      if (this.buffer[i+32] > maxDrawCalls) maxDrawCalls = this.buffer[i+32];
      
      if (s === 0) heapStart = this.buffer[i+36];
      if (s === n - 1) heapEnd = this.buffer[i+36];
      
      if (this.buffer[i+44] > maxWorldGrid) maxWorldGrid = this.buffer[i+44];
      if (this.buffer[i+45] > maxEntityGrid) maxEntityGrid = this.buffer[i+45];
    }
    
    const lines: string[] = [];
    lines.push('=== D-Flow Performance Report ===');
    lines.push(`Duration: ${duration.toFixed(1)}s (${n} samples)`);
    lines.push('');
    lines.push('FPS Summary:');
    lines.push(`  Average: ${(fpsSum / n).toFixed(1)} FPS`);
    lines.push(`  Min: ${fpsMin.toFixed(0)} FPS (sample ${fpsMinSample})`);
    lines.push(`  Max: ${fpsMax.toFixed(0)} FPS`);
    lines.push(`  Below 30 FPS: ${below30Count} samples (${((below30Count/n)*100).toFixed(1)}%)`);
    lines.push('');
    lines.push('Frame Time Breakdown (avg ms/100ms):');
    lines.push(`  Controls:  ${(tControlsSum/n).toFixed(2)}ms`);
    lines.push(`  EnemyAI:   ${(tAISum/n).toFixed(2)}ms`);
    lines.push(`  Blocks:    ${(tBlocksSum/n).toFixed(2)}ms`);
    lines.push(`  Render:    ${(tRenderSum/n).toFixed(2)}ms`);
    lines.push('');
    lines.push('GPU/Memory:');
    lines.push(`  Draw Calls: avg ${(drawCallsSum/n).toFixed(0)}, max ${maxDrawCalls}`);
    lines.push(`  JS Heap: ${heapStart.toFixed(0)}MB -> ${heapEnd.toFixed(0)}MB (${heapEnd > heapStart ? '+' : ''}${(heapEnd-heapStart).toFixed(0)}MB)`);
    lines.push('');
    lines.push('Collision Grids:');
    lines.push(`  World Grid max: ${maxWorldGrid}`);
    lines.push(`  Entity Grid max: ${maxEntityGrid}`);
    lines.push('');
    lines.push('--- Raw Data (last 20 samples) ---');
    lines.push('sample fps frames wGrid eGrid drawCalls tCtrl tAI tBlk tRender');
    
    const startSample = Math.max(0, n - 20);
    for (let s = startSample; s < n; s++) {
      const i = s * METRICS;
      lines.push(
        `${this.buffer[i].toFixed(0)} ` +
        `${this.buffer[i+1].toFixed(0)} ` +
        `${this.buffer[i+2].toFixed(0)} ` +
        `${this.buffer[i+44].toFixed(0)} ` +
        `${this.buffer[i+45].toFixed(0)} ` +
        `${this.buffer[i+32].toFixed(0)} ` +
        `${this.buffer[i+21].toFixed(1)} ` +
        `${this.buffer[i+25].toFixed(1)} ` +
        `${this.buffer[i+24].toFixed(1)} ` +
        `${this.buffer[i+30].toFixed(1)}`
      );
    }
    
    this.lastOutput = lines.join('\n');
    this.showOutput = true;
    console.log(this.lastOutput);
    console.log('[D-Flow] DFLOW_READY: ' + n + ' samples');
  }
  
  dismissOutput(): void {
    this.showOutput = false;
  }
}

export const diagnostics = new DiagnosticsLogger();

// Import THREE type for renderer stats
import type * as THREE from 'three';

// Expose globally for console access
(window as any).__d = diagnostics;
