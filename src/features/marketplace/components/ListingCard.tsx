// ListingCard - Individual marketplace listing display

import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Heart } from 'lucide-react';
import type { MarketplaceListing } from '../types';
import { getItemDisplayName, getItemTier, isListingExpiringSoon, formatDivi, formatTimeRemaining } from '../types';
import { RARITY_COLORS, CATEGORY_LABELS, getFruitTierName } from '../constants';

interface ListingCardProps {
  listing: MarketplaceListing;
  isWatched?: boolean;
  onToggleWatch?: () => void;
  onBuy?: () => void;
  onCancel?: () => void;
  showBuyButton?: boolean;
  showCancelButton?: boolean;
  disabled?: boolean;
  isBuying?: boolean;
}

export function ListingCard({
  listing,
  isWatched = false,
  onToggleWatch,
  onBuy,
  onCancel,
  showBuyButton = true,
  showCancelButton = false,
  disabled = false,
  isBuying = false,
}: ListingCardProps) {
  const tier = getItemTier(listing);
  const displayName = getItemDisplayName(listing);
  const expiringSoon = isListingExpiringSoon(listing);

  // Get texture URL for icon
  const getTextureUrl = (): string | null => {
    if (listing.item_category === 'seed' && listing.seed_definition?.trunk_texture_url) {
      return listing.seed_definition.trunk_texture_url;
    }
    if (listing.item_category === 'block' && listing.block_definition?.texture_url) {
      return listing.block_definition.texture_url;
    }
    return null;
  };

  // Get background gradient based on category/tier
  const getIconBackground = (): string => {
    const textureUrl = getTextureUrl();
    if (textureUrl) {
      return `url(${textureUrl}) center/cover`;
    }

    if (listing.item_category === 'fruit' && tier) {
      // Gradient based on fruit tier
      const tierGradients: Record<number, string> = {
        1: 'linear-gradient(135deg, #d4a84b 0%, #8b6914 100%)',
        2: 'linear-gradient(135deg, #ff8c00 0%, #cc4400 100%)',
        3: 'linear-gradient(135deg, #ffd700 0%, #cc8800 100%)',
        4: 'linear-gradient(135deg, #22cc22 0%, #006600 100%)',
        5: 'linear-gradient(135deg, #ff2222 0%, #880000 100%)',
        6: 'linear-gradient(135deg, #ffffff 0%, #e0e0ff 100%)',
        7: 'linear-gradient(135deg, #ff69b4 0%, #cc00cc 100%)',
        8: 'linear-gradient(135deg, #ff0000 0%, #0000ff 100%)',
        9: 'linear-gradient(135deg, #111111 0%, #ff4400 100%)',
        10: 'linear-gradient(135deg, #ffd700 0%, #fff8dc 100%)',
      };
      return tierGradients[tier] || tierGradients[10];
    }

    // Default gradients by category
    const categoryGradients: Record<string, string> = {
      block: 'linear-gradient(135deg, #8B7355 0%, #5a4a3a 100%)',
      seed: 'linear-gradient(135deg, #228B22 0%, #006400 100%)',
      fruit: 'linear-gradient(135deg, #ffd700 0%, #cc8800 100%)',
      item: 'linear-gradient(135deg, #4a90d9 0%, #2a5a8a 100%)',
    };
    return categoryGradients[listing.item_category] || categoryGradients.item;
  };

  const getRarityBadgeClass = (): string => {
    const rarity = listing.seed_definition?.rarity || listing.block_definition?.rarity;
    if (!rarity) return 'bg-gray-500/50';

    const classes: Record<string, string> = {
      common: 'bg-gray-500/50',
      uncommon: 'bg-green-500/50',
      rare: 'bg-blue-500/50',
      epic: 'bg-purple-500/50',
      legendary: 'bg-amber-500/50',
      mythic: 'bg-red-500/50',
    };
    return classes[rarity] || classes.common;
  };

  const sellerName = listing.store?.store_name ||
    listing.seller_profile?.display_name ||
    'Anonymous';

  // Get seller image: prefer store banner, fallback to profile avatar
  const sellerImage = listing.store?.banner_url || listing.seller_profile?.avatar_url;

  return (
    <Card
      className="p-3 hover:shadow-lg transition-shadow relative"
      style={{
        background: 'hsla(var(--hud-bg), 0.6)',
        border: '1px solid hsla(var(--hud-border), 0.5)',
      }}
    >
      {/* Watch button */}
      {onToggleWatch && (
        <button
          onClick={onToggleWatch}
          className="absolute top-2 right-2 p-1 rounded-full hover:bg-white/10 transition-colors"
        >
          <Heart
            className={`w-4 h-4 ${isWatched ? 'fill-red-500 text-red-500' : 'text-gray-400'}`}
          />
        </button>
      )}

      <div className="flex gap-3">
        {/* Item icon */}
        <div
          className="w-16 h-16 rounded border flex-shrink-0"
          style={{
            background: getIconBackground(),
            borderColor: 'hsla(var(--hud-border), 0.5)',
          }}
        />

        {/* Item details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="truncate">
              <span className="font-medium">{displayName}</span>
              {listing.quantity > 1 && (
                <span className="text-muted-foreground ml-1">x{listing.quantity}</span>
              )}
            </div>
          </div>

          {/* Badges row */}
          <div className="flex flex-wrap gap-1 mt-1">
            <Badge variant="outline" className="text-xs px-1.5 py-0">
              {CATEGORY_LABELS[listing.item_category]}
            </Badge>
            {tier && (
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                {listing.item_category === 'fruit' ? getFruitTierName(tier) : `Tier ${tier}`}
              </Badge>
            )}
            {(listing.seed_definition?.rarity || listing.block_definition?.rarity) && (
              <Badge className={`text-xs px-1.5 py-0 ${getRarityBadgeClass()}`}>
                {listing.seed_definition?.rarity || listing.block_definition?.rarity}
              </Badge>
            )}
          </div>

          {/* Seller */}
          <div className="flex items-center gap-1.5 mt-1">
            {sellerImage ? (
              <div
                className="w-4 h-4 rounded-sm flex-shrink-0"
                style={{
                  background: `url(${sellerImage}) center/cover`,
                  aspectRatio: listing.store?.banner_url ? '3/2' : '1/1',
                }}
              />
            ) : (
              <div
                className="w-4 h-4 rounded-full flex-shrink-0 bg-gray-500/30"
              />
            )}
            <span className="text-xs text-muted-foreground truncate">
              {sellerName}
            </span>
          </div>

          {/* Expiration warning */}
          {listing.expires_at && (
            <div className={`text-xs mt-1 ${expiringSoon ? 'text-orange-400' : 'text-muted-foreground'}`}>
              {expiringSoon ? '⚠️ ' : ''}
              Expires: {formatTimeRemaining(listing.expires_at)}
            </div>
          )}
        </div>
      </div>

      {/* Description if present */}
      {listing.seller_description && (
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {listing.seller_description}
        </p>
      )}

      {/* Price and actions */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10">
        <div className="flex items-center gap-1">
          <div
            className="w-4 h-4 rounded-full flex items-center justify-center font-bold text-[10px]"
            style={{
              background: 'linear-gradient(135deg, #ffd700 0%, #cc8800 100%)',
              color: '#1a1a1a',
            }}
          >
            D
          </div>
          <span className="font-bold" style={{ color: '#ffd700' }}>
            {formatDivi(listing.price_divi)}
          </span>
          {listing.quantity > 1 && (
            <span className="text-xs text-muted-foreground">
              ({formatDivi(Math.ceil(listing.price_divi / listing.quantity))} each)
            </span>
          )}
        </div>

        <div className="flex gap-2">
          {showBuyButton && onBuy && (
            <Button
              size="sm"
              onClick={onBuy}
              disabled={disabled || isBuying}
              className="px-4"
            >
              {isBuying ? 'Buying...' : 'Buy'}
            </Button>
          )}
          {showCancelButton && onCancel && (
            <Button
              size="sm"
              variant="destructive"
              onClick={onCancel}
              disabled={disabled}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
