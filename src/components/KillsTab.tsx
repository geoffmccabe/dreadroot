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
  const monstersWithKills = sortedStatsWithDefs().filter(m => m.kills > 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <ScrollArea style={{ height: `${height - 40}px` }}>
      <div className="grid grid-cols-5 gap-2 pr-4">
        {monstersWithKills.map((monster) => (
          <Card 
            key={monster.id}
            className={`p-1.5 border transition-all hover:shadow-md ${getRarityBorderColor(monster.rarity || 'common')}`}
          >
            {/* Square Monster Image - top 2/3 */}
            <div 
              className="w-full aspect-square rounded mb-1 flex items-center justify-center overflow-hidden"
              style={{
                background: monster.texture_url 
                  ? `url(${monster.texture_url}) center/cover`
                  : 'linear-gradient(135deg, hsl(var(--muted)), hsl(var(--muted-foreground)/0.2))'
              }}
            >
              {!monster.texture_url && (
                <Skull className="w-6 h-6 text-muted-foreground/50" />
              )}
            </div>
            
            {/* Name and Kills - bottom 1/3 */}
            <div className="text-center space-y-0.5">
              <h4 className="font-medium text-[10px] truncate leading-tight">{monster.name}</h4>
              <div className="flex items-center justify-center gap-0.5">
                <Skull className="w-3 h-3 text-destructive" />
                <span className="font-bold text-sm">{monster.kills.toLocaleString()}</span>
              </div>
            </div>
          </Card>
        ))}
        
        {monstersWithKills.length === 0 && (
          <Card className="col-span-5 p-8 text-center text-muted-foreground">
            No kills yet - get hunting!
          </Card>
        )}
      </div>
    </ScrollArea>
  );
};
