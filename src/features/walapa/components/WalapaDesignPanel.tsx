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
import { rotateTexture } from '@/lib/textureRotation';
import type { WalapaDefinition } from '../types';
import { TIER_RARITY, RARITY_COLORS } from '../constants';
import { DEFAULT_WALAPA_DEFINITION } from '../hooks/useWalapaDefinitions';

interface WalapaDesignPanelProps {
  className?: string;
}

function getRarityForTier(tier: number): string {
  return TIER_RARITY[tier] || 'common';
}

export function WalapaDesignPanel({ className }: WalapaDesignPanelProps) {
  const queryClient = useQueryClient();
  const [definitions, setDefinitions] = useState<WalapaDefinition[]>([]);
  const [selectedTier, setSelectedTier] = useState<number | null>(null); // null = ALL TIERS
  const [currentDef, setCurrentDef] = useState<WalapaDefinition | null>(null);
  // Use T1 definition for global AI settings
  const globalDef = definitions.find(d => d.tier === 1) || null;
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRotating, setIsRotating] = useState<Record<string, boolean>>({});

  // Sound settings
  const [soundConfigs, setSoundConfigs] = useState<SoundConfig[]>([
    { key: 'ambient', label: 'Ambient Sound', url: null },
    { key: 'death', label: 'Death Sound', url: null },
  ]);
  const [soundVolume, setSoundVolume] = useState(100);

  // Fetch definitions
  useEffect(() => {
    fetchDefinitions();
    fetchSoundSettings();
  }, []);

  const fetchDefinitions = async () => {
    const { data, error } = await supabase
      .from('walapa_definitions' as any)
      .select('*')
      .order('tier', { ascending: true });

    if (error) {
      // Table might not exist yet - create defaults
      console.warn('[WalapaDesign] Error fetching (table may not exist):', error.message);
      // Fill with defaults
      const filledDefs: WalapaDefinition[] = [];
      for (let tier = 1; tier <= 10; tier++) {
        filledDefs.push({
          ...DEFAULT_WALAPA_DEFINITION,
          id: `temp_${tier}`,
          tier,
          name: `Tier ${tier} Walapa`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as WalapaDefinition);
      }
      setDefinitions(filledDefs);
      return;
    }

    // Fill missing tiers with defaults (up to tier 10)
    const existingTiers = new Set((data || []).map(d => d.tier));
    const filledDefs: WalapaDefinition[] = [...(data || [])] as WalapaDefinition[];

    for (let tier = 1; tier <= 10; tier++) {
      if (!existingTiers.has(tier)) {
        filledDefs.push({
          ...DEFAULT_WALAPA_DEFINITION,
          id: `temp_${tier}`,
          tier,
          name: `Tier ${tier} Walapa`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as WalapaDefinition);
      }
    }

    filledDefs.sort((a, b) => a.tier - b.tier);
    setDefinitions(filledDefs);
  };

  const fetchSoundSettings = async () => {
    const { data } = await supabase
      .from('enemy_sound_settings')
      .select('*')
      .eq('enemy_type', 'walapa')
      .single();

    if (data) {
      setSoundConfigs([
        { key: 'ambient', label: 'Ambient Sound', url: data.ambient_sound_url },
        { key: 'death', label: 'Death Sound', url: data.death_sound_url },
      ]);
      setSoundVolume(data.volume ?? 100);
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

  const updateDef = (field: keyof WalapaDefinition, value: any) => {
    if (!currentDef) return;
    const updatedDef = { ...currentDef, [field]: value };
    setCurrentDef(updatedDef);
    setDefinitions(prev => prev.map(d => d.tier === currentDef.tier ? updatedDef : d));
    setHasChanges(true);
  };

  const updateAiConfig = (config: AIConfig) => {
    if (!globalDef) return;
    const updatedDef = { ...globalDef, ai_config: config };
    setDefinitions(prev => prev.map(d => d.tier === 1 ? updatedDef : d));
    setHasChanges(true);
  };

  const saveDef = async () => {
    if (!currentDef) return;

    const savingTier = currentDef.tier;
    setIsSaving(true);

    const isNew = currentDef.id.startsWith('temp_');
    const { id, created_at, updated_at, ai_config, sound_config, ...baseData } = currentDef;

    const saveData = {
      ...baseData,
      ai_config: ai_config ? JSON.parse(JSON.stringify(ai_config)) : null,
      sound_config: sound_config ? JSON.parse(JSON.stringify(sound_config)) : null,
    };

    console.log('[WalapaDesign] Saving:', { isNew, tier: baseData.tier, saveData });

    try {
      let savedData: WalapaDefinition | null = null;

      if (isNew) {
        const { data, error } = await supabase
          .from('walapa_definitions' as any)
          .upsert([saveData], { onConflict: 'tier' })
          .select()
          .single();
        if (error) throw error;
        savedData = data as WalapaDefinition;
        console.log('[WalapaDesign] Inserted/Upserted:', data);
      } else {
        const { data, error } = await supabase
          .from('walapa_definitions' as any)
          .update(saveData)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        savedData = data as WalapaDefinition;
        console.log('[WalapaDesign] Updated:', data);
      }

      toast.success(`Tier ${savingTier} saved!`);
      setHasChanges(false);

      if (savedData) {
        setDefinitions(prev => prev.map(d => d.tier === savingTier ? savedData : d));
        setCurrentDef(savedData);
      }

      queryClient.invalidateQueries({ queryKey: ['walapa-definitions'] });
    } catch (err: any) {
      console.error('[WalapaDesign] Save error:', err);
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const saveGlobalSettings = async () => {
    if (!globalDef) return;

    setIsSaving(true);

    const isNew = globalDef.id.startsWith('temp_');
    const { id, created_at, updated_at, ai_config, sound_config, ...baseData } = globalDef;

    const saveData = {
      ...baseData,
      ai_config: ai_config ? JSON.parse(JSON.stringify(ai_config)) : null,
      sound_config: sound_config ? JSON.parse(JSON.stringify(sound_config)) : null,
    };

    try {
      if (isNew) {
        const { data, error } = await supabase
          .from('walapa_definitions' as any)
          .upsert([saveData], { onConflict: 'tier' })
          .select()
          .single();
        if (error) throw error;
        setDefinitions(prev => prev.map(d => d.tier === 1 ? (data as WalapaDefinition) : d));
      } else {
        const { data, error } = await supabase
          .from('walapa_definitions' as any)
          .update(saveData)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        setDefinitions(prev => prev.map(d => d.tier === 1 ? (data as WalapaDefinition) : d));
      }

      toast.success('Global settings saved!');
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ['walapa-definitions'] });
    } catch (err: any) {
      console.error('[WalapaDesign] Save global error:', err);
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTextureUpload = async (file: File, textureType: 'body' | 'belly' | 'eyes') => {
    if (!currentDef) return;

    // Capture the tier at the START to prevent closure issues
    const uploadingForTier = currentDef.tier;

    let uploadBlob: Blob = file;
    let fileName: string;

    const isAnimated = await needsAnimationProcessing(file);

    if (isAnimated) {
      toast.info('Converting animation to strip texture...');

      try {
        const result = await convertAnimationToStrip(file, {
          frameSize: 256,
          maxFrames: 24,
        });

        uploadBlob = result.stripBlob;
        fileName = `walapa_tier${uploadingForTier}_${textureType}_${result.frameCount}f_${result.frameDelay}ms_${Date.now()}.webp`;

        toast.success(`Converted ${result.originalFrameCount} frames to ${result.frameCount}-frame strip`);
      } catch (err: any) {
        toast.error(`Animation conversion failed: ${err.message}`);
        return;
      }
    } else {
      fileName = `walapa_tier${uploadingForTier}_${textureType}_${Date.now()}.webp`;
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

    const fieldName = `${textureType}_texture_url` as keyof WalapaDefinition;

    // Update the SPECIFIC tier we started uploading for
    setDefinitions(prev => prev.map(d =>
      d.tier === uploadingForTier ? { ...d, [fieldName]: urlData.publicUrl } : d
    ));

    // Also update currentDef if still on the same tier
    setCurrentDef(prev =>
      prev && prev.tier === uploadingForTier ? { ...prev, [fieldName]: urlData.publicUrl } : prev
    );

    setHasChanges(true);
    toast.success(`${textureType} texture uploaded for Tier ${uploadingForTier}!`);
  };

  const handleTextureRotate = async (textureType: 'body' | 'belly' | 'eyes') => {
    const fieldName = `${textureType}_texture_url` as keyof WalapaDefinition;
    const textureUrl = currentDef?.[fieldName] as string | null;

    if (!textureUrl) {
      toast.error('Upload a texture first');
      return;
    }

    setIsRotating(prev => ({ ...prev, [textureType]: true }));

    try {
      const result = await rotateTexture(textureUrl, `walapa_tier${currentDef!.tier}_${textureType}`);

      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(result.fileName, result.blob, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('block-textures')
        .getPublicUrl(result.fileName);

      updateDef(fieldName, urlData.publicUrl);
      toast.success(`${textureType} texture rotated 90 clockwise`);
    } catch (err) {
      console.error('[WalapaDesign] Rotate error:', err);
      toast.error('Rotation failed');
    } finally {
      setIsRotating(prev => ({ ...prev, [textureType]: false }));
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
      .upsert({ enemy_type: 'walapa', ...updateData }, { onConflict: 'enemy_type' });

    if (error) {
      console.error('[WalapaDesign] Sound update error:', error);
      toast.error('Failed to update sound');
    }
  };

  const handleVolumeChange = async (volume: number) => {
    setSoundVolume(volume);

    const { error } = await supabase
      .from('enemy_sound_settings')
      .upsert({ enemy_type: 'walapa', volume }, { onConflict: 'enemy_type' });

    if (error) {
      toast.error('Failed to update volume');
    }
  };

  return (
    <div className={`grid grid-cols-12 gap-4 ${className}`}>
      {/* Part 1: Tier Selector */}
      <div className="col-span-3">
        <div className="border rounded-lg p-3 bg-muted/30">
          <h3 className="font-semibold mb-3 text-2xl">Walapas</h3>
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
                      <AnimatedTexturePreview
                        url={def.body_texture_url}
                        size={16}
                        className="flex-shrink-0"
                        fallback={<div className="w-full h-full bg-blue-400/50" />}
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

      {/* Part 2: Editor or Global Settings */}
      <div className="col-span-9 flex flex-col gap-4">
        {/* ALL TIERS view: Show global Sound Settings + AI Behavior Settings */}
        {selectedTier === null ? (
          <>
            <EnemySoundSettings
              enemyType="walapa"
              sounds={soundConfigs}
              volume={soundVolume}
              onSoundChange={handleSoundChange}
              onVolumeChange={handleVolumeChange}
            />

            {globalDef && (
              <EnemyBehaviorSettings
                enemyType="walapa"
                aiConfig={globalDef.ai_config as AIConfig | null}
                onConfigChange={updateAiConfig}
              />
            )}

            {hasChanges && (
              <div className="flex justify-end">
                <Button onClick={saveGlobalSettings} disabled={isSaving} size="sm" className="gap-2">
                  <Save className="h-4 w-4" />
                  {isSaving ? 'Saving...' : 'Save Global Settings'}
                </Button>
              </div>
            )}
          </>
        ) : (
          <Card className="p-4">
            {currentDef ? (
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b">
                  <div>
                    <h3 className="font-semibold">Tier {selectedTier} Walapa</h3>
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
                      min={100}
                      max={50000}
                      step={100}
                      onValueChange={([v]) => updateDef('health', v)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Speed: {currentDef.speed}% of player speed</Label>
                    <Slider
                      value={[currentDef.speed]}
                      min={100}
                      max={2000}
                      step={10}
                      onValueChange={([v]) => updateDef('speed', v)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Wait Time: {currentDef.wait_time_seconds}s at each tree</Label>
                    <Slider
                      value={[currentDef.wait_time_seconds]}
                      min={5}
                      max={120}
                      step={5}
                      onValueChange={([v]) => updateDef('wait_time_seconds', v)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Min Tree Tier: T{currentDef.min_tree_tier}+</Label>
                    <Slider
                      value={[currentDef.min_tree_tier]}
                      min={1}
                      max={10}
                      step={1}
                      onValueChange={([v]) => updateDef('min_tree_tier', v)}
                    />
                  </div>
                </div>

                {/* Texture Uploads - 3 textures */}
                <div className="grid grid-cols-3 gap-4">
                  {/* Body Texture */}
                  <div className="space-y-2">
                    <Label>Body Texture</Label>
                    <div className="flex flex-col gap-2">
                      <AnimatedTexturePreview
                        url={currentDef.body_texture_url}
                        size={48}
                        fallback={<div className="w-full h-full bg-blue-400/50" />}
                      />
                      <div className="flex gap-1">
                        <Input
                          type="file"
                          accept="image/*"
                          className="flex-1 text-xs"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleTextureUpload(file, 'body');
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTextureRotate('body')}
                          disabled={!currentDef.body_texture_url || isRotating.body}
                          title="Rotate 90 clockwise"
                        >
                          <RotateCw className={`h-4 w-4 ${isRotating.body ? 'animate-spin' : ''}`} />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Belly Texture */}
                  <div className="space-y-2">
                    <Label>Belly Texture</Label>
                    <div className="flex flex-col gap-2">
                      <AnimatedTexturePreview
                        url={currentDef.belly_texture_url}
                        size={48}
                        fallback={<div className="w-full h-full bg-blue-200/50" />}
                      />
                      <div className="flex gap-1">
                        <Input
                          type="file"
                          accept="image/*"
                          className="flex-1 text-xs"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleTextureUpload(file, 'belly');
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTextureRotate('belly')}
                          disabled={!currentDef.belly_texture_url || isRotating.belly}
                          title="Rotate 90 clockwise"
                        >
                          <RotateCw className={`h-4 w-4 ${isRotating.belly ? 'animate-spin' : ''}`} />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Eyes Texture */}
                  <div className="space-y-2">
                    <Label>Eyes Texture</Label>
                    <div className="flex flex-col gap-2">
                      <AnimatedTexturePreview
                        url={currentDef.eyes_texture_url}
                        size={48}
                        fallback={<div className="w-full h-full bg-gray-800/50" />}
                      />
                      <div className="flex gap-1">
                        <Input
                          type="file"
                          accept="image/*"
                          className="flex-1 text-xs"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleTextureUpload(file, 'eyes');
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTextureRotate('eyes')}
                          disabled={!currentDef.eyes_texture_url || isRotating.eyes}
                          title="Rotate 90 clockwise"
                        >
                          <RotateCw className={`h-4 w-4 ${isRotating.eyes ? 'animate-spin' : ''}`} />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats Summary */}
                <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                  <h4 className="text-xs font-semibold mb-2">Stats Summary</h4>
                  <div className="grid grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Total HP:</span>
                      <span className="ml-1 font-medium">{currentDef.health}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Speed:</span>
                      <span className="ml-1 font-medium">{currentDef.speed}%</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Wait Time:</span>
                      <span className="ml-1 font-medium">{currentDef.wait_time_seconds}s</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Rarity:</span>
                      <span
                        className="ml-1 font-medium capitalize"
                        style={{ color: RARITY_COLORS[getRarityForTier(selectedTier)] }}
                      >
                        {getRarityForTier(selectedTier)}
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
  );
}
