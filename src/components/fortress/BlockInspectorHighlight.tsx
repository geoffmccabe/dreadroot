/**
 * BlockInspectorHighlight - Renders a rainbow-animated edge highlight
 * around the currently inspected block in the Block Inspector.
 */

import * as THREE from 'three';
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { globalInspectData } from '@/components/FPSCounter';

// Color cycles through spectrum 5 times per second
const CYCLES_PER_SECOND = 5;

export function BlockInspectorHighlight() {
  const lineRef = useRef<THREE.LineSegments>(null);
  const lastPosRef = useRef({ x: -9999, y: -9999, z: -9999 });

  // Create edges geometry for a unit cube
  const edgesGeometry = useMemo(() => {
    const boxGeom = new THREE.BoxGeometry(1.02, 1.02, 1.02); // Slightly larger to avoid z-fighting
    const edges = new THREE.EdgesGeometry(boxGeom);
    boxGeom.dispose();
    return edges;
  }, []);

  // Line material with initial color
  const material = useMemo(() => {
    return new THREE.LineBasicMaterial({
      color: 0xff0000,
      linewidth: 2, // Note: linewidth > 1 only works on some systems
      transparent: true,
      opacity: 1,
      depthTest: true,
      depthWrite: false,
    });
  }, []);

  useFrame((state) => {
    const line = lineRef.current;
    if (!line) return;

    // Check if we have inspect data
    const data = globalInspectData;
    if (!data || !data.sources.state.found) {
      line.visible = false;
      return;
    }

    // Position at the inspected block
    const { x, y, z } = data.gridPos;

    // Only update position if it changed
    if (x !== lastPosRef.current.x || y !== lastPosRef.current.y || z !== lastPosRef.current.z) {
      line.position.set(x + 0.5, y + 0.5, z + 0.5);
      lastPosRef.current = { x, y, z };
    }

    line.visible = true;

    // Animate color through spectrum (5 cycles per second)
    const hue = (state.clock.elapsedTime * CYCLES_PER_SECOND) % 1;
    material.color.setHSL(hue, 1, 0.5);
  });

  return (
    <lineSegments
      ref={lineRef}
      geometry={edgesGeometry}
      material={material}
      visible={false}
      renderOrder={1000}
      frustumCulled={false}
    />
  );
}
