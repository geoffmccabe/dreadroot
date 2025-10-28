import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUserData } from '@/hooks/useUserData';
import { Card } from '@/components/ui/card';
import { useBlocksData } from '@/hooks/useBlocksData';
import { useTokenTheme } from '@/contexts/TokenThemeContext';

interface InventoryProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Inventory: React.FC<InventoryProps> = ({ isOpen, onClose }) => {
  const { profile, inventory, isLoading, updateBlockchainAddress } = useUserData();
  const { getBlockByKey } = useBlocksData();
  const { currentTheme } = useTokenTheme();
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
      console.log('Updating blockchain address:', blockchainAddress);
      const success = await updateBlockchainAddress(blockchainAddress);
      if (success) {
        console.log('Blockchain address updated successfully');
      } else {
        console.log('Failed to update blockchain address');
      }
    }
  };

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
                    e.currentTarget.blur(); // Force blur to exit focus
                  }
                }}
                className="placeholder:text-muted-foreground/50"
              />
            </div>
          </Card>

          {/* Blocks */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">Blocks</h3>
            {inventory.filter(item => item.quantity > 0).length === 0 ? (
              <Card className="p-4 text-center text-muted-foreground">
                No blocks in inventory
              </Card>
            ) : (
              inventory
                .filter(item => item.quantity > 0)
                .map((item) => {
                  const blockDef = getBlockByKey(item.item_type);
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
                })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};