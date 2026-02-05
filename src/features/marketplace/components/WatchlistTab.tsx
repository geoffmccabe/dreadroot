// WatchlistTab - View and manage favorited listings

import React, { useState, useCallback } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWatchlist } from '../hooks/useWatchlist';
import { usePurchase } from '../hooks/usePurchase';
import type { MarketplaceListing } from '../types';
import { ListingCard } from './ListingCard';
import { PurchaseConfirmModal } from './PurchaseConfirmModal';

interface WatchlistTabProps {
  userId: string | null;
  userBalance: number;
}

export function WatchlistTab({ userId, userBalance }: WatchlistTabProps) {
  const { watchlist, toggleWatch, isLoading, error } = useWatchlist(userId);
  const { purchase, isPurchasing } = usePurchase();

  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  const [purchaseQuantity, setPurchaseQuantity] = useState(1);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const handleBuyClick = useCallback((listing: MarketplaceListing) => {
    setSelectedListing(listing);
    setPurchaseQuantity(1);
    setPurchaseError(null);
  }, []);

  const handleConfirmPurchase = useCallback(async () => {
    if (!selectedListing) return;

    const result = await purchase(selectedListing.id, purchaseQuantity);

    if (result.success) {
      setSelectedListing(null);
    } else {
      setPurchaseError(result.error || 'Purchase failed');
    }
  }, [selectedListing, purchaseQuantity, purchase]);

  if (!userId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Please log in to view your watchlist.
      </div>
    );
  }

  // Filter to valid listings (active, not expired, not own)
  const validWatchlistItems = watchlist.filter(item => {
    const listing = item.listing;
    if (!listing) return false;
    if (!listing.is_active) return false;
    if (listing.seller_id === userId) return false;
    if (listing.expires_at && new Date(listing.expires_at) <= new Date()) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="text-sm text-muted-foreground">
        {validWatchlistItems.length} item{validWatchlistItems.length !== 1 ? 's' : ''} in watchlist
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading watchlist...</div>
        ) : error ? (
          <div className="text-center py-8 text-red-400">Error: {error}</div>
        ) : validWatchlistItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="mb-2">Your watchlist is empty.</p>
            <p className="text-sm">Click the heart icon on listings to add them here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pr-4">
            {validWatchlistItems.map((item) => (
              <ListingCard
                key={item.id}
                listing={item.listing!}
                isWatched={true}
                onToggleWatch={() => toggleWatch(item.listing_id)}
                onBuy={() => handleBuyClick(item.listing!)}
                showBuyButton={true}
                disabled={userBalance < item.listing!.price_divi}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Purchase confirmation modal */}
      {selectedListing && (
        <PurchaseConfirmModal
          isOpen={!!selectedListing}
          onClose={() => setSelectedListing(null)}
          listing={selectedListing}
          quantity={purchaseQuantity}
          setQuantity={setPurchaseQuantity}
          userBalance={userBalance}
          onConfirm={handleConfirmPurchase}
          isPurchasing={isPurchasing}
          error={purchaseError}
        />
      )}
    </div>
  );
}
