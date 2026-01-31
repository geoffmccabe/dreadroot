// Shwarm Design Panel - Admin UI for configuring shwarm enemy tiers
// Allows setting speed, damage, health, textures, and spawn parameters

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Save, Bug, Zap, Shield, Swords } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ShwarmDefinition } from '../types';
import { EnemySoundSettings, SoundConfig } from '@/components/EnemySoundSettings';
import { EnemyBehaviorSettings, AIConfig } from '@/components/EnemyBehaviorSettings';
import { convertAnimationToStrip, needsAnimationProcessing } from '@/lib/animationToStrip';

const RARITY_COLORS: Record<string, string> = {
  common: '#9ca3af',
  uncommon: '#22c55e',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b',
};

const RARITY_OPTIONS = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

interface ShwarmDesignPanelProps {
  className?: string;
}

export function ShwarmDesignPanel({ className }: ShwarmDesignPanelProps) {
  const [definitions, setDefinitions] = useState<ShwarmDefinition[]>([]);
  const [selectedTier, setSelectedTier] = useState<number | null>(null); // null = ALL TIERS
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const { toast } = useToast();
  
  // Global sound settings state
  const [soundVolume, setSoundVolume] = useState(100);
  const [ambientSoundUrl, setAmbientSoundUrl] = useState<string | null>(null);
  const [deathSoundUrl, setDeathSoundUrl] = useState<string | null>(null);

  // Drop tables list for dropdown
  const [dropTables, setDropTables] = useState<{ code: string; name: string }[]>([]);

  // Current definition being edited
  const currentDef = selectedTier !== null ? definitions.find(d => d.tier === selectedTier) : null;
  // Use T1 definition for global AI settings
  const globalDef = definitions.find(d => d.tier === 1) || null;

  // Load drop tables for dropdown
  useEffect(() => {
    const loadDropTables = async () => {
      const { data } = await supabase
        .from('drop_tables')
        .select('code, name')
        .order('code');
      if (data) setDropTables(data);
    };
    loadDropTables();
  }, []);

  // Load sound settings
  useEffect(() => {
    const loadSoundSettings = async () => {
      const { data } = await supabase
        .from('enemy_sound_settings')
        .select('*')
        .eq('enemy_type', 'shwarm')
        .single();
      
      if (data) {
        setSoundVolume(data.volume);
        setAmbientSoundUrl(data.ambient_sound_url);
        setDeathSoundUrl(data.death_sound_url);
      }
    };
    loadSoundSettings();
  }, []);

  // Save sound settings (upsert to create row if doesn't exist)
  const saveSoundSettings = async (key: string, value: any) => {
    const { error } = await supabase
      .from('enemy_sound_settings')
      .upsert(
        { enemy_type: 'shwarm', [key]: value, updated_at: new Date().toISOString() },
        { onConflict: 'enemy_type' }
      );

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

  // Fetch all shwarm definitions
  useEffect(() => {
    fetchDefinitions();
  }, []);

  const fetchDefinitions = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('shwarm_definitions')
        .select('*')
        .order('tier', { ascending: true });

      if (error) throw error;

      // Create missing tiers with defaults (up to 10)
      const existingTiers = new Set((data || []).map(d => d.tier));
      const allDefs: ShwarmDefinition[] = [...(data || [])] as ShwarmDefinition[];

      for (let tier = 1; tier <= 10; tier++) {
        if (!existingTiers.has(tier)) {
          allDefs.push({
            id: `temp-${tier}`,
            tier,
            name: `Tier ${tier} Shwarm`,
            texture_url: null,
            speed: 3.0 + tier * 0.5,
            min_blocks: 10 + tier * 5,
            max_blocks: 20 + tier * 10,
            health_per_block: 30 + tier * 20,
            damage_per_hit: 5 + tier * 3,
            spawn_chance_per_minute: Math.max(0.1, 2.0 - tier * 0.2),
            x_factor: Math.min(5, 1 + Math.floor(tier / 2)),
            drop_rate: tier * 1.0,
            drop_table_code: 'DT1',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      }

      allDefs.sort((a, b) => a.tier - b.tier);
      setDefinitions(allDefs);
    } catch (err) {
      console.error('[ShwarmDesignPanel] Fetch error:', err);
      toast({
        title: 'Failed to load shwarm definitions',
        description: 'Could not fetch enemy configurations',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Update local state
  const updateDef = (field: keyof ShwarmDefinition, value: any) => {
    setDefinitions(prev => prev.map(d => 
      d.tier === selectedTier ? { ...d, [field]: value } : d
    ));
    setHasChanges(true);
  };

  // Update AI config
  const updateAiConfig = (config: AIConfig) => {
    setDefinitions(prev => prev.map(d => 
      d.tier === selectedTier ? { ...d, ai_config: config } : d
    ));
    setHasChanges(true);
  };

  // Save current definition to database
  const saveDef = async () => {
    if (!currentDef) return;
    
    setIsSaving(true);
    try {
      const isNew = currentDef.id.startsWith('temp-');
      
      // Cast ai_config to JSON-compatible format for Supabase
      const aiConfigForDb = currentDef.ai_config 
        ? JSON.parse(JSON.stringify(currentDef.ai_config))
        : null;
      
      const defData = {
        tier: currentDef.tier,
        name: currentDef.name,
        texture_url: currentDef.texture_url,
        speed: currentDef.speed,
        min_blocks: currentDef.min_blocks,
        max_blocks: currentDef.max_blocks,
        health_per_block: currentDef.health_per_block,
        damage_per_hit: currentDef.damage_per_hit,
        spawn_chance_per_minute: currentDef.spawn_chance_per_minute,
        x_factor: currentDef.x_factor,
        drop_rate: currentDef.drop_rate,
        drop_table_code: currentDef.drop_table_code,
        ai_config: aiConfigForDb,
      };

      if (isNew) {
        const { data, error } = await supabase
          .from('shwarm_definitions')
          .insert(defData)
          .select()
          .single();

        if (error) throw error;

        setDefinitions(prev => prev.map(d => 
          d.tier === selectedTier ? (data as ShwarmDefinition) : d
        ));
      } else {
        const { error } = await supabase
          .from('shwarm_definitions')
          .update(defData)
          .eq('id', currentDef.id);

        if (error) throw error;
      }

      setHasChanges(false);
      toast({
        title: 'Shwarm saved',
        description: `Tier ${selectedTier} shwarm has been updated`,
      });
    } catch (err) {
      console.error('[ShwarmDesignPanel] Save error:', err);
      toast({
        title: 'Save failed',
        description: 'Could not save shwarm definition',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Handle face texture upload - converts animated GIFs/WebP to sprite strips
  // Face textures are stored as T1-T5 texture_url fields
  const handleFaceTextureUpload = async (file: File, faceIndex: number) => {
    const targetTier = faceIndex + 1; // Face 0-4 maps to T1-T5

    try {
      let uploadBlob: Blob = file;
      let fileName: string;

      const isAnimated = await needsAnimationProcessing(file);

      if (isAnimated) {
        toast({ title: `Converting face ${faceIndex + 1} animation to strip...` });

        const result = await convertAnimationToStrip(file, {
          frameSize: 256,
          maxFrames: 24,
        });

        uploadBlob = result.stripBlob;
        fileName = `shwarm_face${faceIndex + 1}_${result.frameCount}f_${result.frameDelay}ms_${Date.now()}.webp`;

        toast({
          title: 'Animation converted',
          description: `${result.originalFrameCount} frames to ${result.frameCount}-frame strip`,
        });
      } else {
        fileName = `shwarm_face${faceIndex + 1}_${Date.now()}.webp`;
      }

      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(fileName, uploadBlob, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('block-textures')
        .getPublicUrl(fileName);

      // Store in T1-T5's texture_url field
      setDefinitions(prev => prev.map(d =>
        d.tier === targetTier ? { ...d, texture_url: publicUrl } : d
      ));
      setHasChanges(true);

      toast({
        title: 'Face texture uploaded',
        description: `Face ${faceIndex + 1} texture has been set`,
      });
    } catch (err) {
      console.error('[ShwarmDesignPanel] Upload error:', err);
      toast({
        title: 'Upload failed',
        variant: 'destructive',
      });
    }
  };

  // Get rarity based on tier
  const getRarityForTier = (tier: number): string => {
    if (tier <= 2) return 'common';
    if (tier <= 4) return 'uncommon';
    if (tier <= 6) return 'rare';
    if (tier <= 8) return 'epic';
    return 'legendary';
  };

  if (isLoading) {
    return (
      <Card className={`p-6 ${className}`}>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading shwarm definitions...</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={`p-4 ${className}`}>
      <div className="grid grid-cols-12 gap-4">
        {/* Tier Selector - Left Column */}
        <div className="col-span-3">
          <div className="border rounded-lg p-3 bg-muted/30">
            <h3 className="font-semibold mb-3 text-2xl">Shwarms</h3>
            <ScrollArea className="h-[500px]">
            <div className="space-y-1 pr-2">
              {/* ALL TIERS option for global settings */}
              <Button
                variant={selectedTier === null ? 'default' : 'ghost'}
                size="sm"
                className="w-full justify-start text-xs h-auto py-1 mb-2"
                onClick={() => setSelectedTier(null)}
              >
                <span className="flex items-center gap-1">
                  <span className="font-semibold">ALL TIERS</span>
                </span>
              </Button>
              {definitions.map(def => {
                const isNew = def.id.startsWith('temp-');
                const rarity = getRarityForTier(def.tier);
                return (
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
                    <span className="flex items-center gap-2">
                      <span 
                        className="w-2 h-2 rounded-full" 
                        style={{ backgroundColor: RARITY_COLORS[rarity] }}
                      />
                      {def.min_blocks}-{def.max_blocks}
                      {isNew && <span className="text-muted-foreground">(new)</span>}
                    </span>
                  </Button>
                );
              })}
            </div>
          </ScrollArea>
          </div>
        </div>

        {/* Editor - Right Column */}
        <div className="col-span-9 flex flex-col gap-4">
          {/* ALL TIERS view: Show global Sound Settings + AI Behavior Settings */}
          {selectedTier === null ? (
            <>
              <EnemySoundSettings
                enemyType="shwarm"
                sounds={soundConfigs}
                volume={soundVolume}
                onSoundChange={handleSoundChange}
                onVolumeChange={handleVolumeChange}
              />

              {globalDef && (
                <EnemyBehaviorSettings
                  enemyType="shwarm"
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

              {/* Face Textures - 5 global animated face textures shared by all tiers */}
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3">Face Textures (shared by all tiers)</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Each shwarm block displays one of these 5 animated face textures. Upload animated GIFs or static images.
                </p>
                <div className="grid grid-cols-5 gap-3">
                  {[0, 1, 2, 3, 4].map(faceIndex => {
                    const faceDef = definitions.find(d => d.tier === faceIndex + 1);
                    const faceUrl = faceDef?.texture_url;
                    return (
                      <div key={faceIndex} className="space-y-1">
                        <Label className="text-xs">Face {faceIndex + 1}</Label>
                        <div
                          className="w-full aspect-square rounded border bg-muted/30 flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary transition-colors"
                          style={faceUrl ? {
                            backgroundImage: `url(${faceUrl})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          } : {}}
                          onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/*';
                            input.onchange = (e) => {
                              const file = (e.target as HTMLInputElement).files?.[0];
                              if (file) handleFaceTextureUpload(file, faceIndex);
                            };
                            input.click();
                          }}
                        >
                          {!faceUrl && (
                            <Upload className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {hasChanges && (
                  <Button
                    className="mt-3 w-full"
                    size="sm"
                    onClick={async () => {
                      // Save all T1-T5 definitions that hold face textures
                      setIsSaving(true);
                      try {
                        for (let t = 1; t <= 5; t++) {
                          const def = definitions.find(d => d.tier === t);
                          if (!def) continue;

                          if (def.id.startsWith('temp-')) {
                            // Insert new tier definition to persist face texture
                            const { data, error } = await supabase
                              .from('shwarm_definitions')
                              .insert({
                                tier: def.tier,
                                name: def.name,
                                texture_url: def.texture_url,
                                speed: def.speed,
                                min_blocks: def.min_blocks,
                                max_blocks: def.max_blocks,
                                health_per_block: def.health_per_block,
                                damage_per_hit: def.damage_per_hit,
                                spawn_chance_per_minute: def.spawn_chance_per_minute,
                                x_factor: def.x_factor,
                              })
                              .select()
                              .single();

                            if (error) throw error;
                            // Update local state with the real ID
                            setDefinitions(prev => prev.map(d =>
                              d.tier === t ? (data as ShwarmDefinition) : d
                            ));
                          } else {
                            await supabase
                              .from('shwarm_definitions')
                              .update({ texture_url: def.texture_url })
                              .eq('id', def.id);
                          }
                        }
                        setHasChanges(false);
                        toast({ title: 'Face textures saved' });
                      } catch {
                        toast({ title: 'Save failed', variant: 'destructive' });
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                    disabled={isSaving}
                  >
                    <Save className="h-3 w-3 mr-2" />
                    {isSaving ? 'Saving...' : 'Save Face Textures'}
                  </Button>
                )}
              </Card>
            </>
          ) : (
          <Card className="p-4 flex-1">
            {currentDef ? (
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b">
                  <div>
                    <h2 className="text-lg font-bold flex items-center gap-2">
                      <Bug className="h-5 w-5 text-destructive" />
                      Tier {selectedTier} Shwarm
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {currentDef.min_blocks}-{currentDef.max_blocks} blocks, {currentDef.health_per_block} HP each
                  </p>
                </div>
                <Button onClick={saveDef} disabled={isSaving || !hasChanges}>
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Left - Basic Info */}
                <div className="space-y-4">
                  {/* Name */}
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={currentDef.name}
                      onChange={(e) => updateDef('name', e.target.value)}
                      placeholder="Shwarm name"
                    />
                  </div>

                  {/* Speed */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs flex items-center gap-1">
                        <Zap className="h-3 w-3" />
                        Speed
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {currentDef.speed.toFixed(1)} blocks/sec
                      </span>
                    </div>
                    <Slider
                      value={[currentDef.speed]}
                      onValueChange={([v]) => updateDef('speed', v)}
                      min={1}
                      max={15}
                      step={0.5}
                    />
                  </div>

                  {/* X-Factor */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">X-Factor (randomness)</Label>
                      <span className="text-xs text-muted-foreground">
                        ±{currentDef.x_factor} variance
                      </span>
                    </div>
                    <Slider
                      value={[currentDef.x_factor]}
                      onValueChange={([v]) => updateDef('x_factor', v)}
                      min={1}
                      max={10}
                      step={1}
                    />
                    <p className="text-xs text-muted-foreground">
                      Higher = more erratic movement
                    </p>
                  </div>
                </div>

                {/* Right - Combat Stats */}
                <div className="space-y-4">
                  {/* Block Count Range */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Min Blocks</Label>
                      <Input
                        type="number"
                        value={currentDef.min_blocks}
                        onChange={(e) => updateDef('min_blocks', parseInt(e.target.value) || 10)}
                        min={5}
                        max={100}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Max Blocks</Label>
                      <Input
                        type="number"
                        value={currentDef.max_blocks}
                        onChange={(e) => updateDef('max_blocks', parseInt(e.target.value) || 20)}
                        min={10}
                        max={100}
                      />
                    </div>
                  </div>

                  {/* Health per Block */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs flex items-center gap-1">
                        <Shield className="h-3 w-3" />
                        Health per Block
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {currentDef.health_per_block} HP
                      </span>
                    </div>
                    <Slider
                      value={[currentDef.health_per_block]}
                      onValueChange={([v]) => updateDef('health_per_block', v)}
                      min={10}
                      max={500}
                      step={10}
                    />
                  </div>

                  {/* Damage per Hit */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs flex items-center gap-1">
                        <Swords className="h-3 w-3" />
                        Damage per Hit
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {currentDef.damage_per_hit} DMG
                      </span>
                    </div>
                    <Slider
                      value={[currentDef.damage_per_hit]}
                      onValueChange={([v]) => updateDef('damage_per_hit', v)}
                      min={5}
                      max={100}
                      step={5}
                    />
                  </div>

                  {/* Spawn Chance */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Spawn Chance</Label>
                      <span className="text-xs text-muted-foreground">
                        {currentDef.spawn_chance_per_minute.toFixed(2)}/min
                      </span>
                    </div>
                    <Slider
                      value={[currentDef.spawn_chance_per_minute]}
                      onValueChange={([v]) => updateDef('spawn_chance_per_minute', v)}
                      min={0}
                      max={10}
                      step={0.1}
                    />
                    <p className="text-xs text-muted-foreground">
                      Probability of this tier spawning per minute check
                    </p>
                  </div>
                </div>
              </div>

              {/* Loot Settings */}
              <div className="grid grid-cols-2 gap-6 mt-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Drop Rate</Label>
                    <span className="text-xs text-muted-foreground">
                      {(currentDef.drop_rate ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <Slider
                    value={[currentDef.drop_rate ?? 0]}
                    onValueChange={([v]) => updateDef('drop_rate', v)}
                    min={0}
                    max={100}
                    step={0.1}
                  />
                  <p className="text-xs text-muted-foreground">
                    Chance to drop loot when killed
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Drop Table</Label>
                  <Select
                    value={currentDef.drop_table_code ?? 'DT1'}
                    onValueChange={(v) => updateDef('drop_table_code', v)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select drop table" />
                    </SelectTrigger>
                    <SelectContent>
                      {dropTables.map(dt => (
                        <SelectItem key={dt.code} value={dt.code}>
                          {dt.code} - {dt.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Which loot table to roll from
                  </p>
                </div>
              </div>

              {/* Stats Summary */}
              <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                <h4 className="text-xs font-semibold mb-2">Combat Summary</h4>
                <div className="grid grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground">Total HP:</span>
                    <span className="ml-1 font-medium">
                      {currentDef.min_blocks * currentDef.health_per_block} - {currentDef.max_blocks * currentDef.health_per_block}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Knockback:</span>
                    <span className="ml-1 font-medium">{1 + selectedTier} blocks</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">DPS potential:</span>
                    <span className="ml-1 font-medium text-destructive">
                      {(currentDef.damage_per_hit * currentDef.max_blocks * 0.5).toFixed(0)}/sec
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

              {/* Spawn Test Button (placeholder for now) */}
              <div className="pt-3 border-t">
                <Button variant="outline" className="w-full" disabled>
                  <Bug className="h-4 w-4 mr-2" />
                  Spawn Test Shwarm (Coming Soon)
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">Select a tier to configure</p>
            </div>
          )}
        </Card>
          )}
      </div>
      </div>
    </Card>
  );
}
