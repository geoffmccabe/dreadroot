// CreateListingModal - Create a new marketplace listing

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useListings } from '../hooks/useListings';
import type { MarketplaceItemCategory, CreateListingInput } from '../types';
import { EXPIRATION_PRESETS, LISTING_DESCRIPTION_MAX_LENGTH, MIN_PRICE_DIVI } from '../constants';

interface CreateListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userId: string;
}

interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  tier?: number;
  rarity?: string;
  textureUrl?: string;
  seedDefinitionId?: string;  // For seeds - the actual UUID
  fruitIds?: string[];        // For fruits - actual fruit row IDs
}

export function CreateListingModal({ isOpen, onClose, onSuccess, userId }: CreateListingModalProps) {
  const { createListing, isCreating } = useListings();

  // Form state
  const [category, setCategory] = useState<MarketplaceItemCategory>('block');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [price, setPrice] = useState<number>(100);
  const [quantity, setQuantity] = useState<number>(1);
  const [description, setDescription] = useState<string>('');
  const [expirationHours, setExpirationHours] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Inventory data
  const [blocks, setBlocks] = useState<InventoryItem[]>([]);
  const [seeds, setSeeds] = useState<InventoryItem[]>([]);
  const [fruits, setFruits] = useState<InventoryItem[]>([]);
  const [isLoadingInventory, setIsLoadingInventory] = useState(true);

  // Fetch inventory on open
  useEffect(() => {
    if (!isOpen || !userId) return;

    const fetchInventory = async () => {
      setIsLoadingInventory(true);

      try {
        // Fetch blocks from user_inventory (item_type stores block key, no item_id for blocks)
        const { data: blockData } = await supabase
          .from('user_inventory')
          .select('item_type, quantity')
          .eq('user_id', userId)
          .not('item_type', 'like', 'seed_tier_%')  // Exclude seeds
          .gt('quantity', 0);

        if (blockData && blockData.length > 0) {
          // Get block definitions
          const { data: blockDefs } = await supabase
            .from('blocks')
            .select('key, name, rarity, texture_url')
            .in('key', blockData.map(b => b.item_type));

          setBlocks(blockData.map(b => {
            const def = blockDefs?.find(d => d.key === b.item_type);
            return {
              id: b.item_type,
              name: def?.name || b.item_type,
              quantity: b.quantity,
              rarity: def?.rarity,
              textureUrl: def?.texture_url,
            };
          }));
        } else {
          setBlocks([]);
        }

        // Fetch seeds from user_inventory (item_type = 'seed_tier_X', item_id = seed_definition_id)
        const { data: seedData } = await supabase
          .from('user_inventory')
          .select('item_type, item_id, quantity')
          .eq('user_id', userId)
          .like('item_type', 'seed_tier_%')
          .gt('quantity', 0);

        if (seedData && seedData.length > 0) {
          // Get seed definitions for all seeds
          const seedDefIds = seedData.map(s => s.item_id).filter(Boolean);
          const { data: seedDefs } = seedDefIds.length > 0
            ? await supabase
                .from('seed_definitions')
                .select('id, name, tier, rarity, trunk_texture_url')
                .in('id', seedDefIds)
            : { data: [] };

          setSeeds(seedData.map((s: any) => {
            const def = seedDefs?.find(d => d.id === s.item_id);
            const tierMatch = s.item_type?.match(/seed_tier_(\d+)/);
            const tier = def?.tier || (tierMatch ? parseInt(tierMatch[1]) : 1);
            return {
              id: s.item_id || s.item_type,  // Use item_id (seed_definition_id) as identifier
              name: def?.name || `Tier ${tier} Seed`,
              quantity: s.quantity,
              tier: tier,
              rarity: def?.rarity,
              textureUrl: def?.trunk_texture_url,
              seedDefinitionId: s.item_id,
            };
          }));
        } else {
          setSeeds([]);
        }

        // Fetch fruits (each fruit is an individual row in user_fruits)
        // All fruits in user_fruits table are already collected/owned by the user
        const { data: fruitData } = await supabase
          .from('user_fruits')
          .select('id, tier')
          .eq('user_id', userId);

        if (fruitData && fruitData.length > 0) {
          // Group fruits by tier and count them
          const fruitsByTier = fruitData.reduce((acc: Record<number, { count: number; ids: string[] }>, f) => {
            if (!acc[f.tier]) acc[f.tier] = { count: 0, ids: [] };
            acc[f.tier].count++;
            acc[f.tier].ids.push(f.id);
            return acc;
          }, {});

          setFruits(Object.entries(fruitsByTier).map(([tier, data]) => ({
            id: `fruit_tier_${tier}`,
            name: `Tier ${tier} Fruit`,
            quantity: data.count,
            tier: parseInt(tier),
            fruitIds: data.ids,  // Store actual fruit IDs for selling
          })));
        } else {
          setFruits([]);
        }
      } catch (err) {
        console.error('[CreateListingModal] Fetch inventory error:', err);
      } finally {
        setIsLoadingInventory(false);
      }
    };

    fetchInventory();
  }, [isOpen, userId]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedItem(null);
      setPrice(100);
      setQuantity(1);
      setDescription('');
      setExpirationHours(null);
      setError(null);
    }
  }, [isOpen]);

  // Update quantity max when item changes
  useEffect(() => {
    if (selectedItem && quantity > selectedItem.quantity) {
      setQuantity(selectedItem.quantity);
    }
  }, [selectedItem, quantity]);

  const handleSubmit = async () => {
    if (!selectedItem) {
      setError('Please select an item to list');
      return;
    }

    if (price < MIN_PRICE_DIVI) {
      setError(`Price must be at least ${MIN_PRICE_DIVI} DIVI`);
      return;
    }

    if (quantity < 1 || quantity > selectedItem.quantity) {
      setError('Invalid quantity');
      return;
    }

    const input: CreateListingInput = {
      item_category: category,
      price_divi: price,
      quantity,
      description: description.trim() || undefined,
      expires_at: expirationHours
        ? new Date(Date.now() + expirationHours * 60 * 60 * 1000).toISOString()
        : undefined,
    };

    // Add item-specific fields
    if (category === 'block') {
      input.item_type = selectedItem.id;  // Block key stored as item_type
    } else if (category === 'seed') {
      input.item_type = `seed_tier_${selectedItem.tier}`;  // Seeds use item_type pattern
      input.seed_definition_id = selectedItem.seedDefinitionId || selectedItem.id;
    } else if (category === 'fruit') {
      input.fruit_tier = selectedItem.tier;
    }

    const result = await createListing(input);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Failed to create listing');
    }
  };

  const getInventoryItems = (): InventoryItem[] => {
    switch (category) {
      case 'block': return blocks;
      case 'seed': return seeds;
      case 'fruit': return fruits;
      default: return [];
    }
  };

  const items = getInventoryItems();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="max-w-lg"
        style={{
          background: 'hsla(211, 30%, 35%, 0.95)',
          border: '1px solid hsla(211, 34%, 73%, 0.8)',
        }}
      >
        <DialogHeader>
          <DialogTitle>Create Listing</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Category selector */}
          <Tabs value={category} onValueChange={(v) => {
            setCategory(v as MarketplaceItemCategory);
            setSelectedItem(null);
          }}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="block">Blocks</TabsTrigger>
              <TabsTrigger value="seed">Seeds</TabsTrigger>
              <TabsTrigger value="fruit">Fruits</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Item selection */}
          <div className="space-y-2">
            <Label>Select Item</Label>
            <ScrollArea className="h-40 rounded border" style={{ borderColor: 'hsla(var(--hud-border), 0.5)' }}>
              {isLoadingInventory ? (
                <div className="p-4 text-center text-muted-foreground">Loading inventory...</div>
              ) : items.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  No {category}s in inventory
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      className={`w-full p-2 rounded flex items-center gap-3 text-left transition-colors ${
                        selectedItem?.id === item.id
                          ? 'bg-primary/20 border border-primary'
                          : 'hover:bg-white/10'
                      }`}
                    >
                      <div
                        className="w-10 h-10 rounded border flex-shrink-0"
                        style={{
                          background: item.textureUrl
                            ? `url(${item.textureUrl}) center/cover`
                            : 'linear-gradient(135deg, #8B7355 0%, #5a4a3a 100%)',
                          borderColor: 'hsla(var(--hud-border), 0.3)',
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{item.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.tier && `Tier ${item.tier} • `}
                          {item.rarity && `${item.rarity} • `}
                          x{item.quantity} available
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Quantity */}
          {selectedItem && selectedItem.quantity > 1 && (
            <div className="space-y-2">
              <Label>Quantity (max {selectedItem.quantity})</Label>
              <Input
                type="number"
                min={1}
                max={selectedItem.quantity}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(selectedItem.quantity, parseInt(e.target.value) || 1)))}
              />
            </div>
          )}

          {/* Price */}
          <div className="space-y-2">
            <Label>Price (DIVI)</Label>
            <Input
              type="number"
              min={MIN_PRICE_DIVI}
              value={price}
              onChange={(e) => setPrice(Math.max(MIN_PRICE_DIVI, parseInt(e.target.value) || MIN_PRICE_DIVI))}
            />
            {quantity > 1 && (
              <div className="text-xs text-muted-foreground">
                {Math.ceil(price / quantity)} DIVI per item
              </div>
            )}
          </div>

          {/* Expiration */}
          <div className="space-y-2">
            <Label>Listing Duration</Label>
            <Select
              value={expirationHours?.toString() || 'permanent'}
              onValueChange={(v) => setExpirationHours(v === 'permanent' ? null : parseInt(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRATION_PRESETS.map((preset) => (
                  <SelectItem key={preset.label} value={preset.value?.toString() || 'permanent'}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, LISTING_DESCRIPTION_MAX_LENGTH))}
              placeholder="Add a description for your listing..."
              rows={3}
            />
            <div className="text-xs text-muted-foreground text-right">
              {description.length}/{LISTING_DESCRIPTION_MAX_LENGTH}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!selectedItem || isCreating}>
            {isCreating ? 'Creating...' : 'Create Listing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
