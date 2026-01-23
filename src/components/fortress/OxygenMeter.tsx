// Oxygen meter HUD component for underwater breathing

interface OxygenMeterProps {
  oxygen: number;
  maxOxygen: number;
  visible: boolean;
}

export function OxygenMeter({ oxygen, maxOxygen, visible }: OxygenMeterProps) {
  if (!visible) return null;
  
  const percentage = Math.max(0, Math.min(100, (oxygen / maxOxygen) * 100));
  const isLow = percentage < 30;
  const isCritical = percentage < 15;
  
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 pointer-events-none">
      {/* Oxygen container */}
      <div className="flex flex-col items-center gap-1">
        {/* Label */}
        <div className={`text-xs font-medium uppercase tracking-wider ${
          isCritical ? 'text-red-400 animate-pulse' : 
          isLow ? 'text-amber-400' : 
          'text-cyan-300'
        }`}>
          Oxygen
        </div>
        
        {/* Bubble bar container */}
        <div className="relative w-48 h-4 bg-black/50 rounded-full border border-cyan-500/30 overflow-hidden backdrop-blur-sm">
          {/* Fill bar */}
          <div 
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-200 ${
              isCritical ? 'bg-gradient-to-r from-red-600 to-red-400' :
              isLow ? 'bg-gradient-to-r from-amber-600 to-amber-400' :
              'bg-gradient-to-r from-cyan-600 to-cyan-400'
            }`}
            style={{ width: `${percentage}%` }}
          />
          
          {/* Bubble decorations */}
          {percentage > 10 && (
            <>
              <div className="absolute top-1 left-2 w-1.5 h-1.5 rounded-full bg-white/40" />
              <div className="absolute bottom-1 left-6 w-1 h-1 rounded-full bg-white/30" />
              {percentage > 50 && (
                <div className="absolute top-0.5 left-16 w-1 h-1 rounded-full bg-white/25" />
              )}
            </>
          )}
          
          {/* Shimmer effect */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />
        </div>
        
        {/* Warning text */}
        {isCritical && (
          <div className="text-red-400 text-xs font-bold animate-pulse">
            DROWNING!
          </div>
        )}
      </div>
    </div>
  );
}

OxygenMeter.displayName = 'OxygenMeter';
