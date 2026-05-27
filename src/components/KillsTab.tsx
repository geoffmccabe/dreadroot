import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useUserCombatStats } from '@/hooks/useUserCombatStats';
import { Skull } from 'lucide-react';

interface KillsTabProps {
  height: number;
}

const getRarityVar = (rarity: string) => {
  switch (rarity) {
    case 'common': return '--rarity-common';
    case 'uncommon': return '--rarity-uncommon';
    case 'rare': return '--rarity-rare';
    case 'epic': return '--rarity-epic';
    case 'legendary': return '--rarity-legendary';
    default: return '--rarity-common';
  }
};

const getRarityStyle = (rarity: string): React.CSSProperties => {
  const v = getRarityVar(rarity);
  return {
    background: `hsla(${`var(${v})`} / 0.15)`,
    color: `hsl(${`var(${v})`})`,
    borderColor: `hsl(${`var(${v})`})`,
  };
};

const getRarityBorderStyle = (rarity: string): React.CSSProperties => {
  const v = getRarityVar(rarity);
  return {
    borderColor: `hsl(${`var(${v})`})`,
  };
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
            className="p-1.5 border transition-all hover:shadow-md"
            style={getRarityBorderStyle(monster.rarity || 'common')}
          >
            {/* Square Monster Image - top 2/3 */}
            <div
              className="w-full aspect-square rounded mb-1 flex items-center justify-center overflow-hidden relative"
              style={{
                background: monster.texture_url
                  ? `url(${monster.texture_url}) center/cover`
                  : 'linear-gradient(135deg, hsl(var(--muted)), hsl(var(--muted-foreground)/0.2))'
              }}
            >
              {!monster.texture_url && (
                <Skull className="w-6 h-6 text-muted-foreground/50" />
              )}
              {/* Tier badge — top-left corner. White text with heavy
                  shadow so it's legible on any texture; matches the
                  hotbar tier badge style. */}
              {monster.tier != null && (
                <span style={{
                  position: 'absolute',
                  top: 2,
                  left: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'white',
                  lineHeight: 1,
                  textShadow: '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.9)',
                  pointerEvents: 'none',
                }}>
                  T{monster.tier}
                </span>
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
