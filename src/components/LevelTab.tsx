import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getAllLevelThresholds, MAX_LEVEL, getLevelForPoints } from '@/lib/levelSystem';

interface LevelTabProps {
  totalPoints: number;
  currentLevel: number;
  height: number;
}

export const LevelTab: React.FC<LevelTabProps> = ({ totalPoints, currentLevel: passedLevel, height }) => {
  const levelThresholds = getAllLevelThresholds();
  
  // Recalculate level from points to ensure accuracy
  const currentLevel = getLevelForPoints(totalPoints);
  
  return (
    <div className="space-y-4">
      {/* Points and Level Display - Side by Side */}
      <Card className="p-4 mr-4" style={{ background: 'linear-gradient(to right, hsla(var(--hud-bg-dim)), hsla(var(--hud-bg-dim)))' }}>
        <div className="flex items-center justify-center gap-8">
          {/* Points - Left */}
          <div className="text-center">
            <div className="text-xs mb-1" style={{ color: 'hsl(var(--hud-text-dim))' }}>Points</div>
            <div className="text-3xl font-bold" style={{ color: 'hsl(var(--hud-text-bright))' }}>
              {totalPoints.toLocaleString()}
            </div>
          </div>
          
          {/* Divider */}
          <div className="h-12 w-px" style={{ background: 'hsla(var(--hud-border))' }} />
          
          {/* Level - Right */}
          <div className="text-center">
            <div className="text-xs mb-1" style={{ color: 'hsl(var(--hud-text-dim))' }}>Level</div>
            <div className="text-3xl font-bold" style={{ color: 'hsl(var(--hud-text))' }}>
              {currentLevel}
            </div>
          </div>
        </div>
      </Card>

      {/* Level Grid */}
      <ScrollArea style={{ height: `${height - 140}px` }}>
        <div className="grid grid-cols-2 gap-2 pr-4">
          {levelThresholds.map(({ level, pointsRequired }) => {
            const isAchieved = currentLevel >= level;
            const isCurrent = currentLevel === level;
            
            return (
              <Card
                key={level}
                className={`p-3 transition-all ${
                  isAchieved
                    ? isCurrent
                      ? 'shadow-md'
                      : ''
                    : 'opacity-50'
                }`}
                style={{
                  background: isAchieved
                    ? isCurrent ? 'hsla(var(--hud-bg))' : 'hsla(var(--hud-bg-dim))'
                    : 'hsla(var(--hud-bg-dim))',
                  borderColor: isAchieved
                    ? isCurrent ? 'hsla(var(--hud-highlight))' : 'hsla(var(--hud-border))'
                    : 'hsla(var(--hud-border))',
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge 
                      variant={isAchieved ? "default" : "secondary"}
                      className={`font-bold ${isCurrent ? 'animate-pulse' : ''}`}
                    >
                      {level}
                    </Badge>
                    {isCurrent && (
                      <span className="text-xs font-medium" style={{ color: 'hsl(var(--hud-text-bright))' }}>Current</span>
                    )}
                  </div>
                  <div className="text-sm font-medium" style={{
                    color: isAchieved ? 'hsl(var(--hud-text))' : 'hsl(var(--hud-text-dim))'
                  }}>
                    {pointsRequired.toLocaleString()} pts
                  </div>
                </div>
                {/* Progress indicator for current level */}
                {isCurrent && level < MAX_LEVEL && (
                  <div className="mt-2">
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'hsla(var(--hud-bg-dim))' }}>
                      <div
                        className="h-full transition-all"
                        style={{
                          background: 'hsla(var(--hud-highlight))',
                          width: `${Math.min(100, ((totalPoints - pointsRequired) / (levelThresholds[level]?.pointsRequired - pointsRequired || 1)) * 100)}%`
                        }}
                      />
                    </div>
                    <div className="text-xs mt-1 text-right" style={{ color: 'hsl(var(--hud-text-dim))' }}>
                      {(levelThresholds[level]?.pointsRequired || 0) - totalPoints} to next
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};
