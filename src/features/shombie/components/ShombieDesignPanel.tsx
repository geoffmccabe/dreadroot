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
import { Save } from 'lucide-react';
import { EnemySoundSettings, SoundConfig } from '@/components/EnemySoundSettings';
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
};

function getRarityForTier(tier: number): string {
  if (tier <= 2) return 'common';
  if (tier <= 4) return 'uncommon';
  if (tier <= 6) return 'rare';
  if (tier <= 8) return 'epic';
  return 'legendary';
}

export function ShombieDesignPanel({ className }: ShombieDesignPanelProps) {
  const queryClient = useQueryClient();
  const [definitions, setDefinitions] = useState<ShombieDefinition[]>([]);
  const [selectedTier, setSelectedTier] = useState(1);
  const [currentDef, setCurrentDef] = useState<ShombieDefinition | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
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

  const selectTier = (tier: number) => {
    setSelectedTier(tier);
    const def = definitions.find(d => d.tier === tier);
    setCurrentDef(def || null);
    setHasChanges(false);
  };

  const updateDef = (field: keyof ShombieDefinition, value: any) => {
    if (!currentDef) return;
    setCurrentDef({ ...currentDef, [field]: value });
    setHasChanges(true);
  };

  const saveDef = async () => {
    if (!currentDef) return;
    setIsSaving(true);

    const isNew = currentDef.id.startsWith('temp_');
    const { id, created_at, updated_at, ai_config, ...baseData } = currentDef;
    
    // Convert ai_config to JSON-safe format
    const saveData = {
      ...baseData,
      ai_config: ai_config ? JSON.parse(JSON.stringify(ai_config)) : null,
    };

    try {
      if (isNew) {
        const { error } = await supabase
          .from('shombie_definitions')
          .insert([saveData]);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('shombie_definitions')
          .update(saveData)
          .eq('id', id);
        if (error) throw error;
      }

      toast.success(`Tier ${currentDef.tier} saved!`);
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ['shombie-definitions'] });
      fetchDefinitions();
    } catch (err: any) {
      console.error('[ShombieDesign] Save error:', err);
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTextureUpload = async (file: File) => {
    if (!currentDef) return;

    const fileName = `shombie_tier${currentDef.tier}_${Date.now()}.webp`;
    
    const { error: uploadError } = await supabase.storage
      .from('block-textures')
      .upload(fileName, file, { upsert: true });

    if (uploadError) {
      toast.error('Failed to upload texture');
      return;
    }

    const { data: urlData } = supabase.storage
      .from('block-textures')
      .getPublicUrl(fileName);

    updateDef('texture_url', urlData.publicUrl);
    toast.success('Texture uploaded!');
  };

  const handleSoundChange = async (key: string, url: string | null) => {
    setSoundConfigs(prev => prev.map(s => s.key === key ? { ...s, url } : s));
    
    const updateData = key === 'ambient' 
      ? { ambient_sound_url: url }
      : { death_sound_url: url };
    
    const { error } = await supabase
      .from('enemy_sound_settings')
      .update(updateData)
      .eq('enemy_type', 'shombie');
    
    if (error) {
      toast.error('Failed to update sound');
    }
  };

  const handleVolumeChange = async (volume: number) => {
    setSoundVolume(volume);
    
    const { error } = await supabase
      .from('enemy_sound_settings')
      .update({ volume })
      .eq('enemy_type', 'shombie');
    
    if (error) {
      toast.error('Failed to update volume');
    }
  };

  return (
    <div className={`grid grid-cols-12 gap-4 ${className}`}>
      {/* Part 1: Tier Selector */}
      <div className="col-span-3">
        <div className="border rounded-lg p-3 bg-muted/30">
          <h3 className="font-semibold mb-3 text-2xl">Shombies</h3>
          <ScrollArea className="h-[500px]">
            <div className="space-y-1 pr-2">
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
                      <div className="w-4 h-4 rounded-sm bg-muted border border-border overflow-hidden flex-shrink-0">
                        {def.texture_url ? (
                          <img src={def.texture_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-green-600/50" />
                        )}
                      </div>
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
        {/* Global Sound Settings Panel */}
        <EnemySoundSettings
          enemyType="shombie"
          sounds={soundConfigs}
          volume={soundVolume}
          onSoundChange={handleSoundChange}
          onVolumeChange={handleVolumeChange}
        />
        
        {/* Tier Editor Card */}
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
                    max={500}
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
                  <Label>Spawn Rate: {currentDef.spawn_chance_per_minute.toFixed(1)}/min</Label>
                  <Slider
                    value={[currentDef.spawn_chance_per_minute]}
                    min={0.1}
                    max={5}
                    step={0.1}
                    onValueChange={([v]) => updateDef('spawn_chance_per_minute', v)}
                  />
                </div>
              </div>

              {/* Texture Upload */}
              <div className="space-y-2">
                <Label>Body Texture</Label>
                <div className="flex gap-2 items-center">
                  <div className="w-12 h-12 rounded-sm bg-muted border border-border overflow-hidden flex-shrink-0">
                    {currentDef.texture_url ? (
                      <img
                        src={currentDef.texture_url}
                        alt="Texture"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-green-600/50" />
                    )}
                  </div>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleTextureUpload(file);
                    }}
                  />
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
      </div>
    </div>
  );
}
