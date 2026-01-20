import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useUserCombatStats } from '@/hooks/useUserCombatStats';
import { Skull } from 'lucide-react';

interface KillsTabProps {
  height: number;
}

const getRarityColor = (rarity: string) => {
  switch (rarity) {
    case 'common': return 'bg-gray-100 text-gray-800 border-gray-300';
    case 'uncommon': return 'bg-green-100 text-green-800 border-green-400';
    case 'rare': return 'bg-blue-100 text-blue-800 border-blue-400';
    case 'epic': return 'bg-purple-100 text-purple-800 border-purple-400';
    case 'legendary': return 'bg-amber-100 text-amber-800 border-amber-400';
    default: return 'bg-gray-100 text-gray-800 border-gray-300';
  }
};

const getRarityBorderColor = (rarity: string) => {
  switch (rarity) {
    case 'common': return 'border-gray-300';
    case 'uncommon': return 'border-green-400';
    case 'rare': return 'border-blue-400';
    case 'epic': return 'border-purple-400';
    case 'legendary': return 'border-amber-400';
    default: return 'border-gray-300';
  }
};

export const KillsTab: React.FC<KillsTabProps> = ({ height }) => {
  const { isLoading, sortedStatsWithDefs } = useUserCombatStats();
  const monstersWithKills = sortedStatsWithDefs();
  
  const totalKills = monstersWithKills.reduce((sum, m) => sum + m.kills, 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Total Kills Display */}
      <Card className="p-4 bg-gradient-to-r from-destructive/10 to-destructive/5">
        <div className="text-center">
          <div className="text-sm text-muted-foreground mb-1">Total Shwarms Killed</div>
          <div className="text-3xl font-bold text-destructive flex items-center justify-center gap-2">
            <Skull className="w-8 h-8" />
            {totalKills.toLocaleString()}
          </div>
        </div>
      </Card>

      {/* Monster Grid - 2 columns, 3 rows visible */}
      <ScrollArea style={{ height: `${height - 140}px` }}>
        <div className="grid grid-cols-2 gap-3 pr-4">
          {monstersWithKills.map((monster) => (
            <Card 
              key={monster.id}
              className={`p-3 border-2 transition-all hover:shadow-md ${getRarityBorderColor(monster.rarity || 'common')} ${
                monster.kills > 0 ? 'opacity-100' : 'opacity-50'
              }`}
            >
              {/* Monster Image/Icon */}
              <div 
                className="w-full aspect-[2/3] rounded mb-2 flex items-center justify-center overflow-hidden"
                style={{
                  background: monster.texture_url 
                    ? `url(${monster.texture_url}) center/cover`
                    : 'linear-gradient(135deg, hsl(var(--muted)), hsl(var(--muted-foreground)/0.2))'
                }}
              >
                {!monster.texture_url && (
                  <Skull className="w-12 h-12 text-muted-foreground/50" />
                )}
              </div>
              
              {/* Monster Info */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm truncate flex-1">{monster.name}</h4>
                  <Badge 
                    variant="outline" 
                    className={`text-[10px] ml-1 ${getRarityColor(monster.rarity || 'common')}`}
                  >
                    T{monster.tier}
                  </Badge>
                </div>
                
                <Badge 
                  variant="secondary" 
                  className={`text-[10px] ${getRarityColor(monster.rarity || 'common')}`}
                >
                  {monster.rarity}
                </Badge>
              </div>
              
              {/* Kill Count */}
              <div className="mt-2 pt-2 border-t border-border">
                <div className="flex items-center justify-center gap-1">
                  <Skull className="w-4 h-4 text-destructive" />
                  <span className="font-bold text-lg">{monster.kills.toLocaleString()}</span>
                </div>
              </div>
            </Card>
          ))}
          
          {monstersWithKills.length === 0 && (
            <Card className="col-span-2 p-8 text-center text-muted-foreground">
              No monsters defined yet
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
