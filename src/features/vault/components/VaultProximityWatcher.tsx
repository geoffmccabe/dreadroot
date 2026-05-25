// Thin in-Canvas wrapper around useVaultProximity. Lives inside the
// Three.js scene so useFrame works; reports back to parent via a
// callback so the HUD prompt + V-key gating can live in regular DOM.

import React, { useEffect } from 'react';
import * as THREE from 'three';
import { useVaultProximity } from '../hooks/useVaultProximity';

interface Props {
  cameraRef: React.RefObject<THREE.Camera>;
  enabled: boolean;
  onChange: (inRange: boolean) => void;
}

export function VaultProximityWatcher({ cameraRef, enabled, onChange }: Props) {
  const inRange = useVaultProximity({ cameraRef, enabled });
  useEffect(() => { onChange(inRange); }, [inRange, onChange]);
  return null;
}
