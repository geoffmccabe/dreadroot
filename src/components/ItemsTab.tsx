import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUserData } from '@/hooks/useUserData';
import { toast } from 'sonner';

interface ItemDef {
  id: string;
  name: string;
  item_number: number | null;
  tier: number;
  texture_url: string | null;
  item_category: string;
}

interface InventoryItemWithDef {
  inventoryId: string;
  itemId: string;
  quantity: number;
  def: ItemDef;
}

function getSpriteUrl(def: ItemDef): string | null {
  if (def.texture_url) return def.texture_url;
  if (def.item_number != null && def.item_number >= 0 && def.item_number <= 228) {
    return `/item-sprites/${def.item_number}.webp`;
  }
  return null;
}

// ─── Items Grid ──────────────────────────────────────────────────

function ItemsGrid({ items, isLoading }: { items: InventoryItemWithDef[]; isLoading: boolean }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground p-4">{isLoading ? 'Loading items...' : 'No items yet.'}</p>;
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        gap: '6px',
        width: '100%',
      }}
    >
      {items.map((item) => {
        const sprite = getSpriteUrl(item.def);
        return (
          <div
            key={item.inventoryId}
            style={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '6px',
              padding: '6px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
              minWidth: 0,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {item.quantity > 1 && (
              <Badge
                className="absolute top-1 right-1 text-[9px] px-1 py-0 z-10"
                variant="secondary"
              >
                {item.quantity}x
              </Badge>
            )}
            {sprite ? (
              <img
                src={sprite}
                alt={item.def.name}
                style={{
                  width: '100%',
                  maxWidth: '64px',
                  aspectRatio: '1',
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  maxWidth: '64px',
                  aspectRatio: '1',
                  background: 'hsl(var(--muted))',
                  borderRadius: '4px',
                }}
              />
            )}
            <span
              style={{
                fontSize: '10px',
                fontWeight: 500,
                lineHeight: '1.2',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                width: '100%',
              }}
            >
              {item.def.name}
            </span>
            {item.def.tier > 0 && (
              <span style={{ fontSize: '9px', color: 'hsl(var(--muted-foreground))' }}>
                Tier {item.def.tier}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Forge Panel ─────────────────────────────────────────────────

function ForgePanel({
  items,
  onForge,
  onForgeComplete,
}: {
  items: InventoryItemWithDef[];
  onForge: (itemId: string, itemName: string, currentTier: number) => Promise<boolean>;
  onForgeComplete: (name: string, fromTier: number, toTier: number) => void;
}) {
  const [animatingGroup, setAnimatingGroup] = useState<string | null>(null);
  const [animationStep, setAnimationStep] = useState(0);
  // Snapshot items during animation so inventory state changes don't remove the card
  const [snapshotItems, setSnapshotItems] = useState<InventoryItemWithDef[] | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Synchronous guard against double-clicks (state updates are async/batched)
  const forgingRef = useRef(false);
  const bgSoundRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => { timersRef.current.forEach(clearTimeout); };
  }, []);

  // Use snapshot during animation, live items otherwise
  const renderItems = snapshotItems ?? items;
  const forgeable = renderItems.filter((i) => i.quantity >= 4);

  if (forgeable.length === 0 && !animatingGroup) {
    return (
      <p className="text-xs text-muted-foreground p-4">
        Collect 4 of any item to forge them into a higher tier.
      </p>
    );
  }

  const handleForgeClick = async (groupKey: string, item: InventoryItemWithDef) => {
    // Synchronous double-click guard
    if (forgingRef.current) return;
    forgingRef.current = true;

    // Snapshot items and start animation + sounds IMMEDIATELY
    setSnapshotItems(items.map(i => ({ ...i })));
    setAnimatingGroup(groupKey);
    setAnimationStep(0);

    // Start background forge sound immediately
    const bgSound = new Audio('/forge_bkgd_noise.mp3');
    bgSound.volume = 0.4;
    bgSound.play().catch(() => {});
    bgSoundRef.current = bgSound;

    // Start slide animation immediately (first hammer at 1s)
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let step = 1; step <= 4; step++) {
      timers.push(setTimeout(() => {
        setAnimationStep(step);
        const hammer = new Audio('/forge_hammer.mp3');
        hammer.volume = 0.5;
        hammer.play().catch(() => {});
      }, step * 1000));
    }
    timersRef.current = timers;

    // Do DB work in parallel with animation
    const clickTime = Date.now();
    const success = await onForge(item.itemId, item.def.name, item.def.tier);

    if (!success) {
      // DB failed — cancel animation, restore state
      timers.forEach(clearTimeout);
      bgSound.pause();
      setAnimatingGroup(null);
      setAnimationStep(0);
      setSnapshotItems(null);
      forgingRef.current = false;
      return;
    }

    // DB succeeded — schedule completion after animation finishes
    const elapsed = Date.now() - clickTime;
    const remaining = Math.max(0, 4800 - elapsed);

    timersRef.current.push(setTimeout(() => {
      bgSound.pause();
      bgSound.currentTime = 0;
      setAnimatingGroup(null);
      setAnimationStep(0);
      setSnapshotItems(null);
      forgingRef.current = false;
      onForgeComplete(item.def.name, item.def.tier, item.def.tier + 1);
    }, remaining));
  };

  return (
    <div className="space-y-3">
      {forgeable.map((item) => {
        const numGroups = Math.floor(item.quantity / 4);
        const sprite = getSpriteUrl(item.def);

        return Array.from({ length: numGroups }, (_, groupIdx) => {
          const groupKey = `${item.inventoryId}-${groupIdx}`;
          const isAnimating = animatingGroup === groupKey;
          const step = isAnimating ? animationStep : 0;

          return (
            <Card
              key={groupKey}
              className="p-3"
              style={{ overflow: 'hidden' }}
            >
              {/* Item name centered across the top */}
              <div style={{
                textAlign: 'center',
                fontSize: '11px',
                fontWeight: 600,
                marginBottom: '6px',
                color: 'hsl(var(--foreground))',
              }}>
                {item.def.name}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* 4 source sprites */}
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0, position: 'relative' }}>
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '2px',
                        transition: 'transform 0.6s ease-in-out, opacity 0.5s ease-in 0.1s',
                        transform: step > i ? 'translateX(140px)' : 'translateX(0)',
                        opacity: step > i ? 0 : 1,
                      }}
                    >
                      <div style={{ width: '48px', height: '48px' }}>
                        {sprite ? (
                          <img
                            src={sprite}
                            alt={item.def.name}
                            style={{ width: '48px', height: '48px', objectFit: 'contain' }}
                          />
                        ) : (
                          <div style={{
                            width: '48px', height: '48px',
                            background: 'hsl(var(--muted))', borderRadius: '4px',
                          }} />
                        )}
                      </div>
                      <span style={{ fontSize: '9px', color: 'hsl(var(--muted-foreground))' }}>
                        T{item.def.tier}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Arrow */}
                <span style={{
                  fontSize: '20px',
                  color: 'hsl(var(--muted-foreground))',
                  flexShrink: 0,
                  lineHeight: 1,
                }}>
                  &rarr;
                </span>

                {/* Target item — clickable forge button */}
                <button
                  onClick={() => handleForgeClick(groupKey, item)}
                  disabled={animatingGroup !== null}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                    padding: '6px',
                    border: '2px solid hsl(var(--border))',
                    borderRadius: '8px',
                    background: 'hsl(var(--muted) / 0.5)',
                    cursor: animatingGroup ? 'default' : 'pointer',
                    flexShrink: 0,
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (!animatingGroup) e.currentTarget.style.borderColor = 'hsl(var(--primary))';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'hsl(var(--border))';
                  }}
                >
                  <div style={{ width: '48px', height: '48px' }}>
                    {sprite ? (
                      <img
                        src={sprite}
                        alt={`${item.def.name} T${item.def.tier + 1}`}
                        style={{
                          width: '48px', height: '48px', objectFit: 'contain',
                          filter: `saturate(${step * 25}%)`,
                          transition: 'filter 0.3s ease-in',
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '48px', height: '48px',
                        background: 'hsl(var(--muted))', borderRadius: '4px',
                        filter: `saturate(${step * 25}%)`,
                        transition: 'filter 0.3s ease-in',
                      }} />
                    )}
                  </div>
                  <span style={{ fontSize: '9px', color: 'hsl(var(--muted-foreground))' }}>
                    T{item.def.tier + 1}
                  </span>
                </button>
              </div>
            </Card>
          );
        });
      })}
    </div>
  );
}

// ─── Main ItemsTab ───────────────────────────────────────────────

export function ItemsTab() {
  const { inventory, addItem, removeItems } = useUserData();
  const [itemDefs, setItemDefs] = useState<Map<string, ItemDef>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [forgeModal, setForgeModal] = useState<{ name: string; fromTier: number; toTier: number } | null>(null);

  // Load item definitions for all inventory items
  const loadDefs = useCallback(async () => {
    const itemEntries = inventory.filter((i) => i.item_type === 'item' && i.item_id);
    const itemIds = itemEntries.map((i) => i.item_id!);

    if (itemIds.length === 0) {
      setItemDefs(new Map());
      setIsLoading(false);
      return;
    }

    const { data } = await supabase
      .from('items')
      .select('id, name, item_number, tier, texture_url, item_category')
      .in('id', itemIds);

    const map = new Map<string, ItemDef>();
    for (const d of data || []) {
      map.set(d.id, d as ItemDef);
    }
    setItemDefs(map);
    setIsLoading(false);
  }, [inventory]);

  useEffect(() => {
    loadDefs();
  }, [loadDefs]);

  // Build display list — aggregate duplicate inventory rows by item_id
  const aggregated = new Map<string, InventoryItemWithDef>();
  for (const inv of inventory) {
    if (inv.item_type !== 'item' || !inv.item_id) continue;
    const def = itemDefs.get(inv.item_id);
    if (!def) continue;
    const existing = aggregated.get(inv.item_id);
    if (existing) {
      existing.quantity += inv.quantity;
    } else {
      aggregated.set(inv.item_id, {
        inventoryId: inv.id,
        itemId: inv.item_id,
        quantity: inv.quantity,
        def,
      });
    }
  }
  const displayItems = Array.from(aggregated.values());
  displayItems.sort((a, b) => (a.def.item_number ?? 999) - (b.def.item_number ?? 999));

  // Forge handler — returns true on success, false on failure
  const handleForge = async (itemId: string, itemName: string, currentTier: number): Promise<boolean> => {
    // Find the next-tier item (same name, tier+1)
    let { data: nextTierItem } = await supabase
      .from('items')
      .select('id, tier')
      .eq('name', itemName)
      .eq('tier', currentTier + 1)
      .maybeSingle();

    // Auto-create the next tier if it doesn't exist
    if (!nextTierItem) {
      const { data: currentItem } = await supabase
        .from('items')
        .select('key, name, item_number, item_category, rarity, class, texture_url, description')
        .eq('id', itemId)
        .single();

      if (!currentItem) {
        toast.error('Could not find item definition');
        return false;
      }

      const nextTier = currentTier + 1;
      const baseKey = currentItem.key.replace(/_t\d+$/, '');
      const newKey = `${baseKey}_t${nextTier}`;

      // Check if the key already exists (from a previous failed forge attempt)
      const { data: existingByKey } = await supabase
        .from('items')
        .select('id, tier')
        .eq('key', newKey)
        .maybeSingle();

      if (existingByKey) {
        nextTierItem = existingByKey;
      } else {
        const { data: created, error: createErr } = await supabase
          .from('items')
          .insert({
            key: newKey,
            name: currentItem.name,
            item_number: null,
            item_category: currentItem.item_category,
            rarity: currentItem.rarity,
            tier: nextTier,
            cost: 0,
            class: currentItem.class,
            texture_url: currentItem.texture_url,
            description: currentItem.description,
          })
          .select('id, tier')
          .single();

        if (createErr || !created) {
          console.error('[Forge] Failed to create tier item:', createErr?.message);
          toast.error(`Forge failed: ${createErr?.message || 'unknown error'}`);
          return false;
        }
        nextTierItem = created;
      }
    }

    // Server-verified: remove 4 of current tier
    const removed = await removeItems(itemId, 4);
    if (!removed) {
      toast.error('Not enough items to forge');
      return false;
    }

    // Server-verified: add 1 of next tier
    const added = await addItem(nextTierItem.id, 1);
    if (!added) {
      toast.error('Failed to create forged item');
      return false;
    }

    return true;
  };

  if (isLoading) {
    return <p className="text-xs text-muted-foreground p-4">Loading items...</p>;
  }

  return (
    <>
      <Tabs defaultValue="items" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-3">
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="forge">Forge</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="mt-0">
          <ItemsGrid items={displayItems} isLoading={isLoading} />
        </TabsContent>

        <TabsContent value="forge" className="mt-0">
          <ForgePanel
            items={displayItems}
            onForge={handleForge}
            onForgeComplete={(name, fromTier, toTier) => {
              setForgeModal({ name, fromTier, toTier });
            }}
          />
        </TabsContent>
      </Tabs>

      {/* Forge success modal */}
      <Dialog open={!!forgeModal} onOpenChange={() => setForgeModal(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Forge Successful</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            You forged four Tier {forgeModal?.fromTier} {forgeModal?.name} into 1 of Tier {forgeModal?.toTier}!
          </p>
          <Button className="w-full mt-2" onClick={() => setForgeModal(null)}>
            OK
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
