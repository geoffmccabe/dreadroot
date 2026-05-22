/**
 * Glow Light Pool
 *
 * A single, FIXED-size pool of point lights for all emissive/glowing placed
 * blocks game-wide.
 *
 * CRITICAL: Three.js bakes the point-light count into every material's shader
 * program (NUM_POINT_LIGHTS). Changing the count recompiles every shader in
 * the scene — a multi-second main-thread freeze. Previously each
 * InstancedBlockGroup rendered its own 0-8 point lights, recomputed whenever
 * the camera moved 5+ units and varying as block-type groups mounted/
 * unmounted — so moving around recompiled all shaders constantly (trace
 * 2026-05-22: repeated multi-second stalls). This component renders exactly
 * LIGHT_SLOTS point lights, always: the closest glowing blocks fill real
 * slots, the rest sit at intensity 0. The count never changes, so shaders
 * compile once and never recompile.
 *
 * Position check updates every 500ms (not per frame).
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useBlocks } from '@/contexts/BlocksContext';
import { useBlocksData } from '@/hooks/useBlocksData';

// Fixed number of glow-light slots — constant => shaders never recompile.
const LIGHT_SLOTS = 8;
const UPDATE_INTERVAL_MS = 500;
const MAX_GLOW_DISTANCE = 50;

interface GlowLight {
  x: number;
  y: number;
  z: number;
  color: string;
  intensity: number;
  distance: number;
}

// Inert slot: intensity 0 contributes nothing but still counts toward
// NUM_POINT_LIGHTS so the shader program stays stable.
const OFF_LIGHT: GlowLight = { x: 0, y: -10000, z: 0, color: '#000000', intensity: 0, distance: 1 };
function makeOffSlots(): GlowLight[] {
  return Array.from({ length: LIGHT_SLOTS }, () => ({ ...OFF_LIGHT }));
}

export function GlowLightPool() {
  const { camera } = useThree();
  const { blocks } = useBlocks();
  const { blocksMap } = useBlocksData();
  const [lightSlots, setLightSlots] = useState<GlowLight[]>(makeOffSlots);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  // Which block-type keys are emissive glowers, and their glow params.
  const glowTypes = useMemo(() => {
    const m = new Map<string, { color: string; intensity: number; distance: number }>();
    for (const [key, def] of blocksMap) {
      const glowFactor = def?.properties?.glowFactor || 0;
      if (def?.properties?.emissive && glowFactor > 0) {
        m.set(key, {
          color: def.properties.color || '#FFE135',
          intensity: glowFactor * 2,
          distance: glowFactor * 3,
        });
      }
    }
    return m;
  }, [blocksMap]);

  useEffect(() => {
    if (glowTypes.size === 0) {
      setLightSlots(makeOffSlots());
      return;
    }
    const update = () => {
      const cam = camera.position;
      const maxD2 = MAX_GLOW_DISTANCE * MAX_GLOW_DISTANCE;
      const found: (GlowLight & { d2: number })[] = [];
      const bl = blocksRef.current;
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        const g = glowTypes.get(b.block_type);
        if (!g) continue;
        const x = b.position_x + 0.5, y = b.position_y + 0.5, z = b.position_z + 0.5;
        const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxD2) continue;
        found.push({ x, y, z, color: g.color, intensity: g.intensity, distance: g.distance, d2 });
      }
      // Closest glowers fill the fixed slots; the rest stay inert.
      found.sort((a, b) => a.d2 - b.d2);
      const slots: GlowLight[] = [];
      for (let i = 0; i < LIGHT_SLOTS; i++) {
        slots.push(found[i] ?? { ...OFF_LIGHT });
      }
      setLightSlots(slots);
    };
    update();
    const interval = setInterval(update, UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [camera, glowTypes]);

  // Always render exactly LIGHT_SLOTS lights, keyed by slot index so React
  // only updates props — the count is constant and shaders never recompile.
  return (
    <>
      {lightSlots.map((light, i) => (
        <pointLight
          key={i}
          position={[light.x, light.y, light.z]}
          color={light.color}
          intensity={light.intensity}
          distance={light.distance}
          decay={2}
          castShadow={false}
        />
      ))}
    </>
  );
}
