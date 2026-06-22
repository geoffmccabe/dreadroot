import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getAllLevelThresholds, MAX_LEVEL, getLevelForPoints } from '@/lib/levelSystem';

interface LevelTabProps {
  totalPoints: number;
  // currentLevel/height kept optional for back-compat; level is recomputed from points.
  currentLevel?: number;
  height?: number;
}

export const LevelTab: React.FC<LevelTabProps> = ({ totalPoints }) => {
  const levelThresholds = getAllLevelThresholds();
  // Recalculate level from points to ensure accuracy
  const currentLevel = getLevelForPoints(totalPoints);
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="space-y-2">
      {/* Points & Level summary */}
      <Card className="p-4" style={{ background: 'hsla(var(--hud-bg-dim))' }}>
        <div className="flex items-center justify-center gap-8">
          {/* Points */}
          <div className="text-center">
            <div className="text-sm font-bold mb-1" style={{ color: '#ffffff' }}>Points</div>
            <div className="text-3xl font-bold" style={{ color: 'hsl(var(--hud-text-bright))' }}>
              {totalPoints.toLocaleString()}
            </div>
          </div>

          {/* Divider */}
          <div className="h-12 w-px" style={{ background: 'hsla(var(--hud-border))' }} />

          {/* Level */}
          <div className="text-center">
            <div className="text-sm font-bold mb-1" style={{ color: '#ffffff' }}>Level</div>
            <div className="text-3xl font-bold" style={{ color: 'hsl(var(--hud-text))' }}>
              {currentLevel}
            </div>
          </div>
        </div>
      </Card>

      {/* Full level ladder — collapsible, default collapsed */}
      <Collapsible open={showAll} onOpenChange={setShowAll}>
        <CollapsibleTrigger asChild>
          <button
            className="w-full flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-md"
            style={{ background: 'hsla(var(--hud-bg-dim))', color: 'hsl(var(--hud-text-dim))' }}
          >
            <span>{showAll ? '▼' : '▶'}</span> All levels
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid grid-cols-2 gap-2 mt-2 pr-1" style={{ maxHeight: 280, overflowY: 'auto' }}>
            {levelThresholds.map(({ level, pointsRequired }) => {
              const isAchieved = currentLevel >= level;
              const isCurrent = currentLevel === level;

              return (
                <Card
                  key={level}
                  className={`p-3 transition-all ${isAchieved ? (isCurrent ? 'shadow-md' : '') : 'opacity-50'}`}
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
                        variant={isAchieved ? 'default' : 'secondary'}
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
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
