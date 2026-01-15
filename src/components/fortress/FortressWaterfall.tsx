import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { WaterfallDrop } from './FortressTypes';
import { useBlocks } from '@/contexts/BlocksContext';
import { CHUNK_SIZE } from '@/lib/chunkManager';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';

interface WaterfallProps {
  flowSpeed?: number;
  msBetweeenDrops?: number;
  colorPalette: Array<{ hex: string; weight: number }>;
}

// Constants outside component to avoid recreation
const FALL_CONFIG = {
  width: 6,
  depth: 0.6,
  topY: 19.95,
  bottomY: 0.2,
  centerX: 0,
  z: -6.8
} as const;

const VISIBILITY_CHECK_THROTTLE = 200;
const MAX_DROPS = 500;

export function Waterfall({ 
  flowSpeed = 1.2, 
  msBetweeenDrops = 10, 
  colorPalette 
}: WaterfallProps) {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const activeDropsRef = useRef<WaterfallDrop[]>([]);
  const timeAccumulatorRef = useRef(0);
  const nextInactiveIndexRef = useRef(0);
  
  // Use refs for values accessed in frame loop to avoid re-registration
  const { camera } = useThree();
  const { visualDistance } = useBlocks();
  const visualDistanceRef = useRef(visualDistance);
  const flowSpeedRef = useRef(flowSpeed);
  const msBetweeenDropsRef = useRef(msBetweeenDrops);
  
  // Update refs when props change
  useEffect(() => { visualDistanceRef.current = visualDistance; }, [visualDistance]);
  useEffect(() => { flowSpeedRef.current = flowSpeed; }, [flowSpeed]);
  useEffect(() => { msBetweeenDropsRef.current = msBetweeenDrops; }, [msBetweeenDrops]);
  
  // Visibility as ref (no state updates in frame loop!)
  const isVisibleRef = useRef(true);
  const lastVisibilityCheck = useRef(0);

  // Water drop colors with proper normalization
  const dropPaletteColors = useMemo(() => {
    return colorPalette.map(item => ({
      color: new THREE.Color(item.hex),
      weight: item.weight,
      hex: item.hex
    }));
  }, [colorPalette]);

  // Create cumulative distribution function
  const dropCDF = useMemo(() => {
    const cdf: number[] = [];
    let sum = 0;
    for (const p of dropPaletteColors) {
      sum += p.weight;
      cdf.push(sum);
    }
    for (let i = 0; i < cdf.length; i++) {
      cdf[i] /= sum;
    }
    return cdf;
  }, [dropPaletteColors]);

  // Store palette in ref for frame loop access
  const dropPaletteRef = useRef(dropPaletteColors);
  const dropCDFRef = useRef(dropCDF);
  useEffect(() => { 
    dropPaletteRef.current = dropPaletteColors; 
    dropCDFRef.current = dropCDF;
  }, [dropPaletteColors, dropCDF]);

  // Pre-allocated color for pickColor
  const tempPickColor = useMemo(() => new THREE.Color(), []);

  const pickColor = useCallback(() => {
    const r = Math.random();
    const cdf = dropCDFRef.current;
    const palette = dropPaletteRef.current;
    for (let i = 0; i < cdf.length; i++) {
      if (r <= cdf[i]) {
        tempPickColor.set(palette[i].hex);
        tempPickColor.multiplyScalar(0.4);
        return tempPickColor.clone();
      }
    }
    tempPickColor.set(palette[palette.length - 1].hex);
    tempPickColor.multiplyScalar(0.4);
    return tempPickColor.clone();
  }, [tempPickColor]);

  // Initialize drops array once
  useEffect(() => {
    activeDropsRef.current = Array.from({ length: MAX_DROPS }, () => ({
      position: new THREE.Vector3(0, FALL_CONFIG.topY, FALL_CONFIG.z),
      velocity: 0,
      stretchFactor: 10,
      color: pickColor(),
      active: false
    }));
  }, [pickColor]);

  // Reusable objects for animation loop - stable refs
  const matrix = useRef(new THREE.Matrix4());
  const posVec = useRef(new THREE.Vector3());
  const scaleVec = useRef(new THREE.Vector3());
  const quaternion = useRef(new THREE.Quaternion());

  // Register with centralized frame loop - STABLE dependencies only
  useEffect(() => {
    const unregister = frameLoop.register('waterfall', (delta) => {
      diagnostics.useFrameCallCount++;
      
      const mesh = instancedMeshRef.current;
      if (!mesh) return;
      
      // Check visibility with throttle (no state updates!)
      const now = Date.now();
      if (now - lastVisibilityCheck.current > VISIBILITY_CHECK_THROTTLE) {
        lastVisibilityCheck.current = now;
        const dx = camera.position.x - FALL_CONFIG.centerX;
        const dz = camera.position.z - FALL_CONFIG.z;
        const distSq = dx * dx + dz * dz;
        const maxDistance = visualDistanceRef.current * CHUNK_SIZE;
        isVisibleRef.current = distSq <= maxDistance * maxDistance;
      }
      
      if (!isVisibleRef.current) {
        mesh.count = 0;
        return;
      }

      const mul = flowSpeedRef.current;
      const msInterval = msBetweeenDropsRef.current;
      timeAccumulatorRef.current += delta * 1000;

      // Spawn new drops
      while (timeAccumulatorRef.current >= msInterval) {
        timeAccumulatorRef.current -= msInterval;

        const drops = activeDropsRef.current;
        let found = false;
        for (let i = 0; i < drops.length; i++) {
          const idx = (nextInactiveIndexRef.current + i) % drops.length;
          if (!drops[idx].active) {
            const drop = drops[idx];
            drop.active = true;
            drop.position.set(
              FALL_CONFIG.centerX + (Math.random() - 0.5) * FALL_CONFIG.width,
              FALL_CONFIG.topY,
              FALL_CONFIG.z + (Math.random() - 0.5) * FALL_CONFIG.depth
            );
            drop.velocity = 0;
            drop.color = pickColor();
            nextInactiveIndexRef.current = (idx + 1) % drops.length;
            found = true;
            break;
          }
        }
        if (!found) break;
      }

      let activeCount = 0;
      const mat = matrix.current;
      const pos = posVec.current;
      const sc = scaleVec.current;
      const quat = quaternion.current;

      // Update all active drops
      for (let i = 0; i < activeDropsRef.current.length; i++) {
        const drop = activeDropsRef.current[i];
        if (!drop.active) continue;

        // Apply gravity
        drop.velocity += 9.8 * mul * delta;
        drop.position.y -= drop.velocity * delta;

        // Check if drop reached bottom
        if (drop.position.y <= FALL_CONFIG.bottomY) {
          drop.active = false;
          continue;
        }

        // Calculate stretch
        const fallProgress = 1 - (drop.position.y - FALL_CONFIG.bottomY) / (FALL_CONFIG.topY - FALL_CONFIG.bottomY);
        const stretchMultiplier = 1 + (drop.stretchFactor - 1) * fallProgress;

        const baseSize = 0.1;
        const scaleY = baseSize * stretchMultiplier;
        sc.set(baseSize, scaleY, baseSize);

        const yOffset = (scaleY - baseSize) / 2;
        pos.set(drop.position.x, drop.position.y + yOffset, drop.position.z);

        quat.identity();
        mat.compose(pos, quat, sc);
        mesh.setMatrixAt(activeCount, mat);
        mesh.setColorAt(activeCount, drop.color);

        activeCount++;
      }

      mesh.count = activeCount;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }, 40);

    return unregister;
  }, [camera, pickColor]); // Only stable deps: camera object and pickColor (which only depends on tempPickColor)

  return (
    <instancedMesh
      ref={instancedMeshRef}
      args={[undefined, undefined, MAX_DROPS]}
      frustumCulled={true}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        transparent
        opacity={0.8}
        depthWrite={false}
        depthTest={true}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}
