// Seed Design Panel - Admin UI for configuring all 30 seed tiers
// Fully isolated in the trees feature module

import React, { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Save, TreeDeciduous, Leaf } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SeedDefinition } from '../types';
import { RARITY_COLORS, DEFAULT_TIER_NAMES, TREE_CONFIG } from '../constants';
import { generateTreeBlueprint } from '../lib/treeGrowth';

interface SeedDesignPanelProps {
  className?: string;
}

export function SeedDesignPanel({ className }: SeedDesignPanelProps) {
  const [seedDefinitions, setSeedDefinitions] = useState<SeedDefinition[]>([]);
  const [selectedTier, setSelectedTier] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const { toast } = useToast();
  
  const trunkInputRef = useRef<HTMLInputElement>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);
  const fruitInputRef = useRef<HTMLInputElement>(null);

  // Current seed being edited
  const currentSeed = seedDefinitions.find(s => s.tier === selectedTier);

  // Fetch all seed definitions
  useEffect(() => {
    fetchSeedDefinitions();
  }, []);

  const fetchSeedDefinitions = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('seed_definitions')
        .select('*')
        .order('tier', { ascending: true });

      if (error) throw error;

      // Create missing tiers with defaults
      const existingTiers = new Set((data || []).map(s => s.tier));
      const allSeeds: SeedDefinition[] = [...(data || [])] as SeedDefinition[];

      for (let tier = 1; tier <= 30; tier++) {
        if (!existingTiers.has(tier)) {
          allSeeds.push({
            id: `temp-${tier}`,
            tier,
            name: DEFAULT_TIER_NAMES[tier - 1] || `Tier ${tier} Seed`,
            trunk_texture_url: null,
            branch_texture_url: null,
            fruit_texture_url: null,
            width_factor: 0.5,
            branching_factor: 0.5,
            fruiting_factor: 0.5,
            growth_factor: 0.5,
            cost: tier * 50,
            rarity: tier <= 10 ? 'common' : tier <= 18 ? 'uncommon' : tier <= 24 ? 'rare' : tier <= 28 ? 'epic' : 'legendary',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      }

      allSeeds.sort((a, b) => a.tier - b.tier);
      setSeedDefinitions(allSeeds);
    } catch (err) {
      console.error('[SeedDesignPanel] Fetch error:', err);
      toast({
        title: 'Failed to load seeds',
        description: 'Could not fetch seed definitions',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Update local state
  const updateSeed = (field: keyof SeedDefinition, value: any) => {
    setSeedDefinitions(prev => prev.map(s => 
      s.tier === selectedTier ? { ...s, [field]: value } : s
    ));
    setHasChanges(true);
  };

  // Save current seed to database
  const saveSeed = async () => {
    if (!currentSeed) return;
    
    setIsSaving(true);
    try {
      const isNew = currentSeed.id.startsWith('temp-');
      
      const seedData = {
        tier: currentSeed.tier,
        name: currentSeed.name,
        trunk_texture_url: currentSeed.trunk_texture_url,
        branch_texture_url: currentSeed.branch_texture_url,
        fruit_texture_url: currentSeed.fruit_texture_url,
        width_factor: currentSeed.width_factor,
        branching_factor: currentSeed.branching_factor,
        fruiting_factor: currentSeed.fruiting_factor,
        growth_factor: currentSeed.growth_factor,
        cost: currentSeed.cost,
        rarity: currentSeed.rarity,
      };

      if (isNew) {
        const { data, error } = await supabase
          .from('seed_definitions')
          .insert(seedData)
          .select()
          .single();

        if (error) throw error;

        setSeedDefinitions(prev => prev.map(s => 
          s.tier === selectedTier ? (data as SeedDefinition) : s
        ));
      } else {
        const { error } = await supabase
          .from('seed_definitions')
          .update(seedData)
          .eq('id', currentSeed.id);

        if (error) throw error;
      }

      setHasChanges(false);
      toast({
        title: 'Seed saved',
        description: `Tier ${selectedTier} seed has been updated`,
      });
    } catch (err) {
      console.error('[SeedDesignPanel] Save error:', err);
      toast({
        title: 'Save failed',
        description: 'Could not save seed definition',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Handle texture upload
  const handleTextureUpload = async (
    file: File,
    type: 'trunk' | 'branch' | 'fruit'
  ) => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `seed_${selectedTier}_${type}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('block-textures')
        .getPublicUrl(fileName);

      updateSeed(`${type}_texture_url` as keyof SeedDefinition, publicUrl);
      
      toast({
        title: 'Texture uploaded',
        description: `${type} texture has been set`,
      });
    } catch (err) {
      console.error('[SeedDesignPanel] Upload error:', err);
      toast({
        title: 'Upload failed',
        variant: 'destructive',
      });
    }
  };

  // Calculate preview stats
  const previewStats = currentSeed ? {
    maxHeight: currentSeed.tier * TREE_CONFIG.BLOCKS_PER_TIER_HEIGHT,
    maxBranchLength: Math.floor(currentSeed.tier * TREE_CONFIG.BLOCKS_PER_TIER_HEIGHT * currentSeed.width_factor),
    growthTime: Math.round((TREE_CONFIG.BASE_GROWTH_INTERVAL / currentSeed.growth_factor) / 1000),
    estimatedBlocks: (() => {
      const blueprint = generateTreeBlueprint(0, 0, 0, currentSeed.tier, currentSeed.width_factor, currentSeed.branching_factor, 12345);
      return blueprint.blocks.length;
    })(),
  } : null;

  if (isLoading) {
    return (
      <Card className={`p-6 ${className}`}>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading seed definitions...</p>
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
              {seedDefinitions.map(seed => {
                const isNew = seed.id.startsWith('temp-');
                return (
                  <Button
                    key={seed.tier}
                    variant={selectedTier === seed.tier ? 'default' : 'ghost'}
                    size="sm"
                    className="w-full justify-between text-xs"
                    onClick={() => setSelectedTier(seed.tier)}
                  >
                    <span className="flex items-center gap-2">
                      <TreeDeciduous className="h-3 w-3" />
                      T{seed.tier}
                    </span>
                    <span className="flex items-center gap-2">
                      <span 
                        className="w-2 h-2 rounded-full" 
                        style={{ backgroundColor: RARITY_COLORS[seed.rarity as keyof typeof RARITY_COLORS] }}
                      />
                      {seed.tier * 3}m
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
          {currentSeed ? (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b">
                <div>
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <TreeDeciduous className="h-5 w-5" />
                    Tier {selectedTier} Seed
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Max height: {selectedTier * 3} blocks
                  </p>
                </div>
                <Button onClick={saveSeed} disabled={isSaving || !hasChanges}>
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
                      value={currentSeed.name}
                      onChange={(e) => updateSeed('name', e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && hasChanges) {
                          e.preventDefault();
                          saveSeed();
                        }
                      }}
                      placeholder="Seed name"
                    />
                  </div>

                  {/* Rarity */}
                  <div className="space-y-1">
                    <Label className="text-xs">Rarity</Label>
                    <Select 
                      value={currentSeed.rarity} 
                      onValueChange={(v) => updateSeed('rarity', v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(RARITY_COLORS).map(([rarity, color]) => (
                          <SelectItem key={rarity} value={rarity}>
                            <span className="flex items-center gap-2">
                              <span 
                                className="w-3 h-3 rounded-full" 
                                style={{ backgroundColor: color }}
                              />
                              {rarity.charAt(0).toUpperCase() + rarity.slice(1)}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Cost */}
                  <div className="space-y-1">
                    <Label className="text-xs">Cost (coins)</Label>
                    <Input
                      type="number"
                      value={currentSeed.cost}
                      onChange={(e) => updateSeed('cost', parseInt(e.target.value) || 0)}
                      min={0}
                    />
                  </div>

                  {/* Textures */}
                  <div className="space-y-3 pt-2">
                    <Label className="text-xs font-semibold">Textures</Label>
                    
                    {/* Trunk Texture */}
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-10 h-10 rounded border bg-muted flex items-center justify-center overflow-hidden"
                        style={currentSeed.trunk_texture_url ? {
                          backgroundImage: `url(${currentSeed.trunk_texture_url})`,
                          backgroundSize: 'cover'
                        } : {}}
                      >
                        {!currentSeed.trunk_texture_url && <TreeDeciduous className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <input
                        ref={trunkInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleTextureUpload(e.target.files[0], 'trunk')}
                      />
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="flex-1"
                        onClick={() => trunkInputRef.current?.click()}
                      >
                        <Upload className="h-3 w-3 mr-2" />
                        Trunk
                      </Button>
                    </div>

                    {/* Leaf Texture */}
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-10 h-10 rounded border bg-muted flex items-center justify-center overflow-hidden"
                        style={currentSeed.branch_texture_url ? {
                          backgroundImage: `url(${currentSeed.branch_texture_url})`,
                          backgroundSize: 'cover'
                        } : {}}
                      >
                        {!currentSeed.branch_texture_url && <Leaf className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <input
                        ref={branchInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleTextureUpload(e.target.files[0], 'branch')}
                      />
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="flex-1"
                        onClick={() => branchInputRef.current?.click()}
                      >
                        <Upload className="h-3 w-3 mr-2" />
                        Leaf
                      </Button>
                    </div>

                    {/* Fruit Texture */}
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-10 h-10 rounded border bg-muted flex items-center justify-center overflow-hidden"
                        style={currentSeed.fruit_texture_url ? {
                          backgroundImage: `url(${currentSeed.fruit_texture_url})`,
                          backgroundSize: 'cover'
                        } : {}}
                      >
                        {!currentSeed.fruit_texture_url && <span className="text-lg">🍎</span>}
                      </div>
                      <input
                        ref={fruitInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleTextureUpload(e.target.files[0], 'fruit')}
                      />
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="flex-1"
                        onClick={() => fruitInputRef.current?.click()}
                      >
                        <Upload className="h-3 w-3 mr-2" />
                        Fruit
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Right - Sliders */}
                <div className="space-y-5">
                  {/* Width Factor */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-xs">Width Factor</Label>
                      <span className="text-xs text-muted-foreground">{currentSeed.width_factor.toFixed(1)}</span>
                    </div>
                    <Slider
                      value={[currentSeed.width_factor]}
                      onValueChange={([v]) => updateSeed('width_factor', v)}
                      min={0.1}
                      max={1}
                      step={0.1}
                    />
                    <p className="text-xs text-muted-foreground">
                      Controls how far branches extend horizontally
                    </p>
                  </div>

                  {/* Branching Factor */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-xs">Branching Factor</Label>
                      <span className="text-xs text-muted-foreground">{currentSeed.branching_factor.toFixed(1)}</span>
                    </div>
                    <Slider
                      value={[currentSeed.branching_factor]}
                      onValueChange={([v]) => updateSeed('branching_factor', v)}
                      min={0.1}
                      max={1}
                      step={0.1}
                    />
                    <p className="text-xs text-muted-foreground">
                      Controls branch density and sub-branching
                    </p>
                  </div>

                  {/* Fruiting Factor */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-xs">Fruiting Factor</Label>
                      <span className="text-xs text-muted-foreground">{currentSeed.fruiting_factor.toFixed(1)}</span>
                    </div>
                    <Slider
                      value={[currentSeed.fruiting_factor]}
                      onValueChange={([v]) => updateSeed('fruiting_factor', v)}
                      min={0.1}
                      max={1}
                      step={0.1}
                    />
                    <p className="text-xs text-muted-foreground">
                      Controls how many fruits spawn on branches
                    </p>
                  </div>

                  {/* Growth Factor */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-xs">Growth Factor</Label>
                      <span className="text-xs text-muted-foreground">{currentSeed.growth_factor.toFixed(1)}</span>
                    </div>
                    <Slider
                      value={[currentSeed.growth_factor]}
                      onValueChange={([v]) => updateSeed('growth_factor', v)}
                      min={0.1}
                      max={1}
                      step={0.1}
                    />
                    <p className="text-xs text-muted-foreground">
                      Controls growth speed (higher = faster)
                    </p>
                  </div>

                  {/* Preview Stats */}
                  {previewStats && (
                    <div className="mt-4 p-3 bg-muted rounded-lg space-y-1">
                      <h4 className="font-semibold text-xs mb-2">Preview Stats</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Max Height:</span>
                          <span className="ml-1 font-medium">{previewStats.maxHeight} blocks</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Max Branch:</span>
                          <span className="ml-1 font-medium">{previewStats.maxBranchLength} blocks</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Est. Blocks:</span>
                          <span className="ml-1 font-medium">~{previewStats.estimatedBlocks}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Growth Time:</span>
                          <span className="ml-1 font-medium">{previewStats.growthTime}s/block</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">Select a tier to edit</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
