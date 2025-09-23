import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useUserData } from '@/hooks/useUserData';

interface BlockShopProps {
  isOpen: boolean;
  onClose: () => void;
  onBlockPurchased: () => void;
}

const BLOCK_ITEMS = [
  {
    id: 'fortress_block',
    name: 'Fortress Block',
    description: '1x1m block textured like the fortress walls',
    cost: 3,
    image: '/waterfall_coin.png' // Using coin image as placeholder
  }
];

export const BlockShop: React.FC<BlockShopProps> = ({ isOpen, onClose, onBlockPurchased }) => {
  const { profile, inventory, buyBlock, isLoading } = useUserData();

  const handleBuyBlock = async (itemId: string, cost: number) => {
    const success = await buyBlock(itemId, cost);
    if (success) {
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
        
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Buy blocks with your coins to build in the world!
          </div>
          
          {BLOCK_ITEMS.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-stone-400 to-stone-600 rounded border border-stone-300 flex items-center justify-center">
                  <div className="w-8 h-8 bg-gradient-to-br from-stone-300 to-stone-500 rounded-sm border border-stone-400"></div>
                </div>
                
                <div className="flex-1">
                  <h3 className="font-semibold">{item.name}</h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <img src="/waterfall_coin.png" alt="coin" className="w-4 h-4" />
                    <span className="text-sm font-medium">{item.cost} coins</span>
                  </div>
                </div>
                
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">
                    You have: {getBlockQuantity(item.id)}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleBuyBlock(item.id, item.cost)}
                    disabled={!profile || profile.coins < item.cost}
                    className="min-w-[60px]"
                  >
                    Buy
                  </Button>
                </div>
              </div>
            </Card>
          ))}
          
          <div className="text-xs text-muted-foreground text-center pt-2">
            Click a block after buying to select it for placement
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};