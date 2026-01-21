import React, { useEffect, useState } from 'react';

interface PentabulletCrosshairProps {
  chargeProgress: number; // 0-5+ seconds
  baseMode: 'inactive' | 'shooting' | 'building' | 'planting';
}

// Individual crosshair ring with + or X shape
function CrosshairRing({ 
  diameter, 
  rotation, 
  baseOffset = 0,
  opacity = 1 
}: { 
  diameter: number; 
  rotation: number; 
  baseOffset?: number;
  opacity?: number;
}) {
  const lineLength = Math.max(3, diameter * 0.15);
  const lineThickness = 2;
  
  return (
    <div 
      className="absolute left-1/2 top-1/2 rounded-full pointer-events-none border-2 border-[#ff2431]"
      style={{
        width: diameter,
        height: diameter,
        transform: `translate(-50%, -50%) rotate(${rotation + baseOffset}deg)`,
        opacity,
      }}
    >
      {/* Top line */}
      <div 
        className="absolute left-1/2 bg-[#ff2431]"
        style={{
          width: lineThickness,
          height: lineLength,
          top: -lineLength,
          transform: 'translateX(-50%)',
        }}
      />
      {/* Bottom line */}
      <div 
        className="absolute left-1/2 bg-[#ff2431]"
        style={{
          width: lineThickness,
          height: lineLength,
          bottom: -lineLength,
          transform: 'translateX(-50%)',
        }}
      />
      {/* Left line */}
      <div 
        className="absolute top-1/2 bg-[#ff2431]"
        style={{
          width: lineLength,
          height: lineThickness,
          left: -lineLength,
          transform: 'translateY(-50%)',
        }}
      />
      {/* Right line */}
      <div 
        className="absolute top-1/2 bg-[#ff2431]"
        style={{
          width: lineLength,
          height: lineThickness,
          right: -lineLength,
          transform: 'translateY(-50%)',
        }}
      />
    </div>
  );
}

export function PentabulletCrosshair({ chargeProgress, baseMode }: PentabulletCrosshairProps) {
  const [rotation, setRotation] = useState(0);
  
  // Calculate number of additional rings based on charge time
  // Ring timing: 1.0s, 1.75s, 2.5s, 3.25s, 4.0s (every 0.75s after 1s)
  const additionalRingCount = chargeProgress >= 4.0 ? 4 :
                              chargeProgress >= 3.25 ? 3 :
                              chargeProgress >= 2.5 ? 2 :
                              chargeProgress >= 1.75 ? 1 :
                              chargeProgress >= 1.0 ? 0 : -1; // -1 means no extra rings yet
  
  const isFullyCharged = chargeProgress >= 5.0;
  
  // Rotation animation when fully charged
  useEffect(() => {
    if (!isFullyCharged) {
      setRotation(0);
      return;
    }
    
    let animationId: number;
    let lastTime = performance.now();
    
    const animate = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;
      // 30 degrees per second
      setRotation(r => r + (delta / 1000) * 30);
      animationId = requestAnimationFrame(animate);
    };
    
    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [isFullyCharged]);
  
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
          rotation={isFullyCharged ? rotation : 0} 
          baseOffset={0}
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
          rotation={isFullyCharged ? -rotation : 0} 
          baseOffset={45}
          opacity={0.9}
        />
      )}
      
      {/* Ring 2: at 1.75s - 4x diameter, + shape */}
      {baseMode === 'shooting' && additionalRingCount >= 1 && (
        <CrosshairRing 
          diameter={baseDiameter * 4} 
          rotation={isFullyCharged ? rotation : 0} 
          baseOffset={0}
          opacity={0.8}
        />
      )}
      
      {/* Ring 3: at 2.5s - 8x diameter, X shape */}
      {baseMode === 'shooting' && additionalRingCount >= 2 && (
        <CrosshairRing 
          diameter={baseDiameter * 8} 
          rotation={isFullyCharged ? -rotation : 0} 
          baseOffset={45}
          opacity={0.7}
        />
      )}
      
      {/* Ring 4: at 3.25s - 16x diameter, + shape */}
      {baseMode === 'shooting' && additionalRingCount >= 3 && (
        <CrosshairRing 
          diameter={baseDiameter * 16} 
          rotation={isFullyCharged ? rotation : 0} 
          baseOffset={0}
          opacity={0.6}
        />
      )}
    </div>
  );
}
