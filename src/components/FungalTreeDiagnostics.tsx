// Fungal Tree Diagnostics Panel
// Toggle with Shift+4 ($)
// Displays tree growth pipeline diagnostics in real-time

import { useEffect, useState, useRef } from 'react';
import { treeDiagnostics, type PollResult, type PlantingEvent } from '@/features/trees/lib/treeDiagnosticsStore';

interface PlantedTreeInfo {
  id: string;
  base_x: number;
  base_y: number;
  base_z: number;
  current_block_count: number;
  target_block_count: number;
  is_fully_grown: boolean;
  planted_at: string;
  seed_definition?: {
    tier?: number;
    tree_type?: string;
  } | null;
}

interface FungalTreeDiagnosticsProps {
  plantedTrees?: PlantedTreeInfo[];
}

function formatTime(ms: number): string {
  if (ms === 0) return 'never';
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function progressBar(current: number, target: number): string {
  const pct = target > 0 ? Math.round((current / target) * 100) : 0;
  const filled = Math.round(pct / 10);
  return `[${'#'.repeat(filled)}${'.'.repeat(10 - filled)}] ${pct}%`;
}

export function FungalTreeDiagnostics({ plantedTrees = [] }: FungalTreeDiagnosticsProps) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tick, setTick] = useState(0);

  // Toggle visibility with Shift+4
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === '$') {
        setVisible(prev => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Refresh display every 1 second when visible
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  const d = treeDiagnostics;

  // Separate growing trees
  const growingTrees = plantedTrees.filter(t => !t.is_fully_grown);
  const fungalTrees = plantedTrees.filter(t => t.seed_definition?.tree_type === 'fungal');
  const growingFungal = fungalTrees.filter(t => !t.is_fully_grown);

  // Calculate growth rate from poll history
  const recentPolls = d.pollHistory.filter(p => Date.now() - p.timestamp < 60000);
  const recentBlocks = recentPolls.reduce((sum, p) => sum + p.blocksInserted, 0);
  const growthRate = recentPolls.length > 0
    ? (recentBlocks / ((Date.now() - recentPolls[0].timestamp) / 60000)).toFixed(1)
    : '0';

  const pollerColor = d.pollingActive ? 'text-green-400' : 'text-red-400';
  const errorColor = d.consecutiveErrors > 0 ? 'text-red-400' : 'text-green-400';

  const handleCopy = () => {
    let text = `=== Tree Growth Diagnostics Report ===
Generated: ${new Date().toISOString()}

POLLER STATUS
  Active: ${d.pollingActive ? 'YES' : 'NO'}
  Interval: ${d.pollIntervalMs / 1000}s
  Last poll: ${formatTime(d.lastPollTime)}
  Errors: ${d.consecutiveErrors}
  Last error: ${d.lastErrorMessage || 'none'}
  Total polls: ${d.totalPollCount}
  Total blocks grown: ${d.totalBlocksGrown}
  Total trees completed: ${d.totalTreesCompleted}
  Growth rate: ${growthRate} blocks/min

TREE SUMMARY
  All trees: ${plantedTrees.length}
  Growing: ${growingTrees.length}
  Fungal total: ${fungalTrees.length}
  Fungal growing: ${growingFungal.length}

GROWING TREES`;

    for (const tree of growingTrees) {
      const tier = tree.seed_definition?.tier ?? '?';
      const type = tree.seed_definition?.tree_type ?? 'original';
      const pct = tree.target_block_count > 0
        ? Math.round((tree.current_block_count / tree.target_block_count) * 100)
        : 0;
      const age = Math.ceil((Date.now() - new Date(tree.planted_at).getTime()) / (1000 * 60 * 60 * 24));
      text += `
  ${shortId(tree.id)} | T${tier} ${type} | (${tree.base_x},${tree.base_y},${tree.base_z}) | ${tree.current_block_count}/${tree.target_block_count} (${pct}%) | ${age}d old`;
    }

    text += `

LAST POLL RESULT`;
    if (d.lastPollResult) {
      text += `
  Trees processed: ${d.lastPollResult.treesProcessed}
  Trees completed: ${d.lastPollResult.treesCompleted}
  Blocks inserted: ${d.lastPollResult.blocksInserted}
  Time: ${new Date(d.lastPollResult.timestamp).toISOString()}`;
      if (d.lastPollResult.error) {
        text += `
  ERROR: ${d.lastPollResult.error}`;
      }
    } else {
      text += '\n  No polls recorded yet';
    }

    text += `

PLANTING LOG (last ${d.plantingLog.length})`;
    for (const evt of d.plantingLog) {
      text += `
  ${new Date(evt.timestamp).toISOString().slice(11, 19)} | T${evt.tier} ${evt.treeType} | (${evt.position.x},${evt.position.y},${evt.position.z}) | BP:${evt.blueprintSaved ? 'OK' : 'FAIL'} ${evt.blueprintBlockCount}blk | ${evt.error || 'OK'}`;
    }

    text += `

POLL HISTORY (last ${d.pollHistory.length})`;
    for (const poll of d.pollHistory.slice(-10)) {
      text += `
  ${new Date(poll.timestamp).toISOString().slice(11, 19)} | ${poll.treesProcessed} trees | ${poll.blocksInserted} blocks | ${poll.error || 'OK'}`;
    }

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed top-2 right-2 z-[9999] bg-black/90 text-white font-mono text-[11px] p-3 rounded-lg select-none min-w-[280px] max-w-[340px] border border-white/20 shadow-lg max-h-[90vh] overflow-y-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/20">
        <div className="flex items-center gap-2">
          <span className="text-cyan-400 font-bold">TREE DX</span>
          <span className={`text-[10px] ${pollerColor}`}>
            {d.pollingActive ? 'POLLING' : 'IDLE'}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className={`pointer-events-auto text-[10px] px-2 py-1 rounded font-medium transition-colors ${
            copied ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
          }`}
        >
          {copied ? 'Copied' : 'COPY'}
        </button>
      </div>

      {/* Poller Status */}
      <div className="mb-2">
        <div className="text-cyan-400 text-[10px] font-bold mb-0.5">POLLER</div>
        <div className="space-y-0.5">
          <div className="flex justify-between">
            <span className="text-gray-400">Status</span>
            <span className={pollerColor}>{d.pollingActive ? 'Active' : 'Inactive'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Interval</span>
            <span>{d.pollIntervalMs > 0 ? `${d.pollIntervalMs / 1000}s` : '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Last poll</span>
            <span>{formatTime(d.lastPollTime)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Errors</span>
            <span className={errorColor}>{d.consecutiveErrors}</span>
          </div>
          {d.lastErrorMessage && (
            <div className="text-red-400 text-[10px] truncate">{d.lastErrorMessage}</div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-400">Total polls</span>
            <span>{d.totalPollCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Growth rate</span>
            <span className="text-green-400">{growthRate} blk/min</span>
          </div>
        </div>
      </div>

      {/* Tree Summary */}
      <div className="mb-2 pt-2 border-t border-white/10">
        <div className="text-cyan-400 text-[10px] font-bold mb-0.5">TREES</div>
        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <div>All: {plantedTrees.length}</div>
          <div>Growing: {growingTrees.length}</div>
          <div className="text-purple-400">Fungal: {fungalTrees.length}</div>
          <div className="text-purple-400">Fung grow: {growingFungal.length}</div>
          <div>Grown total: {d.totalBlocksGrown}</div>
          <div>Completed: {d.totalTreesCompleted}</div>
        </div>
      </div>

      {/* Growing Trees */}
      {growingTrees.length > 0 && (
        <div className="mb-2 pt-2 border-t border-white/10">
          <div className="text-cyan-400 text-[10px] font-bold mb-0.5">
            GROWING ({growingTrees.length})
          </div>
          <div className="space-y-1">
            {growingTrees.slice(0, 8).map(tree => {
              const tier = tree.seed_definition?.tier ?? '?';
              const type = tree.seed_definition?.tree_type ?? 'orig';
              const isFungal = type === 'fungal';
              const pct = tree.target_block_count > 0
                ? Math.round((tree.current_block_count / tree.target_block_count) * 100)
                : 0;
              return (
                <div key={tree.id} className={`text-[10px] ${isFungal ? 'text-purple-300' : 'text-gray-300'}`}>
                  <div className="flex justify-between">
                    <span>{shortId(tree.id)} T{tier} {type}</span>
                    <span>({tree.base_x},{tree.base_y},{tree.base_z})</span>
                  </div>
                  <div className="text-gray-500">
                    {progressBar(tree.current_block_count, tree.target_block_count)} {tree.current_block_count}/{tree.target_block_count}
                  </div>
                </div>
              );
            })}
            {growingTrees.length > 8 && (
              <div className="text-gray-500 text-[10px]">...+{growingTrees.length - 8} more</div>
            )}
          </div>
        </div>
      )}

      {/* Last Poll Result */}
      {d.lastPollResult && (
        <div className="mb-2 pt-2 border-t border-white/10">
          <div className="text-cyan-400 text-[10px] font-bold mb-0.5">LAST POLL</div>
          <div className="space-y-0.5 text-[10px]">
            <div className="flex justify-between">
              <span className="text-gray-400">Trees</span>
              <span>{d.lastPollResult.treesProcessed}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Completed</span>
              <span>{d.lastPollResult.treesCompleted}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Blocks</span>
              <span className={d.lastPollResult.blocksInserted > 0 ? 'text-green-400' : ''}>
                {d.lastPollResult.blocksInserted}
              </span>
            </div>
            {d.lastPollResult.error && (
              <div className="text-red-400 truncate">{d.lastPollResult.error}</div>
            )}
          </div>
        </div>
      )}

      {/* Planting Log */}
      {d.plantingLog.length > 0 && (
        <div className="mb-2 pt-2 border-t border-white/10">
          <div className="text-cyan-400 text-[10px] font-bold mb-0.5">
            PLANTING LOG ({d.plantingLog.length})
          </div>
          <div className="space-y-0.5">
            {d.plantingLog.slice(-5).reverse().map((evt, i) => {
              const isFungal = evt.treeType === 'fungal';
              return (
                <div key={i} className={`text-[10px] ${isFungal ? 'text-purple-300' : 'text-gray-300'}`}>
                  <div className="flex justify-between">
                    <span>T{evt.tier} {evt.treeType}</span>
                    <span>({evt.position.x},{evt.position.y},{evt.position.z})</span>
                  </div>
                  <div className="text-gray-500">
                    BP:{evt.blueprintSaved ? <span className="text-green-400">OK</span> : <span className="text-red-400">FAIL</span>}
                    {' '}{evt.blueprintBlockCount}blk
                    {evt.error && <span className="text-red-400"> {evt.error}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="pt-1 border-t border-white/10 text-gray-500 text-[9px] text-center">
        Shift+4 to close
      </div>
    </div>
  );
}
