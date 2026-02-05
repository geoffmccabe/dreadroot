// MyListingsTab - View and manage user's own listings

import React, { useState, useCallback } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useMarketplaceData } from '../hooks/useMarketplaceData';
import { useListings } from '../hooks/useListings';
import type { MarketplaceListing } from '../types';
import { ListingCard } from './ListingCard';
import { CreateListingModal } from './CreateListingModal';

interface MyListingsTabProps {
  userId: string | null;
}

export function MyListingsTab({ userId }: MyListingsTabProps) {
  const { listings, isLoading, error, refetch } = useMarketplaceData({
    filters: { seller_id: userId || undefined },
    sortOption: 'date_desc',
  });
  const { cancelListing, isCanceling } = useListings();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const handleCancel = useCallback(async (listingId: string) => {
    setCancelingId(listingId);
    const result = await cancelListing(listingId);
    setCancelingId(null);

    if (result.success) {
      refetch();
    }
  }, [cancelListing, refetch]);

  const handleListingCreated = useCallback(() => {
    setIsCreateModalOpen(false);
    refetch();
  }, [refetch]);

  // Filter to only show user's listings (double-check)
  const myListings = userId
    ? listings.filter(l => l.seller_id === userId)
    : [];

  if (!userId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Please log in to manage your listings.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {myListings.length} active listing{myListings.length !== 1 ? 's' : ''}
        </div>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Listing
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {isLoading && myListings.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">Loading your listings...</div>
        ) : error ? (
          <div className="text-center py-8 text-red-400">Error: {error}</div>
        ) : myListings.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="mb-4">You have no active listings.</p>
            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Listing
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pr-4">
            {myListings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                showBuyButton={false}
                showCancelButton={true}
                onCancel={() => handleCancel(listing.id)}
                disabled={cancelingId === listing.id}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Create listing modal */}
      <CreateListingModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleListingCreated}
        userId={userId}
      />
    </div>
  );
}
