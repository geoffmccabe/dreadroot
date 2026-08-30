/**
 * Installs the scanner that matches the running world, and takes it down
 * again on unmount so a game switch cannot leave the previous world's scanner
 * answering questions about geometry that is no longer loaded.
 */
import { useEffect } from 'react';
import { getActiveGame } from '@/config/activeGame';
import { gameUsesVoxels } from '@/config/gameRegistry';
import { installScanner, setScanner } from './index';
import { installParkourDebug } from './debugProbe';
import { installCourseHooks } from './testCourse';

export function ScannerInstaller(): null {
  useEffect(() => {
    installScanner(gameUsesVoxels(getActiveGame()));
    installParkourDebug();
    installCourseHooks();
    return () => setScanner(null);
  }, []);
  return null;
}
