// FruitsTab - displays user's harvested fruits in a grid with forge selection

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import type { UserFruit } from '@/features/trees/types';
import { getFruitTier, FRUIT_CONFIG } from '@/features/trees/constants';
import { playerTracker } from '@/lib/playerTracker';
import { shrineTracker } from '@/lib/shrineTracker';
import { useToast } from '@/hooks/use-toast';
import { useAdminPanel } from '@/contexts/AdminPanelContext';

interface FruitsTabProps {
  height: number;
  userFruits: UserFruit[];
  userId: string | null;
  isAdmin?: boolean;
}

export const FruitsTab: React.FC<FruitsTabProps> = ({
  height,
  userFruits,
  userId,
  isAdmin = false,
}) => {
  const { toast } = useToast();
  const { fruitVisibility, setFruitVisibility } = useAdminPanel();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [forgeOpen, setForgeOpen] = useState(false);
  const [forging, setForging] = useState(false);
  const [isInShrine, setIsInShrine] = useState(false);

  // Check if player is inside a shrine (for forge eligibility)
  useEffect(() => {
    const checkShrineProximity = () => {
      const player = playerTracker.getPlayerById('local');
      if (player) {
        const inShrine = shrineTracker.isInsideShrine(
          player.position.x,
          player.position.y,
          player.position.z
        );
        setIsInShrine(inShrine);
      }
    };

    // Check immediately and then every 500ms
    checkShrineProximity();
    const interval = setInterval(checkShrineProximity, 500);
    return () => clearInterval(interval);
  }, []);

  // Count fruits per tier for forge-eligibility detection
  const tierCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const f of userFruits) {
      counts.set(f.tier, (counts.get(f.tier) || 0) + 1);
    }
    return counts;
  }, [userFruits]);

  // Handle fruit selection
  const handleSelect = useCallback((fruitId: string) => {
    setSelectedIds(prev => {
      if (prev.includes(fruitId)) {
        return prev.filter(id => id !== fruitId);
      }

      // If already have one selected, check if same tier
      if (prev.length === 1) {
        const first = userFruits.find(f => f.id === prev[0]);
        const second = userFruits.find(f => f.id === fruitId);
        if (first && second && first.tier === second.tier) {
          return [prev[0], fruitId];
        }
        // Different tier — replace selection
        return [fruitId];
      }

      // Start new selection
      return [fruitId];
    });
  }, [userFruits]);

  // Open forge modal when 2 selected
  const canForge = selectedIds.length === 2;

  const selectedTier = useMemo(() => {
    if (selectedIds.length === 0) return null;
    const fruit = userFruits.find(f => f.id === selectedIds[0]);
    return fruit?.tier ?? null;
  }, [selectedIds, userFruits]);

  const handleForge = useCallback(async () => {
    if (!userId || selectedIds.length !== 2 || !selectedTier) return;

    // Check if inside a shrine (required for forging)
    const player = playerTracker.getPlayerById('local');
    if (player) {
      const pos = player.position;

      // Must be inside a shrine to forge
      if (!shrineTracker.isInsideShrine(pos.x, pos.y, pos.z)) {
        toast({
          title: 'Cannot forge here',
          description: 'You must be within a Shrine to forge fruit!',
          duration: 3000,
        });
        setForgeOpen(false);
        return;
      }
    }

    setForging(true);

    try {
      // Roll bonus: 50% +1, 25% +2, 12.5% +3, etc.
      let bonus = 1;
      while (Math.random() < 0.5 && bonus < FRUIT_CONFIG.MAX_FORGE_BONUS) bonus++;
      const newTier = selectedTier + bonus;

      const { data, error } = await supabase.rpc('forge_fruits', {
        fruit_id_1: selectedIds[0],
        fruit_id_2: selectedIds[1],
        new_tier: newTier,
      });

      if (error) {
        console.error('[Forge] Error:', error);
        toast({
          title: 'Forge failed',
          description: error.message,
          duration: 3000,
        });
      } else {
        const tierDef = getFruitTier(newTier);
        toast({
          title: `Forged Tier ${newTier} ${tierDef.name}!`,
          description: `+${bonus} tier${bonus > 1 ? 's' : ''} bonus`,
          duration: 4000,
        });
      }
    } catch (err) {
      console.error('[Forge] Error:', err);
    } finally {
      setForging(false);
      setForgeOpen(false);
      setSelectedIds([]);
    }
  }, [userId, selectedIds, selectedTier, toast]);

  return (
    <>
      {/* Admin-only visibility toggle */}
      {isAdmin && (
        <div className="flex items-center justify-end gap-2 mb-2 pr-1">
          <span className="text-xs" style={{ color: 'hsl(var(--hud-text-dim))' }}>Show All Fruit</span>
          <Switch checked={fruitVisibility} onCheckedChange={setFruitVisibility} />
        </div>
      )}

      {userFruits.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'hsl(var(--hud-text-dim))' }}>
          No fruits harvested yet. Find fruit on trees!
        </div>
      ) : (
        <>
          <ScrollArea style={{ height: `${height - 40}px` }}>
            <div className="grid grid-cols-5 gap-2 pr-4">
              {userFruits.map((fruit) => {
                const tierDef = getFruitTier(fruit.tier);
                const isSelected = selectedIds.includes(fruit.id);
                const hasPair = (tierCounts.get(fruit.tier) || 0) >= 2;

                return (
                  <Card
                    key={fruit.id}
                    className="p-1.5 cursor-pointer transition-all"
                    style={{
                      borderWidth: '2px',
                      borderColor: isSelected ? 'hsl(var(--hud-selection))' : 'transparent',
                      backgroundColor: hasPair ? 'hsla(var(--hud-bg))' : 'hsla(var(--hud-bg-dim))',
                      borderRadius: 'var(--hud-radius)',
                    }}
                    onClick={() => handleSelect(fruit.id)}
                  >
                    {/* Flame color swatch */}
                    <div
                      className="w-full aspect-square rounded mb-1"
                      style={{
                        background: `radial-gradient(circle, ${tierDef.flameColors[0]}, ${tierDef.flameColors[1]}, ${tierDef.flameColors[2]})`,
                      }}
                    />
                    <div className="text-center">
                      <Badge variant="secondary" className="text-[9px] px-1">
                        T{fruit.tier}
                      </Badge>
                      <p className="text-[10px] mt-0.5 truncate">{tierDef.name}</p>
                      <p className="text-[8px]" style={{ color: 'hsl(var(--hud-text-dim))' }}>{fruit.fruit_code}</p>
                    </div>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>

          {/* Forge button */}
          {canForge && (
            <div className="mt-2 flex flex-col items-center gap-1">
              <Button
                size="sm"
                onClick={() => setForgeOpen(true)}
                disabled={!isInShrine}
                title={!isInShrine ? 'You must be within a Shrine to forge fruit' : undefined}
              >
                {isInShrine ? 'Forge Selected' : 'Forge (Shrine Required)'}
              </Button>
              {!isInShrine && (
                <span className="text-xs text-muted-foreground">
                  You must be within a Shrine to forge fruit
                </span>
              )}
            </div>
          )}

          {/* Forge confirmation dialog */}
          <Dialog open={forgeOpen} onOpenChange={setForgeOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Forge Fruit?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-gray-600">
                Combine 2 Tier {selectedTier} fruits. Result: 50% +1, 25% +2, 12.5% +3...
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setForgeOpen(false)} disabled={forging}>
                  Cancel
                </Button>
                <Button onClick={handleForge} disabled={forging}>
                  {forging ? 'Forging...' : 'Forge'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
  );
};
