// Shnake Design Panel - Admin UI for configuring shnake enemy tiers

import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, Save, Bug, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { convertAnimationToStrip, isAnimatedFile } from '@/lib/animationToStrip';
import { EnemySoundSettings, SoundConfig } from '@/components/EnemySoundSettings';
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
  const queryClient = useQueryClient();

  // Global sound settings state
  const [soundVolume, setSoundVolume] = useState(100);
  const [ambientSoundUrl, setAmbientSoundUrl] = useState<string | null>(null);
  const [deathSoundUrl, setDeathSoundUrl] = useState<string | null>(null);

  const headInputRef = useRef<HTMLInputElement>(null);
  const bodyInputRef = useRef<HTMLInputElement>(null);
  const faceInputRef = useRef<HTMLInputElement>(null);

  const currentDef = definitions.find(d => d.tier === selectedTier) || null;

  // Load sound settings
  useEffect(() => {
    const loadSoundSettings = async () => {
      const { data } = await supabase
        .from('enemy_sound_settings')
        .select('*')
        .eq('enemy_type', 'shnake')
        .single();
      
      if (data) {
        setSoundVolume(data.volume);
        setAmbientSoundUrl(data.ambient_sound_url);
        setDeathSoundUrl(data.death_sound_url);
      }
    };
    loadSoundSettings();
  }, []);

  // Save sound settings
  const saveSoundSettings = async (key: string, value: any) => {
    const { error } = await supabase
      .from('enemy_sound_settings')
      .update({ [key]: value, updated_at: new Date().toISOString() })
      .eq('enemy_type', 'shnake');
    
    if (error) {
      toast({ title: 'Failed to save sound setting', variant: 'destructive' });
    }
  };

  const handleSoundChange = (key: string, url: string | null) => {
    if (key === 'ambient') {
      setAmbientSoundUrl(url);
      saveSoundSettings('ambient_sound_url', url);
    } else if (key === 'death') {
      setDeathSoundUrl(url);
      saveSoundSettings('death_sound_url', url);
    }
  };

  const handleVolumeChange = (volume: number) => {
    setSoundVolume(volume);
    saveSoundSettings('volume', volume);
  };

  const soundConfigs: SoundConfig[] = [
    { key: 'ambient', label: 'Ambient Sound', url: ambientSoundUrl },
    { key: 'death', label: 'Death Sound', url: deathSoundUrl },
  ];

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
      // Invalidate query cache to trigger immediate texture updates in-game
      queryClient.invalidateQueries({ queryKey: ['shnake-definitions'] });
      toast({ title: 'Saved - textures will update immediately' });
    } catch (err) {
      console.error('[ShnakeDesignPanel] Save error:', err);
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const uploadTexture = async (file: File, kind: 'head' | 'body' | 'face') => {
    try {
      let blob: Blob;
      let fileName: string;
      
      if (isAnimatedFile(file)) {
        // Convert animation (GIF/video) to horizontal strip
        toast({ title: 'Converting animation...', description: 'Processing frames into strip texture' });
        
        const result = await convertAnimationToStrip(file, {
          frameSize: 256,
          maxFrames: 24,
        });
        
        blob = result.stripBlob;
        fileName = `shnake_${kind}_${selectedTier}_${result.frameCount}f_${result.frameDelay}ms_${Date.now()}.webp`;
        
        toast({ 
          title: 'Animation converted', 
          description: `${result.originalFrameCount} frames → ${result.frameCount} frame strip` 
        });
      } else {
        // Static image - convert to 512x512 webp (head/body stay high-res)
        blob = await convertToWebp(file);
        fileName = `shnake_${kind}_${selectedTier}_${Date.now()}.webp`;
      }
      
      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(fileName, blob, { upsert: true, contentType: 'image/webp' });
      if (uploadError) throw uploadError;
      
      const {
        data: { publicUrl },
      } = supabase.storage.from('block-textures').getPublicUrl(fileName);

      if (kind === 'head') updateDef('head_texture_url', publicUrl);
      if (kind === 'body') updateDef('body_texture_url', publicUrl);
      if (kind === 'face') updateDef('face_texture_url', publicUrl);

      toast({ title: 'Texture uploaded', description: `Shnake ${kind} texture saved` });
    } catch (err) {
      console.error('[ShnakeDesignPanel] Upload error:', err);
      toast({ title: 'Upload failed', variant: 'destructive' });
    }
  };

  // Convert any image to 512x512 webp format (center crop if not square)
  const convertToWebp = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const TARGET_SIZE = 512;
        const canvas = document.createElement('canvas');
        canvas.width = TARGET_SIZE;
        canvas.height = TARGET_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        // Center crop to square, then scale to 512x512
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        
        ctx.drawImage(img, sx, sy, size, size, 0, 0, TARGET_SIZE, TARGET_SIZE);
        
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to convert to webp'));
            }
          },
          'image/webp',
          0.9
        );
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  };

  // Re-process a URL to 512x512 webp
  const reprocessUrlToWebp = async (url: string, kind: 'head' | 'body' | 'face'): Promise<void> => {
    try {
      toast({ title: 'Converting...', description: `Re-processing ${kind} texture to 512x512 webp` });
      
      const response = await fetch(url);
      const blob = await response.blob();
      const file = new File([blob], 'texture', { type: blob.type });
      
      await uploadTexture(file, kind);
    } catch (err) {
      console.error('[ShnakeDesignPanel] Reprocess error:', err);
      toast({ title: 'Conversion failed', variant: 'destructive' });
    }
  };

  // Check if URL needs reprocessing (not webp or wrong size)
  const needsReprocessing = (url: string | null): boolean => {
    if (!url) return false;
    return !url.endsWith('.webp');
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
    <div className={`flex flex-col gap-4 ${className || ''}`}>
      {/* Global Sound Settings Panel */}
      <EnemySoundSettings
        enemyType="shnake"
        sounds={soundConfigs}
        volume={soundVolume}
        onSoundChange={handleSoundChange}
        onVolumeChange={handleVolumeChange}
      />
      
      <div className="grid grid-cols-12 gap-4">
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
                  className="w-full justify-start text-xs h-auto py-1"
                  onClick={() => setSelectedTier(def.tier)}
                >
                  <span className="flex items-center gap-1">
                    <span className="w-6 font-mono">T{def.tier}</span>
                    <div className="flex gap-0.5">
                      {/* Face */}
                      <div className="w-4 h-4 rounded-sm bg-muted border border-border overflow-hidden flex-shrink-0">
                        {def.face_texture_url ? (
                          <img src={def.face_texture_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-muted-foreground/20" />
                        )}
                      </div>
                      {/* Head */}
                      <div className="w-4 h-4 rounded-sm bg-muted border border-border overflow-hidden flex-shrink-0">
                        {def.head_texture_url ? (
                          <img src={def.head_texture_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-muted-foreground/20" />
                        )}
                      </div>
                      {/* Body x3 */}
                      {[0, 1, 2].map(i => (
                        <div key={i} className="w-4 h-4 rounded-sm bg-muted border border-border overflow-hidden flex-shrink-0">
                          {def.body_texture_url ? (
                            <img src={def.body_texture_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-muted-foreground/20" />
                          )}
                        </div>
                      ))}
                    </div>
                  </span>
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
                  <Label>Head</Label>
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-16 h-16 rounded border border-border bg-muted flex items-center justify-center overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary"
                      onClick={() => headInputRef.current?.click()}
                      title="Click to upload"
                    >
                      {currentDef.head_texture_url ? (
                        <img src={currentDef.head_texture_url} alt="Head" className="w-full h-full object-cover" />
                      ) : (
                        <Upload className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    {currentDef.head_texture_url && (
                      <Button size="sm" variant="ghost" onClick={() => updateDef('head_texture_url', null)} className="text-xs text-destructive">
                        Clear
                      </Button>
                    )}
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
                  <Label>Body</Label>
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-16 h-16 rounded border border-border bg-muted flex items-center justify-center overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary"
                      onClick={() => bodyInputRef.current?.click()}
                      title="Click to upload"
                    >
                      {currentDef.body_texture_url ? (
                        <img src={currentDef.body_texture_url} alt="Body" className="w-full h-full object-cover" />
                      ) : (
                        <Upload className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    {currentDef.body_texture_url && (
                      <Button size="sm" variant="ghost" onClick={() => updateDef('body_texture_url', null)} className="text-xs text-destructive">
                        Clear
                      </Button>
                    )}
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
                  <Label>Face</Label>
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-16 h-16 rounded border border-border bg-muted flex items-center justify-center overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary"
                      onClick={() => faceInputRef.current?.click()}
                      title="Click to upload"
                    >
                      {currentDef.face_texture_url ? (
                        <img src={currentDef.face_texture_url} alt="Face" className="w-full h-full object-cover" />
                      ) : (
                        <Upload className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    {currentDef.face_texture_url && (
                      <Button size="sm" variant="ghost" onClick={() => updateDef('face_texture_url', null)} className="text-xs text-destructive">
                        Clear
                      </Button>
                    )}
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
    </div>
  );
}
