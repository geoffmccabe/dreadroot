import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUserData } from '@/hooks/useUserData';
import { Card } from '@/components/ui/card';
import { useBlocksData } from '@/hooks/useBlocksData';
import { useCoinTheme } from '@/contexts/CoinThemeContext';
import { useTreeData } from '@/features/trees/hooks/useTreeData';
import { useAuth } from '@/contexts/AuthContext';

interface InventoryProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Inventory: React.FC<InventoryProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { profile, inventory, isLoading, updateBlockchainAddress } = useUserData();
  const { getBlockByKey } = useBlocksData();
  const { seedDefinitions } = useTreeData(null, user?.id);
  const { currentTheme } = useCoinTheme();
  const [blockchainAddress, setBlockchainAddress] = useState('');
  const coinImageUrl = currentTheme?.coin_image_url || '/waterfall_coin.png';

  // Sync with profile data
  useEffect(() => {
    if (profile?.blockchain_address) {
      setBlockchainAddress(profile.blockchain_address);
    }
  }, [profile?.blockchain_address]);

  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBlockchainAddress(e.target.value);
  };

  const handleAddressBlur = async () => {
    if (blockchainAddress !== (profile?.blockchain_address || '')) {
      await updateBlockchainAddress(blockchainAddress);
    }
  };

  // Parse seed tier from item_type like "seed_tier_5"
  const parseSeedTier = (itemType: string): number | null => {
    const match = itemType.match(/^seed_tier_(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  };

  // Get seed definition by tier
  const getSeedByTier = (tier: number) => {
    return seedDefinitions.find(s => s.tier === tier);
  };

  // Categorize inventory items
  const categorizedInventory = React.useMemo(() => {
    const seeds: typeof inventory = [];
    const fruits: typeof inventory = [];
    const blocks: typeof inventory = [];

    for (const item of inventory) {
      if (item.quantity <= 0) continue;

      const seedTier = parseSeedTier(item.item_type);
      if (seedTier !== null) {
        seeds.push(item);
      } else if (item.item_type === 'fruit') {
        fruits.push(item);
      } else if (item.item_type !== 'trunk') {
        // Exclude trunk - it's not a valid inventory item
        blocks.push(item);
      }
    }

    return { seeds, fruits, blocks };
  }, [inventory]);

  if (isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Inventory</DialogTitle>
          </DialogHeader>
          <div className="p-4 text-center">Loading...</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Inventory</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Coins */}
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src={coinImageUrl} alt="coin" className="w-6 h-6" />
                <span className="font-medium">Coins</span>
              </div>
              <span className="font-bold text-lg">{profile?.coins || 0}</span>
            </div>
          </Card>

          {/* Blockchain Address */}
          <Card className="p-4">
            <div className="space-y-2">
              <Label htmlFor="blockchain-address" className="text-sm font-medium">
                Waterfall Blockchain Address
              </Label>
              <Input
                id="blockchain-address"
                type="text"
                placeholder="0x...."
                value={blockchainAddress}
                onChange={handleAddressChange}
                onBlur={handleAddressBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddressBlur();
                    e.currentTarget.blur();
                  }
                }}
                className="placeholder:text-muted-foreground/50"
              />
            </div>
          </Card>

          {/* Seeds */}
          {categorizedInventory.seeds.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Seeds</h3>
              {categorizedInventory.seeds.map((item) => {
                const seedTier = parseSeedTier(item.item_type);
                const seedDef = seedTier ? getSeedByTier(seedTier) : null;
                const textureUrl = seedDef?.trunk_texture_url;
                const color = '#4a7c59';
                const displayName = seedDef?.name 
                  ? `SEED - ${seedDef.name}`
                  : `SEED - Tier ${seedTier} Tree`;
                
                return (
                  <Card key={item.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-6 h-6 rounded border flex items-center justify-center"
                          style={{
                            background: textureUrl 
                              ? `url(${textureUrl}) center/cover`
                              : `linear-gradient(135deg, ${color}, ${color}CC)`,
                            borderColor: `${color}DD`
                          }}
                        >
                          {!textureUrl && (
                            <div 
                              className="w-4 h-4 rounded-sm border"
                              style={{
                                background: `linear-gradient(135deg, ${color}EE, ${color}AA)`,
                                borderColor: `${color}FF`
                              }}
                            />
                          )}
                        </div>
                        <span className="font-medium">{displayName}</span>
                      </div>
                      <span className="font-bold">x{item.quantity}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Fruits */}
          {categorizedInventory.fruits.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Fruits</h3>
              {categorizedInventory.fruits.map((item) => {
                const blockDef = getBlockByKey('fruit');
                const textureUrl = blockDef?.texture?.diffuse;
                const color = blockDef?.properties?.color || '#FF6B6B';
                
                return (
                  <Card key={item.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-6 h-6 rounded border flex items-center justify-center"
                          style={{
                            background: textureUrl 
                              ? `url(${textureUrl}) center/cover`
                              : `linear-gradient(135deg, ${color}, ${color}CC)`,
                            borderColor: `${color}DD`
                          }}
                        >
                          {!textureUrl && (
                            <div 
                              className="w-4 h-4 rounded-sm border"
                              style={{
                                background: `linear-gradient(135deg, ${color}EE, ${color}AA)`,
                                borderColor: `${color}FF`
                              }}
                            />
                          )}
                        </div>
                        <span className="font-medium">Fruit</span>
                      </div>
                      <span className="font-bold">x{item.quantity}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Other Blocks */}
          {categorizedInventory.blocks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Blocks</h3>
              {categorizedInventory.blocks.map((item) => {
                const itemKey = item.item_id || item.item_type;
                const blockDef = getBlockByKey(itemKey);
                const textureUrl = blockDef?.texture?.diffuse;
                const color = blockDef?.properties?.color || '#8B7355';
                
                return (
                  <Card key={item.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-6 h-6 rounded border flex items-center justify-center"
                          style={{
                            background: textureUrl 
                              ? `url(${textureUrl}) center/cover`
                              : `linear-gradient(135deg, ${color}, ${color}CC)`,
                            borderColor: `${color}DD`
                          }}
                        >
                          {!textureUrl && (
                            <div 
                              className="w-4 h-4 rounded-sm border"
                              style={{
                                background: `linear-gradient(135deg, ${color}EE, ${color}AA)`,
                                borderColor: `${color}FF`
                              }}
                            />
                          )}
                        </div>
                        <span className="font-medium capitalize">
                          {blockDef?.name || item.item_type.replace('_', ' ')}
                        </span>
                      </div>
                      <span className="font-bold">x{item.quantity}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {categorizedInventory.seeds.length === 0 && 
           categorizedInventory.fruits.length === 0 && 
           categorizedInventory.blocks.length === 0 && (
            <Card className="p-4 text-center text-muted-foreground">
              No items in inventory
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
