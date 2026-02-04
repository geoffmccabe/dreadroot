import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sprout, TreeDeciduous } from 'lucide-react';

interface SeedDefinition {
  id: string;
  name: string | null;
  tier: number;
  trunk_texture_url: string | null;
  rarity?: string;
}

interface PlantedTree {
  id: string;
  seed_definition_id: string;
  base_x: number;
  base_y: number;
  base_z: number;
  current_block_count: number;
  target_block_count: number;
  is_fully_grown: boolean;
  seed_definition?: SeedDefinition;
}

interface InventoryItem {
  item_type: string;
  item_id?: string;
  quantity: number;
}

interface TreesTabProps {
  height: number;
  inventory: InventoryItem[];
  seedDefinitions: SeedDefinition[];
  plantedTrees: PlantedTree[];
}

const getRarityFromTier = (tier: number): string => {
  if (tier <= 5) return 'common';
  if (tier <= 10) return 'uncommon';
  if (tier <= 15) return 'rare';
  if (tier <= 20) return 'epic';
  return 'legendary';
};

const getRarityStyle = (rarity: string): React.CSSProperties => {
  const varName = `--rarity-${rarity === 'common' ? 'common' : rarity}`;
  return {
    backgroundColor: `hsla(var(${varName}) / 0.15)`,
    color: `hsl(var(${varName}))`,
  };
};

export const TreesTab: React.FC<TreesTabProps> = ({ 
  height, 
  inventory, 
  seedDefinitions, 
  plantedTrees 
}) => {
  // Get seeds from inventory - match by item_id (seed_definition_id) or item_type fallback
  const seedsInInventory = seedDefinitions
    .map(sd => {
      // Primary: match by item_id (UUID match)
      // Fallback: match by item_type string (e.g., "seed_tier_13")
      const invItem = inventory.find(i => 
        i.item_id === sd.id || i.item_type === `seed_tier_${sd.tier}`
      );
      const quantity = invItem?.quantity || 0;
      return { ...sd, quantity };
    })
    .filter(s => s.quantity > 0)
    .sort((a, b) => a.tier - b.tier);

  // Get user's planted trees with seed definition info
  const treesWithInfo = plantedTrees
    .map(tree => {
      const seedDef = tree.seed_definition || seedDefinitions.find(sd => sd.id === tree.seed_definition_id);
      return { ...tree, seedDef };
    })
    .sort((a, b) => (a.seedDef?.tier || 0) - (b.seedDef?.tier || 0));

  return (
    <Tabs defaultValue="seeds" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="seeds" className="flex items-center gap-1">
          <Sprout className="w-4 h-4" />
          Seeds ({seedsInInventory.length})
        </TabsTrigger>
        <TabsTrigger value="trees" className="flex items-center gap-1">
          <TreeDeciduous className="w-4 h-4" />
          Trees ({treesWithInfo.length})
        </TabsTrigger>
      </TabsList>

      {/* Seeds Sub-panel */}
      <TabsContent
        value="seeds"
        style={{ paddingTop: '0.5rem' }}
      >
        <ScrollArea style={{ height: `${height - 56}px` }}>
        <div className="space-y-2 pr-4">
        {seedsInInventory.length === 0 ? (
          <Card className="p-4 text-center text-muted-foreground">
            <Sprout className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No seeds in inventory
          </Card>
        ) : (
          seedsInInventory.map(seed => {
            const rarity = getRarityFromTier(seed.tier);
            return (
              <Card key={seed.id} className="p-3">
                <div className="flex items-center gap-3">
                  {/* Seed Image */}
                  <div 
                    className="w-14 h-14 rounded border flex items-center justify-center flex-shrink-0"
                    style={{
                      background: seed.trunk_texture_url 
                        ? `url(${seed.trunk_texture_url}) center/cover` 
                        : 'linear-gradient(135deg, hsl(var(--rarity-uncommon)), hsl(var(--rarity-uncommon) / 0.7))'
                    }}
                  >
                    {!seed.trunk_texture_url && <Sprout className="w-6 h-6 text-white" />}
                  </div>

                  {/* Seed Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold truncate">
                        {seed.name || `Tier ${seed.tier} Seed`}
                      </h3>
                      <Badge
                        variant="secondary"
                        className="text-xs"
                        style={getRarityStyle(rarity)}
                      >
                        {rarity}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        Tier {seed.tier}
                      </Badge>
                    </div>
                  </div>

                  {/* Quantity */}
                  <div className="text-right flex-shrink-0">
                    <div className="text-2xl font-bold">{seed.quantity}</div>
                    <div className="text-xs text-muted-foreground">in inventory</div>
                  </div>
                </div>
              </Card>
            );
          })
        )}
        </div>
        </ScrollArea>
      </TabsContent>

      {/* Trees Sub-panel */}
      <TabsContent
        value="trees"
        style={{ paddingTop: '0.5rem' }}
      >
        <ScrollArea style={{ height: `${height - 56}px` }}>
        <div className="space-y-2 pr-4">
        {treesWithInfo.length === 0 ? (
          <Card className="p-4 text-center text-muted-foreground">
            <TreeDeciduous className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No trees planted
          </Card>
        ) : (
          treesWithInfo.map(tree => {
            const tier = tree.seedDef?.tier || 0;
            const rarity = getRarityFromTier(tier);
            const growthPercent = tree.target_block_count > 0 
              ? Math.round((tree.current_block_count / tree.target_block_count) * 100) 
              : 0;
            
            return (
              <Card key={tree.id} className="p-3">
                <div className="flex items-center gap-3">
                  {/* Tree Image */}
                  <div 
                    className="w-14 h-14 rounded border flex items-center justify-center flex-shrink-0"
                    style={{
                      background: tree.seedDef?.trunk_texture_url 
                        ? `url(${tree.seedDef.trunk_texture_url}) center/cover` 
                        : 'linear-gradient(135deg, hsl(var(--rarity-uncommon)), hsl(var(--rarity-uncommon) / 0.6))'
                    }}
                  >
                    {!tree.seedDef?.trunk_texture_url && <TreeDeciduous className="w-6 h-6 text-white" />}
                  </div>

                  {/* Tree Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold truncate">
                        {tree.seedDef?.name || `Tier ${tier} Tree`}
                      </h3>
                      <Badge
                        variant="secondary"
                        className="text-xs"
                        style={getRarityStyle(rarity)}
                      >
                        T{tier}
                      </Badge>
                      {!tree.is_fully_grown && (
                        <Badge
                          variant="outline"
                          className="text-xs"
                          style={{
                            color: 'hsl(var(--rarity-uncommon))',
                            borderColor: 'hsla(var(--rarity-uncommon) / 0.5)',
                          }}
                        >
                          Growing
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>📍 ({tree.base_x}, {tree.base_y}, {tree.base_z})</span>
                    </div>
                  </div>

                  {/* Block Count */}
                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-bold">
                      {tree.current_block_count.toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {tree.is_fully_grown ? 'blocks' : `${growthPercent}% grown`}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })
        )}
        </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
};
