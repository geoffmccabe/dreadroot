/**
 * Wide Tree Lights
 *
 * Manages point lights near wide trees for glow bark illumination.
 * Each wide tree gets 1-3 dim point lights depending on tier.
 *
 * CRITICAL: a FIXED number of <pointLight>s is always rendered. Three.js
 * bakes the point-light count into every material's shader program
 * (NUM_POINT_LIGHTS), so changing the count forces a full shader recompile
 * of the whole scene — a multi-second main-thread freeze. Earlier this
 * component mounted a variable 0-20 lights recalculated every 500ms, which
 * recompiled shaders constantly while moving (trace 2026-05-22: repeated
 * multi-second stalls, screen flashing the clear colour). Now exactly
 * LIGHT_SLOTS lights always exist; unused slots are just set to intensity 0.
 *
 * Position check updates every 500ms (not per frame).
 */

import React, { useState, useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { PlantedTree } from '../types';

// Fixed number of point-light slots. Constant => shader compiles once, never
// recompiles. The closest wide-tree lights fill real slots; the rest sit at
// intensity 0. 8 nearby glow-casters is ample; distant ones contributed
// almost nothing at the old cap of 20 anyway (point-light range is only 20).
const LIGHT_SLOTS = 8;
const UPDATE_INTERVAL_MS = 500;

interface TreeLight {
  treeId: string;
  x: number;
  y: number;
  z: number;
  color: string;
  intensity: number;
  distance: number;
}

// An inert slot: intensity 0 contributes nothing, but the light still counts
// toward NUM_POINT_LIGHTS so the shader program stays stable.
const OFF_LIGHT: TreeLight = {
  treeId: '', x: 0, y: -10000, z: 0, color: '#000000', intensity: 0, distance: 1,
};

function makeOffSlots(): TreeLight[] {
  return Array.from({ length: LIGHT_SLOTS }, () => ({ ...OFF_LIGHT }));
}

function getLightCountForTier(tier: number): number {
  if (tier <= 3) return 1;
  if (tier <= 7) return 2;
  return 3;
}

interface WideTreeLightsProps {
  plantedTrees: PlantedTree[];
}

export function WideTreeLights({ plantedTrees }: WideTreeLightsProps) {
  const { camera } = useThree();
  // Always exactly LIGHT_SLOTS entries — never grows or shrinks.
  const [lightSlots, setLightSlots] = useState<TreeLight[]>(makeOffSlots);
  const treesRef = useRef(plantedTrees);
  treesRef.current = plantedTrees;

  useEffect(() => {
    const update = () => {
      const cam = camera.position;
      const wideTrees = treesRef.current.filter(
        t => t.seed_definition?.tree_type === 'wide' && t.is_fully_grown
      );

      if (wideTrees.length === 0) {
        setLightSlots(makeOffSlots());
        return;
      }

      // Generate potential lights for each wide tree, sorted by distance
      const allLights: (TreeLight & { distSq: number })[] = [];

      for (const tree of wideTrees) {
        const sd = tree.seed_definition!;
        const tier = sd.tier;
        const glowColor = sd.wide_glow_color ?? '#88ffaa';
        const lightCount = getLightCountForTier(tier);
        const height = sd.wide_max_height ?? 60;

        const dx = tree.base_x - cam.x;
        const dz = tree.base_z - cam.z;
        const distSq = dx * dx + dz * dz;

        for (let i = 0; i < lightCount; i++) {
          // Place lights at different heights along the trunk
          const heightFrac = 0.3 + (i / Math.max(1, lightCount - 1)) * 0.5;
          const lightY = tree.base_y + Math.floor(height * heightFrac);

          allLights.push({
            treeId: tree.id,
            x: tree.base_x,
            y: lightY,
            z: tree.base_z,
            color: glowColor,
            intensity: 0.3,
            distance: 20,
            distSq,
          });
        }
      }

      // Closest lights fill the fixed slots; remaining slots stay inert.
      allLights.sort((a, b) => a.distSq - b.distSq);
      const slots: TreeLight[] = [];
      for (let i = 0; i < LIGHT_SLOTS; i++) {
        slots.push(allLights[i] ?? { ...OFF_LIGHT });
      }
      setLightSlots(slots);
    };

    update();
    const interval = setInterval(update, UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [camera]);

  // Always render exactly LIGHT_SLOTS lights, keyed by slot index so React
  // never mounts/unmounts a light — it only updates props. The count is
  // therefore constant and the scene's shaders never recompile.
  return (
    <>
      {lightSlots.map((light, i) => (
        <pointLight
          key={i}
          position={[light.x + 0.5, light.y + 0.5, light.z + 0.5]}
          color={light.color}
          intensity={light.intensity}
          distance={light.distance}
          castShadow={false}
        />
      ))}
    </>
  );
}
