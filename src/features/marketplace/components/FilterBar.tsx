// FilterBar - Search, filter, and sort controls for marketplace

import React from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';
import type { MarketplaceFilters, MarketplaceSortOption, MarketplaceItemCategory } from '../types';
import { SORT_OPTIONS, CATEGORY_LABELS } from '../constants';

interface FilterBarProps {
  filters: MarketplaceFilters;
  setFilters: React.Dispatch<React.SetStateAction<MarketplaceFilters>>;
  sortOption: MarketplaceSortOption;
  setSortOption: (option: MarketplaceSortOption) => void;
}

export function FilterBar({ filters, setFilters, sortOption, setSortOption }: FilterBarProps) {
  const hasActiveFilters = Object.values(filters).some(v =>
    v !== undefined && v !== '' && (Array.isArray(v) ? v.length > 0 : true)
  );

  const clearFilters = () => {
    setFilters({});
  };

  return (
    <div className="flex flex-wrap gap-3 p-3 rounded-lg" style={{ background: 'hsla(var(--hud-bg), 0.4)' }}>
      {/* Search */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search listings..."
          value={filters.search || ''}
          onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value || undefined }))}
          className="pl-8 h-9"
          style={{ background: 'hsla(var(--hud-bg), 0.6)' }}
        />
      </div>

      {/* Category filter */}
      <Select
        value={filters.category || 'all'}
        onValueChange={(value) =>
          setFilters(prev => ({
            ...prev,
            category: value === 'all' ? undefined : value as MarketplaceItemCategory,
          }))
        }
      >
        <SelectTrigger className="w-[130px] h-9" style={{ background: 'hsla(var(--hud-bg), 0.6)' }}>
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Tier range (only show for seeds/fruits) */}
      {(filters.category === 'seed' || filters.category === 'fruit') && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Tier:</span>
          <Input
            type="number"
            min={1}
            max={30}
            placeholder="Min"
            value={filters.tier_min || ''}
            onChange={(e) =>
              setFilters(prev => ({
                ...prev,
                tier_min: e.target.value ? parseInt(e.target.value) : undefined,
              }))
            }
            className="w-16 h-9"
            style={{ background: 'hsla(var(--hud-bg), 0.6)' }}
          />
          <span className="text-muted-foreground">-</span>
          <Input
            type="number"
            min={1}
            max={30}
            placeholder="Max"
            value={filters.tier_max || ''}
            onChange={(e) =>
              setFilters(prev => ({
                ...prev,
                tier_max: e.target.value ? parseInt(e.target.value) : undefined,
              }))
            }
            className="w-16 h-9"
            style={{ background: 'hsla(var(--hud-bg), 0.6)' }}
          />
        </div>
      )}

      {/* Price range */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Price:</span>
        <Input
          type="number"
          min={1}
          placeholder="Min"
          value={filters.price_min || ''}
          onChange={(e) =>
            setFilters(prev => ({
              ...prev,
              price_min: e.target.value ? parseInt(e.target.value) : undefined,
            }))
          }
          className="w-20 h-9"
          style={{ background: 'hsla(var(--hud-bg), 0.6)' }}
        />
        <span className="text-muted-foreground">-</span>
        <Input
          type="number"
          min={1}
          placeholder="Max"
          value={filters.price_max || ''}
          onChange={(e) =>
            setFilters(prev => ({
              ...prev,
              price_max: e.target.value ? parseInt(e.target.value) : undefined,
            }))
          }
          className="w-20 h-9"
          style={{ background: 'hsla(var(--hud-bg), 0.6)' }}
        />
      </div>

      {/* Sort */}
      <Select value={sortOption} onValueChange={(v) => setSortOption(v as MarketplaceSortOption)}>
        <SelectTrigger className="w-[160px] h-9" style={{ background: 'hsla(var(--hud-bg), 0.6)' }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Clear filters */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="h-9 px-2"
        >
          <X className="w-4 h-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
