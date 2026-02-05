// PurchaseConfirmModal - Confirm purchase dialog

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MarketplaceListing } from '../types';
import { getItemDisplayName, formatDivi } from '../types';
import { DiviBalance } from './DiviBalance';

interface PurchaseConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: MarketplaceListing;
  quantity: number;
  setQuantity: (q: number) => void;
  userBalance: number;
  onConfirm: () => void;
  isPurchasing: boolean;
  error: string | null;
}

export function PurchaseConfirmModal({
  isOpen,
  onClose,
  listing,
  quantity,
  setQuantity,
  userBalance,
  onConfirm,
  isPurchasing,
  error,
}: PurchaseConfirmModalProps) {
  const totalCost = listing.price_divi * quantity;
  const canAfford = userBalance >= totalCost;
  const maxQuantity = Math.min(listing.quantity, Math.floor(userBalance / listing.price_divi));

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="max-w-md"
        style={{
          background: 'hsla(211, 30%, 35%, 0.95)',
          border: '1px solid hsla(211, 34%, 73%, 0.8)',
        }}
      >
        <DialogHeader>
          <DialogTitle>Confirm Purchase</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Item info */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-black/20">
            <div
              className="w-12 h-12 rounded border"
              style={{
                background: 'linear-gradient(135deg, #8B7355 0%, #5a4a3a 100%)',
                borderColor: 'hsla(var(--hud-border), 0.5)',
              }}
            />
            <div>
              <div className="font-medium">{getItemDisplayName(listing)}</div>
              <div className="text-sm text-muted-foreground">
                {formatDivi(listing.price_divi)} DIVI each
              </div>
            </div>
          </div>

          {/* Quantity selector */}
          {listing.quantity > 1 && (
            <div className="space-y-2">
              <Label>Quantity (max {listing.quantity})</Label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={quantity <= 1}
                >
                  -
                </Button>
                <Input
                  type="number"
                  min={1}
                  max={maxQuantity}
                  value={quantity}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 1;
                    setQuantity(Math.max(1, Math.min(maxQuantity, val)));
                  }}
                  className="w-20 text-center"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setQuantity(Math.min(maxQuantity, quantity + 1))}
                  disabled={quantity >= maxQuantity}
                >
                  +
                </Button>
              </div>
            </div>
          )}

          {/* Cost breakdown */}
          <div className="space-y-2 p-3 rounded-lg bg-black/20">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Unit Price:</span>
              <span>{formatDivi(listing.price_divi)} DIVI</span>
            </div>
            {quantity > 1 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Quantity:</span>
                <span>x{quantity}</span>
              </div>
            )}
            <div className="flex justify-between font-bold border-t border-white/10 pt-2">
              <span>Total Cost:</span>
              <span style={{ color: '#ffd700' }}>{formatDivi(totalCost)} DIVI</span>
            </div>
          </div>

          {/* Balance */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-black/20">
            <span className="text-muted-foreground">Your Balance:</span>
            <DiviBalance balance={userBalance} showLabel={false} />
          </div>

          {/* Balance after purchase */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-black/20">
            <span className="text-muted-foreground">After Purchase:</span>
            <span className={canAfford ? 'text-green-400' : 'text-red-400'}>
              {formatDivi(userBalance - totalCost)} DIVI
            </span>
          </div>

          {/* Error message */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Insufficient funds warning */}
          {!canAfford && (
            <div className="p-3 rounded-lg bg-orange-500/20 text-orange-400 text-sm">
              Insufficient DIVI balance. You need {formatDivi(totalCost - userBalance)} more.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPurchasing}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!canAfford || isPurchasing}>
            {isPurchasing ? 'Purchasing...' : `Buy for ${formatDivi(totalCost)} DIVI`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
