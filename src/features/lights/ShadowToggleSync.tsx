// Makes the runtime shadow toggle ('-' key → shadowStore) actually take effect: when
// it flips, force the shadow map to refresh and recompile scene materials so they
// include/exclude shadow sampling. Lives inside the Canvas. Also owns the key handler.
import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { shadowStore, useShadowsEnabled } from './shadowStore';

export function ShadowToggleSync() {
  const { gl, scene } = useThree();
  const enabled = useShadowsEnabled();

  // The UNDERSCORE character ('_' = Shift+Minus) toggles shadows. Match e.key === '_', NOT
  // e.code === 'Minus' — the latter is the same physical key as '-', so it (and its
  // preventDefault) was hijacking plain Cmd+'-' and blocking Chrome's zoom-out. Plain '-'
  // (with or without Cmd) now passes straight through to the browser.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '_') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      shadowStore.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Apply the toggle: shadow map on/off + recompile materials so the change is visible.
  useEffect(() => {
    gl.shadowMap.enabled = enabled;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    gl.shadowMap.needsUpdate = true;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      if (Array.isArray(m)) m.forEach((mm) => (mm.needsUpdate = true));
      else m.needsUpdate = true;
    });
  }, [enabled, gl, scene]);

  return null;
}
