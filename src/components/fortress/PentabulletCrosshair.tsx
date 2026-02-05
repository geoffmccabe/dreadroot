import React, { useEffect, useState } from 'react';

interface PentabulletCrosshairProps {
  chargeProgress: number; // 0-5+ seconds
  baseMode: 'inactive' | 'shooting' | 'building' | 'planting';
  bulletColor?: string; // Color from bullet tier definition
  inspectorMode?: boolean; // Hide crosshair when in inspector mode
}

// Individual crosshair ring with + or X shape
function CrosshairRing({ 
  diameter, 
  rotation, 
  baseOffset = 0,
  opacity = 1,
  color = '#ff2431'
}: { 
  diameter: number; 
  rotation: number; 
  baseOffset?: number;
  opacity?: number;
  color?: string;
}) {
  const lineLength = Math.max(3, diameter * 0.15);
  const lineThickness = 2;
  
  return (
    <div 
      className="absolute left-1/2 top-1/2 rounded-full pointer-events-none"
      style={{
        width: diameter,
        height: diameter,
        transform: `translate(-50%, -50%) rotate(${rotation + baseOffset}deg)`,
        opacity,
        border: `2px solid ${color}`,
      }}
    >
      {/* Top line */}
      <div 
        className="absolute left-1/2"
        style={{
          width: lineThickness,
          height: lineLength,
          top: -lineLength,
          transform: 'translateX(-50%)',
          backgroundColor: color,
        }}
      />
      {/* Bottom line */}
      <div 
        className="absolute left-1/2"
        style={{
          width: lineThickness,
          height: lineLength,
          bottom: -lineLength,
          transform: 'translateX(-50%)',
          backgroundColor: color,
        }}
      />
      {/* Left line */}
      <div 
        className="absolute top-1/2"
        style={{
          width: lineLength,
          height: lineThickness,
          left: -lineLength,
          transform: 'translateY(-50%)',
          backgroundColor: color,
        }}
      />
      {/* Right line */}
      <div 
        className="absolute top-1/2"
        style={{
          width: lineLength,
          height: lineThickness,
          right: -lineLength,
          transform: 'translateY(-50%)',
          backgroundColor: color,
        }}
      />
    </div>
  );
}

export function PentabulletCrosshair({ chargeProgress, baseMode, bulletColor = '#ff2431', inspectorMode = false }: PentabulletCrosshairProps) {
  const [rotation, setRotation] = useState(0);
  const [cycleColorIndex, setCycleColorIndex] = useState(0);

  // Calculate number of additional rings based on charge time
  // Ring timing: 1.0s, 1.75s, 2.5s, 3.25s, 4.0s (every 0.75s after 1s)
  const additionalRingCount = chargeProgress >= 4.0 ? 4 :
                              chargeProgress >= 3.25 ? 3 :
                              chargeProgress >= 2.5 ? 2 :
                              chargeProgress >= 1.75 ? 1 :
                              chargeProgress >= 1.0 ? 0 : -1; // -1 means no extra rings yet

  // Start rotating as soon as charging begins (at 1 second)
  const isCharging = chargeProgress >= 1.0;
  const isFullyCharged = chargeProgress >= 5.0;

  // Color cycling when fully charged (10 cycles per second = 33ms per color)
  const cycleColors = [bulletColor, '#ffffff', '#000000'];
  const displayColor = isFullyCharged ? cycleColors[cycleColorIndex] : bulletColor;

  // Color cycling animation when fully charged
  useEffect(() => {
    if (!isFullyCharged) {
      setCycleColorIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setCycleColorIndex(i => (i + 1) % 3);
    }, 33); // ~10 full cycles per second (3 colors × 33ms = 99ms per cycle)

    return () => clearInterval(interval);
  }, [isFullyCharged]);

  // Rotation animation - starts at 1 second, speeds up when fully charged
  useEffect(() => {
    if (!isCharging) {
      setRotation(0);
      return;
    }

    let animationId: number;
    let lastTime = performance.now();

    const animate = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;
      // 30 degrees per second while charging, 60 when fully charged
      const speed = isFullyCharged ? 60 : 30;
      setRotation(r => r + (delta / 1000) * speed);
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [isCharging, isFullyCharged]);

  // Hide when in inspector mode (InspectorCrosshair shows instead)
  // NOTE: This must be AFTER all hooks to avoid "Rendered fewer hooks" error
  if (inspectorMode) return null;

  // Don't show crosshair when inactive
  if (baseMode === 'inactive') return null;
  
  // Base crosshair diameter (matches original CSS)
  const baseDiameter = 14;
  
  return (
    <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50">
      {/* Base crosshair - always visible in shooting mode */}
      {baseMode === 'shooting' && (
        <CrosshairRing 
          diameter={baseDiameter} 
          rotation={isCharging ? rotation : 0} 
          baseOffset={0}
          color={displayColor}
        />
      )}
      
      {/* Block placement mode - hand emoji (matches original CSS) */}
      {baseMode === 'building' && (
        <div 
          className="absolute left-1/2 top-1/2 w-6 h-6 flex items-center justify-center text-xl opacity-50"
          style={{ transform: 'translate(-50%, -50%)' }}
        >
          ✋
        </div>
      )}
      
      {/* Planting mode crosshair */}
      {baseMode === 'planting' && (
        <div 
          className="absolute left-1/2 top-1/2 w-4 h-4 border-2 border-green-500 rounded-full opacity-75"
          style={{ transform: 'translate(-50%, -50%)' }}
        />
      )}
      
      {/* Pentabullet charging rings - only in shooting mode */}
      {/* Ring 1: at 1.0s - 2x diameter, X shape (45° offset) */}
      {baseMode === 'shooting' && additionalRingCount >= 0 && (
        <CrosshairRing 
          diameter={baseDiameter * 2} 
          rotation={isCharging ? -rotation : 0} 
          baseOffset={45}
          opacity={0.9}
          color={displayColor}
        />
      )}
      
      {/* Ring 2: at 1.75s - 4x diameter, + shape */}
      {baseMode === 'shooting' && additionalRingCount >= 1 && (
        <CrosshairRing 
          diameter={baseDiameter * 4} 
          rotation={isCharging ? rotation : 0} 
          baseOffset={0}
          opacity={0.8}
          color={displayColor}
        />
      )}
      
      {/* Ring 3: at 2.5s - 8x diameter, X shape */}
      {baseMode === 'shooting' && additionalRingCount >= 2 && (
        <CrosshairRing 
          diameter={baseDiameter * 8} 
          rotation={isCharging ? -rotation : 0} 
          baseOffset={45}
          opacity={0.7}
          color={displayColor}
        />
      )}
      
      {/* Ring 4: at 3.25s - 16x diameter, + shape */}
      {baseMode === 'shooting' && additionalRingCount >= 3 && (
        <CrosshairRing 
          diameter={baseDiameter * 16} 
          rotation={isCharging ? rotation : 0} 
          baseOffset={0}
          opacity={0.6}
          color={displayColor}
        />
      )}
    </div>
  );
}
