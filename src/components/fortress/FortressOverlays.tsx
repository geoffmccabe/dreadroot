import React from 'react';

import { AdminPanel } from '@/components/AdminPanel';
import { UserPanel } from '@/components/UserPanel';
import { Toaster } from '@/components/ui/toaster';
import { PerformanceOverlay } from '@/components/PerformanceOverlay';
import { FungalTreeDiagnostics } from '@/components/FungalTreeDiagnostics';
import { TreeChopConfirmModal } from '@/features/trees/components/TreeChopConfirmModal';
import { DeathOverlay } from '@/features/shwarm';

import { PentabulletCrosshair } from './PentabulletCrosshair';

// Intentionally loose typing: this file is an extraction of UI overlays
// from a large component, and we want minimal friction during refactor.
type FortressOverlaysProps = any;

export function FortressOverlays(props: FortressOverlaysProps) {
  const {
    settings,
    handleSettingsChange,
    setWallPositions,
    setIsMoveMode,
    weatherSettings,
    handleWeatherSettingsChange,

    handleBlockPurchased,

    pentabulletCharge,
    blockPlacementMode,
    treePlacementMode,
    crosshairsEnabled,
    bulletColor,

    isDead,
    respawnTimer,
    respawn,
    setRespawnPosition,
    setRespawnTimer,

    godMode,
    performanceMode,
    plantedTrees,

    treeChopModalOpen,
    pendingChopPosition,
    chopProgress,
    setTreeChopModalOpen,
    setPendingChopPosition,
    setChopProgress,
    handleTreeChopConfirm,
  } = props;

  const baseMode = blockPlacementMode
    ? 'building'
    : treePlacementMode
      ? 'planting'
      : crosshairsEnabled
        ? 'shooting'
        : 'inactive';

  return (
    <>
      {/* Admin Panel */}
      <AdminPanel
        waterfallSettings={settings}
        onWaterfallSettingsChange={handleSettingsChange}
        onWallPositionsChange={setWallPositions}
        onMoveModeChange={setIsMoveMode}
        weatherSettings={weatherSettings}
        onWeatherSettingsChange={handleWeatherSettingsChange}
      />

      {/* User Panel */}
      <UserPanel onBlockPurchased={handleBlockPurchased} />

      {/* Crosshair */}
      <PentabulletCrosshair
        chargeProgress={pentabulletCharge}
        baseMode={baseMode}
        bulletColor={bulletColor}
      />

      {/* Death Overlay */}
      <DeathOverlay
        isDead={isDead}
        respawnTimer={respawnTimer}
        onRespawn={() => {
          const spawnPos = respawn?.();
          if (spawnPos && setRespawnPosition) setRespawnPosition(spawnPos);
          if (setRespawnTimer) setRespawnTimer(0);
        }}
      />

      {/* God Mode HUD Indicator */}
      {!!godMode && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-purple-600/90 text-white px-6 py-2 rounded-lg font-bold text-lg border border-purple-400/50 shadow-lg shadow-purple-500/30">
          GOD MODE (~)
        </div>
      )}

      {/* Performance Mode HUD Indicator */}
      {!!performanceMode && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-green-600/90 text-white px-6 py-2 rounded-lg font-bold text-lg border border-green-400/50 shadow-lg shadow-green-500/30">
          PERF MODE (0)
        </div>
      )}

      {/* Tree Chop Confirmation Modal */}
      <TreeChopConfirmModal
        isOpen={!!treeChopModalOpen}
        onConfirm={() => {
          if (typeof handleTreeChopConfirm === 'function') {
            handleTreeChopConfirm();
            return;
          }
          // Fallback: close modal if the confirm handler isn't wired yet.
          if (setTreeChopModalOpen) setTreeChopModalOpen(false);
          if (setPendingChopPosition) setPendingChopPosition(null);
          if (setChopProgress) setChopProgress(0);
        }}
        onCancel={() => {
          if (setTreeChopModalOpen) setTreeChopModalOpen(false);
          if (setPendingChopPosition) setPendingChopPosition(null);
          if (setChopProgress) setChopProgress(0);
        }}
        pendingChopPosition={pendingChopPosition}
        chopProgress={chopProgress}
      />

      {/* Toast notifications */}
      <Toaster />

      {/* Performance Overlay - Toggle with Shift+3 */}
      <PerformanceOverlay />

      {/* Tree Growth Diagnostics - Toggle with Shift+4 */}
      <FungalTreeDiagnostics plantedTrees={plantedTrees} />
    </>
  );
}
