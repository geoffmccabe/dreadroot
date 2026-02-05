// BrowseTab - Browse all active marketplace listings

import React, { useState, useCallback } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useMarketplaceData } from '../hooks/useMarketplaceData';
import { useWatchlist } from '../hooks/useWatchlist';
import { usePurchase } from '../hooks/usePurchase';
import type { MarketplaceFilters, MarketplaceSortOption, MarketplaceListing } from '../types';
import { FilterBar } from './FilterBar';
import { ListingCard } from './ListingCard';
import { PurchaseConfirmModal } from './PurchaseConfirmModal';

interface BrowseTabProps {
  filters: MarketplaceFilters;
  setFilters: React.Dispatch<React.SetStateAction<MarketplaceFilters>>;
  sortOption: MarketplaceSortOption;
  setSortOption: (option: MarketplaceSortOption) => void;
  userId: string | null;
  userBalance: number;
}

export function BrowseTab({
  filters,
  setFilters,
  sortOption,
  setSortOption,
  userId,
  userBalance,
}: BrowseTabProps) {
  const { listings, isLoading, error, hasMore, loadMore, totalCount } = useMarketplaceData({
    filters,
    sortOption,
  });
  const { isWatched, toggleWatch } = useWatchlist(userId);
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

  // Filter out user's own listings
  const filteredListings = userId
    ? listings.filter(l => l.seller_id !== userId)
    : listings;

  return (
    <div className="h-full flex flex-col gap-4">
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        sortOption={sortOption}
        setSortOption={setSortOption}
      />

      <div className="text-sm text-muted-foreground px-1">
        {totalCount} listing{totalCount !== 1 ? 's' : ''} found
      </div>

      <ScrollArea className="flex-1">
        {isLoading && filteredListings.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">Loading listings...</div>
        ) : error ? (
          <div className="text-center py-8 text-red-400">Error: {error}</div>
        ) : filteredListings.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No listings found. Try adjusting your filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pr-4">
            {filteredListings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                isWatched={isWatched(listing.id)}
                onToggleWatch={() => toggleWatch(listing.id)}
                onBuy={() => handleBuyClick(listing)}
                showBuyButton={true}
                disabled={!userId || userBalance < listing.price_divi}
              />
            ))}
          </div>
        )}

        {hasMore && !isLoading && (
          <div className="flex justify-center py-4">
            <Button variant="outline" onClick={loadMore}>
              Load More
            </Button>
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
