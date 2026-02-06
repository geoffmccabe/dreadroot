import { useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
import * as THREE from 'three';

const MAX_TRACERS = 5000; // Max tracer segments in pool
const TRACER_VISIBLE_DURATION = 1.5; // Seconds at full opacity
const TRACER_FADE_DURATION = 0.5; // Seconds to fade out after visible period (2 sec total)
const BASE_OPACITY = 0.125; // 87.5% transparent (half of previous)

interface TracerSegment {
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  lightenedR: number; // Pre-computed lightened color
  lightenedG: number;
  lightenedB: number;
  createdAt: number;
  active: boolean;
}

export interface TracersHandle {
  addSegment: (
    startX: number, startY: number, startZ: number,
    endX: number, endY: number, endZ: number,
    color: string
  ) => void;
  update: () => void;
}

// Reusable scratch color to avoid GC pressure
const tmpColor = new THREE.Color();

/**
 * Lighten a color 50% toward white for vapor effect
 */
function computeLightenedColor(hexColor: string, factor: number = 0.5): { r: number; g: number; b: number } {
  tmpColor.set(hexColor);
  // Lerp each channel toward white (1.0)
  const r = tmpColor.r + (1 - tmpColor.r) * factor;
  const g = tmpColor.g + (1 - tmpColor.g) * factor;
  const b = tmpColor.b + (1 - tmpColor.b) * factor;
  return { r, g, b };
}

export const Tracers = forwardRef<TracersHandle>((_, ref) => {
  const segmentsRef = useRef<TracerSegment[]>([]);
  const nextIndexRef = useRef(0);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const positionsRef = useRef<Float32Array | null>(null);
  const colorsRef = useRef<Float32Array | null>(null);
  const meshRef = useRef<THREE.LineSegments | null>(null);
  
  // Create geometry and material once
  const { geometry, material } = useMemo(() => {
    // Pre-allocate pool
    segmentsRef.current = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      segmentsRef.current.push({
        startX: 0, startY: 0, startZ: 0,
        endX: 0, endY: 0, endZ: 0,
        lightenedR: 1, lightenedG: 1, lightenedB: 1,
        createdAt: 0,
        active: false,
      });
    }
    
    // Create buffer geometry with pre-allocated arrays
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_TRACERS * 2 * 3); // 2 vertices per segment, 3 components
    const colors = new Float32Array(MAX_TRACERS * 2 * 3);
    
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0); // Start with nothing visible
    
    positionsRef.current = positions;
    colorsRef.current = colors;
    geometryRef.current = geo;
    
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1.0, // Opacity handled per-vertex via color
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    
    return { geometry: geo, material: mat };
  }, []);

  useImperativeHandle(ref, () => ({
    addSegment: (
      startX: number, startY: number, startZ: number,
      endX: number, endY: number, endZ: number,
      color: string
    ) => {
      const segment = segmentsRef.current[nextIndexRef.current % MAX_TRACERS];
      segment.startX = startX;
      segment.startY = startY;
      segment.startZ = startZ;
      segment.endX = endX;
      segment.endY = endY;
      segment.endZ = endZ;
      
      // Pre-compute lightened color at segment creation
      const lightened = computeLightenedColor(color, 0.5);
      segment.lightenedR = lightened.r;
      segment.lightenedG = lightened.g;
      segment.lightenedB = lightened.b;
      
      segment.createdAt = performance.now();
      segment.active = true;
      nextIndexRef.current++;
    },
    
    update: () => {
      const positions = positionsRef.current;
      const colors = colorsRef.current;
      const geo = geometryRef.current;
      if (!positions || !colors || !geo) return;
      
      // Early-out: check if any segments are active
      let hasActive = false;
      for (const seg of segmentsRef.current) {
        if (seg.active) { hasActive = true; break; }
      }
      if (!hasActive) {
        geo.setDrawRange(0, 0);
        return;
      }
      
      const now = performance.now();
      let vertexIndex = 0;
      
      for (const segment of segmentsRef.current) {
        if (!segment.active) continue;
        
        const age = (now - segment.createdAt) / 1000;
        const totalDuration = TRACER_VISIBLE_DURATION + TRACER_FADE_DURATION;
        
        if (age > totalDuration) {
          segment.active = false;
          continue;
        }
        
        // Calculate opacity fade
        let opacity = BASE_OPACITY;
        if (age > TRACER_VISIBLE_DURATION) {
          const fadeProgress = (age - TRACER_VISIBLE_DURATION) / TRACER_FADE_DURATION;
          opacity = BASE_OPACITY * (1.0 - fadeProgress);
        }
        
        const baseIdx = vertexIndex * 3;
        
        // Start position
        positions[baseIdx] = segment.startX;
        positions[baseIdx + 1] = segment.startY;
        positions[baseIdx + 2] = segment.startZ;
        // End position
        positions[baseIdx + 3] = segment.endX;
        positions[baseIdx + 4] = segment.endY;
        positions[baseIdx + 5] = segment.endZ;
        
        // Apply opacity to colors (additive blending handles the rest)
        const r = segment.lightenedR * opacity;
        const g = segment.lightenedG * opacity;
        const b = segment.lightenedB * opacity;
        colors[baseIdx] = r;
        colors[baseIdx + 1] = g;
        colors[baseIdx + 2] = b;
        colors[baseIdx + 3] = r;
        colors[baseIdx + 4] = g;
        colors[baseIdx + 5] = b;
        
        vertexIndex += 2;
      }
      
      // Update draw range and mark attributes as needing update
      geo.setDrawRange(0, vertexIndex);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  }), []);

  return (
    <lineSegments ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />
  );
});

Tracers.displayName = 'Tracers';
