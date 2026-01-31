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
import { Upload, Save, TreeDeciduous, Leaf, RotateCw, CircleDot } from 'lucide-react';
import { AnimatedTexturePreview } from '@/components/AnimatedTexturePreview';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { convertAnimationToStrip, needsAnimationProcessing } from '@/lib/animationToStrip';
import { rotateTexture } from '@/lib/textureRotation';
import { SeedDefinition, SymmetryMode, TreeType } from '../types';
import { RARITY_COLORS, TREE_CONFIG } from '../constants';
import { generateTreeBlueprint } from '../lib/treeGrowth';
import { PlantedTreesPanel } from './PlantedTreesPanel';

const SYMMETRY_OPTIONS: { value: SymmetryMode; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'Organic, random growth' },
  { value: '2xs', label: '2XS', description: '2-axis mirror (4 blocks)' },
  { value: '4r', label: '4R', description: '4-way radial (4 blocks)' },
  { value: '4x2', label: '4X2', description: '4-way × mirror (8 blocks)' },
];

interface SeedDesignPanelProps {
  className?: string;
  treeType: TreeType;
}

export function SeedDesignPanel({ className, treeType }: SeedDesignPanelProps) {
  const [seedDefinitions, setSeedDefinitions] = useState<SeedDefinition[]>([]);
  const [selectedTier, setSelectedTier] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const { toast } = useToast();
  
  const trunkInputRef = useRef<HTMLInputElement>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);
  const fruitInputRef = useRef<HTMLInputElement>(null);
  // Fungal texture refs
  const fungalStemInputRef = useRef<HTMLInputElement>(null);
  const fungalCapTopInputRef = useRef<HTMLInputElement>(null);
  const fungalCapUndersideInputRef = useRef<HTMLInputElement>(null);
  const [isRotating, setIsRotating] = useState<string | null>(null); // Track which texture is rotating
  const [isUpdatingExisting, setIsUpdatingExisting] = useState(false);

  // Current seed being edited
  const currentSeed = seedDefinitions.find(s => s.tier === selectedTier);

  // Max tiers per tree type
  const maxTiers = treeType === 'fungal' ? 10 : 30;

  // Fetch seed definitions filtered by tree type
  useEffect(() => {
    fetchSeedDefinitions();
  }, [treeType]);

  const fetchSeedDefinitions = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('seed_definitions')
        .select('*')
        .order('tier', { ascending: true });

      if (error) throw error;

      // Filter to matching tree type
      const matchingSeeds = ((data || []) as SeedDefinition[]).filter(
        s => (s.tree_type || 'original') === treeType
      );

      // Create missing tiers with defaults
      const existingTiers = new Set(matchingSeeds.map(s => s.tier));
      const allSeeds: SeedDefinition[] = [...matchingSeeds];

      for (let tier = 1; tier <= maxTiers; tier++) {
        if (!existingTiers.has(tier)) {
          allSeeds.push({
            id: `temp-${treeType}-${tier}`,
            tier,
            name: '',
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
            low_branch_height: 2,
            spike_chance: 0,
            spike_length: 3,
            nob_chance: 0,
            nob_size: 1,
            cross_chance: 0,
            cross_length: 3,
            shroom_chance: 0,
            shroom_length: 5,
            shroom_cap_diameter: 3,
            symmetry: 'none',
            tree_type: treeType,
            fungal_stem_texture_url: null,
            fungal_cap_top_texture_url: null,
            fungal_cap_underside_texture_url: null,
            fungal_min_height: 30,
            fungal_max_height: 60,
            fungal_min_cap_width: 40,
            fungal_max_cap_width: 100,
            fungal_stem_random: 0,
            fungal_lean_angle: 0,
            fungal_s_curve: false,
            in_bracket_menu: false,
          });
        }
      }

      allSeeds.sort((a, b) => a.tier - b.tier);
      setSeedDefinitions(allSeeds);
      setSelectedTier(1);
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

      const seedData: Record<string, any> = {
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
        low_branch_height: currentSeed.low_branch_height,
        spike_chance: currentSeed.spike_chance,
        spike_length: currentSeed.spike_length,
        nob_chance: currentSeed.nob_chance,
        nob_size: currentSeed.nob_size,
        cross_chance: currentSeed.cross_chance,
        cross_length: currentSeed.cross_length,
        shroom_chance: currentSeed.shroom_chance,
        shroom_length: currentSeed.shroom_length,
        shroom_cap_diameter: currentSeed.shroom_cap_diameter,
        symmetry: currentSeed.symmetry || 'none',
        tree_type: treeType,
        fungal_stem_texture_url: currentSeed.fungal_stem_texture_url,
        fungal_cap_top_texture_url: currentSeed.fungal_cap_top_texture_url,
        fungal_cap_underside_texture_url: currentSeed.fungal_cap_underside_texture_url,
        fungal_min_height: currentSeed.fungal_min_height,
        fungal_max_height: currentSeed.fungal_max_height,
        fungal_min_cap_width: currentSeed.fungal_min_cap_width,
        fungal_max_cap_width: currentSeed.fungal_max_cap_width,
        fungal_stem_random: currentSeed.fungal_stem_random,
        fungal_lean_angle: currentSeed.fungal_lean_angle,
        fungal_s_curve: currentSeed.fungal_s_curve,
        in_bracket_menu: currentSeed.in_bracket_menu ?? false,
      };

      let result;
      if (isNew) {
        const { data, error } = await supabase
          .from('seed_definitions')
          .insert(seedData)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        const { error } = await supabase
          .from('seed_definitions')
          .update(seedData)
          .eq('id', currentSeed.id);
        if (error) throw error;
      }

      if (isNew && result) {
        setSeedDefinitions(prev => prev.map(s =>
          s.tier === selectedTier ? (result as SeedDefinition) : s
        ));
      }

      setHasChanges(false);
      toast({
        title: 'Seed saved',
        description: `Tier ${selectedTier} seed has been updated`,
      });
    } catch (err: any) {
      console.error('[SeedDesignPanel] Save error:', err);
      const errorMsg = err?.message || err?.error?.message || JSON.stringify(err) || 'Could not save seed definition';
      toast({
        title: 'Save failed',
        description: errorMsg,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Update textures on all existing placed blocks for this fungal tier
  const updateExistingFungalTextures = async () => {
    if (!currentSeed || treeType !== 'fungal') return;

    setIsUpdatingExisting(true);
    try {
      const { data, error } = await (supabase as any).rpc('update_fungal_tree_textures', {
        p_tier: selectedTier,
        p_stem_texture_url: currentSeed.fungal_stem_texture_url || currentSeed.trunk_texture_url || null,
        p_cap_top_texture_url: currentSeed.fungal_cap_top_texture_url || currentSeed.trunk_texture_url || null,
        p_cap_underside_texture_url: currentSeed.fungal_cap_underside_texture_url || currentSeed.trunk_texture_url || null,
      });

      if (error) throw error;

      const result = data as { total_updated: number; stem_updated: number; cap_top_updated: number; cap_underside_updated: number };
      toast({
        title: 'Existing trees updated',
        description: `Updated ${result.total_updated} blocks (stem: ${result.stem_updated}, cap top: ${result.cap_top_updated}, underside: ${result.cap_underside_updated})`,
      });
    } catch (err: any) {
      console.error('[SeedDesignPanel] Update existing error:', err);
      toast({
        title: 'Update failed',
        description: err?.message || 'Could not update existing tree blocks',
        variant: 'destructive',
      });
    } finally {
      setIsUpdatingExisting(false);
    }
  };

  // Handle texture upload
  const handleTextureUpload = async (
    file: File,
    type: 'trunk' | 'branch' | 'fruit' | 'fungal_stem' | 'fungal_cap_top' | 'fungal_cap_underside'
  ) => {
    try {
      let uploadBlob: Blob = file;
      let fileName: string;

      // Check if file needs animation processing (includes animated WebP)
      const isAnimated = await needsAnimationProcessing(file);

      if (isAnimated) {
        // Convert animation (GIF/video/animated WebP) to horizontal strip
        toast({
          title: 'Converting animation',
          description: 'Converting to strip texture...',
        });

        try {
          const result = await convertAnimationToStrip(file, {
            frameSize: 256,
            maxFrames: 24,
          });

          uploadBlob = result.stripBlob;
          // Filename encodes frame count and delay for playback
          fileName = `seed_${selectedTier}_${type}_${result.frameCount}f_${result.frameDelay}ms_${Date.now()}.webp`;

          toast({
            title: 'Animation converted',
            description: `${result.originalFrameCount} frames → ${result.frameCount}-frame strip`,
          });
        } catch (err: any) {
          toast({
            title: 'Conversion failed',
            description: err.message,
            variant: 'destructive',
          });
          return;
        }
      } else {
        // Static image - upload as-is
        const fileExt = file.name.split('.').pop();
        fileName = `seed_${selectedTier}_${type}_${Date.now()}.${fileExt}`;
      }

      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(fileName, uploadBlob, { upsert: true });

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

  // Handle texture rotation
  const handleTextureRotate = async (type: 'trunk' | 'branch' | 'fruit' | 'fungal_stem' | 'fungal_cap_top' | 'fungal_cap_underside') => {
    const urlField = `${type}_texture_url` as keyof SeedDefinition;
    const currentUrl = currentSeed?.[urlField] as string | null;

    if (!currentUrl) {
      toast({
        title: 'No texture',
        description: `Upload a ${type} texture first`,
        variant: 'destructive',
      });
      return;
    }

    setIsRotating(type);

    try {
      const result = await rotateTexture(currentUrl, `seed_${selectedTier}_${type}`);

      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(result.fileName, result.blob, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('block-textures')
        .getPublicUrl(result.fileName);

      updateSeed(urlField, publicUrl);

      toast({
        title: 'Texture rotated',
        description: `${type} texture rotated 90° clockwise`,
      });
    } catch (err) {
      console.error('[SeedDesignPanel] Rotate error:', err);
      toast({
        title: 'Rotation failed',
        variant: 'destructive',
      });
    } finally {
      setIsRotating(null);
    }
  };

  // Calculate preview stats (only for original trees, not fungal)
  const previewStats = currentSeed && treeType !== 'fungal' ? {
    maxHeight: currentSeed.tier * TREE_CONFIG.BLOCKS_PER_TIER_HEIGHT,
    maxBranchLength: Math.floor(currentSeed.tier * TREE_CONFIG.BLOCKS_PER_TIER_HEIGHT * currentSeed.width_factor),
    growthTime: Math.round((TREE_CONFIG.BASE_GROWTH_INTERVAL / currentSeed.growth_factor) / 1000),
    estimatedBlocks: (() => {
        const blueprint = generateTreeBlueprint(
          0, 0, 0,
          currentSeed.tier,
          currentSeed.width_factor,
          currentSeed.branching_factor,
          12345,
          {
            lowBranchHeight: currentSeed.low_branch_height ?? 2,
            spikeChance: currentSeed.spike_chance ?? 0,
            spikeLength: currentSeed.spike_length ?? 3,
            nobChance: currentSeed.nob_chance ?? 0,
            nobSize: currentSeed.nob_size ?? 1,
            crossChance: currentSeed.cross_chance ?? 0,
            crossLength: currentSeed.cross_length ?? 3,
            shroomChance: currentSeed.shroom_chance ?? 0,
            shroomLength: currentSeed.shroom_length ?? 5,
            shroomCapDiameter: currentSeed.shroom_cap_diameter ?? 3,
            symmetry: currentSeed.symmetry ?? 'none',
          }
        );
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
    <div className={className}>
      <PlantedTreesPanel treeType={treeType} />
    <div className="grid grid-cols-12 gap-4">
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
                <div className="flex gap-2">
                  <Button onClick={saveSeed} disabled={isSaving || !hasChanges}>
                    <Save className="h-4 w-4 mr-2" />
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                  {treeType === 'fungal' && (
                    <Button
                      variant="outline"
                      onClick={updateExistingFungalTextures}
                      disabled={isUpdatingExisting || hasChanges}
                      title={hasChanges ? 'Save first before updating existing trees' : 'Update textures on all placed blocks for this tier'}
                    >
                      {isUpdatingExisting ? 'Updating...' : 'Update Existing Trees'}
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Left - Basic Info */}
                <div className="space-y-4">
                  {/* Name + Bracket Menu Toggle */}
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <div className="flex gap-2">
                      <Input
                        className="flex-1"
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
                      <Button
                        variant={currentSeed.in_bracket_menu ? "default" : "outline"}
                        size="sm"
                        className="shrink-0 text-xs px-2"
                        onClick={() => updateSeed('in_bracket_menu', !currentSeed.in_bracket_menu)}
                        title={currentSeed.in_bracket_menu ? "Remove from [ ] menu" : "Add to [ ] menu"}
                      >
                        [ ]
                      </Button>
                    </div>
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

                  {/* Symmetry (only for original trees) */}
                  {treeType !== 'fungal' && (
                    <div className="space-y-1">
                      <Label className="text-xs">Symmetry</Label>
                      <Select
                        value={currentSeed.symmetry || 'none'}
                        onValueChange={(v) => updateSeed('symmetry', v as SymmetryMode)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SYMMETRY_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              <span className="flex items-center gap-2">
                                <span className="font-medium">{opt.label}</span>
                                <span className="text-muted-foreground text-xs">- {opt.description}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

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

                  {/* Textures - Different based on tree type */}
                  <div className="space-y-3 pt-2">
                    <Label className="text-xs font-semibold">
                      {treeType === 'fungal' ? 'Fungal Textures' : 'Textures'}
                    </Label>

                    {treeType === 'fungal' ? (
                      <>
                        {/* Fungal Stem Texture */}
                        <div className="flex items-center gap-2">
                          <AnimatedTexturePreview
                            url={currentSeed.fungal_stem_texture_url}
                            size={40}
                            fallback={<CircleDot className="h-4 w-4 text-muted-foreground" />}
                          />
                          <input
                            ref={fungalStemInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => e.target.files?.[0] && handleTextureUpload(e.target.files[0], 'fungal_stem')}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => fungalStemInputRef.current?.click()}
                          >
                            <Upload className="h-3 w-3 mr-2" />
                            Stem
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTextureRotate('fungal_stem')}
                            disabled={!currentSeed.fungal_stem_texture_url || isRotating === 'fungal_stem'}
                            title="Rotate 90° clockwise"
                          >
                            <RotateCw className={`h-3 w-3 ${isRotating === 'fungal_stem' ? 'animate-spin' : ''}`} />
                          </Button>
                        </div>

                        {/* Fungal Cap Top Texture */}
                        <div className="flex items-center gap-2">
                          <AnimatedTexturePreview
                            url={currentSeed.fungal_cap_top_texture_url}
                            size={40}
                            fallback={<span className="text-lg">🔴</span>}
                          />
                          <input
                            ref={fungalCapTopInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => e.target.files?.[0] && handleTextureUpload(e.target.files[0], 'fungal_cap_top')}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => fungalCapTopInputRef.current?.click()}
                          >
                            <Upload className="h-3 w-3 mr-2" />
                            Cap Top
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTextureRotate('fungal_cap_top')}
                            disabled={!currentSeed.fungal_cap_top_texture_url || isRotating === 'fungal_cap_top'}
                            title="Rotate 90° clockwise"
                          >
                            <RotateCw className={`h-3 w-3 ${isRotating === 'fungal_cap_top' ? 'animate-spin' : ''}`} />
                          </Button>
                        </div>

                        {/* Fungal Cap Underside Texture */}
                        <div className="flex items-center gap-2">
                          <AnimatedTexturePreview
                            url={currentSeed.fungal_cap_underside_texture_url}
                            size={40}
                            fallback={<span className="text-lg">⚪</span>}
                          />
                          <input
                            ref={fungalCapUndersideInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => e.target.files?.[0] && handleTextureUpload(e.target.files[0], 'fungal_cap_underside')}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => fungalCapUndersideInputRef.current?.click()}
                          >
                            <Upload className="h-3 w-3 mr-2" />
                            Cap Underside
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTextureRotate('fungal_cap_underside')}
                            disabled={!currentSeed.fungal_cap_underside_texture_url || isRotating === 'fungal_cap_underside'}
                            title="Rotate 90° clockwise"
                          >
                            <RotateCw className={`h-3 w-3 ${isRotating === 'fungal_cap_underside' ? 'animate-spin' : ''}`} />
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Trunk Texture */}
                        <div className="flex items-center gap-2">
                          <AnimatedTexturePreview
                            url={currentSeed.trunk_texture_url}
                            size={40}
                            fallback={<TreeDeciduous className="h-4 w-4 text-muted-foreground" />}
                          />
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
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTextureRotate('trunk')}
                            disabled={!currentSeed.trunk_texture_url || isRotating === 'trunk'}
                            title="Rotate 90° clockwise"
                          >
                            <RotateCw className={`h-3 w-3 ${isRotating === 'trunk' ? 'animate-spin' : ''}`} />
                          </Button>
                        </div>

                        {/* Leaf Texture */}
                        <div className="flex items-center gap-2">
                          <AnimatedTexturePreview
                            url={currentSeed.branch_texture_url}
                            size={40}
                            fallback={<Leaf className="h-4 w-4 text-muted-foreground" />}
                          />
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
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTextureRotate('branch')}
                            disabled={!currentSeed.branch_texture_url || isRotating === 'branch'}
                            title="Rotate 90° clockwise"
                          >
                            <RotateCw className={`h-3 w-3 ${isRotating === 'branch' ? 'animate-spin' : ''}`} />
                          </Button>
                        </div>

                        {/* Fruit Texture */}
                        <div className="flex items-center gap-2">
                          <AnimatedTexturePreview
                            url={currentSeed.fruit_texture_url}
                            size={40}
                            fallback={<span className="text-lg">🍎</span>}
                          />
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
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTextureRotate('fruit')}
                            disabled={!currentSeed.fruit_texture_url || isRotating === 'fruit'}
                            title="Rotate 90° clockwise"
                          >
                            <RotateCw className={`h-3 w-3 ${isRotating === 'fruit' ? 'animate-spin' : ''}`} />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Right - Sliders (different for fungal vs original) */}
                <div className="space-y-5">
                  {treeType === 'fungal' ? (
                    <>
                      {/* Fungal Tree Settings */}
                      <h4 className="font-semibold text-xs">Size Settings</h4>

                      {/* Min Height */}
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label className="text-xs">Min Height</Label>
                          <span className="text-xs text-muted-foreground">{currentSeed.fungal_min_height ?? 30}</span>
                        </div>
                        <Slider
                          value={[currentSeed.fungal_min_height ?? 30]}
                          onValueChange={([v]) => updateSeed('fungal_min_height', v)}
                          min={10}
                          max={100}
                          step={5}
                        />
                      </div>

                      {/* Max Height */}
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label className="text-xs">Max Height</Label>
                          <span className="text-xs text-muted-foreground">{currentSeed.fungal_max_height ?? 60}</span>
                        </div>
                        <Slider
                          value={[currentSeed.fungal_max_height ?? 60]}
                          onValueChange={([v]) => updateSeed('fungal_max_height', v)}
                          min={20}
                          max={200}
                          step={5}
                        />
                      </div>

                      {/* Min Cap Width */}
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label className="text-xs">Min Cap Width</Label>
                          <span className="text-xs text-muted-foreground">{currentSeed.fungal_min_cap_width ?? 40}</span>
                        </div>
                        <Slider
                          value={[currentSeed.fungal_min_cap_width ?? 40]}
                          onValueChange={([v]) => updateSeed('fungal_min_cap_width', v)}
                          min={10}
                          max={80}
                          step={5}
                        />
                      </div>

                      {/* Max Cap Width */}
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label className="text-xs">Max Cap Width</Label>
                          <span className="text-xs text-muted-foreground">{currentSeed.fungal_max_cap_width ?? 100}</span>
                        </div>
                        <Slider
                          value={[currentSeed.fungal_max_cap_width ?? 100]}
                          onValueChange={([v]) => updateSeed('fungal_max_cap_width', v)}
                          min={20}
                          max={200}
                          step={5}
                        />
                      </div>

                      <div className="pt-4 border-t space-y-4">
                        <h4 className="font-semibold text-xs">Shape Settings</h4>

                        {/* Stem Random */}
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <Label className="text-xs">Stem Random</Label>
                            <span className="text-xs text-muted-foreground">{currentSeed.fungal_stem_random ?? 0}</span>
                          </div>
                          <Slider
                            value={[currentSeed.fungal_stem_random ?? 0]}
                            onValueChange={([v]) => updateSeed('fungal_stem_random', v)}
                            min={0}
                            max={3}
                            step={1}
                          />
                          <p className="text-xs text-muted-foreground">
                            0 = smooth, 1-3 = ribbed wall variation
                          </p>
                        </div>

                        {/* Lean Angle */}
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <Label className="text-xs">Lean Angle</Label>
                            <span className="text-xs text-muted-foreground">{currentSeed.fungal_lean_angle ?? 0}°</span>
                          </div>
                          <Slider
                            value={[currentSeed.fungal_lean_angle ?? 0]}
                            onValueChange={([v]) => updateSeed('fungal_lean_angle', v)}
                            min={0}
                            max={30}
                            step={1}
                          />
                          <p className="text-xs text-muted-foreground">
                            Degrees of lean from vertical
                          </p>
                        </div>

                        {/* S-Curve */}
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-xs">S-Curve</Label>
                            <p className="text-xs text-muted-foreground">
                              Stem bends mid-height then straightens
                            </p>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={currentSeed.fungal_s_curve ?? false}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                              currentSeed.fungal_s_curve ? 'bg-primary' : 'bg-muted-foreground/30'
                            }`}
                            onClick={() => updateSeed('fungal_s_curve', !(currentSeed.fungal_s_curve ?? false))}
                          >
                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition-transform ${
                              currentSeed.fungal_s_curve ? 'translate-x-4' : 'translate-x-0'
                            }`} />
                          </button>
                        </div>
                      </div>

                      <div className="pt-4 border-t space-y-4">
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
                      </div>

                      {/* Fungal Tree Stats */}
                      <div className="mt-4 p-3 bg-muted rounded-lg space-y-3">
                        <h4 className="font-semibold text-xs mb-2">Fungal Tree Stats (Tier {currentSeed.tier})</h4>
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Stem Diameter:</span>
                            <span className="font-medium">{11 + (Math.min(currentSeed.tier, 10) - 1) * 2} blocks</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Height Range:</span>
                            <span className="font-medium">
                              {currentSeed.fungal_min_height ?? 30} - {currentSeed.fungal_max_height ?? 60} blocks
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Cap Width Range:</span>
                            <span className="font-medium">
                              {currentSeed.fungal_min_cap_width ?? 40} - {currentSeed.fungal_max_cap_width ?? 100} blocks
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Stem Random:</span>
                            <span className="font-medium">{currentSeed.fungal_stem_random ?? 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Lean:</span>
                            <span className="font-medium">{currentSeed.fungal_lean_angle ?? 0}°</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">S-Curve:</span>
                            <span className="font-medium">{currentSeed.fungal_s_curve ? 'Yes' : 'No'}</span>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                          Fungal trees are giant hollow mushrooms with an interior spiral staircase.
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
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

                      {/* === DECORATION FACTORS === */}
                      <div className="pt-4 border-t space-y-4">
                        <h4 className="font-semibold text-xs">Decoration Factors</h4>

                        {/* Low Branch Height */}
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <Label className="text-xs">Low Branch Height</Label>
                            <span className="text-xs text-muted-foreground">{currentSeed.low_branch_height ?? 2} blocks</span>
                          </div>
                          <Slider
                            value={[currentSeed.low_branch_height ?? 2]}
                            onValueChange={([v]) => updateSeed('low_branch_height', v)}
                            min={1}
                            max={Math.max(2, Math.floor(currentSeed.tier * 3 * 0.8))}
                            step={1}
                          />
                        </div>

                        {/* Spikes */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Spikes</Label>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <span className="text-xs text-muted-foreground">Chance: {((currentSeed.spike_chance ?? 0) * 100).toFixed(0)}%</span>
                              <Slider value={[currentSeed.spike_chance ?? 0]} onValueChange={([v]) => updateSeed('spike_chance', v)} min={0} max={0.30} step={0.01} />
                            </div>
                            <div>
                              <span className="text-xs text-muted-foreground">Length: {currentSeed.spike_length ?? 3}</span>
                              <Slider value={[currentSeed.spike_length ?? 3]} onValueChange={([v]) => updateSeed('spike_length', v)} min={1} max={10} step={1} />
                            </div>
                          </div>
                        </div>

                        {/* Nobs */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Nobs</Label>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <span className="text-xs text-muted-foreground">Chance: {((currentSeed.nob_chance ?? 0) * 100).toFixed(1)}%</span>
                              <Slider value={[currentSeed.nob_chance ?? 0]} onValueChange={([v]) => updateSeed('nob_chance', v)} min={0} max={0.30} step={0.001} />
                            </div>
                            <div>
                              <span className="text-xs text-muted-foreground">Size: {currentSeed.nob_size ?? 1}x{currentSeed.nob_size ?? 1}</span>
                              <Slider value={[currentSeed.nob_size ?? 1]} onValueChange={([v]) => updateSeed('nob_size', v)} min={1} max={4} step={1} />
                            </div>
                          </div>
                        </div>

                        {/* Crosses */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Crosses</Label>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <span className="text-xs text-muted-foreground">Chance: {((currentSeed.cross_chance ?? 0) * 100).toFixed(0)}%</span>
                              <Slider value={[currentSeed.cross_chance ?? 0]} onValueChange={([v]) => updateSeed('cross_chance', v)} min={0} max={0.10} step={0.01} />
                            </div>
                            <div>
                              <span className="text-xs text-muted-foreground">Length: {currentSeed.cross_length ?? 3}</span>
                              <Slider value={[currentSeed.cross_length ?? 3]} onValueChange={([v]) => updateSeed('cross_length', v)} min={1} max={10} step={1} />
                            </div>
                          </div>
                        </div>

                        {/* Shrooms */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Shrooms</Label>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <span className="text-xs text-muted-foreground">Chance: {((currentSeed.shroom_chance ?? 0) * 100).toFixed(1)}%</span>
                              <Slider value={[currentSeed.shroom_chance ?? 0]} onValueChange={([v]) => updateSeed('shroom_chance', v)} min={0} max={0.10} step={0.001} />
                            </div>
                            <div>
                              <span className="text-xs text-muted-foreground">Length: {currentSeed.shroom_length ?? 5}</span>
                              <Slider value={[currentSeed.shroom_length ?? 5]} onValueChange={([v]) => updateSeed('shroom_length', v)} min={3} max={20} step={1} />
                            </div>
                            <div>
                              <span className="text-xs text-muted-foreground">Cap: {currentSeed.shroom_cap_diameter ?? 3}</span>
                              <Slider value={[currentSeed.shroom_cap_diameter ?? 3]} onValueChange={([v]) => updateSeed('shroom_cap_diameter', v)} min={3} max={10} step={1} />
                            </div>
                          </div>
                        </div>
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
                    </>
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
    </div>
  );
}
