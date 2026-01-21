import { useRef, useImperativeHandle, forwardRef, useMemo, useEffect, useState } from 'react';
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { useThree } from '@react-three/fiber';

const MAX_TRACERS = 500; // Max tracer segments in pool
const TRACER_VISIBLE_DURATION = 1.0; // Seconds at full opacity
const TRACER_FADE_DURATION = 1.0; // Seconds to fade out
const BASE_OPACITY = 0.5; // 50% base transparency
const TRACER_LINE_WIDTH = 0.1; // 2x bullet size (bullet is 0.05)

interface TracerSegment {
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  color: string;
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
 * Modifies the passed color in-place and returns RGB components
 */
function computeLightenedColor(hexColor: string, factor: number = 0.5): { r: number; g: number; b: number } {
  tmpColor.set(hexColor);
  // Lerp each channel toward white (1.0)
  const r = tmpColor.r + (1 - tmpColor.r) * factor;
  const g = tmpColor.g + (1 - tmpColor.g) * factor;
  const b = tmpColor.b + (1 - tmpColor.b) * factor;
  return { r, g, b };
}

// Pre-allocated arrays to avoid per-frame allocations
// Max size: 500 segments * 2 vertices * 3 components = 3000
// Using regular arrays since LineGeometry.setPositions/setColors expect number[]
const positionsArray: number[] = new Array(MAX_TRACERS * 2 * 3);
const colorsArray: number[] = new Array(MAX_TRACERS * 2 * 3);

export const Tracers = forwardRef<TracersHandle>((_, ref) => {
  const segmentsRef = useRef<TracerSegment[]>([]);
  const nextIndexRef = useRef(0);
  const lineRef = useRef<Line2 | null>(null);
  const geometryRef = useRef<LineGeometry | null>(null);
  const materialRef = useRef<LineMaterial | null>(null);
  const { size } = useThree();
  const [lineReady, setLineReady] = useState(false);
  
  // Pre-allocate pool with lightened color cache
  useMemo(() => {
    segmentsRef.current = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      segmentsRef.current.push({
        startX: 0, startY: 0, startZ: 0,
        endX: 0, endY: 0, endZ: 0,
        color: '#ffffff',
        lightenedR: 1, lightenedG: 1, lightenedB: 1,
        createdAt: 0,
        active: false,
      });
    }
  }, []);

  // Create Line2 geometry and material for fat lines
  useEffect(() => {
    const geometry = new LineGeometry();
    const material = new LineMaterial({
      vertexColors: true,
      transparent: true,
      opacity: BASE_OPACITY,
      linewidth: TRACER_LINE_WIDTH,
      worldUnits: true, // Use world units for consistent thickness
      alphaToCoverage: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    
    // Set initial resolution
    material.resolution.set(size.width, size.height);
    
    const line = new Line2(geometry, material);
    line.frustumCulled = false;
    line.computeLineDistances();
    
    geometryRef.current = geometry;
    materialRef.current = material;
    lineRef.current = line;
    setLineReady(true); // Trigger re-render so primitive gets the line
    
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, []);
  
  // Update resolution when window resizes
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.resolution.set(size.width, size.height);
    }
  }, [size]);

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
      segment.color = color;
      
      // Pre-compute lightened color at segment creation (once per segment, not per frame)
      const lightened = computeLightenedColor(color, 0.5);
      segment.lightenedR = lightened.r;
      segment.lightenedG = lightened.g;
      segment.lightenedB = lightened.b;
      
      segment.createdAt = performance.now();
      segment.active = true;
      nextIndexRef.current++;
    },
    
    update: () => {
      if (!geometryRef.current || !materialRef.current) return;
      
      const now = performance.now();
      let posIndex = 0;
      let colIndex = 0;
      
      for (const segment of segmentsRef.current) {
        if (!segment.active) continue;
        
        const age = (now - segment.createdAt) / 1000; // Convert to seconds
        const totalDuration = TRACER_VISIBLE_DURATION + TRACER_FADE_DURATION;
        
        if (age > totalDuration) {
          segment.active = false;
          continue;
        }
        
        // Calculate opacity - start at BASE_OPACITY, fade to 0
        let opacity = BASE_OPACITY;
        if (age > TRACER_VISIBLE_DURATION) {
          const fadeProgress = (age - TRACER_VISIBLE_DURATION) / TRACER_FADE_DURATION;
          opacity = BASE_OPACITY * (1.0 - fadeProgress);
        }
        
        // Add start position
        positionsArray[posIndex++] = segment.startX;
        positionsArray[posIndex++] = segment.startY;
        positionsArray[posIndex++] = segment.startZ;
        // Add end position  
        positionsArray[posIndex++] = segment.endX;
        positionsArray[posIndex++] = segment.endY;
        positionsArray[posIndex++] = segment.endZ;
        
        // Use pre-computed lightened colors, apply opacity fade
        const opacityScale = opacity / BASE_OPACITY;
        const r = segment.lightenedR * opacityScale;
        const g = segment.lightenedG * opacityScale;
        const b = segment.lightenedB * opacityScale;
        colorsArray[colIndex++] = r;
        colorsArray[colIndex++] = g;
        colorsArray[colIndex++] = b;
        colorsArray[colIndex++] = r;
        colorsArray[colIndex++] = g;
        colorsArray[colIndex++] = b;
      }
      
      // Update geometry if we have segments
      if (posIndex > 0) {
        // Slice to get only the filled portion - LineGeometry expects exact length
        // Note: slice() creates a new array but this is unavoidable with LineGeometry API
        geometryRef.current.setPositions(positionsArray.slice(0, posIndex));
        geometryRef.current.setColors(colorsArray.slice(0, colIndex));
        if (lineRef.current) {
          lineRef.current.computeLineDistances();
          lineRef.current.visible = true;
        }
      } else {
        if (lineRef.current) {
          lineRef.current.visible = false;
        }
      }
    },
  }), []);

  return lineReady && lineRef.current ? (
    <primitive object={lineRef.current} />
  ) : null;
});

Tracers.displayName = 'Tracers';
