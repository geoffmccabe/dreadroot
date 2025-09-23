import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUserData } from '@/hooks/useUserData';
import { Card } from '@/components/ui/card';

interface InventoryProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Inventory: React.FC<InventoryProps> = ({ isOpen, onClose }) => {
  const { profile, inventory, isLoading, updateBlockchainAddress } = useUserData();
  const [blockchainAddress, setBlockchainAddress] = useState('');

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
                <img src="/waterfall_coin.png" alt="coin" className="w-6 h-6" />
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
            {inventory.length === 0 ? (
              <Card className="p-4 text-center text-muted-foreground">
                No blocks in inventory
              </Card>
            ) : (
              inventory.map((item) => (
                <Card key={item.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-gradient-to-br from-stone-400 to-stone-600 rounded border border-stone-300 flex items-center justify-center">
                        <div className="w-4 h-4 bg-gradient-to-br from-stone-300 to-stone-500 rounded-sm border border-stone-400"></div>
                      </div>
                      <span className="font-medium capitalize">
                        {item.item_type.replace('_', ' ')}
                      </span>
                    </div>
                    <span className="font-bold">x{item.quantity}</span>
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};