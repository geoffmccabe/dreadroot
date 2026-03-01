// D-Flow Diagnostic Logger v2.0
// Comprehensive zero-allocation performance diagnostic system
// Toggle with Shift+3 (#) key

const BUFFER_SIZE = 600; // 60 seconds at 10 samples/sec
const METRICS = 52; // Added: [50]=chunkUnloadsThisSample, [51]=colliderRemovesThisSample

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
  
  // === Per-enemy-type metrics ===
  shwarmCount = 0;
  shwarmBlockCount = 0;
  shwarmTickTime = 0;
  shnakeCount = 0;
  shnakeSegmentCount = 0;
  shnakeTickTime = 0;
  shombieCount = 0;
  shombieTickTime = 0;
  
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

  // === Budgeted work queue diagnostics ===
  private budgetQueueLength = 0;        // current queue length
  private budgetQueueMax = 0;           // max queue length this sample
  private budgetJobsAdded = 0;          // jobs added this sample
  private budgetJobsCompleted = 0;      // jobs completed this sample
  private budgetMs = 0;                 // time spent in tickBudgetedWork

  // === Collider map diagnostics ===
  colliderMapSize = 0;                  // current colliderByBlockId.size
  colliderMapMax = 0;                   // max size during recording

  // === Signature stability diagnostics ===
  private sigChanges = 0;               // number of signature changes this sample
  private sigChangeReasons: string[] = [];  // reasons for changes (limited to 5)

  // === Re-render pipeline diagnostics ===
  private normalEntriesEvals = 0;       // normalEntries useMemo evaluations this sample
  private normalEntriesEvalsTotal = 0;
  private mutationRenderFires = 0;      // mutation-triggered re-renders this sample
  private mutationRenderFiresTotal = 0;
  private mutationRenderSkips = 0;      // mutation re-renders throttled this sample
  private mutationRenderSkipsTotal = 0;

  // === User data loading diagnostics ===
  userDataStatus: 'pending' | 'loading' | 'success' | 'error' = 'pending';
  userDataError: string | null = null;
  userDataLoadMs = 0;

  // === Chunk rendering diagnostics (Phase 0) ===
  private chunkRenderCount = 0;      // ChunkRenderer components currently mounted
  private chunkRebuildCount = 0;     // chunks that re-rendered this sample interval
  private chunkRebuildMs = 0;        // total time in chunk-level grouping+mesh rebuilds
  private globalFlattenMs = 0;       // time in CameraTrackedBlocks flatten/dedup/sort
  meshInstanceTotal = 0;             // sum of all InstancedMesh.count values
  gpuTextureMemMB = 0;              // estimated GPU texture memory

  // === GPU object leak tracking ===
  private geometriesStart = 0;       // geometries count at recording start
  private texturesStart = 0;         // textures count at recording start

  // === Dispose tracking ===
  private disposeGeometry = 0;
  private disposeMaterial = 0;
  private disposeMesh = 0;
  private disposeGeometryTotal = 0;
  private disposeMaterialTotal = 0;
  private disposeMeshTotal = 0;

  // === Draw call breakdown ===
  private drawCallsTreeAtlas = 0;    // InstancedAtlasBlockGroup mounted count
  private drawCallsNonTree = 0;      // InstancedBlockGroup mounted count
  private drawCallsFade = 0;         // FadeRing mounted count

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

  // === Budgeted work queue totals ===
  private budgetJobsAddedTotal = 0;
  private budgetJobsCompletedTotal = 0;
  private budgetMsTotal = 0;

  // === Signature change totals ===
  private sigChangesTotal = 0;

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

  // === Dispose tracking ===
  recordDispose(type: 'geometry' | 'material' | 'mesh'): void {
    if (!this.enabled) return;
    if (type === 'geometry') this.disposeGeometry++;
    else if (type === 'material') this.disposeMaterial++;
    else this.disposeMesh++;
  }

  // === Draw call breakdown (mount/unmount tracking — always active, not gated by enabled) ===
  mountDrawCall(type: 'treeAtlas' | 'nonTree' | 'fade'): void {
    if (type === 'treeAtlas') this.drawCallsTreeAtlas++;
    else if (type === 'nonTree') this.drawCallsNonTree++;
    else this.drawCallsFade++;
  }

  unmountDrawCall(type: 'treeAtlas' | 'nonTree' | 'fade'): void {
    if (type === 'treeAtlas') this.drawCallsTreeAtlas--;
    else if (type === 'nonTree') this.drawCallsNonTree--;
    else this.drawCallsFade--;
  }

  // === Chunk rendering diagnostics (Phase 0) ===
  setChunkRenderCount(count: number): void {
    if (!this.enabled) return;
    this.chunkRenderCount = count;
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

  // === Budgeted work queue diagnostics ===
  recordBudgetTick(queueLength: number, jobsCompleted: number, ms: number): void {
    if (!this.enabled) return;
    this.budgetQueueLength = queueLength;
    if (queueLength > this.budgetQueueMax) this.budgetQueueMax = queueLength;
    this.budgetJobsCompleted += jobsCompleted;
    this.budgetMs += ms;
  }

  recordBudgetJobAdded(): void {
    if (!this.enabled) return;
    this.budgetJobsAdded++;
  }

  // === Collider map diagnostics ===
  recordColliderMapSize(size: number): void {
    if (!this.enabled) return;
    this.colliderMapSize = size;
    if (size > this.colliderMapMax) this.colliderMapMax = size;
  }

  // === Signature stability diagnostics ===
  recordSignatureChange(reason: string): void {
    if (!this.enabled) return;
    this.sigChanges++;
    if (this.sigChangeReasons.length < 5) {
      this.sigChangeReasons.push(reason);
    }
  }

  // === Re-render pipeline diagnostics ===
  recordNormalEntriesEval(): void {
    if (!this.enabled) return;
    this.normalEntriesEvals++;
  }

  recordMutationRender(): void {
    if (!this.enabled) return;
    this.mutationRenderFires++;
  }

  recordMutationRenderSkip(): void {
    if (!this.enabled) return;
    this.mutationRenderSkips++;
  }

  // === User data loading diagnostics ===
  recordUserDataStart(): void {
    // Always record (no enabled guard) — user data loads before D-Flow is toggled on,
    // so gating on this.enabled would leave status stuck at 'pending' forever.
    this.userDataStatus = 'loading';
    this.userDataLoadMs = performance.now();
  }

  recordUserDataSuccess(): void {
    this.userDataStatus = 'success';
    this.userDataLoadMs = performance.now() - this.userDataLoadMs;
    this.userDataError = null;
  }

  recordUserDataError(error: string): void {
    this.userDataStatus = 'error';
    this.userDataLoadMs = performance.now() - this.userDataLoadMs;
    this.userDataError = error;
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

      // Budgeted work queue
      budgetQueueLength: this.budgetQueueLength,
      budgetQueueMax: this.budgetQueueMax,
      budgetJobsAddedTotal: this.budgetJobsAddedTotal,
      budgetJobsCompletedTotal: this.budgetJobsCompletedTotal,
      budgetMsTotal: this.budgetMsTotal,

      // Collider map
      colliderMapSize: this.colliderMapSize,
      colliderMapMax: this.colliderMapMax,

      // Signature stability
      sigChangesTotal: this.sigChangesTotal,

      // Re-render pipeline
      normalEntriesEvalsTotal: this.normalEntriesEvalsTotal,
      mutationRenderFiresTotal: this.mutationRenderFiresTotal,
      mutationRenderSkipsTotal: this.mutationRenderSkipsTotal,

      // User data
      userDataStatus: this.userDataStatus,
      userDataError: this.userDataError,
      userDataLoadMs: this.userDataLoadMs,
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

      // Reset dispose tracking
      this.disposeGeometry = 0;
      this.disposeMaterial = 0;
      this.disposeMesh = 0;
      this.disposeGeometryTotal = 0;
      this.disposeMaterialTotal = 0;
      this.disposeMeshTotal = 0;

      // Defer GPU object start capture to first tick (when captureRendererStats has run)
      this.geometriesStart = -1;
      this.texturesStart = -1;

      // Reset budgeted work diagnostics
      this.budgetQueueLength = 0;
      this.budgetQueueMax = 0;
      this.budgetJobsAdded = 0;
      this.budgetJobsCompleted = 0;
      this.budgetMs = 0;
      this.budgetJobsAddedTotal = 0;
      this.budgetJobsCompletedTotal = 0;
      this.budgetMsTotal = 0;

      // Reset collider map diagnostics
      this.colliderMapSize = 0;
      this.colliderMapMax = 0;

      // Reset signature diagnostics
      this.sigChanges = 0;
      this.sigChangesTotal = 0;
      this.sigChangeReasons = [];

      // Reset re-render pipeline diagnostics
      this.normalEntriesEvals = 0;
      this.normalEntriesEvalsTotal = 0;
      this.mutationRenderFires = 0;
      this.mutationRenderFiresTotal = 0;
      this.mutationRenderSkips = 0;
      this.mutationRenderSkipsTotal = 0;

      // DO NOT reset userDataStatus — it is recorded without the enabled guard,
      // so it already reflects the true state from the initial load.
      // Resetting it here would overwrite 'success' with 'pending' since
      // user data loads once at startup and doesn't re-run when D-Flow toggles.
      // this.userDataStatus = 'pending';  // <-- was the bug: overwrote already-loaded status
      // this.userDataError = null;
      // this.userDataLoadMs = 0;

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

    // Deferred start capture (same as tick)
    if (this.geometriesStart < 0 && this.geometries > 0) {
      this.geometriesStart = this.geometries;
      this.texturesStart = this.textures;
    }

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

      // [50-51] Per-sample stall signals
      this.buffer[i+50] = this.chunkUnloads;
      this.buffer[i+51] = this.colliderRemoves;

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

    // Dispose tracking
    this.disposeGeometryTotal += this.disposeGeometry;
    this.disposeMaterialTotal += this.disposeMaterial;
    this.disposeMeshTotal += this.disposeMesh;
    this.disposeGeometry = 0;
    this.disposeMaterial = 0;
    this.disposeMesh = 0;

    // Chunk rendering diagnostics
    this.chunkRenderCountTotal = this.chunkRenderCount; // snapshot, not accumulated
    this.chunkRebuildCountTotal += this.chunkRebuildCount;
    this.chunkRebuildMsTotal += this.chunkRebuildMs;
    this.globalFlattenMsTotal += this.globalFlattenMs;

    this.chunkRebuildCount = 0;
    this.chunkRebuildMs = 0;
    this.globalFlattenMs = 0;

    // Budgeted work diagnostics
    this.budgetJobsAddedTotal += this.budgetJobsAdded;
    this.budgetJobsCompletedTotal += this.budgetJobsCompleted;
    this.budgetMsTotal += this.budgetMs;

    this.budgetJobsAdded = 0;
    this.budgetJobsCompleted = 0;
    this.budgetMs = 0;
    this.budgetQueueMax = this.budgetQueueLength; // reset max to current

    // Signature diagnostics
    this.sigChangesTotal += this.sigChanges;
    this.sigChanges = 0;
    this.sigChangeReasons = [];

    // Re-render pipeline diagnostics
    this.normalEntriesEvalsTotal += this.normalEntriesEvals;
    this.mutationRenderFiresTotal += this.mutationRenderFires;
    this.mutationRenderSkipsTotal += this.mutationRenderSkips;
    this.normalEntriesEvals = 0;
    this.mutationRenderFires = 0;
    this.mutationRenderSkips = 0;
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

    // Deferred start capture: snapshot GPU counts once renderer stats are available
    if (this.geometriesStart < 0 && this.geometries > 0) {
      this.geometriesStart = this.geometries;
      this.texturesStart = this.textures;
    }
    
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

      // [50-51] Per-sample stall signals
      this.buffer[i+50] = this.chunkUnloads;
      this.buffer[i+51] = this.colliderRemoves;

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
    let maxChunkUnloadsSample = 0, maxColliderRemovesSample = 0;
    let maxChunkUnloadsAt = 0, maxColliderRemovesAt = 0;

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

      const cUnld = this.buffer[i+50];
      if (cUnld > maxChunkUnloadsSample) { maxChunkUnloadsSample = cUnld; maxChunkUnloadsAt = s; }

      const cColRm = this.buffer[i+51];
      if (cColRm > maxColliderRemovesSample) { maxColliderRemovesSample = cColRm; maxColliderRemovesAt = s; }
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
    lines.push(`  Draw Call Breakdown: tree=${this.drawCallsTreeAtlas}, nonTree=${this.drawCallsNonTree}, fade=${this.drawCallsFade}, other=${Math.max(0, Math.round(drawCallsSum/n) - this.drawCallsTreeAtlas - this.drawCallsNonTree - this.drawCallsFade)}`);
    lines.push(`  JS Heap: ${heapStart.toFixed(0)}MB -> ${heapEnd.toFixed(0)}MB (${heapEnd > heapStart ? '+' : ''}${(heapEnd-heapStart).toFixed(0)}MB)`);
    const geoStart = Math.max(0, this.geometriesStart);
    const texStart = Math.max(0, this.texturesStart);
    const geoDelta = this.geometries - geoStart;
    const texDelta = this.textures - texStart;
    lines.push(`  GPU Geometries: ${geoStart} -> ${this.geometries} (${geoDelta > 0 ? '+' : ''}${geoDelta})`);
    lines.push(`  GPU Textures: ${texStart} -> ${this.textures} (${texDelta > 0 ? '+' : ''}${texDelta})`);
    if (geoDelta > 20) {
      lines.push(`  ⚠️ GEOMETRY LEAK: ${geoDelta} geometries accumulated!`);
    }
    lines.push(`  Disposes: ${this.disposeGeometryTotal} geo, ${this.disposeMaterialTotal} mat, ${this.disposeMeshTotal} mesh`);
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

    lines.push('--- Raw Data (last 20 samples) ---');
    lines.push('sample fps frames wGrid eGrid drawCalls tCtrl tAI tBlk tRender cUnld cColRm');

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
        `${this.buffer[i+30].toFixed(1)} ` +
        `${this.buffer[i+50].toFixed(0)} ` +
        `${this.buffer[i+51].toFixed(0)}`
      );
    }

    // Add stall diagnostics section
    lines.push('');
    lines.push('--- Stall Diagnostics ---');
    lines.push(`LongTasks: ${this.longTaskCountTotal} (${this.longTaskMsTotal.toFixed(1)}ms total)`);
    lines.push(`EventLoopLag: ${this.eventLoopLagCountTotal} spikes (max ${this.eventLoopLagMaxMsTotal.toFixed(1)}ms)`);
    lines.push(`Chunk Loads/Unloads: ${this.chunkLoadsTotal}/${this.chunkUnloadsTotal}`);
    lines.push(`Chunk Fetch/Build: ${this.chunkFetchMsTotal.toFixed(1)}ms / ${this.chunkBuildMsTotal.toFixed(1)}ms`);
    lines.push(`Emits: ${this.emitsTotal}, Flatten: ${this.flattenMsTotal.toFixed(1)}ms (${this.flattenBlocksTotal} blocks)`);
    lines.push(`Colliders: +${this.colliderAddsTotal} -${this.colliderRemovesTotal} (${this.colliderMsTotal.toFixed(1)}ms)`);
    lines.push(`Max chunk unloads/sample: ${maxChunkUnloadsSample.toFixed(0)} (sample ${maxChunkUnloadsAt})`);
    lines.push(`Max collider removes/sample: ${maxColliderRemovesSample.toFixed(0)} (sample ${maxColliderRemovesAt})`);
    lines.push(`Grouping: ${this.groupCacheHitsTotal} hits, ${this.groupCacheMissesTotal} misses (${this.groupMsTotal.toFixed(1)}ms for ${this.groupBlocksTotal} blocks)`);
    lines.push(`MeshRebuild: ${this.meshRebuildCountTotal} rebuilds (${this.meshRebuildMsTotal.toFixed(1)}ms for ${this.meshRebuildBlocksTotal} blocks)`);
    lines.push('');
    lines.push('--- Budgeted Work Queue ---');
    lines.push(`Queue: ${this.budgetQueueLength} pending (max ${this.budgetQueueMax})`);
    lines.push(`Jobs: +${this.budgetJobsAddedTotal} added, -${this.budgetJobsCompletedTotal} completed`);
    const backlog = this.budgetJobsAddedTotal - this.budgetJobsCompletedTotal;
    if (backlog > 0) {
      lines.push(`⚠️ BACKLOG: ${backlog} jobs accumulating faster than processed!`);
    }
    lines.push(`Time: ${this.budgetMsTotal.toFixed(1)}ms total`);
    lines.push('');
    lines.push('--- Collider Map ---');
    lines.push(`colliderByBlockId.size: ${this.colliderMapSize} (max ${this.colliderMapMax})`);
    if (this.colliderMapMax > 100000) {
      lines.push(`⚠️ BLOAT: Collider map exceeds 100K entries!`);
    }
    lines.push('');
    lines.push('--- Signature Stability ---');
    lines.push(`Signature changes: ${this.sigChangesTotal}`);
    if (this.sigChangesTotal > 10) {
      lines.push(`⚠️ INSTABILITY: High signature churn causing mesh rebuilds`);
    }
    lines.push('');
    lines.push('--- Re-Render Pipeline ---');
    lines.push(`normalEntries evals: ${this.normalEntriesEvalsTotal}`);
    lines.push(`Mutation renders: ${this.mutationRenderFiresTotal} fired, ${this.mutationRenderSkipsTotal} throttled`);
    lines.push('');
    lines.push('--- User Data ---');
    lines.push(`Status: ${this.userDataStatus}`);
    if (this.userDataStatus === 'success') {
      lines.push(`Load time: ${this.userDataLoadMs.toFixed(0)}ms`);
    } else if (this.userDataStatus === 'error') {
      lines.push(`Error: ${this.userDataError}`);
    }
    lines.push('');
    lines.push('--- Chunk Rendering ---');
    lines.push(`ChunkRenderers: ${this.chunkRenderCountTotal}`);
    lines.push(`ChunkRebuilds: ${this.chunkRebuildCountTotal} (${this.chunkRebuildMsTotal.toFixed(1)}ms)`);
    lines.push(`GlobalFlatten: ${this.globalFlattenMsTotal.toFixed(1)}ms`);
    lines.push(`MeshInstances: ${this.meshInstanceTotal}`);
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
