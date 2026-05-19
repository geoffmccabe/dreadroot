// D-Flow Diagnostic Logger v2.0
// Comprehensive zero-allocation performance diagnostic system
// Toggle with Shift+3 (#) key

const BUFFER_SIZE = 600; // 60 seconds at 10 samples/sec
const METRICS = 58; // Expanded to track chunk pipeline metrics

type TimingSystem = 
  | 'controls' | 'coins' | 'waterfall' | 'blocks' | 'frame'
  | 'enemyAI' | 'particles' | 'trees' | 'bullets' | 'matrix' | 'render';

class DiagnosticsLogger {
  enabled = false;
  buffer = new Float32Array(BUFFER_SIZE * METRICS);
  metricsPerSample = METRICS;
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
  
  // === Per-enemy-type metrics ===
  shwarmCount = 0;
  shwarmBlockCount = 0;
  shwarmTickTime = 0;
  shnakeCount = 0;
  shnakeSegmentCount = 0;
  shnakeTickTime = 0;
  shombieCount = 0;
  shombieTickTime = 0;
  
  // === Chunk pipeline metrics (set by components each frame) ===
  loadedChunkCount = 0;       // chunks in loadedChunksRef
  visibleChunkCount = 0;      // chunks passing distance filter in CameraTrackedBlocks
  renderedChunkCount = 0;     // ChunkRenderer components that actually rendered blocks
  totalLoadedBlocks = 0;      // total blocks across all loaded chunks
  totalVisibleBlocks = 0;     // total blocks across visible chunks (after surface culling)
  playerChunkX = 0;           // player's current chunk X
  playerChunkZ = 0;           // player's current chunk Z
  chunksInFlight = 0;         // chunks currently being fetched

  // === Collision grid metrics ===
  worldGridSize = 0;
  entityGridSize = 0;
  gridCacheHits = 0;
  gridCacheMisses = 0;
  gridGeneration = 0;

  // === Stall / chunk / collider diagnostics (per-sample) ===
  private longTaskCount = 0;
  private longTaskMs = 0;

  private eventLoopLagCount = 0;
  private eventLoopLagMaxMs = 0;

  private chunkLoads = 0;
  private chunkUnloads = 0;
  private chunkFetchMs = 0;
  private chunkBuildMs = 0;

  private emits = 0;
  private flattenMs = 0;
  private flattenBlocks = 0;

  private colliderAdds = 0;
  private colliderRemoves = 0;
  private colliderMs = 0;

  // === PlacedBlocks grouping diagnostics ===
  private groupCacheHits = 0;
  private groupCacheMisses = 0;
  private groupMs = 0;
  private groupBlocks = 0;

  // === InstancedMesh rebuild diagnostics ===
  private meshRebuildCount = 0;
  private meshRebuildMs = 0;
  private meshRebuildBlocks = 0;

  // === Off-thread worker-apply diagnostics (real main-thread time spent
  // copying worker results into the live mesh; previously hidden as 0). ===
  private workerApplyCount = 0;
  private workerApplyMs = 0;
  private workerApplyBlocks = 0;
  private workerFallbackCount = 0;

  // === Incremental update diagnostics (delta path — separated from full
  // rebuilds so we can see how often the cheap path runs vs the heavy one). ===
  private incrementalCount = 0;
  private incrementalMs = 0;
  private incrementalBlocks = 0;

  // === Chunk rendering diagnostics (Phase 0) ===
  private chunkRenderCount = 0;      // ChunkRenderer components currently mounted
  private chunkRebuildCount = 0;     // chunks that re-rendered this sample interval
  private chunkRebuildMs = 0;        // total time in chunk-level grouping+mesh rebuilds
  private globalFlattenMs = 0;       // time in CameraTrackedBlocks flatten/dedup/sort
  meshInstanceTotal = 0;             // sum of all InstancedMesh.count values
  gpuTextureMemMB = 0;              // estimated GPU texture memory

  private chunkRenderCountTotal = 0;
  private chunkRebuildCountTotal = 0;
  private chunkRebuildMsTotal = 0;
  private globalFlattenMsTotal = 0;

  // === Totals over recording ===
  private longTaskCountTotal = 0;
  private longTaskMsTotal = 0;
  private eventLoopLagCountTotal = 0;
  private eventLoopLagMaxMsTotal = 0;

  private chunkLoadsTotal = 0;
  private chunkUnloadsTotal = 0;
  private chunkFetchMsTotal = 0;
  private chunkBuildMsTotal = 0;

  private emitsTotal = 0;
  private flattenMsTotal = 0;
  private flattenBlocksTotal = 0;

  private colliderAddsTotal = 0;
  private colliderRemovesTotal = 0;
  private colliderMsTotal = 0;

  private groupCacheHitsTotal = 0;
  private groupCacheMissesTotal = 0;
  private groupMsTotal = 0;
  private groupBlocksTotal = 0;

  private meshRebuildCountTotal = 0;
  private meshRebuildMsTotal = 0;
  private meshRebuildBlocksTotal = 0;

  private workerApplyCountTotal = 0;
  private workerApplyMsTotal = 0;
  private workerApplyBlocksTotal = 0;
  private workerFallbackCountTotal = 0;

  private incrementalCountTotal = 0;
  private incrementalMsTotal = 0;
  private incrementalBlocksTotal = 0;

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

  // === Stall diagnostics methods ===
  recordLongTask(ms: number): void {
    if (!this.enabled) return;
    this.longTaskCount++;
    this.longTaskMs += ms;
  }

  recordEventLoopLag(ms: number): void {
    if (!this.enabled) return;
    this.eventLoopLagCount++;
    if (ms > this.eventLoopLagMaxMs) this.eventLoopLagMaxMs = ms;
  }

  recordChunkLoad(fetchMs: number, buildMs: number): void {
    if (!this.enabled) return;
    this.chunkLoads++;
    this.chunkFetchMs += fetchMs;
    this.chunkBuildMs += buildMs;
  }

  recordChunkUnload(): void {
    if (!this.enabled) return;
    this.chunkUnloads++;
  }

  recordFlattenEmit(blockCount: number, ms: number): void {
    if (!this.enabled) return;
    this.emits++;
    this.flattenBlocks += blockCount;
    this.flattenMs += ms;
  }

  recordColliderOp(kind: 'add' | 'remove', ms: number): void {
    if (!this.enabled) return;
    if (kind === 'add') this.colliderAdds++;
    else this.colliderRemoves++;
    this.colliderMs += ms;
  }

  // === PlacedBlocks grouping diagnostics ===
  recordGroupCacheHit(): void {
    if (!this.enabled) return;
    this.groupCacheHits++;
  }

  recordGrouping(ms: number, blockCount: number): void {
    if (!this.enabled) return;
    this.groupCacheMisses++;
    this.groupMs += ms;
    this.groupBlocks += blockCount;
  }

  // === InstancedMesh rebuild diagnostics ===
  recordMeshRebuild(ms: number, blockCount: number): void {
    if (!this.enabled) return;
    this.meshRebuildCount++;
    this.meshRebuildMs += ms;
    this.meshRebuildBlocks += blockCount;
  }

  // Real main-thread time of an off-thread worker result being applied to
  // the live mesh (matrix copy + uv/color attribute update + posMap rebuild).
  recordWorkerApply(ms: number, blockCount: number): void {
    if (!this.enabled) return;
    this.workerApplyCount++;
    this.workerApplyMs += ms;
    this.workerApplyBlocks += blockCount;
  }

  recordWorkerFallback(): void {
    if (!this.enabled) return;
    this.workerFallbackCount++;
  }

  // Incremental delta updates (cheap path) — was previously conflated with
  // full rebuilds under recordMeshRebuild, hiding the full-vs-delta ratio.
  recordIncremental(ms: number, blockCount: number): void {
    if (!this.enabled) return;
    this.incrementalCount++;
    this.incrementalMs += ms;
    this.incrementalBlocks += blockCount;
  }

  // === Chunk rendering diagnostics (Phase 0) ===
  setChunkRenderCount(count: number): void {
    if (!this.enabled) return;
    this.chunkRenderCount = count;
    this.renderedChunkCount = count;
  }

  recordChunkRebuild(ms: number): void {
    if (!this.enabled) return;
    this.chunkRebuildCount++;
    this.chunkRebuildMs += ms;
  }

  recordGlobalFlatten(ms: number): void {
    if (!this.enabled) return;
    this.globalFlattenMs += ms;
  }

  // Get accumulated stall stats for report
  getExtraStats() {
    return {
      longTaskCountTotal: this.longTaskCountTotal,
      longTaskMsTotal: this.longTaskMsTotal,
      eventLoopLagCountTotal: this.eventLoopLagCountTotal,
      eventLoopLagMaxMsTotal: this.eventLoopLagMaxMsTotal,

      chunkLoadsTotal: this.chunkLoadsTotal,
      chunkUnloadsTotal: this.chunkUnloadsTotal,
      chunkFetchMsTotal: this.chunkFetchMsTotal,
      chunkBuildMsTotal: this.chunkBuildMsTotal,

      emitsTotal: this.emitsTotal,
      flattenMsTotal: this.flattenMsTotal,
      flattenBlocksTotal: this.flattenBlocksTotal,

      colliderAddsTotal: this.colliderAddsTotal,
      colliderRemovesTotal: this.colliderRemovesTotal,
      colliderMsTotal: this.colliderMsTotal,

      // Chunk rendering (Phase 0)
      chunkRenderCount: this.chunkRenderCount,
      chunkRebuildCountTotal: this.chunkRebuildCountTotal,
      chunkRebuildMsTotal: this.chunkRebuildMsTotal,
      globalFlattenMsTotal: this.globalFlattenMsTotal,
      meshInstanceTotal: this.meshInstanceTotal,
      gpuTextureMemMB: this.gpuTextureMemMB,

      // Grouping/Mesh
      groupCacheMissesTotal: this.groupCacheMissesTotal,
      groupMsTotal: this.groupMsTotal,
      groupBlocksTotal: this.groupBlocksTotal,
      meshRebuildCountTotal: this.meshRebuildCountTotal,
      meshRebuildMsTotal: this.meshRebuildMsTotal,
      meshRebuildBlocksTotal: this.meshRebuildBlocksTotal,

      workerApplyCountTotal: this.workerApplyCountTotal,
      workerApplyMsTotal: this.workerApplyMsTotal,
      workerApplyBlocksTotal: this.workerApplyBlocksTotal,
      workerFallbackCountTotal: this.workerFallbackCountTotal,

      incrementalCountTotal: this.incrementalCountTotal,
      incrementalMsTotal: this.incrementalMsTotal,
      incrementalBlocksTotal: this.incrementalBlocksTotal,
    };
  }

  captureRendererStats(renderer: THREE.WebGLRenderer): void {
    if (!this.enabled || !renderer) return;
    this.drawCalls = renderer.info.render.calls;
    this.triangles = renderer.info.render.triangles;
    this.geometries = renderer.info.memory.geometries;
    this.textures = renderer.info.memory.textures;
    // Estimate GPU texture memory from atlas (8192x8192 RGBA = 256MB, no mipmaps)
    // This is a rough estimate; actual depends on atlas size constant
    this.gpuTextureMemMB = (8192 * 8192 * 4) / (1024 * 1024); // 256MB for current atlas
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
  
  captureShwarmStats(shwarmCount: number, blockCount: number): void {
    if (!this.enabled) return;
    this.shwarmCount = shwarmCount;
    this.shwarmBlockCount = blockCount;
  }
  
  captureShnakeStats(shnakeCount: number, segmentCount: number): void {
    if (!this.enabled) return;
    this.shnakeCount = shnakeCount;
    this.shnakeSegmentCount = segmentCount;
  }
  
  captureShombieStats(shombieCount: number): void {
    if (!this.enabled) return;
    this.shombieCount = shombieCount;
  }
  
  startEnemyTiming(type: 'shwarm' | 'shnake' | 'shombie'): void {
    if (this.enabled) this.timingStarts[`enemy_${type}`] = performance.now();
  }
  
  recordEnemyTiming(type: 'shwarm' | 'shnake' | 'shombie'): void {
    if (!this.enabled) return;
    const start = this.timingStarts[`enemy_${type}`];
    if (start === undefined) return;
    const elapsed = performance.now() - start;
    switch (type) {
      case 'shwarm': this.shwarmTickTime += elapsed; break;
      case 'shnake': this.shnakeTickTime += elapsed; break;
      case 'shombie': this.shombieTickTime += elapsed; break;
    }
  }
  
  // Fallback timer for when frame loop is frozen
  private fallbackTimerId: number | null = null;

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

      // Reset stall diagnostics
      this.longTaskCount = 0;
      this.longTaskMs = 0;
      this.eventLoopLagCount = 0;
      this.eventLoopLagMaxMs = 0;
      this.chunkLoads = 0;
      this.chunkUnloads = 0;
      this.chunkFetchMs = 0;
      this.chunkBuildMs = 0;
      this.emits = 0;
      this.flattenMs = 0;
      this.flattenBlocks = 0;
      this.colliderAdds = 0;
      this.colliderRemoves = 0;
      this.colliderMs = 0;

      // Reset totals
      this.longTaskCountTotal = 0;
      this.longTaskMsTotal = 0;
      this.eventLoopLagCountTotal = 0;
      this.eventLoopLagMaxMsTotal = 0;
      this.chunkLoadsTotal = 0;
      this.chunkUnloadsTotal = 0;
      this.chunkFetchMsTotal = 0;
      this.chunkBuildMsTotal = 0;
      this.emitsTotal = 0;
      this.flattenMsTotal = 0;
      this.flattenBlocksTotal = 0;
      this.colliderAddsTotal = 0;
      this.colliderRemovesTotal = 0;
      this.colliderMsTotal = 0;
      this.groupCacheHitsTotal = 0;
      this.groupCacheMissesTotal = 0;
      this.groupMsTotal = 0;
      this.groupBlocksTotal = 0;
      this.meshRebuildCountTotal = 0;
      this.meshRebuildMsTotal = 0;
      this.meshRebuildBlocksTotal = 0;
      this.workerApplyCountTotal = 0;
      this.workerApplyMsTotal = 0;
      this.workerApplyBlocksTotal = 0;
      this.workerFallbackCountTotal = 0;
      this.incrementalCountTotal = 0;
      this.incrementalMsTotal = 0;
      this.incrementalBlocksTotal = 0;

      // Reset chunk rendering diagnostics
      this.chunkRenderCount = 0;
      this.chunkRebuildCount = 0;
      this.chunkRebuildMs = 0;
      this.globalFlattenMs = 0;
      this.meshInstanceTotal = 0;
      this.gpuTextureMemMB = 0;
      this.chunkRenderCountTotal = 0;
      this.chunkRebuildCountTotal = 0;
      this.chunkRebuildMsTotal = 0;
      this.globalFlattenMsTotal = 0;

      // Start fallback timer - collects samples even if frame loop is frozen
      this.fallbackTimerId = window.setInterval(() => {
        this.tickFallback();
      }, 100) as unknown as number;

      this.tickCallCount = 0;
      this.fallbackCallCount = 0;
      console.log('[D-Flow] Recording STARTED (Shift+3 to stop)');
    } else {
      console.log('[D-Flow] Recording STOPPED. Samples:', this.ticker);
      // Stop fallback timer
      if (this.fallbackTimerId !== null) {
        window.clearInterval(this.fallbackTimerId);
        this.fallbackTimerId = null;
      }
      this.print();
    }
  }

  // Fallback tick - runs via setInterval, doesn't require frame loop
  private tickFallback(): void {
    if (!this.enabled) return;
    this.fallbackCallCount++;

    const now = performance.now();
    this.elapsedSeconds = Math.floor((now - this.startTime) / 1000);

    // Only write a sample if the frame loop didn't already do it
    if (now - this.lastSampleTime >= 100) {
      const i = (this.ticker % BUFFER_SIZE) * METRICS;
      // Calculate FPS based on frame count (may be 0 if frozen)
      const elapsed = now - this.lastSampleTime;
      const fps = elapsed > 0 ? (this.masterFrameCount / elapsed) * 1000 : 0;

      // Buffer layout - same as tick()
      this.buffer[i] = this.ticker;
      this.buffer[i+1] = fps;
      this.buffer[i+2] = this.masterFrameCount;
      this.buffer[i+3] = this.cameraX;
      this.buffer[i+4] = this.cameraY;
      this.buffer[i+5] = this.cameraZ;
      this.buffer[i+6] = this.visibleBlocks;
      this.buffer[i+7] = this.particleCount;
      this.buffer[i+8] = this.coinCount;

      // Events
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

      // Timing
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

      // GPU
      this.buffer[i+32] = this.drawCalls;
      this.buffer[i+33] = this.triangles;
      this.buffer[i+34] = this.geometries;
      this.buffer[i+35] = this.textures;
      this.buffer[i+36] = this.jsHeapUsed;
      this.buffer[i+37] = this.jsHeapTotal;

      // Enemy AI
      this.buffer[i+38] = this.enemyCount;
      this.buffer[i+39] = this.enemiesFullLOD;
      this.buffer[i+40] = this.enemiesThrottled;
      this.buffer[i+41] = this.enemiesFrozen;
      this.buffer[i+42] = this.behaviorTransitions;
      this.buffer[i+43] = this.spatialQueries;

      // Grid
      this.buffer[i+44] = this.worldGridSize;
      this.buffer[i+45] = this.entityGridSize;
      this.buffer[i+46] = this.gridCacheHits;
      this.buffer[i+47] = this.gridCacheMisses;

      // Frame analysis
      this.buffer[i+48] = this.longFrameCount;
      this.buffer[i+49] = this.frameTimeMax;

      // Chunk pipeline
      this.buffer[i+50] = this.loadedChunkCount;
      this.buffer[i+51] = this.visibleChunkCount;
      this.buffer[i+52] = this.renderedChunkCount;
      this.buffer[i+53] = this.totalLoadedBlocks;
      this.buffer[i+54] = this.totalVisibleBlocks;
      this.buffer[i+55] = this.playerChunkX;
      this.buffer[i+56] = this.playerChunkZ;
      this.buffer[i+57] = this.chunksInFlight;

      this.ticker++;
      this.masterFrameCount = 0;
      this.resetEventCounters();
      this.resetTimingCounters();
      this.accumulateAndResetStallCounters();
      this.longFrameCount = 0;
      this.frameTimeMax = 0;
      this.lastSampleTime = now;
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
    this.shwarmTickTime = 0;
    this.shnakeTickTime = 0;
    this.shombieTickTime = 0;
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

  private accumulateAndResetStallCounters(): void {
    // Accumulate totals for overlay summary
    this.longTaskCountTotal += this.longTaskCount;
    this.longTaskMsTotal += this.longTaskMs;

    this.eventLoopLagCountTotal += this.eventLoopLagCount;
    this.eventLoopLagMaxMsTotal = Math.max(this.eventLoopLagMaxMsTotal, this.eventLoopLagMaxMs);

    this.chunkLoadsTotal += this.chunkLoads;
    this.chunkUnloadsTotal += this.chunkUnloads;
    this.chunkFetchMsTotal += this.chunkFetchMs;
    this.chunkBuildMsTotal += this.chunkBuildMs;

    this.emitsTotal += this.emits;
    this.flattenMsTotal += this.flattenMs;
    this.flattenBlocksTotal += this.flattenBlocks;

    this.colliderAddsTotal += this.colliderAdds;
    this.colliderRemovesTotal += this.colliderRemoves;
    this.colliderMsTotal += this.colliderMs;

    this.groupCacheHitsTotal += this.groupCacheHits;
    this.groupCacheMissesTotal += this.groupCacheMisses;
    this.groupMsTotal += this.groupMs;
    this.groupBlocksTotal += this.groupBlocks;

    this.meshRebuildCountTotal += this.meshRebuildCount;
    this.meshRebuildMsTotal += this.meshRebuildMs;
    this.meshRebuildBlocksTotal += this.meshRebuildBlocks;

    this.workerApplyCountTotal += this.workerApplyCount;
    this.workerApplyMsTotal += this.workerApplyMs;
    this.workerApplyBlocksTotal += this.workerApplyBlocks;
    this.workerFallbackCountTotal += this.workerFallbackCount;

    this.incrementalCountTotal += this.incrementalCount;
    this.incrementalMsTotal += this.incrementalMs;
    this.incrementalBlocksTotal += this.incrementalBlocks;

    // Reset per-sample
    this.longTaskCount = 0;
    this.longTaskMs = 0;

    this.eventLoopLagCount = 0;
    this.eventLoopLagMaxMs = 0;

    this.chunkLoads = 0;
    this.chunkUnloads = 0;
    this.chunkFetchMs = 0;
    this.chunkBuildMs = 0;

    this.emits = 0;
    this.flattenMs = 0;
    this.flattenBlocks = 0;

    this.colliderAdds = 0;
    this.colliderRemoves = 0;
    this.colliderMs = 0;

    this.groupCacheHits = 0;
    this.groupCacheMisses = 0;
    this.groupMs = 0;
    this.groupBlocks = 0;

    this.meshRebuildCount = 0;
    this.meshRebuildMs = 0;
    this.meshRebuildBlocks = 0;

    this.workerApplyCount = 0;
    this.workerApplyMs = 0;
    this.workerApplyBlocks = 0;
    this.workerFallbackCount = 0;

    this.incrementalCount = 0;
    this.incrementalMs = 0;
    this.incrementalBlocks = 0;

    // Chunk rendering diagnostics
    this.chunkRenderCountTotal = this.chunkRenderCount; // snapshot, not accumulated
    this.chunkRebuildCountTotal += this.chunkRebuildCount;
    this.chunkRebuildMsTotal += this.chunkRebuildMs;
    this.globalFlattenMsTotal += this.globalFlattenMs;

    this.chunkRebuildCount = 0;
    this.chunkRebuildMs = 0;
    this.globalFlattenMs = 0;
  }
  
  private tickCallCount = 0;
  private fallbackCallCount = 0;

  tick(): void {
    if (!this.enabled) return;
    this.tickCallCount++;
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

      // Chunk pipeline
      this.buffer[i+50] = this.loadedChunkCount;
      this.buffer[i+51] = this.visibleChunkCount;
      this.buffer[i+52] = this.renderedChunkCount;
      this.buffer[i+53] = this.totalLoadedBlocks;
      this.buffer[i+54] = this.totalVisibleBlocks;
      this.buffer[i+55] = this.playerChunkX;
      this.buffer[i+56] = this.playerChunkZ;
      this.buffer[i+57] = this.chunksInFlight;

      this.ticker++;
      this.masterFrameCount = 0;
      this.resetEventCounters();
      this.resetTimingCounters();
      this.accumulateAndResetStallCounters();
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
    let totalLongFrames = 0, maxFrameTime = 0, totalFrames = 0;

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

      // Frame time analysis
      totalLongFrames += this.buffer[i+48];
      if (this.buffer[i+49] > maxFrameTime) maxFrameTime = this.buffer[i+49];
      totalFrames += this.buffer[i+2];
    }

    // Calculate average frame time
    const avgFrameTime = totalFrames > 0 ? (duration * 1000) / totalFrames : 0;
    
    const lines: string[] = [];
    lines.push('=== D-Flow Performance Report ===');
    lines.push(`Duration: ${duration.toFixed(1)}s (${n} samples)`);
    lines.push('');
    lines.push('FPS Summary:');
    lines.push(`  Average: ${(fpsSum / n).toFixed(1)} FPS`);
    lines.push(`  Min: ${fpsMin.toFixed(0)} FPS (sample ${fpsMinSample})`);
    lines.push(`  Max: ${fpsMax.toFixed(0)} FPS`);
    lines.push(`  Below 30 FPS: ${below30Count} samples (${((below30Count/n)*100).toFixed(1)}%)`);
    lines.push(`  Avg frame time: ${avgFrameTime.toFixed(1)}ms (${totalFrames} frames)`);
    lines.push(`  Long frames (>33ms): ${totalLongFrames}, Max: ${maxFrameTime.toFixed(1)}ms`);
    lines.push('');
    lines.push('Frame Time Breakdown (avg ms/100ms):');
    lines.push(`  Controls:  ${(tControlsSum/n).toFixed(2)}ms`);
    lines.push(`  EnemyAI:   ${(tAISum/n).toFixed(2)}ms`);
    lines.push(`  Blocks:    ${(tBlocksSum/n).toFixed(2)}ms`);
    lines.push(`  Render:    ${(tRenderSum/n).toFixed(2)}ms`);
    lines.push('');
    lines.push('Enemy Stats (current):');
    lines.push(`  Shwarms: ${this.shwarmCount} (${this.shwarmBlockCount} blocks)`);
    lines.push(`  Shnakes: ${this.shnakeCount} (${this.shnakeSegmentCount} segments)`);
    lines.push(`  Shombies: ${this.shombieCount}`);
    lines.push('');
    lines.push('GPU/Memory:');
    lines.push(`  Draw Calls: avg ${(drawCallsSum/n).toFixed(0)}, max ${maxDrawCalls}`);
    lines.push(`  JS Heap: ${heapStart.toFixed(0)}MB -> ${heapEnd.toFixed(0)}MB (${heapEnd > heapStart ? '+' : ''}${(heapEnd-heapStart).toFixed(0)}MB)`);
    lines.push('');
    lines.push('Collision Grids:');
    lines.push(`  World Grid max: ${maxWorldGrid}`);
    lines.push(`  Entity Grid max: ${maxEntityGrid}`);
    lines.push('');

    // Get frameLoop callback timing breakdown
    const frameLoopTiming = (window as any).frameLoop?.getTimingReport?.();
    if (frameLoopTiming && frameLoopTiming.length > 0) {
      lines.push('Frame Loop Callbacks (total ms over recording):');
      // Show top 10 callbacks by time
      const topCallbacks = frameLoopTiming.slice(0, 10);
      for (const { id, time } of topCallbacks) {
        lines.push(`  ${id}: ${time.toFixed(1)}ms`);
      }
      lines.push('');
      // Reset timing for next recording
      (window as any).frameLoop?.resetTiming?.();
    }

    lines.push('--- Raw Data (last 50 samples) ---');
    lines.push('sample fps frames drawCalls loadChk visChk renChk pChkX pChkZ wGrid tCtrl tAI tRender');

    const startSample = Math.max(0, n - 50);
    for (let s = startSample; s < n; s++) {
      const i = s * METRICS;
      lines.push(
        `${this.buffer[i].toFixed(0)} ` +
        `${this.buffer[i+1].toFixed(0)} ` +
        `${this.buffer[i+2].toFixed(0)} ` +
        `${this.buffer[i+32].toFixed(0)} ` +
        `${this.buffer[i+50].toFixed(0)} ` +
        `${this.buffer[i+51].toFixed(0)} ` +
        `${this.buffer[i+52].toFixed(0)} ` +
        `${this.buffer[i+55].toFixed(0)} ` +
        `${this.buffer[i+56].toFixed(0)} ` +
        `${this.buffer[i+44].toFixed(0)} ` +
        `${this.buffer[i+21].toFixed(1)} ` +
        `${this.buffer[i+25].toFixed(1)} ` +
        `${this.buffer[i+30].toFixed(1)}`
      );
    }

    // Add stall diagnostics section
    lines.push('');
    lines.push('--- Stall Diagnostics ---');
    lines.push(`LongTasks: ${this.longTaskCountTotal} (${this.longTaskMsTotal.toFixed(1)}ms total)`);
    lines.push(`EventLoopLag: ${this.eventLoopLagCountTotal} spikes (max ${this.eventLoopLagMaxMsTotal.toFixed(1)}ms)`);
    lines.push(`Chunk Loads/Unloads: ${this.chunkLoadsTotal}/${this.chunkUnloadsTotal}`);
    lines.push(`Chunk Fetch/Build: ${this.chunkFetchMsTotal.toFixed(1)}ms / ${this.chunkBuildMsTotal.toFixed(1)}ms`);
    lines.push(`Emits: ${this.emitsTotal}, WorldRevision bumps: ${this.emitsTotal}`);
    lines.push(`Colliders: +${this.colliderAddsTotal} -${this.colliderRemovesTotal} (${this.colliderMsTotal.toFixed(1)}ms)`);
    lines.push(`Grouping: ${this.groupCacheHitsTotal} hits, ${this.groupCacheMissesTotal} misses (${this.groupMsTotal.toFixed(1)}ms for ${this.groupBlocksTotal} blocks)`);
    lines.push(`MeshRebuild: ${this.meshRebuildCountTotal} rebuilds (${this.meshRebuildMsTotal.toFixed(1)}ms for ${this.meshRebuildBlocksTotal} blocks)`);
    lines.push('');
    lines.push('--- Chunk Pipeline (current) ---');
    lines.push(`Player Chunk: (${this.playerChunkX}, ${this.playerChunkZ})`);
    lines.push(`Loaded Chunks: ${this.loadedChunkCount} (${this.totalLoadedBlocks} blocks)`);
    lines.push(`Visible Chunks: ${this.visibleChunkCount} (${this.totalVisibleBlocks} surface blocks)`);
    lines.push(`Rendered Chunks: ${this.renderedChunkCount}`);
    lines.push(`Chunks In Flight: ${this.chunksInFlight}`);
    lines.push(`ChunkRebuilds: ${this.chunkRebuildCountTotal} (${this.chunkRebuildMsTotal.toFixed(1)}ms)`);
    lines.push(`MeshRebuild: ${this.meshRebuildCountTotal} (${this.meshRebuildMsTotal.toFixed(1)}ms for ${this.meshRebuildBlocksTotal} blocks)`);
    lines.push(`GPU Texture Mem: ${this.gpuTextureMemMB.toFixed(1)}MB`);

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
