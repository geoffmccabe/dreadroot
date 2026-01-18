// Shwarm Design Panel - Admin UI for configuring shwarm enemy tiers
// Allows setting speed, damage, health, textures, and spawn parameters

import React, { useState, useEffect, useRef } from 'react';
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
  const [selectedTier, setSelectedTier] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const { toast } = useToast();
  
  const textureInputRef = useRef<HTMLInputElement>(null);

  // Current definition being edited
  const currentDef = definitions.find(d => d.tier === selectedTier);

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

  // Save current definition to database
  const saveDef = async () => {
    if (!currentDef) return;
    
    setIsSaving(true);
    try {
      const isNew = currentDef.id.startsWith('temp-');
      
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

  // Handle texture upload
  const handleTextureUpload = async (file: File) => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `shwarm_${selectedTier}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('block-textures')
        .getPublicUrl(fileName);

      updateDef('texture_url', publicUrl);
      
      toast({
        title: 'Texture uploaded',
        description: 'Shwarm texture has been set',
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
    <div className={`grid grid-cols-12 gap-4 ${className}`}>
      {/* Tier Selector - Left Column */}
      <div className="col-span-3">
        <Card className="p-3">
          <h3 className="font-semibold mb-3 text-sm">Select Tier</h3>
          <ScrollArea className="h-[500px]">
            <div className="space-y-1 pr-2">
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
        </Card>
      </div>

      {/* Editor - Right Column */}
      <div className="col-span-9">
        <Card className="p-4">
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

                  {/* Texture */}
                  <div className="space-y-2">
                    <Label className="text-xs">Texture (optional)</Label>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-12 h-12 rounded border bg-destructive/20 flex items-center justify-center overflow-hidden"
                        style={currentDef.texture_url ? {
                          backgroundImage: `url(${currentDef.texture_url})`,
                          backgroundSize: 'cover'
                        } : {}}
                      >
                        {!currentDef.texture_url && <Bug className="h-5 w-5 text-destructive" />}
                      </div>
                      <input
                        ref={textureInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleTextureUpload(e.target.files[0])}
                      />
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="flex-1"
                        onClick={() => textureInputRef.current?.click()}
                      >
                        <Upload className="h-3 w-3 mr-2" />
                        Upload Texture
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Leave empty to use default red-tinted block
                    </p>
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
                      style={{ color: RARITY_COLORS[getRarityForTier(selectedTier)] }}
                    >
                      {getRarityForTier(selectedTier)}
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
      </div>
    </div>
  );
}
