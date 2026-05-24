import React, { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Save, Upload, X, Bug } from 'lucide-react';
import { convertTextureToKtx2 } from '@/lib/ktx2';
import type { ShpiderDefinition } from '../types';

type TextureField = 'body_texture_url' | 'leg_texture_url' | 'face_texture_url';

interface ShpiderDesignPanelProps {
  className?: string;
}

const RARITY_NAMES: Record<number, string> = {
  1: 'common', 2: 'uncommon', 3: 'rare', 4: 'epic', 5: 'legendary',
  6: 'divine', 7: 'mystic', 8: 'rainbow', 9: 'apocalyptic', 10: 'cosmic',
};

export function ShpiderDesignPanel({ className }: ShpiderDesignPanelProps) {
  const queryClient = useQueryClient();
  const [definitions, setDefinitions] = useState<ShpiderDefinition[]>([]);
  const [selectedTier, setSelectedTier] = useState<number>(1);
  const [currentDef, setCurrentDef] = useState<ShpiderDefinition | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState<TextureField | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const bodyInputRef = useRef<HTMLInputElement>(null);
  const legInputRef = useRef<HTMLInputElement>(null);
  const faceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchDefinitions();
  }, []);

  const fetchDefinitions = async () => {
    setIsLoading(true);
    const { data, error } = await (supabase
      .from('shpider_definitions' as any)
      .select('*')
      .order('tier', { ascending: true }) as any);

    if (error) {
      console.error('[ShpiderDesign] fetch error:', error);
      setDefinitions([]);
      setIsLoading(false);
      return;
    }

    const defs = (data ?? []) as ShpiderDefinition[];
    setDefinitions(defs);
    setCurrentDef(defs.find(d => d.tier === selectedTier) ?? null);
    setIsLoading(false);
  };

  const selectTier = (tier: number) => {
    setSelectedTier(tier);
    setCurrentDef(definitions.find(d => d.tier === tier) ?? null);
    setHasChanges(false);
  };

  const updateDef = (field: keyof ShpiderDefinition, value: any) => {
    if (!currentDef) return;
    const updated = { ...currentDef, [field]: value };
    setCurrentDef(updated);
    setDefinitions(prev => prev.map(d => d.tier === currentDef.tier ? updated : d));
    setHasChanges(true);
  };

  const handleTextureUpload = async (field: TextureField, file: File) => {
    if (!currentDef) return;
    setIsUploading(field);
    try {
      const ext = file.name.split('.').pop() || 'webp';
      const part = field.replace('_texture_url', '');
      const path = `shpider/t${currentDef.tier}/${part}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(path, file, { cacheControl: '3600', upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('block-textures')
        .getPublicUrl(path);

      updateDef(field, publicUrl);
      toast.success(`${part} texture uploaded`);

      const rowId = currentDef.id;
      void convertTextureToKtx2(publicUrl, 'standard').then((ktx2Url) => {
        if (!ktx2Url) return;
        const ktx2Field = `${field}_ktx2` as keyof ShpiderDefinition;
        updateDef(ktx2Field, ktx2Url);
        if (!rowId.startsWith('temp_')) {
          void (supabase
            .from('shpider_definitions' as any)
            .update({ [ktx2Field]: ktx2Url })
            .eq('id', rowId) as any);
        }
      });
    } catch (err: any) {
      console.error('[ShpiderDesign] upload error:', err);
      toast.error(err?.message ?? 'Failed to upload texture');
    } finally {
      setIsUploading(null);
    }
  };

  const saveDef = async () => {
    if (!currentDef) return;
    setIsSaving(true);
    const { id, created_at, updated_at, ai_config, ...rest } = currentDef as any;
    const saveData = { ...rest, ai_config: ai_config ?? null };

    try {
      const { data, error } = await (supabase
        .from('shpider_definitions' as any)
        .upsert(saveData, { onConflict: 'tier' })
        .select()
        .single() as any);

      if (error) throw error;

      const saved = data as ShpiderDefinition;
      setDefinitions(prev => prev.map(d => d.tier === saved.tier ? saved : d));
      setCurrentDef(saved);
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ['shpider-definitions'] });
      toast.success('Shpider saved');
    } catch (err: any) {
      console.error('[ShpiderDesign] save error:', err);
      toast.error(`Failed to save: ${err?.message ?? err}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card className={`p-6 ${className ?? ''}`}>
        <div className="flex items-center justify-center h-40">
          <p className="text-muted-foreground">Loading shpider definitions...</p>
        </div>
      </Card>
    );
  }

  if (definitions.length === 0) {
    return (
      <Card className={`p-6 ${className ?? ''}`}>
        <p className="text-sm text-muted-foreground">
          No shpider definitions in database. Run the Phase 1 migration first.
        </p>
      </Card>
    );
  }

  return (
    <Card className={`p-4 ${className || ''}`}>
      <div className="grid grid-cols-12 gap-4">
        {/* Tier list */}
        <div className="col-span-3">
          <div className="border rounded-lg p-3 bg-muted/30">
            <h3 className="font-semibold mb-3 text-2xl flex items-center gap-2">
              <Bug className="h-5 w-5" /> Shpiders
            </h3>
            <ScrollArea className="h-[500px]">
              <div className="space-y-1 pr-2">
                {definitions.map(def => (
                  <Button
                    key={def.tier}
                    variant={selectedTier === def.tier ? 'default' : 'ghost'}
                    size="sm"
                    className="w-full justify-between text-xs"
                    onClick={() => selectTier(def.tier)}
                  >
                    <span>T{def.tier} — {def.name}</span>
                    <span className="text-muted-foreground">{RARITY_NAMES[def.tier]}</span>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Editor */}
        <div className="col-span-9">
          {!currentDef ? (
            <p className="text-sm text-muted-foreground">Select a tier on the left.</p>
          ) : (
            <ScrollArea className="h-[500px] pr-4">
              <div className="space-y-4">
                {/* Header + Save */}
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Tier {currentDef.tier}</h3>
                  <Button onClick={saveDef} disabled={!hasChanges || isSaving} size="sm" className="gap-2">
                    <Save className="h-4 w-4" />
                    {isSaving ? 'Saving…' : 'Save'}
                  </Button>
                </div>

                {/* Name */}
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={currentDef.name}
                    onChange={(e) => updateDef('name', e.target.value)}
                  />
                </div>

                {/* Three textures */}
                <div className="grid grid-cols-3 gap-3">
                  {(['body_texture_url','leg_texture_url','face_texture_url'] as TextureField[]).map(field => {
                    const label = field.replace('_texture_url', '');
                    const url = currentDef[field] as string | null;
                    const ref = field === 'body_texture_url' ? bodyInputRef
                              : field === 'leg_texture_url' ? legInputRef
                              : faceInputRef;
                    return (
                      <div key={field} className="border rounded-md p-2">
                        <Label className="text-xs capitalize">{label}</Label>
                        <div className="aspect-square w-full bg-muted/30 rounded mt-1 flex items-center justify-center overflow-hidden">
                          {url ? (
                            <img src={url} alt={label} className="object-cover w-full h-full" />
                          ) : (
                            <span className="text-xs text-muted-foreground">no texture</span>
                          )}
                        </div>
                        <div className="flex gap-1 mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 text-xs gap-1"
                            onClick={() => ref.current?.click()}
                            disabled={isUploading === field}
                          >
                            <Upload className="h-3 w-3" />
                            {isUploading === field ? '…' : 'Upload'}
                          </Button>
                          {url && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateDef(field, null)}
                              className="text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        <input
                          ref={ref}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleTextureUpload(field, f);
                            e.target.value = '';
                          }}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Gameplay */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Health</Label>
                    <Input
                      type="number"
                      value={currentDef.health}
                      onChange={(e) => updateDef('health', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Damage per hit</Label>
                    <Input
                      type="number"
                      value={currentDef.damage_per_hit}
                      onChange={(e) => updateDef('damage_per_hit', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Speed during hop</Label>
                    <Input
                      type="number"
                      step={0.5}
                      value={currentDef.speed_during_hop}
                      onChange={(e) => updateDef('speed_during_hop', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Knockback received</Label>
                    <Input
                      type="number"
                      step={0.1}
                      value={currentDef.knockback_received}
                      onChange={(e) => updateDef('knockback_received', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Spawn / minute (chunk dist=1)</Label>
                    <Input
                      type="number"
                      step={0.01}
                      value={currentDef.spawn_chance_per_minute}
                      onChange={(e) => updateDef('spawn_chance_per_minute', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>

                {/* Hop physics */}
                <div className="border rounded-lg p-3 bg-muted/20">
                  <h4 className="text-sm font-semibold mb-2">Hop physics</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Idle min (ms)</Label>
                      <Input
                        type="number"
                        value={currentDef.hop_interval_min_ms}
                        onChange={(e) => updateDef('hop_interval_min_ms', parseInt(e.target.value, 10) || 0)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Idle max (ms)</Label>
                      <Input
                        type="number"
                        value={currentDef.hop_interval_max_ms}
                        onChange={(e) => updateDef('hop_interval_max_ms', parseInt(e.target.value, 10) || 0)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Hop distance min (m)</Label>
                      <Input
                        type="number"
                        step={0.5}
                        value={currentDef.hop_distance_min}
                        onChange={(e) => updateDef('hop_distance_min', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Hop distance max (m)</Label>
                      <Input
                        type="number"
                        step={0.5}
                        value={currentDef.hop_distance_max}
                        onChange={(e) => updateDef('hop_distance_max', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Hop duration (ms)</Label>
                      <Input
                        type="number"
                        value={currentDef.hop_duration_ms}
                        onChange={(e) => updateDef('hop_duration_ms', parseInt(e.target.value, 10) || 0)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Arc height factor</Label>
                      <Slider
                        value={[currentDef.hop_arc_factor]}
                        onValueChange={([v]) => updateDef('hop_arc_factor', v)}
                        min={0.1} max={1.0} step={0.05}
                      />
                      <span className="text-xs text-muted-foreground">
                        peak = {(currentDef.hop_arc_factor).toFixed(2)} × hop distance
                      </span>
                    </div>
                  </div>
                </div>

                {/* Body geometry */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Body size (blocks)</Label>
                    <Input
                      type="number"
                      step={0.05}
                      value={currentDef.body_size}
                      onChange={(e) => updateDef('body_size', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Head size (blocks)</Label>
                    <Input
                      type="number"
                      step={0.05}
                      value={currentDef.head_size}
                      onChange={(e) => updateDef('head_size', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>

                {/* Behavior */}
                <div className="flex items-center gap-3">
                  <Switch
                    checked={currentDef.can_climb_trees}
                    onCheckedChange={(v) => updateDef('can_climb_trees', v)}
                  />
                  <Label className="text-sm">Can climb trees</Label>
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </Card>
  );
}
