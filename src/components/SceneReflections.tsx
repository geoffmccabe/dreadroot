import React from 'react';

/**
 * SceneReflections - DISABLED FOR PERFORMANCE
 * CubeCamera.update() renders the entire scene 6 times per update.
 * This was causing massive CPU load even when throttled.
 */
export function SceneReflections() {
  // Completely disabled - return null
  return null;
}
