// ShpiderEggsPanel — admin UI for managing the inventory sprite of
// each of the 10 shpider-egg tiers. Lives inside ShpiderDesignPanel's
// right-pane area when "Shpider Eggs" is selected on the left list.
//
// One row per tier (T1–T10). Each row shows the current sprite (or a
// placeholder), an Upload button, and a Delete button. Sprites are
// stored in the supabase `block-textures` bucket and the public URL
// is written to items.texture_url for the matching shpider_egg_tN
// row. UX mirrors the texture-upload pattern in ShpiderDesignPanel.

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Upload, X, Egg } from 'lucide-react';

interface EggItem {
  id: string;
  tier: number;
  key: string;
  texture_url: string | null;
}

const NUM_TIERS = 10;

export function ShpiderEggsPanel() {
  const [eggs, setEggs] = useState<EggItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadingTier, setUploadingTier] = useState<number | null>(null);
  // One file input per tier so click events route correctly.
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const fetchEggs = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('items')
      .select('id, tier, key, texture_url')
      .like('key', 'shpider_egg_t%')
      .order('tier', { ascending: true });
    if (error) {
      console.error('[ShpiderEggs] fetch failed:', error);
      toast.error(`Failed to load eggs: ${error.message}`);
      setEggs([]);
      setIsLoading(false);
      return;
    }
    setEggs((data ?? []) as EggItem[]);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchEggs();
  }, []);

  const handleUpload = async (tier: number, file: File) => {
    const egg = eggs.find(e => e.tier === tier);
    if (!egg) {
      toast.error(`No items row for shpider_egg_t${tier} — re-run the seed migration.`);
      return;
    }
    setUploadingTier(tier);
    try {
      const ext = file.name.split('.').pop() || 'webp';
      const path = `shpider/eggs/t${tier}_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(path, file, { cacheControl: '3600', upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('block-textures')
        .getPublicUrl(path);

      // items table RLS only allows superadmin direct UPDATE.
      // admin_set_item_texture is a SECURITY DEFINER RPC that lets
      // admin OR superadmin write texture_url.
      const { error: dbErr } = await supabase.rpc('admin_set_item_texture', {
        p_item_id: egg.id,
        p_texture_url: publicUrl,
      });
      if (dbErr) throw dbErr;

      setEggs(prev => prev.map(e => e.tier === tier ? { ...e, texture_url: publicUrl } : e));
      toast.success(`T${tier} sprite uploaded`);
    } catch (err: any) {
      console.error('[ShpiderEggs] upload error:', err);
      toast.error(err?.message ?? 'Failed to upload sprite');
    } finally {
      setUploadingTier(null);
    }
  };

  const handleDelete = async (tier: number) => {
    const egg = eggs.find(e => e.tier === tier);
    if (!egg || !egg.texture_url) return;
    try {
      const { error: dbErr } = await supabase.rpc('admin_set_item_texture', {
        p_item_id: egg.id,
        p_texture_url: null,
      });
      if (dbErr) throw dbErr;
      setEggs(prev => prev.map(e => e.tier === tier ? { ...e, texture_url: null } : e));
      toast.success(`T${tier} sprite removed`);
    } catch (err: any) {
      console.error('[ShpiderEggs] delete error:', err);
      toast.error(err?.message ?? 'Failed to remove sprite');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-muted-foreground">Loading shpider eggs...</p>
      </div>
    );
  }

  // Build display rows for all 10 tiers — show even tiers that are
  // missing from the items table, with a clear "missing" hint so the
  // admin knows to run the seed migration.
  const rows = Array.from({ length: NUM_TIERS }, (_, i) => {
    const tier = i + 1;
    const egg = eggs.find(e => e.tier === tier);
    return { tier, egg };
  });

  return (
    <ScrollArea className="h-[500px] pr-4">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Egg className="h-5 w-5" />
          <h3 className="text-lg font-semibold">Shpider Eggs — Inventory Sprites</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Upload one sprite per tier. Shown in the player's inventory grid after pickup.
          Webp / PNG / JPG accepted. Stored in supabase block-textures bucket.
        </p>

        {rows.map(({ tier, egg }) => (
          <div key={tier} className="border rounded-md p-3 flex items-center gap-3">
            {/* Tier label */}
            <div className="w-12 text-center">
              <div className="text-sm font-semibold">T{tier}</div>
            </div>

            {/* Sprite preview */}
            <div className="w-16 h-16 bg-muted/30 rounded flex items-center justify-center overflow-hidden border">
              {egg?.texture_url ? (
                <img src={egg.texture_url} alt={`T${tier} egg`} className="object-cover w-full h-full" />
              ) : (
                <span className="text-[10px] text-muted-foreground">no sprite</span>
              )}
            </div>

            {/* Status / Actions */}
            <div className="flex-1">
              {!egg ? (
                <p className="text-xs text-amber-600">
                  Not in items table. Run the shpider_egg seed migration.
                </p>
              ) : (
                <div className="flex gap-2">
                  <input
                    ref={(el) => { inputRefs.current[tier] = el; }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUpload(tier, f);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => inputRefs.current[tier]?.click()}
                    disabled={uploadingTier === tier}
                    className="gap-1"
                  >
                    <Upload className="h-3 w-3" />
                    {uploadingTier === tier ? 'Uploading…' : (egg.texture_url ? 'Replace' : 'Upload')}
                  </Button>
                  {egg.texture_url && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(tier)}
                      disabled={uploadingTier === tier}
                      className="gap-1 text-destructive hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                      Delete
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
