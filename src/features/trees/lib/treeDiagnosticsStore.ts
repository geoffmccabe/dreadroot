// Shared module-level store for tree growth diagnostics
// Written to by useTreeGrowthPoller and useSeedPlanting
// Read by FungalTreeDiagnostics overlay component

export interface PollResult {
  timestamp: number;
  treesProcessed: number;
  treesCompleted: number;
  blocksInserted: number;
  error?: string;
}

export interface PlantingEvent {
  timestamp: number;
  position: { x: number; y: number; z: number };
  tier: number;
  treeType: string;
  blueprintSaved: boolean;
  blueprintBlockCount: number;
  seedDefId: string;
  treeId?: string;
  error?: string;
}

export interface TreeDiagnosticsStore {
  // Poller status
  pollingActive: boolean;
  pollIntervalMs: number;
  lastPollTime: number;
  consecutiveErrors: number;
  lastErrorMessage: string | null;

  // Last poll result
  lastPollResult: PollResult | null;

  // Poll history (last 20)
  pollHistory: PollResult[];

  // Planting log (last 10 events)
  plantingLog: PlantingEvent[];

  // Counters
  totalPollCount: number;
  totalBlocksGrown: number;
  totalTreesCompleted: number;
}

// Module-level singleton - no React state, just a plain object
export const treeDiagnostics: TreeDiagnosticsStore = {
  pollingActive: false,
  pollIntervalMs: 0,
  lastPollTime: 0,
  consecutiveErrors: 0,
  lastErrorMessage: null,
  lastPollResult: null,
  pollHistory: [],
  plantingLog: [],
  totalPollCount: 0,
  totalBlocksGrown: 0,
  totalTreesCompleted: 0,
};

export function recordPollResult(result: PollResult) {
  treeDiagnostics.lastPollResult = result;
  treeDiagnostics.lastPollTime = result.timestamp;
  treeDiagnostics.totalPollCount++;

  if (result.error) {
    treeDiagnostics.consecutiveErrors++;
    treeDiagnostics.lastErrorMessage = result.error;
  } else {
    treeDiagnostics.consecutiveErrors = 0;
    treeDiagnostics.lastErrorMessage = null;
    treeDiagnostics.totalBlocksGrown += result.blocksInserted;
    treeDiagnostics.totalTreesCompleted += result.treesCompleted;
  }

  treeDiagnostics.pollHistory.push(result);
  if (treeDiagnostics.pollHistory.length > 20) {
    treeDiagnostics.pollHistory.shift();
  }
}

export function recordPlantingEvent(event: PlantingEvent) {
  treeDiagnostics.plantingLog.push(event);
  if (treeDiagnostics.plantingLog.length > 10) {
    treeDiagnostics.plantingLog.shift();
  }
}

export function setPollerStatus(active: boolean, intervalMs: number) {
  treeDiagnostics.pollingActive = active;
  treeDiagnostics.pollIntervalMs = intervalMs;
}
