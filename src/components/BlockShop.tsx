import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useUserData } from '@/hooks/useUserData';
import { getAllBlocks } from '@/data/blockRegistry';
import { BlockType } from '@/types/blocks';

interface BlockShopProps {
  isOpen: boolean;
  onClose: () => void;
  onBlockPurchased: () => void;
}

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
  
  return (
    <div className={`w-12 h-12 rounded border flex items-center justify-center ${
      isEmissive ? 'shadow-lg' : ''
    }`} 
    style={{ 
      background: isEmissive 
        ? `radial-gradient(circle, ${baseColor}, ${baseColor}80)` 
        : `linear-gradient(135deg, ${baseColor}, ${baseColor}CC)`,
      borderColor: isTransparent ? `${baseColor}60` : `${baseColor}DD`,
      opacity: isTransparent ? 0.8 : 1
    }}>
      <div className={`w-8 h-8 rounded-sm border ${
        isEmissive ? 'animate-pulse' : ''
      }`}
      style={{
        background: `linear-gradient(135deg, ${baseColor}EE, ${baseColor}AA)`,
        borderColor: `${baseColor}FF`
      }}></div>
    </div>
  );
};

export const BlockShop: React.FC<BlockShopProps> = ({ isOpen, onClose, onBlockPurchased }) => {
  const { profile, inventory, buyBlock, isLoading } = useUserData();
  const availableBlocks = getAllBlocks();

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
      
      onBlockPurchased();
    }
  };

  const getBlockQuantity = (itemType: string) => {
    const item = inventory.find(i => i.item_type === itemType);
    return item?.quantity || 0;
  };

  if (isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Loading...</DialogTitle>
          </DialogHeader>
          <div className="p-4 text-center">Loading shop...</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-background/95 backdrop-blur">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src="/waterfall_coin.png" alt="coin" className="w-6 h-6" />
            Shop - Coins: {profile?.coins || 0}
          </DialogTitle>
        </DialogHeader>
        
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
      </DialogContent>
    </Dialog>
  );
};