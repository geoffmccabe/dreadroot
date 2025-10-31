import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useUserData } from '@/hooks/useUserData';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPanel } from '@/contexts/UserPanelContext';
import { BlockType } from '@/types/blocks';
import { useBlocksData } from '@/hooks/useBlocksData';
import { useTokenTheme } from '@/contexts/TokenThemeContext';
import { useBlocks } from '@/contexts/BlocksContext';

const getRarityColor = (rarity: BlockType['rarity']) => {
  switch (rarity) {
    case 'common': return 'bg-gray-100 text-gray-800';
    case 'rare': return 'bg-blue-100 text-blue-800';
    case 'epic': return 'bg-purple-100 text-purple-800';
    case 'legendary': return 'bg-amber-100 text-amber-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

const BlockIcon: React.FC<{ block: BlockType }> = ({ block }) => {
  const baseColor = block.properties?.color || '#8B7355';
  const isEmissive = block.properties?.emissive;
  const isTransparent = block.properties?.transparent;
  const hasTexture = block.texture?.diffuse;
  
  return (
    <div className={`w-[72px] h-[72px] rounded border flex items-center justify-center ${
      isEmissive ? 'shadow-lg' : ''
    }`}
    style={{ 
      background: hasTexture 
        ? `url(${block.texture?.diffuse}) center/cover`
        : isEmissive 
          ? `radial-gradient(circle, ${baseColor}, ${baseColor}80)` 
          : `linear-gradient(135deg, ${baseColor}, ${baseColor}CC)`,
      borderColor: isTransparent ? `${baseColor}60` : `${baseColor}DD`,
      opacity: isTransparent ? 0.8 : 1
    }}>
      {!hasTexture && (
        <div className={`w-8 h-8 rounded-sm border ${
          isEmissive ? 'animate-pulse' : ''
        }`}
        style={{
          background: `linear-gradient(135deg, ${baseColor}EE, ${baseColor}AA)`,
          borderColor: `${baseColor}FF`
        }}></div>
      )}
    </div>
  );
};

interface UserPanelProps {
  onBlockPurchased?: () => void;
}

export const UserPanel: React.FC<UserPanelProps> = ({ onBlockPurchased }) => {
  const { isOpen, activeTab, closePanel, setActiveTab } = useUserPanel();
  const { user } = useAuth();
  const { profile, inventory, isLoading, buyBlock, updateBlockchainAddress, updateVisualDistance, updateFogEnabled } = useUserData();
  const { blocks: availableBlocks, isLoading: loadingBlocks } = useBlocksData();
  const { currentTheme } = useTokenTheme();
  const [blockchainAddress, setBlockchainAddress] = useState('');
  const [visualDistance, setVisualDistance] = useState(4);
  const [fogEnabled, setFogEnabled] = useState(true);
  const [storeActiveClass, setStoreActiveClass] = useState<'basic' | 'magic' | 'mystery' | 'iconic'>('basic');
  const [inventoryActiveClass, setInventoryActiveClass] = useState<'basic' | 'magic' | 'mystery' | 'iconic'>('basic');
  
  const coinImageUrl = currentTheme?.coin_image_url || '/waterfall_coin.png';
  const { blocks: allPlacedBlocks } = useBlocks();
  
  // Count placed blocks by type for current user
  const placedBlockCounts = useMemo(() => {
    const counts = new Map<string, number>();
    allPlacedBlocks.forEach(block => {
      if (block.user_id === user?.id) {
        const count = counts.get(block.block_type) || 0;
        counts.set(block.block_type, count + 1);
      }
    });
    return counts;
  }, [allPlacedBlocks, user?.id]);

  // Sync blockchain address with profile
  useEffect(() => {
    if (profile?.blockchain_address) {
      setBlockchainAddress(profile.blockchain_address);
    }
  }, [profile?.blockchain_address]);

  // Sync visual distance with profile
  useEffect(() => {
    if (profile?.visual_distance !== undefined) {
      setVisualDistance(profile.visual_distance);
    }
  }, [profile?.visual_distance]);

  // Sync fog enabled with profile
  useEffect(() => {
    if (profile?.fog_enabled !== undefined) {
      setFogEnabled(profile.fog_enabled);
    }
  }, [profile?.fog_enabled]);

  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBlockchainAddress(e.target.value);
  };

  const handleAddressBlur = async () => {
    if (blockchainAddress !== (profile?.blockchain_address || '')) {
      await updateBlockchainAddress(blockchainAddress);
    }
  };

  const handleVisualDistanceChange = async (value: number[]) => {
    const newDistance = value[0];
    setVisualDistance(newDistance); // Update local state immediately
    await updateVisualDistance(newDistance); // Save to database
  };

  const handleFogToggle = async (checked: boolean) => {
    setFogEnabled(checked); // Update local state immediately
    await updateFogEnabled(checked); // Save to database
  };

  const handleBuyBlock = async (itemKey: string, cost: number) => {
    const success = await buyBlock(itemKey, cost);
    if (success) {
      // Play coin sound 3 times rapidly
      const audio = new Audio('/coin_hit_sound.mp3');
      audio.volume = 0.3;
      audio.play();
      
      setTimeout(() => {
        const audio2 = new Audio('/coin_hit_sound.mp3');
        audio2.volume = 0.3;
        audio2.play();
      }, 100);
      
      setTimeout(() => {
        const audio3 = new Audio('/coin_hit_sound.mp3');
        audio3.volume = 0.3;
        audio3.play();
      }, 200);
      
      onBlockPurchased?.();
    }
  };

  const getBlockQuantity = (itemType: string) => {
    const item = inventory.find(i => i.item_type === itemType);
    return item?.quantity || 0;
  };

  if (isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={closePanel}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Loading...</DialogTitle>
          </DialogHeader>
          <div className="p-4 text-center">Loading...</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={closePanel}>
      <DialogContent className="user-panel-dialog w-[28rem] max-w-[28rem] bg-background/95 backdrop-blur">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src={coinImageUrl} alt="coin" className="w-6 h-6" />
            User Panel - Coins: {profile?.coins || 0}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="user">User</TabsTrigger>
            <TabsTrigger value="wallet">Wallet</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="store">Store</TabsTrigger>
          </TabsList>

          {/* User Tab */}
          <TabsContent value="user" className="space-y-4">
            <Card className="p-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Email</Label>
                <div className="text-lg font-semibold">{user?.email || 'Not logged in'}</div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Visual Distance</Label>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {visualDistance} chunks ({visualDistance * 16} blocks)
                  </span>
                </div>
                <Slider
                  value={[visualDistance]}
                  onValueChange={handleVisualDistanceChange}
                  min={1}
                  max={20}
                  step={1}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Controls how far you can see. Lower = better performance.
                </p>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label htmlFor="fog-toggle" className="text-sm font-medium">
                    Distance Fog
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Gradually fade distant blocks to grey
                  </p>
                </div>
                <Switch
                  id="fog-toggle"
                  checked={fogEnabled}
                  onCheckedChange={handleFogToggle}
                />
              </div>
            </Card>
          </TabsContent>

          {/* Wallet Tab */}
          <TabsContent value="wallet" className="space-y-4">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <img src={coinImageUrl} alt="coin" className="w-6 h-6" />
                  <span className="font-medium">Coins</span>
                </div>
                <span className="font-bold text-lg">{profile?.coins || 0}</span>
              </div>
            </Card>

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
          </TabsContent>

          {/* Inventory Tab */}
          <TabsContent value="inventory" className="space-y-4">
            <Tabs value={inventoryActiveClass} onValueChange={(v) => setInventoryActiveClass(v as any)} className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="basic">BASIC</TabsTrigger>
                <TabsTrigger value="magic">MAGIC</TabsTrigger>
                <TabsTrigger value="mystery">MYSTERY</TabsTrigger>
                <TabsTrigger value="iconic">ICONIC</TabsTrigger>
              </TabsList>
              
              <TabsContent value={inventoryActiveClass} className="space-y-2 max-h-96 overflow-y-auto mt-4">
                {(() => {
                  const blocksInClass = availableBlocks
                    .filter(block => {
                      if (block.class !== inventoryActiveClass) return false;
                      const inventoryCount = inventory.find(i => i.item_type === block.key)?.quantity || 0;
                      const placedCount = placedBlockCounts.get(block.key) || 0;
                      return inventoryCount > 0 || placedCount > 0;
                    })
                    .sort((a, b) => {
                      // Mystery blocks: sort by tier only
                      if (inventoryActiveClass === 'mystery') {
                        return a.tier - b.tier;
                      }
                      // Other classes: sort by cost (cheapest first), then by tier
                      if (a.cost !== b.cost) {
                        return a.cost - b.cost;
                      }
                      return a.tier - b.tier;
                    });
                  
                  if (blocksInClass.length === 0) {
                    return (
                      <Card className="p-4 text-center text-muted-foreground">
                        No blocks in this class
                      </Card>
                    );
                  }
                  
                  return blocksInClass.map((block) => {
                    const inventoryCount = inventory.find(i => i.item_type === block.key)?.quantity || 0;
                    const placedCount = placedBlockCounts.get(block.key) || 0;
                    
                    return (
                      <Card key={block.key} className="p-3">
                        <div className="flex items-center gap-3">
                          <BlockIcon block={block} />
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold truncate">{block.name}</h3>
                              <Badge 
                                variant="secondary" 
                                className={`text-xs ${getRarityColor(block.rarity)}`}
                              >
                                {block.rarity}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-xs">
                                {block.category}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                Tier {block.tier}
                              </Badge>
                            </div>
                          </div>
                          
                          <div className="text-right flex-shrink-0 text-xs space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Inventory:</span>
                              <span className="font-semibold">{inventoryCount}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Placed:</span>
                              <span className="font-semibold">{placedCount}</span>
                            </div>
                          </div>
                        </div>
                      </Card>
                    );
                  });
                })()}
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* Store Tab */}
          <TabsContent value="store" className="space-y-4">
            {loadingBlocks ? (
              <Card className="p-4 text-center text-muted-foreground">
                Loading blocks...
              </Card>
            ) : availableBlocks.length === 0 ? (
              <Card className="p-4 text-center text-muted-foreground">
                No blocks available in store
              </Card>
            ) : (
              <Tabs value={storeActiveClass} onValueChange={(v) => setStoreActiveClass(v as any)} className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="basic">BASIC</TabsTrigger>
                  <TabsTrigger value="magic">MAGIC</TabsTrigger>
                  <TabsTrigger value="mystery">MYSTERY</TabsTrigger>
                  <TabsTrigger value="iconic">ICONIC</TabsTrigger>
                </TabsList>
                
                <TabsContent value={storeActiveClass} className="space-y-4 max-h-96 overflow-y-auto mt-4">
                  {availableBlocks
                    .filter(block => block.class === storeActiveClass)
                    .sort((a, b) => {
                      // Mystery blocks: sort by tier only
                      if (storeActiveClass === 'mystery') {
                        return a.tier - b.tier;
                      }
                      // Other classes: sort by cost (cheapest first), then by tier
                      if (a.cost !== b.cost) {
                        return a.cost - b.cost;
                      }
                      return a.tier - b.tier;
                    })
                    .map((block) => (
                    <Card key={block.key} className="p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-3">
                        <BlockIcon block={block} />
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold truncate">{block.name}</h3>
                            <Badge 
                              variant="secondary" 
                              className={`text-xs ${getRarityColor(block.rarity)}`}
                            >
                              {block.rarity}
                            </Badge>
                          </div>
                          
                          <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                            {block.description}
                          </p>
                          
                          <div className="flex items-center gap-2 flex-wrap">
                            <img src={coinImageUrl} alt="coin" className="w-4 h-4" />
                            <span className="text-sm font-medium">{block.cost} coins</span>
                            <Badge variant="outline" className="text-xs">
                              {block.category}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              Tier {block.tier}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {block.class.toUpperCase()}
                            </Badge>
                          </div>
                        </div>
                        
                        <div className="text-center flex-shrink-0">
                          <div className="text-xs text-muted-foreground mb-2">
                            Owned: {getBlockQuantity(block.key)}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleBuyBlock(block.key, block.cost)}
                            disabled={!profile || profile.coins < block.cost}
                            className="min-w-[60px]"
                          >
                            Buy
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </TabsContent>
              </Tabs>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
