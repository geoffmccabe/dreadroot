/**
 * Wide Tree Lights
 *
 * Manages sparse point lights near wide trees for glow bark illumination.
 * Each wide tree gets 1-3 dim point lights depending on tier.
 * Capped at 20 active lights scene-wide. Trees beyond camera threshold skip lights
 * (emissive blocks still glow, just no light casting).
 * Position check updates every 500ms (not per frame).
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { PlantedTree } from '../types';

const MAX_SCENE_LIGHTS = 20;
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
  const [activeLights, setActiveLights] = useState<TreeLight[]>([]);
  const treesRef = useRef(plantedTrees);
  treesRef.current = plantedTrees;

  useEffect(() => {
    const update = () => {
      const cam = camera.position;
      const wideTrees = treesRef.current.filter(
        t => t.seed_definition?.tree_type === 'wide' && t.is_fully_grown
      );

      if (wideTrees.length === 0) {
        setActiveLights([]);
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

      // Sort by distance and take closest up to MAX_SCENE_LIGHTS
      allLights.sort((a, b) => a.distSq - b.distSq);
      const selected = allLights.slice(0, MAX_SCENE_LIGHTS);

      setActiveLights(selected);
    };

    update();
    const interval = setInterval(update, UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [camera]);

  if (activeLights.length === 0) return null;

  return (
    <>
      {activeLights.map((light, i) => (
        <pointLight
          key={`${light.treeId}-${i}`}
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
