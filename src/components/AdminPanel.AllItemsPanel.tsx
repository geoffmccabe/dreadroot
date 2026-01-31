import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, Plus, Save, Trash2, Upload } from 'lucide-react';

interface ItemRow {
  id: string;
  key: string;
  name: string;
  item_number: number | null;
  item_category: string;
  tier: number;
  rarity: string;
  texture_url: string | null;
  description: string | null;
  properties: Record<string, unknown> | null;
}

interface FortressGroup {
  name: string;
  baseNumber: number;
  description: string;
  adminDescription: string;
  tiers: ItemRow[];
}

// ─── Siege Worlds Grid (read-only) ───────────────────────────────

function SiegeWorldsGrid({ items }: { items: ItemRow[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        gap: '6px',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {items.map((item) => {
        const hasSprite =
          item.item_number != null && item.item_number >= 0 && item.item_number <= 228;
        const spriteUrl = hasSprite
          ? `/item-sprites/${item.item_number}.webp`
          : item.texture_url;

        return (
          <div
            key={item.id}
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
            }}
          >
            {spriteUrl ? (
              <img
                src={spriteUrl}
                alt={item.name}
                style={{
                  width: '100%',
                  maxWidth: '80px',
                  aspectRatio: '1',
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  maxWidth: '80px',
                  aspectRatio: '1',
                  background: 'hsl(var(--muted))',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  color: 'hsl(var(--muted-foreground))',
                }}
              >
                No sprite
              </div>
            )}
            <span
              style={{
                fontSize: '10px',
                color: 'hsl(var(--muted-foreground))',
                fontFamily: 'monospace',
              }}
            >
              #{item.item_number ?? '—'}
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 500,
                lineHeight: '1.2',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                width: '100%',
              }}
            >
              {item.name}
            </span>
            {item.tier > 0 && (
              <span
                style={{
                  fontSize: '10px',
                  color: 'hsl(var(--muted-foreground))',
                }}
              >
                Tier {item.tier}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Fortress Item Group Card ────────────────────────────────────

function FortressGroupCard({
  group,
  onSave,
  onDelete,
  onSpriteUpload,
}: {
  group: FortressGroup;
  onSave: (baseNumber: number, name: string, desc: string, adminDesc: string) => void;
  onDelete: (baseNumber: number) => void;
  onSpriteUpload: (itemId: string, itemNumber: number, file: File) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [name, setName] = useState(group.name);
  const [desc, setDesc] = useState(group.description);
  const [adminDesc, setAdminDesc] = useState(group.adminDescription);
  const [dirty, setDirty] = useState(false);
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const hasChanges =
    dirty || name !== group.name || desc !== group.description || adminDesc !== group.adminDescription;

  return (
    <Card className="mb-3">
      <CardHeader
        className="cursor-pointer py-3 px-4"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">{group.name}</CardTitle>
            <span className="text-xs text-muted-foreground">
              #{group.baseNumber} ({group.tiers.length} tier{group.tiers.length > 1 ? 's' : ''})
            </span>
          </div>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isOpen ? '' : '-rotate-90'}`}
          />
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent className="pt-0 px-4 pb-4 space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-16 shrink-0">Name</label>
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setDirty(true); }}
              className="h-7 text-xs"
            />
          </div>
          <div className="flex gap-2">
            <label className="text-xs text-muted-foreground w-16 shrink-0 pt-1">User Desc</label>
            <textarea
              value={desc}
              onChange={(e) => { setDesc(e.target.value); setDirty(true); }}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs min-h-[48px] resize-y"
              placeholder="What users see when they look at this item..."
            />
          </div>
          <div className="flex gap-2">
            <label className="text-xs text-muted-foreground w-16 shrink-0 pt-1">Admin Desc</label>
            <textarea
              value={adminDesc}
              onChange={(e) => { setAdminDesc(e.target.value); setDirty(true); }}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs min-h-[48px] resize-y"
              placeholder="Internal: what it is and what it does..."
            />
          </div>

          {/* Tier sprites row */}
          <div
            style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            {group.tiers.map((tier) => (
              <div
                key={tier.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '2px',
                  width: '72px',
                }}
              >
                {tier.texture_url ? (
                  <img
                    src={tier.texture_url}
                    alt={`T${tier.tier}`}
                    style={{
                      width: '64px',
                      height: '64px',
                      objectFit: 'contain',
                      borderRadius: '4px',
                      border: '1px solid hsl(var(--border))',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '64px',
                      height: '64px',
                      background: 'hsl(var(--muted))',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '9px',
                      color: 'hsl(var(--muted-foreground))',
                      border: '1px solid hsl(var(--border))',
                    }}
                  >
                    No sprite
                  </div>
                )}
                <span style={{ fontSize: '9px', color: 'hsl(var(--muted-foreground))' }}>
                  T{tier.tier} #{tier.item_number}
                </span>
                <input
                  ref={(el) => {
                    if (el) fileInputRefs.current.set(tier.id, el);
                  }}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onSpriteUpload(tier.id, tier.item_number!, f);
                    e.target.value = '';
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-5 text-[9px] px-1"
                  onClick={() => fileInputRefs.current.get(tier.id)?.click()}
                >
                  <Upload className="h-2.5 w-2.5 mr-0.5" />
                  Upload
                </Button>
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            {hasChanges && (
              <Button size="sm" onClick={() => { onSave(group.baseNumber, name, desc, adminDesc); setDirty(false); }}>
                <Save className="h-3 w-3 mr-1" />
                Save
              </Button>
            )}
            <Button variant="destructive" size="sm" onClick={() => onDelete(group.baseNumber)}>
              <Trash2 className="h-3 w-3 mr-1" />
              Delete
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Add New Item Form ───────────────────────────────────────────

function AddNewItemForm({
  defaultStartNumber,
  allItemNumbers,
  onCreated,
}: {
  defaultStartNumber: number;
  allItemNumbers: Set<number>;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [startNum, setStartNum] = useState(defaultStartNumber);
  const [numTiers, setNumTiers] = useState(1);
  const [desc, setDesc] = useState('');
  const [adminDesc, setAdminDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const hasConflict = (() => {
    for (let i = 0; i < numTiers; i++) {
      if (allItemNumbers.has(startNum + i)) return true;
    }
    return false;
  })();

  const handleCreate = async () => {
    if (!name.trim()) { toast.error('Enter an item name'); return; }
    if (hasConflict) { toast.error('Item number conflict — choose a different starting number'); return; }

    setCreating(true);
    const key = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const rows = [];
    for (let t = 1; t <= numTiers; t++) {
      rows.push({
        key: `fortress_${startNum + t - 1}_${key}`,
        name: name.trim(),
        item_number: startNum + t - 1,
        item_category: 'fortress',
        tier: t,
        description: desc || null,
        properties: adminDesc ? { admin_description: adminDesc } : null,
        rarity: 'common',
        cost: 0,
        class: 'material',
      });
    }

    const { error } = await supabase.from('items').insert(rows);
    if (error) {
      console.error('[Fortress] Create failed:', error);
      toast.error('Failed to create item');
    } else {
      toast.success(`${name.trim()} created (${numTiers} tier${numTiers > 1 ? 's' : ''})`);
      setName('');
      setDesc('');
      setAdminDesc('');
      setNumTiers(1);
      onCreated();
    }
    setCreating(false);
  };

  return (
    <Card className="p-4 space-y-3">
      <p className="text-xs font-medium">Add New Fortress Item</p>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground w-20 shrink-0">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-7 text-xs" placeholder="e.g. Fire Sword" />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground w-20 shrink-0">Starting Item#</label>
        <Input type="number" value={startNum} onChange={(e) => setStartNum(parseInt(e.target.value) || 500)} className="h-7 text-xs w-24" />
        {hasConflict && <span className="text-xs text-destructive">Conflict!</span>}
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground w-20 shrink-0">Tiers (1–10)</label>
        <Input type="number" min={1} max={10} value={numTiers} onChange={(e) => setNumTiers(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))} className="h-7 text-xs w-20" />
        <span className="text-xs text-muted-foreground">#{startNum}–#{startNum + numTiers - 1}</span>
      </div>
      <div className="flex gap-2">
        <label className="text-xs text-muted-foreground w-20 shrink-0 pt-1">User Desc</label>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs min-h-[40px] resize-y" placeholder="What users see..." />
      </div>
      <div className="flex gap-2">
        <label className="text-xs text-muted-foreground w-20 shrink-0 pt-1">Admin Desc</label>
        <textarea value={adminDesc} onChange={(e) => setAdminDesc(e.target.value)} className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs min-h-[40px] resize-y" placeholder="Internal: what it does..." />
      </div>
      <Button size="sm" onClick={handleCreate} disabled={creating || !name.trim() || hasConflict}>
        <Plus className="h-3 w-3 mr-1" />
        Create Item
      </Button>
    </Card>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────

export function AllItemsPanel() {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddNew, setShowAddNew] = useState(false);

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('items')
      .select('id, key, name, item_number, item_category, tier, rarity, texture_url, description, properties')
      .order('item_number', { ascending: true, nullsFirst: false });

    if (error) {
      console.error('[AllItems] Failed to load items:', error);
      toast.error('Failed to load items');
      setIsLoading(false);
      return;
    }

    setItems((data || []).filter(i => i.name.toLowerCase() !== 'nothing') as ItemRow[]);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Split items into Siege Worlds vs Fortress
  const siegeItems = items.filter(
    (i) => i.item_category !== 'fortress' || (i.item_number != null && i.item_number < 500)
  );
  const fortressItems = items.filter(
    (i) => i.item_category === 'fortress' && i.item_number != null && i.item_number >= 500
  );

  // Group fortress items by name + base number
  const fortressGroups: FortressGroup[] = [];
  const groupedByName = new Map<string, ItemRow[]>();
  for (const item of fortressItems) {
    const existing = groupedByName.get(item.name);
    if (existing) {
      existing.push(item);
    } else {
      groupedByName.set(item.name, [item]);
    }
  }
  for (const [name, tiers] of groupedByName) {
    tiers.sort((a, b) => (a.item_number ?? 0) - (b.item_number ?? 0));
    const first = tiers[0];
    const props = first.properties as Record<string, unknown> | null;
    fortressGroups.push({
      name,
      baseNumber: first.item_number ?? 500,
      description: first.description || '',
      adminDescription: (props?.admin_description as string) || '',
      tiers,
    });
  }
  fortressGroups.sort((a, b) => a.baseNumber - b.baseNumber);

  // All used item numbers
  const allItemNumbers = new Set<number>();
  for (const item of items) {
    if (item.item_number != null) allItemNumbers.add(item.item_number);
  }

  // Next available starting number >= 500
  let nextStartNum = 500;
  while (allItemNumbers.has(nextStartNum)) nextStartNum++;

  // Save group metadata (name + descriptions across all tiers)
  const handleSaveGroup = async (baseNumber: number, name: string, desc: string, adminDesc: string) => {
    const group = fortressGroups.find((g) => g.baseNumber === baseNumber);
    if (!group) return;

    for (const tier of group.tiers) {
      const { error } = await supabase
        .from('items')
        .update({
          name,
          description: desc || null,
          properties: adminDesc ? { admin_description: adminDesc } : null,
        })
        .eq('id', tier.id);

      if (error) {
        toast.error(`Failed to update tier ${tier.tier}`);
        return;
      }
    }

    toast.success(`${name} saved`);
    loadItems();
  };

  // Delete entire group
  const handleDeleteGroup = async (baseNumber: number) => {
    const group = fortressGroups.find((g) => g.baseNumber === baseNumber);
    if (!group) return;

    const ids = group.tiers.map((t) => t.id);
    const { error } = await supabase.from('items').delete().in('id', ids);

    if (error) {
      toast.error('Failed to delete item');
    } else {
      toast.success(`${group.name} deleted`);
      loadItems();
    }
  };

  // Upload sprite for a specific tier
  const handleSpriteUpload = async (itemId: string, itemNumber: number, file: File) => {
    const fileName = `fortress_item_${itemNumber}_${Date.now()}.webp`;

    // Convert to webp via canvas
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = async () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 256, 256);

      canvas.toBlob(
        async (blob) => {
          if (!blob) { toast.error('Failed to process image'); return; }

          const { error: uploadError } = await supabase.storage
            .from('block-textures')
            .upload(fileName, blob, { upsert: true });

          if (uploadError) {
            toast.error('Failed to upload sprite');
            return;
          }

          const { data: urlData } = supabase.storage
            .from('block-textures')
            .getPublicUrl(fileName);

          const { error: updateError } = await supabase
            .from('items')
            .update({ texture_url: urlData.publicUrl })
            .eq('id', itemId);

          if (updateError) {
            toast.error('Failed to save sprite URL');
          } else {
            toast.success('Sprite uploaded');
            loadItems();
          }
        },
        'image/webp',
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      toast.error('Failed to load image');
    };
    img.src = objectUrl;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Loading items...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Siege Worlds ── */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Siege Worlds</h3>
        {siegeItems.length > 0 ? (
          <SiegeWorldsGrid items={siegeItems} />
        ) : (
          <p className="text-xs text-muted-foreground">No Siege Worlds items. Save a drop table to sync them.</p>
        )}
      </div>

      {/* ── Fortress ── */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Fortress</h3>

        {fortressGroups.map((group) => (
          <FortressGroupCard
            key={group.baseNumber}
            group={group}
            onSave={handleSaveGroup}
            onDelete={handleDeleteGroup}
            onSpriteUpload={handleSpriteUpload}
          />
        ))}

        {showAddNew ? (
          <div className="space-y-2">
            <AddNewItemForm
              defaultStartNumber={nextStartNum}
              allItemNumbers={allItemNumbers}
              onCreated={() => { setShowAddNew(false); loadItems(); }}
            />
            <Button variant="ghost" size="sm" onClick={() => setShowAddNew(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="w-full" onClick={() => setShowAddNew(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add New Fortress Item
          </Button>
        )}
      </div>
    </div>
  );
}
