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
      <Card className="p-4 bg-gradient-to-r from-primary/10 to-primary/5">
        <div className="flex items-center justify-center gap-8">
          {/* Points - Left */}
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">Points</div>
            <div className="text-3xl font-bold text-primary">
              {totalPoints.toLocaleString()}
            </div>
          </div>
          
          {/* Divider */}
          <div className="h-12 w-px bg-border" />
          
          {/* Level - Right */}
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">Level</div>
            <div className="text-3xl font-bold text-foreground">
              {currentLevel}
              <span className="text-lg text-muted-foreground font-normal">/{MAX_LEVEL}</span>
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
                      ? 'bg-primary/20 border-primary shadow-md'
                      : 'bg-accent/50 border-accent'
                    : 'bg-muted/30 border-muted opacity-50'
                }`}
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
                      <span className="text-xs text-primary font-medium">Current</span>
                    )}
                  </div>
                  <div className={`text-sm font-medium ${
                    isAchieved ? 'text-foreground' : 'text-muted-foreground'
                  }`}>
                    {pointsRequired.toLocaleString()} pts
                  </div>
                </div>
                {/* Progress indicator for current level */}
                {isCurrent && level < MAX_LEVEL && (
                  <div className="mt-2">
                    <div className="h-1 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary transition-all"
                        style={{ 
                          width: `${Math.min(100, ((totalPoints - pointsRequired) / (levelThresholds[level]?.pointsRequired - pointsRequired || 1)) * 100)}%` 
                        }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 text-right">
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
