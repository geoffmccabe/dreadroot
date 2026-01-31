// Player Health Bar UI Component
// Minecraft-style hearts display with damage/heal animations

import React, { useEffect, useState } from 'react';
import { Heart, HeartCrack, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HealthBarProps {
  currentHealth: number;
  maxHealth: number;
  totalPoints?: number;
  className?: string;
  jetBoostAvailable?: number;
  jetBoostMax?: number;
  isGliding?: boolean;
}

export function HealthBar({ currentHealth, maxHealth, totalPoints, className, jetBoostAvailable = 0, jetBoostMax = 0, isGliding = false }: HealthBarProps) {
  const [shake, setShake] = useState(false);
  const [prevHealth, setPrevHealth] = useState(currentHealth);
  
  // Calculate heart display (1 heart = 10 HP)
  const heartsFromHealth = currentHealth / 10;
  const maxHearts = maxHealth / 10;
  const fullHearts = Math.floor(heartsFromHealth);
  const partialHeart = heartsFromHealth % 1; // decimal portion (0 to 0.99)
  const totalHearts = Math.ceil(maxHearts);
  const emptyHearts = Math.max(0, totalHearts - Math.ceil(heartsFromHealth));
  
  // Shake animation on damage
  useEffect(() => {
    if (currentHealth < prevHealth) {
      setShake(true);
      const timer = setTimeout(() => setShake(false), 300);
      return () => clearTimeout(timer);
    }
    setPrevHealth(currentHealth);
  }, [currentHealth, prevHealth]);
  
  // Low health warning state
  const isLowHealth = currentHealth <= maxHealth * 0.3;
  const isCritical = currentHealth <= maxHealth * 0.1;

  return (
    <div 
      className={cn(
        "flex items-center gap-0.5 p-1.5 rounded bg-black/50 backdrop-blur-sm border border-white/10",
        shake && "animate-shake",
        isLowHealth && "border-destructive/50",
        className
      )}
    >
      {/* Full hearts */}
      {Array.from({ length: fullHearts }).map((_, i) => (
        <Heart
          key={`full-${i}`}
          className={cn(
            "w-3 h-3 fill-destructive text-destructive drop-shadow-[0_0_2px_hsl(var(--destructive)/0.5)]",
            isCritical && "animate-pulse"
          )}
        />
      ))}
      
      {/* Partial heart (if any) */}
      {partialHeart > 0 && (
        <div className="relative w-3 h-3">
          {/* Empty background */}
          <Heart className="absolute w-3 h-3 text-muted-foreground fill-muted" />
          {/* Partial fill using clip-path */}
          <div 
            className="absolute inset-0 overflow-hidden"
            style={{ clipPath: `inset(0 ${(1 - partialHeart) * 100}% 0 0)` }}
          >
            <Heart 
              className={cn(
                "w-3 h-3 fill-destructive text-destructive",
                isCritical && "animate-pulse"
              )} 
            />
          </div>
        </div>
      )}
      
      {/* Empty hearts */}
      {Array.from({ length: emptyHearts }).map((_, i) => (
        <HeartCrack
          key={`empty-${i}`}
          className="w-3 h-3 text-muted-foreground fill-muted/50"
        />
      ))}
      
      {/* Max health display */}
      <span className={cn(
        "ml-1.5 text-[10px] font-bold tabular-nums",
        isCritical ? "text-destructive" : isLowHealth ? "text-orange-400" : "text-white"
      )}>
        {Math.round(maxHealth)}
      </span>
      
      {/* Points display */}
      {totalPoints !== undefined && (
        <span className="ml-2 text-[10px] font-bold tabular-nums text-yellow-400">
          PTS {totalPoints}
        </span>
      )}

      {/* Jet Boost indicators - inverted triangles + Glide indicator */}
      {(jetBoostMax > 0 || isGliding) && (
        <div className="ml-2 flex items-center gap-0.5">
          {Array.from({ length: jetBoostMax }).map((_, i) => {
            const isAvailable = i < jetBoostAvailable;
            return (
              <svg
                key={`boost-${i}`}
                width="12"
                height="12"
                viewBox="0 0 10 10"
                className={cn(
                  "drop-shadow-[0_0_2px_rgba(255,165,0,0.5)]",
                  isAvailable ? "fill-orange-500" : "fill-transparent stroke-orange-500"
                )}
                strokeWidth={isAvailable ? 0 : 1.5}
              >
                {/* Inverted triangle (pointing down) */}
                <polygon points="5,10 0,0 10,0" />
              </svg>
            );
          })}
          {/* Glide indicator - shows G when gliding is active */}
          {isGliding && (
            <span className="ml-1 text-[10px] font-bold text-cyan-400 drop-shadow-[0_0_2px_rgba(0,255,255,0.5)]">
              G
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Death overlay component
interface DeathOverlayProps {
  isDead: boolean;
  respawnTimer: number;
  onRespawn: () => void;
}

export function DeathOverlay({ isDead, respawnTimer, onRespawn }: DeathOverlayProps) {
  if (!isDead) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-destructive/80 backdrop-blur-sm">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-destructive-foreground drop-shadow-lg">YOU DIED</h1>
        {respawnTimer > 0 ? (
          <p className="text-2xl text-destructive-foreground/80">
            Respawning in {respawnTimer}...
          </p>
        ) : (
          <button
            onClick={onRespawn}
            className="px-6 py-3 text-xl font-bold text-destructive-foreground bg-destructive hover:opacity-90 rounded-lg transition-opacity"
          >
            Respawn
          </button>
        )}
      </div>
    </div>
  );
}
