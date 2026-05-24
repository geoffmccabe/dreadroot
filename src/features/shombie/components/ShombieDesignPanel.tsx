import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Save, RotateCw } from 'lucide-react';
import { AnimatedTexturePreview } from '@/components/AnimatedTexturePreview';
import { EnemySoundSettings, SoundConfig } from '@/components/EnemySoundSettings';
import { EnemyBehaviorSettings, AIConfig } from '@/components/EnemyBehaviorSettings';
import { convertAnimationToStrip, needsAnimationProcessing } from '@/lib/animationToStrip';
import { convertTextureToKtx2 } from '@/lib/ktx2';
import { rotateTexture } from '@/lib/textureRotation';
import type { ShombieDefinition } from '../types';

interface ShombieDesignPanelProps {
  className?: string;
}

const DEFAULT_DEFINITION: Omit<ShombieDefinition, 'id' | 'created_at' | 'updated_at'> = {
  tier: 1,
  name: 'Shambler',
  texture_url: null,
  speed: 2.0,
  health: 100,
  damage_per_hit: 10,
  knockback_received: 2.0,
  spawn_chance_per_minute: 1.0,
  ai_config: {
    behaviors: ['chase', 'attack'],
    detectionRange: 50,
    attackRange: 1.2,
    attackCooldownMs: 1000,
  },
};

const RARITY_COLORS: Record<string, string> = {
  common: '#9ca3af',
  uncommon: '#22c55e',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b',
  divine: '#ffffff',
  mystic: '#ec4899',
  rainbow: '#ff0000',
  apocalyptic: '#1a1a1a',
  cosmic: '#ffd700',
};

const RARITY_NAMES: Record<number, string> = {
  1: 'common',
  2: 'uncommon',
  3: 'rare',
  4: 'epic',
  5: 'legendary',
  6: 'divine',
  7: 'mystic',
  8: 'rainbow',
  9: 'apocalyptic',
  10: 'cosmic',
};

function getRarityForTier(tier: number): string {
  return RARITY_NAMES[tier] || 'common';
}

export function ShombieDesignPanel({ className }: ShombieDesignPanelProps) {
  const queryClient = useQueryClient();
  const [definitions, setDefinitions] = useState<ShombieDefinition[]>([]);
  const [selectedTier, setSelectedTier] = useState<number | null>(null); // null = ALL TIERS
  const [currentDef, setCurrentDef] = useState<ShombieDefinition | null>(null);
  // Use T1 definition for global AI settings
  const globalDef = definitions.find(d => d.tier === 1) || null;
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Sound settings
  const [soundConfigs, setSoundConfigs] = useState<SoundConfig[]>([
    { key: 'ambient', label: 'Ambient Sound', url: null },
    { key: 'death', label: 'Death Sound', url: null },
  ]);
  const [soundVolume, setSoundVolume] = useState(100);
  const [isRotating, setIsRotating] = useState(false);

  // Fetch definitions
  useEffect(() => {
    fetchDefinitions();
    fetchSoundSettings();
  }, []);

  const fetchDefinitions = async () => {
    const { data, error } = await supabase
      .from('shombie_definitions')
      .select('*')
      .order('tier', { ascending: true });

    if (error) {
      console.error('[ShombieDesign] Error fetching:', error);
      toast.error('Failed to load shombie definitions');
      return;
    }

    // Fill missing tiers with defaults (up to tier 10)
    const existingTiers = new Set((data || []).map(d => d.tier));
    const filledDefs: ShombieDefinition[] = [...(data || [])] as ShombieDefinition[];

    for (let tier = 1; tier <= 10; tier++) {
      if (!existingTiers.has(tier)) {
        filledDefs.push({
          ...DEFAULT_DEFINITION,
          id: `temp_${tier}`,
          tier,
          name: `Tier ${tier} Shombie`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as ShombieDefinition);
      }
    }

    filledDefs.sort((a, b) => a.tier - b.tier);
    setDefinitions(filledDefs);

    // Set current def
    const def = filledDefs.find(d => d.tier === selectedTier);
    setCurrentDef(def || null);
  };

  const fetchSoundSettings = async () => {
    const { data } = await supabase
      .from('enemy_sound_settings')
      .select('*')
      .eq('enemy_type', 'shombie')
      .single();
    
    if (data) {
      setSoundConfigs([
        { key: 'ambient', label: 'Ambient Sound', url: data.ambient_sound_url },
        { key: 'death', label: 'Death Sound', url: data.death_sound_url },
      ]);
      setSoundVolume(data.volume);
    }
  };

  const selectTier = (tier: number | null) => {
    setSelectedTier(tier);
    if (tier !== null) {
      const def = definitions.find(d => d.tier === tier);
      setCurrentDef(def || null);
    } else {
      setCurrentDef(null);
    }
    setHasChanges(false);
  };

  const updateDef = (field: keyof ShombieDefinition, value: any) => {
    if (!currentDef) return;
    const updatedDef = { ...currentDef, [field]: value };
    setCurrentDef(updatedDef);
    // Also update definitions array so sidebar reflects changes immediately
    setDefinitions(prev => prev.map(d => d.tier === currentDef.tier ? updatedDef : d));
    setHasChanges(true);
  };

  const updateAiConfig = (config: AIConfig) => {
    if (!currentDef) return;
    const updatedDef = { ...currentDef, ai_config: config };
    setCurrentDef(updatedDef);
    // Also update definitions array so sidebar reflects changes immediately
    setDefinitions(prev => prev.map(d => d.tier === currentDef.tier ? updatedDef : d));
    setHasChanges(true);
  };

  const saveDef = async () => {
    if (!currentDef) return;

    // Capture the tier we're saving BEFORE any async operations
    const savingTier = currentDef.tier;

    setIsSaving(true);

    const isNew = currentDef.id.startsWith('temp_');
    const { id, created_at, updated_at, ai_config, ...baseData } = currentDef;

    // Convert ai_config to JSON-safe format
    const saveData = {
      ...baseData,
      ai_config: ai_config ? JSON.parse(JSON.stringify(ai_config)) : null,
    };

    console.log('[ShombieDesign] Saving:', { isNew, tier: baseData.tier, saveData });

    try {
      let savedData: ShombieDefinition | null = null;

      if (isNew) {
        // Insert new definition - use upsert on tier for safety
        const { data, error } = await supabase
          .from('shombie_definitions')
          .upsert([saveData], { onConflict: 'tier' })
          .select()
          .single();
        if (error) throw error;
        savedData = data as ShombieDefinition;
        console.log('[ShombieDesign] Inserted/Upserted:', data);
      } else {
        // Update existing definition by id
        const { data, error } = await supabase
          .from('shombie_definitions')
          .update(saveData)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        savedData = data as ShombieDefinition;
        console.log('[ShombieDesign] Updated:', data);
      }

      toast.success(`Tier ${savingTier} saved!`);
      setHasChanges(false);

      // Update local state immediately with saved data (don't wait for refetch)
      if (savedData) {
        setDefinitions(prev => {
          const updated = prev.map(d => d.tier === savingTier ? savedData : d);
          return updated;
        });
        // Keep currentDef in sync with the saved data
        setCurrentDef(savedData);
      }

      // Invalidate queries for other components that use this data
      queryClient.invalidateQueries({ queryKey: ['shombie-definitions'] });
    } catch (err: any) {
      console.error('[ShombieDesign] Save error:', err);
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTextureUpload = async (file: File) => {
    if (!currentDef) return;

    // Capture the tier at the START of the upload to prevent closure issues
    const uploadingForTier = currentDef.tier;
    const uploadingForId = currentDef.id;

    let uploadBlob: Blob = file;
    let fileName: string;

    // Check if file needs animation processing (includes animated WebP)
    const isAnimated = await needsAnimationProcessing(file);

    if (isAnimated) {
      // Convert animation (GIF/video/animated WebP) to horizontal strip
      toast.info('Converting animation to strip texture...');

      try {
        const result = await convertAnimationToStrip(file, {
          frameSize: 256,
          maxFrames: 24,
        });

        uploadBlob = result.stripBlob;
        // Filename encodes frame count and delay for playback
        fileName = `shombie_tier${uploadingForTier}_${result.frameCount}f_${result.frameDelay}ms_${Date.now()}.webp`;

        toast.success(`Converted ${result.originalFrameCount} frames to ${result.frameCount}-frame strip`);
      } catch (err: any) {
        toast.error(`Animation conversion failed: ${err.message}`);
        return;
      }
    } else {
      // Static image - upload as-is
      fileName = `shombie_tier${uploadingForTier}_${Date.now()}.webp`;
    }

    const { error: uploadError } = await supabase.storage
      .from('block-textures')
      .upload(fileName, uploadBlob, { upsert: true });

    if (uploadError) {
      toast.error('Failed to upload texture');
      return;
    }

    const { data: urlData } = supabase.storage
      .from('block-textures')
      .getPublicUrl(fileName);

    // Update the SPECIFIC tier we started uploading for, not whatever is currently selected
    setDefinitions(prev => prev.map(d =>
      d.tier === uploadingForTier ? { ...d, texture_url: urlData.publicUrl } : d
    ));

    // Also update currentDef if it's still the same tier
    setCurrentDef(prev =>
      prev && prev.tier === uploadingForTier ? { ...prev, texture_url: urlData.publicUrl } : prev
    );

    setHasChanges(true);
    toast.success(`Texture uploaded for Tier ${uploadingForTier}!`);

    // Fire-and-forget KTX2 sibling.
    const tierForKtx2 = uploadingForTier;
    void convertTextureToKtx2(urlData.publicUrl, 'standard').then((ktx2Url) => {
      if (!ktx2Url) return;
      setDefinitions(prev => prev.map(d =>
        d.tier === tierForKtx2 ? { ...d, texture_url_ktx2: ktx2Url } : d
      ));
      setCurrentDef(prev =>
        prev && prev.tier === tierForKtx2 ? { ...prev, texture_url_ktx2: ktx2Url } : prev
      );
      const rowId = definitions.find(d => d.tier === tierForKtx2)?.id;
      if (rowId) {
        void (supabase.from('shombie_definitions' as any).update({ texture_url_ktx2: ktx2Url }).eq('id', rowId) as any);
      }
    });
  };

  const handleTextureRotate = async () => {
    if (!currentDef?.texture_url) {
      toast.error('Upload a texture first');
      return;
    }

    setIsRotating(true);

    try {
      const result = await rotateTexture(currentDef.texture_url, `shombie_tier${currentDef.tier}`);

      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(result.fileName, result.blob, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('block-textures')
        .getPublicUrl(result.fileName);

      updateDef('texture_url', urlData.publicUrl);
      toast.success('Texture rotated 90° clockwise');

      const rotatedTier = currentDef.tier;
      void convertTextureToKtx2(urlData.publicUrl, 'standard').then((ktx2Url) => {
        if (!ktx2Url) return;
        updateDef('texture_url_ktx2', ktx2Url);
        const rowId = definitions.find(d => d.tier === rotatedTier)?.id;
        if (rowId) {
          void (supabase.from('shombie_definitions' as any).update({ texture_url_ktx2: ktx2Url }).eq('id', rowId) as any);
        }
      });
    } catch (err) {
      console.error('[ShombieDesign] Rotate error:', err);
      toast.error('Rotation failed');
    } finally {
      setIsRotating(false);
    }
  };

  const handleSoundChange = async (key: string, url: string | null) => {
    setSoundConfigs(prev => prev.map(s => s.key === key ? { ...s, url } : s));

    const updateData = key === 'ambient'
      ? { ambient_sound_url: url }
      : { death_sound_url: url };

    // Upsert the sound settings (creates row if doesn't exist)
    const { error } = await supabase
      .from('enemy_sound_settings')
      .upsert({ enemy_type: 'shombie', ...updateData }, { onConflict: 'enemy_type' });

    if (error) {
      toast.error('Failed to update sound');
    }
  };

  const handleVolumeChange = async (volume: number) => {
    setSoundVolume(volume);

    // Upsert the sound settings (creates row if doesn't exist)
    const { error } = await supabase
      .from('enemy_sound_settings')
      .upsert({ enemy_type: 'shombie', volume }, { onConflict: 'enemy_type' });
    
    if (error) {
      toast.error('Failed to update volume');
    }
  };

  return (
    <Card className={`p-4 ${className || ''}`}>
      <div className="grid grid-cols-12 gap-4">
      {/* Part 1: Tier Selector */}
      <div className="col-span-3">
        <div className="border rounded-lg p-3 bg-muted/30">
          <h3 className="font-semibold mb-3 text-2xl">Shombies</h3>
          <ScrollArea className="h-[500px]">
            <div className="space-y-1 pr-2">
              {/* ALL TIERS option for global settings */}
              <Button
                variant={selectedTier === null ? 'default' : 'ghost'}
                size="sm"
                className="w-full justify-start text-xs h-auto py-1 mb-2"
                onClick={() => selectTier(null)}
              >
                <span className="flex items-center gap-1">
                  <span className="font-semibold">ALL TIERS</span>
                </span>
              </Button>
              {definitions.map(def => (
                <Button
                  key={def.tier}
                  variant={selectedTier === def.tier ? 'default' : 'ghost'}
                  size="sm"
                  className="w-full justify-start text-xs h-auto py-1"
                  onClick={() => selectTier(def.tier)}
                >
                  <span className="flex items-center gap-1">
                    <span className="w-6 font-mono">T{def.tier}</span>
                    <div className="flex gap-0.5">
                      {/* Texture thumbnail */}
                      <AnimatedTexturePreview
                        url={def.texture_url}
                        size={16}
                        className="flex-shrink-0"
                        fallback={<div className="w-full h-full bg-green-600/50" />}
                      />
                    </div>
                    <span 
                      className="ml-1 text-[10px] capitalize"
                      style={{ color: RARITY_COLORS[getRarityForTier(def.tier)] }}
                    >
                      {getRarityForTier(def.tier)}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Part 2 & 3: Sound Settings + Tier Editor */}
      <div className="col-span-9 flex flex-col gap-4">
        {/* ALL TIERS view: Show global Sound Settings + AI Behavior Settings */}
        {selectedTier === null ? (
          <>
            <EnemySoundSettings
              enemyType="shombie"
              sounds={soundConfigs}
              volume={soundVolume}
              onSoundChange={handleSoundChange}
              onVolumeChange={handleVolumeChange}
            />

            {globalDef && (
              <EnemyBehaviorSettings
                enemyType="shombie"
                aiConfig={globalDef.ai_config as AIConfig | null}
                onConfigChange={(config) => {
                  // Update T1's ai_config as the global config
                  setDefinitions(prev =>
                    prev.map(d => d.tier === 1 ? { ...d, ai_config: config } : d)
                  );
                  setHasChanges(true);
                }}
              />
            )}
          </>
        ) : (
        <Card className="p-4 flex-1">
          {currentDef ? (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b">
                <div>
                  <h3 className="font-semibold">Tier {selectedTier} Shombie</h3>
                  <p className="text-xs text-muted-foreground">{currentDef.name}</p>
                </div>
                <Button onClick={saveDef} disabled={!hasChanges || isSaving} size="sm" className="gap-2">
                  <Save className="h-4 w-4" />
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>

              {/* Two-column grid for inputs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={currentDef.name}
                    onChange={(e) => updateDef('name', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Health: {currentDef.health}</Label>
                  <Slider
                    value={[currentDef.health]}
                    min={10}
                    max={10000}
                    step={10}
                    onValueChange={([v]) => updateDef('health', v)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Speed: {currentDef.speed.toFixed(1)} blocks/s</Label>
                  <Slider
                    value={[currentDef.speed]}
                    min={0.5}
                    max={6}
                    step={0.1}
                    onValueChange={([v]) => updateDef('speed', v)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Damage per Hit: {currentDef.damage_per_hit}</Label>
                  <Slider
                    value={[currentDef.damage_per_hit]}
                    min={1}
                    max={50}
                    step={1}
                    onValueChange={([v]) => updateDef('damage_per_hit', v)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Knockback Received: {currentDef.knockback_received.toFixed(1)}</Label>
                  <Slider
                    value={[currentDef.knockback_received]}
                    min={0.5}
                    max={10}
                    step={0.5}
                    onValueChange={([v]) => updateDef('knockback_received', v)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Spawn Rate: {currentDef.spawn_chance_per_minute.toFixed(2)}/min</Label>
                  <Slider
                    value={[currentDef.spawn_chance_per_minute]}
                    min={0.01}
                    max={5}
                    step={0.01}
                    onValueChange={([v]) => updateDef('spawn_chance_per_minute', v)}
                  />
                </div>
              </div>

              {/* Texture Upload */}
              <div className="space-y-2">
                <Label>Body Texture</Label>
                <div className="flex gap-2 items-center">
                  <AnimatedTexturePreview
                    url={currentDef.texture_url}
                    size={48}
                    fallback={<div className="w-full h-full bg-green-600/50" />}
                  />
                  <Input
                    type="file"
                    accept="image/*"
                    className="flex-1"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleTextureUpload(file);
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTextureRotate}
                    disabled={!currentDef.texture_url || isRotating}
                    title="Rotate 90° clockwise"
                  >
                    <RotateCw className={`h-4 w-4 ${isRotating ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>

              {/* Combat Summary */}
              <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                <h4 className="text-xs font-semibold mb-2">Combat Summary</h4>
                <div className="grid grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground">Total HP:</span>
                    <span className="ml-1 font-medium">{currentDef.health}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Knockback:</span>
                    <span className="ml-1 font-medium">{currentDef.knockback_received} blocks</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">DPS potential:</span>
                    <span className="ml-1 font-medium text-destructive">
                      {currentDef.damage_per_hit}/sec
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Difficulty:</span>
                    <span
                      className="ml-1 font-medium capitalize"
                      style={{ color: RARITY_COLORS[getRarityForTier(selectedTier!)] }}
                    >
                      {getRarityForTier(selectedTier!)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground text-center py-8">
              Select a tier to edit
            </div>
          )}
        </Card>
        )}
      </div>
      </div>
    </Card>
  );
}
