/**
 * Installs the obstacle probe that matches the running world, and takes it down
 * again on unmount so a game switch cannot leave the previous world's probe
 * answering questions about geometry that is no longer loaded.
 */
import { useEffect } from 'react';
import { getActiveGame } from '@/config/activeGame';
import { gameUsesVoxels } from '@/config/gameRegistry';
import { installObstacleProbe, setObstacleProbe } from './index';

export function ObstacleProbeInstaller(): null {
  useEffect(() => {
    installObstacleProbe(gameUsesVoxels(getActiveGame()));
    return () => setObstacleProbe(null);
  }, []);
  return null;
}
