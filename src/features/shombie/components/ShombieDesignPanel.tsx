import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
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

export function ShombieDesignPanel({ className }: ShombieDesignPanelProps) {
  const queryClient = useQueryClient();
  const [definitions, setDefinitions] = useState<ShombieDefinition[]>([]);
  const [selectedTier, setSelectedTier] = useState(1);
  const [currentDef, setCurrentDef] = useState<ShombieDefinition | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch definitions
  useEffect(() => {
    fetchDefinitions();
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

  if (!currentDef) {
    return <div className={className}>Loading...</div>;
  }

  return (
    <div className={`flex gap-4 ${className}`}>
      {/* Tier Selector */}
      <div className="w-24 flex flex-col gap-1">
        <Label className="text-xs mb-1">Tier</Label>
        <ScrollArea className="h-[400px]">
          {definitions.map((def) => (
            <Button
              key={def.tier}
              variant={selectedTier === def.tier ? 'default' : 'outline'}
              size="sm"
              className="w-full mb-1 justify-start"
              onClick={() => selectTier(def.tier)}
            >
              <span className="w-4 h-4 rounded-full bg-green-600 mr-2" />
              T{def.tier}
            </Button>
          ))}
        </ScrollArea>
      </div>

      {/* Editor */}
      <div className="flex-1 space-y-4">
        <h3 className="text-2xl font-bold">Shombie Design</h3>

        {/* Name */}
        <div>
          <Label>Name</Label>
          <Input
            value={currentDef.name}
            onChange={(e) => updateDef('name', e.target.value)}
          />
        </div>

        {/* Texture */}
        <div>
          <Label>Texture</Label>
          <div className="flex gap-2 items-center">
            {currentDef.texture_url && (
              <img
                src={currentDef.texture_url}
                alt="Texture"
                className="w-12 h-12 object-cover border rounded"
              />
            )}
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

        {/* Speed */}
        <div>
          <Label>Speed: {currentDef.speed.toFixed(1)} blocks/s</Label>
          <Slider
            value={[currentDef.speed]}
            min={0.5}
            max={6}
            step={0.1}
            onValueChange={([v]) => updateDef('speed', v)}
          />
        </div>

        {/* Health */}
        <div>
          <Label>Health: {currentDef.health}</Label>
          <Slider
            value={[currentDef.health]}
            min={10}
            max={500}
            step={10}
            onValueChange={([v]) => updateDef('health', v)}
          />
        </div>

        {/* Damage */}
        <div>
          <Label>Damage per Hit: {currentDef.damage_per_hit}</Label>
          <Slider
            value={[currentDef.damage_per_hit]}
            min={1}
            max={50}
            step={1}
            onValueChange={([v]) => updateDef('damage_per_hit', v)}
          />
        </div>

        {/* Knockback Received */}
        <div>
          <Label>Knockback Received: {currentDef.knockback_received.toFixed(1)}</Label>
          <Slider
            value={[currentDef.knockback_received]}
            min={0.5}
            max={10}
            step={0.5}
            onValueChange={([v]) => updateDef('knockback_received', v)}
          />
        </div>

        {/* Spawn Rate */}
        <div>
          <Label>Spawn Rate: {currentDef.spawn_chance_per_minute.toFixed(1)}/min per chunk</Label>
          <Slider
            value={[currentDef.spawn_chance_per_minute]}
            min={0.1}
            max={5}
            step={0.1}
            onValueChange={([v]) => updateDef('spawn_chance_per_minute', v)}
          />
        </div>

        {/* Save Button */}
        <Button
          onClick={saveDef}
          disabled={!hasChanges || isSaving}
          className="w-full"
        >
          {isSaving ? 'Saving...' : hasChanges ? 'Save Changes' : 'No Changes'}
        </Button>
      </div>
    </div>
  );
}
