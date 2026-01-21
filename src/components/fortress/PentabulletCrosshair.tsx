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
      className="absolute left-1/2 top-1/2 rounded-full pointer-events-none"
      style={{
        width: diameter,
        height: diameter,
        transform: `translate(-50%, -50%) rotate(${rotation + baseOffset}deg)`,
        opacity,
        border: '2px solid rgb(239, 68, 68)', // red-500
      }}
    >
      {/* Top line */}
      <div 
        className="absolute left-1/2 bg-red-500"
        style={{
          width: lineThickness,
          height: lineLength,
          top: -lineLength,
          transform: 'translateX(-50%)',
        }}
      />
      {/* Bottom line */}
      <div 
        className="absolute left-1/2 bg-red-500"
        style={{
          width: lineThickness,
          height: lineLength,
          bottom: -lineLength,
          transform: 'translateX(-50%)',
        }}
      />
      {/* Left line */}
      <div 
        className="absolute top-1/2 bg-red-500"
        style={{
          width: lineLength,
          height: lineThickness,
          left: -lineLength,
          transform: 'translateY(-50%)',
        }}
      />
      {/* Right line */}
      <div 
        className="absolute top-1/2 bg-red-500"
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
  
  // Calculate number of rings based on charge time
  // Ring 1 (base): at 1.0s
  // Ring 2: at 1.75s (1s + 0.75s) - X shape (45° offset)
  // Ring 3: at 2.5s - + shape
  // Ring 4: at 3.25s - X shape
  // Ring 5: at 4.0s - + shape
  const ringCount = chargeProgress >= 4.0 ? 5 :
                    chargeProgress >= 3.25 ? 4 :
                    chargeProgress >= 2.5 ? 3 :
                    chargeProgress >= 1.75 ? 2 :
                    chargeProgress >= 1.0 ? 1 : 0;
  
  const isFullyCharged = chargeProgress >= 5.0;
  const isCharging = chargeProgress > 0;
  
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
  
  // Base crosshair diameter
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
      
      {/* Block mode crosshair */}
      {baseMode === 'building' && (
        <div 
          className="absolute left-1/2 top-1/2 w-4 h-4 border-2 border-blue-500 rounded-full"
          style={{ transform: 'translate(-50%, -50%)' }}
        />
      )}
      
      {/* Planting mode crosshair */}
      {baseMode === 'planting' && (
        <div 
          className="absolute left-1/2 top-1/2 w-4 h-4 border-2 border-green-500 rounded-full"
          style={{ transform: 'translate(-50%, -50%)' }}
        />
      )}
      
      {/* Pentabullet charging rings - only in shooting mode */}
      {baseMode === 'shooting' && ringCount >= 1 && (
        <CrosshairRing 
          diameter={baseDiameter * 2} 
          rotation={isFullyCharged ? -rotation : 0} 
          baseOffset={45} // X shape
          opacity={0.9}
        />
      )}
      
      {baseMode === 'shooting' && ringCount >= 2 && (
        <CrosshairRing 
          diameter={baseDiameter * 4} 
          rotation={isFullyCharged ? rotation : 0} 
          baseOffset={0} // + shape
          opacity={0.8}
        />
      )}
      
      {baseMode === 'shooting' && ringCount >= 3 && (
        <CrosshairRing 
          diameter={baseDiameter * 8} 
          rotation={isFullyCharged ? -rotation : 0} 
          baseOffset={45} // X shape
          opacity={0.7}
        />
      )}
      
      {baseMode === 'shooting' && ringCount >= 4 && (
        <CrosshairRing 
          diameter={baseDiameter * 16} 
          rotation={isFullyCharged ? rotation : 0} 
          baseOffset={0} // + shape
          opacity={0.6}
        />
      )}
      
      {/* Charging indicator text */}
      {isCharging && baseMode === 'shooting' && (
        <div 
          className="absolute left-1/2 text-center text-white text-xs font-bold"
          style={{ 
            transform: 'translateX(-50%)',
            top: baseDiameter * 16 + 20,
            textShadow: '0 0 4px rgba(0,0,0,0.8)'
          }}
        >
          {isFullyCharged ? 'PENTABULLET READY!' : `Charging... ${Math.min(chargeProgress, 5).toFixed(1)}s`}
        </div>
      )}
    </div>
  );
}
