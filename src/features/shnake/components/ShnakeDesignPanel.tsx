// Shnake Design Panel - Admin UI for configuring shnake enemy tiers

import React, { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, Save, Bug } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { ShnakeDefinition } from '../types';

interface ShnakeDesignPanelProps {
  className?: string;
}

const TIERS = Array.from({ length: 30 }, (_, i) => i + 1);

export function ShnakeDesignPanel({ className }: ShnakeDesignPanelProps) {
  const [definitions, setDefinitions] = useState<ShnakeDefinition[]>([]);
  const [selectedTier, setSelectedTier] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const { toast } = useToast();

  const headInputRef = useRef<HTMLInputElement>(null);
  const bodyInputRef = useRef<HTMLInputElement>(null);
  const faceInputRef = useRef<HTMLInputElement>(null);

  const currentDef = definitions.find(d => d.tier === selectedTier) || null;

  useEffect(() => {
    void fetchDefinitions();
  }, []);

  const fetchDefinitions = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('shnake_definitions')
        .select('*')
        .order('tier', { ascending: true });

      if (error) throw error;

      const existingTiers = new Set((data || []).map((d: any) => d.tier));
      const allDefs: ShnakeDefinition[] = [...((data || []) as any[])].map((r: any) => ({
        id: r.id,
        tier: r.tier,
        name: r.name,
        head_texture_url: r.head_texture_url,
        body_texture_url: r.body_texture_url,
        face_texture_url: r.face_texture_url,
        health_per_segment: r.health_per_segment,
        damage_per_hit: r.damage_per_hit,
        knockback: Number(r.knockback),
        armor: r.armor,
        speed: Number(r.speed),
        spawn_chance_per_minute: Number(r.spawn_chance_per_minute),
        max_spawn_per_tree: r.max_spawn_per_tree,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));

      for (const tier of TIERS) {
        if (!existingTiers.has(tier)) {
          allDefs.push({
            id: `temp-${tier}`,
            tier,
            name: `Shnake T${tier}`,
            head_texture_url: null,
            body_texture_url: null,
            face_texture_url: null,
            health_per_segment: 75 + tier * 5,
            damage_per_hit: 6 + Math.floor(tier / 2),
            knockback: 6 + tier * 0.2,
            armor: Math.floor(tier / 4),
            speed: 0.8 + tier * 0.03,
            spawn_chance_per_minute: 1.0,
            max_spawn_per_tree: tier <= 10 ? 2 : 1,
            created_at: '',
            updated_at: '',
          });
        }
      }

      allDefs.sort((a, b) => a.tier - b.tier);
      setDefinitions(allDefs);
    } catch (err) {
      console.error('[ShnakeDesignPanel] Fetch error:', err);
      toast({ title: 'Failed to load definitions', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const updateDef = (field: keyof ShnakeDefinition, value: any) => {
    setDefinitions(prev =>
      prev.map(d => (d.tier === selectedTier ? { ...d, [field]: value } : d))
    );
    setHasChanges(true);
  };

  const saveDef = async () => {
    if (!currentDef) return;
    setIsSaving(true);
    try {
      const isNew = currentDef.id.startsWith('temp-');
      const payload = {
        tier: currentDef.tier,
        name: currentDef.name,
        head_texture_url: currentDef.head_texture_url,
        body_texture_url: currentDef.body_texture_url,
        face_texture_url: currentDef.face_texture_url,
        health_per_segment: currentDef.health_per_segment,
        damage_per_hit: currentDef.damage_per_hit,
        knockback: currentDef.knockback,
        armor: currentDef.armor,
        speed: currentDef.speed,
        spawn_chance_per_minute: currentDef.spawn_chance_per_minute,
        max_spawn_per_tree: currentDef.max_spawn_per_tree,
      };

      if (isNew) {
        const { data, error } = await supabase
          .from('shnake_definitions')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        setDefinitions(prev =>
          prev.map(d => (d.tier === selectedTier ? { ...d, id: data.id } : d))
        );
      } else {
        const { error } = await supabase
          .from('shnake_definitions')
          .update(payload)
          .eq('id', currentDef.id);
        if (error) throw error;
      }
      setHasChanges(false);
      toast({ title: 'Saved' });
    } catch (err) {
      console.error('[ShnakeDesignPanel] Save error:', err);
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const uploadTexture = async (file: File, kind: 'head' | 'body' | 'face') => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `shnake_${kind}_${selectedTier}_${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(fileName, file, { upsert: true });
      if (uploadError) throw uploadError;
      const {
        data: { publicUrl },
      } = supabase.storage.from('block-textures').getPublicUrl(fileName);

      if (kind === 'head') updateDef('head_texture_url', publicUrl);
      if (kind === 'body') updateDef('body_texture_url', publicUrl);
      if (kind === 'face') updateDef('face_texture_url', publicUrl);

      toast({ title: 'Texture uploaded', description: `Shnake ${kind} texture updated` });
    } catch (err) {
      console.error('[ShnakeDesignPanel] Upload error:', err);
      toast({ title: 'Upload failed', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <Card className={`p-6 ${className || ''}`}>
        <div className="flex items-center justify-center h-48">
          <p className="text-muted-foreground">Loading shnake definitions...</p>
        </div>
      </Card>
    );
  }

  return (
    <div className={`grid grid-cols-12 gap-4 ${className || ''}`}>
      <div className="col-span-3">
        <Card className="p-3">
          <h3 className="font-semibold mb-3 text-sm">Shnakes</h3>
          <ScrollArea className="h-[500px]">
            <div className="space-y-1 pr-2">
              {definitions.map(def => (
                <Button
                  key={def.tier}
                  variant={selectedTier === def.tier ? 'default' : 'ghost'}
                  size="sm"
                  className="w-full justify-between text-xs"
                  onClick={() => setSelectedTier(def.tier)}
                >
                  <span className="flex items-center gap-2">
                    <Bug className="h-3 w-3" />
                    T{def.tier}
                  </span>
                  <span className="text-muted-foreground">L={10 + def.tier}</span>
                </Button>
              ))}
            </div>
          </ScrollArea>
        </Card>
      </div>

      <div className="col-span-9">
        <Card className="p-4">
          {currentDef ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b">
                <div>
                  <h3 className="font-semibold">Tier {selectedTier} Shnake</h3>
                  <p className="text-xs text-muted-foreground">Length: {10 + selectedTier} segments</p>
                </div>
                <Button onClick={saveDef} disabled={!hasChanges || isSaving} size="sm" className="gap-2">
                  <Save className="h-4 w-4" />
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={currentDef.name} onChange={e => updateDef('name', e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Health per segment</Label>
                  <Input
                    type="number"
                    value={currentDef.health_per_segment}
                    onChange={e => updateDef('health_per_segment', parseInt(e.target.value || '0', 10))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Damage per hit</Label>
                  <Input
                    type="number"
                    value={currentDef.damage_per_hit}
                    onChange={e => updateDef('damage_per_hit', parseInt(e.target.value || '0', 10))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Knockback</Label>
                  <Input
                    type="number"
                    value={currentDef.knockback}
                    onChange={e => updateDef('knockback', parseFloat(e.target.value || '0'))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Armor</Label>
                  <Input
                    type="number"
                    value={currentDef.armor}
                    onChange={e => updateDef('armor', parseInt(e.target.value || '0', 10))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Speed (blocks/sec)</Label>
                  <Input
                    type="number"
                    value={currentDef.speed}
                    onChange={e => updateDef('speed', parseFloat(e.target.value || '0'))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Spawn chance per minute (%)</Label>
                  <Input
                    type="number"
                    value={currentDef.spawn_chance_per_minute}
                    onChange={e => updateDef('spawn_chance_per_minute', parseFloat(e.target.value || '0'))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Max spawn per tree</Label>
                  <Input
                    type="number"
                    value={currentDef.max_spawn_per_tree}
                    onChange={e => updateDef('max_spawn_per_tree', parseInt(e.target.value || '0', 10))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-2">
                <div className="space-y-2">
                  <Label>Head texture</Label>
                  <div className="flex gap-2">
                    <Input value={currentDef.head_texture_url || ''} onChange={e => updateDef('head_texture_url', e.target.value)} placeholder="URL" />
                    <Button size="icon" variant="outline" onClick={() => headInputRef.current?.click()}>
                      <Upload className="h-4 w-4" />
                    </Button>
                    <input
                      ref={headInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) void uploadTexture(f, 'head');
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Body texture</Label>
                  <div className="flex gap-2">
                    <Input value={currentDef.body_texture_url || ''} onChange={e => updateDef('body_texture_url', e.target.value)} placeholder="URL" />
                    <Button size="icon" variant="outline" onClick={() => bodyInputRef.current?.click()}>
                      <Upload className="h-4 w-4" />
                    </Button>
                    <input
                      ref={bodyInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) void uploadTexture(f, 'body');
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Face texture (GIF ok)</Label>
                  <div className="flex gap-2">
                    <Input value={currentDef.face_texture_url || ''} onChange={e => updateDef('face_texture_url', e.target.value)} placeholder="URL" />
                    <Button size="icon" variant="outline" onClick={() => faceInputRef.current?.click()}>
                      <Upload className="h-4 w-4" />
                    </Button>
                    <input
                      ref={faceInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) void uploadTexture(f, 'face');
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Select a tier to edit.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
