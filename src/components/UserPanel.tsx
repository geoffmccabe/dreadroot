import React, { useState, useEffect } from 'react';
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
  const [blockchainAddress, setBlockchainAddress] = useState('');
  const [visualDistance, setVisualDistance] = useState(4);
  const [fogEnabled, setFogEnabled] = useState(true);

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
            <img src="/waterfall_coin.png" alt="coin" className="w-6 h-6" />
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
                  <img src="/waterfall_coin.png" alt="coin" className="w-6 h-6" />
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
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Blocks</h3>
              {inventory.filter(item => item.quantity > 0).length === 0 ? (
                <Card className="p-4 text-center text-muted-foreground">
                  No blocks in inventory
                </Card>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {inventory
                    .filter(item => item.quantity > 0)
                    .sort((a, b) => {
                      const blockA = availableBlocks.find(block => block.key === a.item_type);
                      const blockB = availableBlocks.find(block => block.key === b.item_type);
                      const costA = blockA?.cost || 0;
                      const costB = blockB?.cost || 0;
                      
                      // Sort by cost descending, then name ascending
                      if (costB !== costA) return costB - costA;
                      return (a.item_type || '').localeCompare(b.item_type || '');
                    })
                    .map((item) => {
                      const block = availableBlocks.find(b => b.key === item.item_type);
                      return (
                        <Card key={item.id} className="p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {block ? (
                                <BlockIcon block={block} />
                              ) : (
                                <div className="w-9 h-9 bg-gradient-to-br from-stone-400 to-stone-600 rounded border border-stone-300 flex items-center justify-center flex-shrink-0">
                                  <div className="w-6 h-6 bg-gradient-to-br from-stone-300 to-stone-500 rounded-sm border border-stone-400"></div>
                                </div>
                              )}
                              <span className="font-medium capitalize">
                                {item.item_type.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <span className="font-bold">x{item.quantity}</span>
                          </div>
                        </Card>
                      );
                    })}
                </div>
              )}
            </div>
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
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {availableBlocks.map((block) => (
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
                      
                      <div className="flex items-center gap-2">
                        <img src="/waterfall_coin.png" alt="coin" className="w-4 h-4" />
                        <span className="text-sm font-medium">{block.cost} coins</span>
                        <Badge variant="outline" className="text-xs ml-auto">
                          {block.category}
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
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
