import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Save, Upload, X, User } from 'lucide-react';
import { AnimatedTexturePreview } from '@/components/AnimatedTexturePreview';
import { EnemyBehaviorSettings, AIConfig } from '@/components/EnemyBehaviorSettings';
import { convertAnimationToStrip, needsAnimationProcessing } from '@/lib/animationToStrip';
import type { ShtickmanDefinition } from '../types';
import { getHeightBlocks, getHeadSizeBlocks } from '../types';

interface ShtickmanDesignPanelProps {
  className?: string;
}

function getDefaultDefinition(tier: number): Omit<ShtickmanDefinition, 'id' | 'created_at' | 'updated_at'> {
  const textureUrl = `/Bamboo_Seamless_t${tier}.webp`;
  return {
    tier,
    name: 'Shtickman',
    body_texture_url: textureUrl,
    head_texture_url: textureUrl,
    face_texture_url: null,
    roar_sound_url: null,
    throw_sound_url: null,
    death_sound_url: null,
    proximity_sound_url: '/shtickman_sound.mp3',
    speed: 1.5 + (tier - 1) * 0.05,
    health: 300 + (tier - 1) * 50,
    damage_per_hit: 0,
    knockback_received: 1.0,
    ai_config: {
      behaviors: ['wander'],
      detectionRange: 50,
    },
  };
}

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

export function ShtickmanDesignPanel({ className }: ShtickmanDesignPanelProps) {
  const queryClient = useQueryClient();
  const [definitions, setDefinitions] = useState<ShtickmanDefinition[]>([]);
  const [selectedTier, setSelectedTier] = useState<number>(1);
  const [currentDef, setCurrentDef] = useState<ShtickmanDefinition | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // File input refs
  const bodyTextureInputRef = useRef<HTMLInputElement>(null);
  const headTextureInputRef = useRef<HTMLInputElement>(null);
  const faceTextureInputRef = useRef<HTMLInputElement>(null);
  const roarSoundInputRef = useRef<HTMLInputElement>(null);
  const throwSoundInputRef = useRef<HTMLInputElement>(null);
  const deathSoundInputRef = useRef<HTMLInputElement>(null);
  const proximitySoundInputRef = useRef<HTMLInputElement>(null);

  // Fetch definitions
  useEffect(() => {
    fetchDefinitions();
  }, []);

  const fetchDefinitions = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('shtickman_definitions')
      .select('*')
      .order('tier', { ascending: true });

    if (error) {
      console.error('[ShtickmanDesign] Error fetching:', error);
      const filledDefs = createDefaultDefinitions();
      setDefinitions(filledDefs);
      setCurrentDef(filledDefs.find(d => d.tier === selectedTier) || null);
      setIsLoading(false);
      return;
    }

    // Fill missing tiers with defaults
    const existingTiers = new Set((data || []).map(d => d.tier));
    const filledDefs: ShtickmanDefinition[] = [...(data || [])] as ShtickmanDefinition[];

    for (let tier = 1; tier <= 10; tier++) {
      if (!existingTiers.has(tier)) {
        filledDefs.push({
          ...getDefaultDefinition(tier),
          id: `temp_${tier}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as ShtickmanDefinition);
      }
    }

    filledDefs.sort((a, b) => a.tier - b.tier);
    setDefinitions(filledDefs);
    setCurrentDef(filledDefs.find(d => d.tier === selectedTier) || null);
    setIsLoading(false);
  };

  const createDefaultDefinitions = (): ShtickmanDefinition[] => {
    const defs: ShtickmanDefinition[] = [];
    for (let tier = 1; tier <= 10; tier++) {
      defs.push({
        ...getDefaultDefinition(tier),
        id: `temp_${tier}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as ShtickmanDefinition);
    }
    return defs;
  };

  const selectTier = (tier: number) => {
    setSelectedTier(tier);
    const def = definitions.find(d => d.tier === tier);
    setCurrentDef(def || null);
    setHasChanges(false);
  };

  const updateDef = (field: keyof ShtickmanDefinition, value: any) => {
    if (!currentDef) return;
    const updatedDef = { ...currentDef, [field]: value };
    setCurrentDef(updatedDef);
    setDefinitions(prev => prev.map(d => d.tier === currentDef.tier ? updatedDef : d));
    setHasChanges(true);
  };

  const updateAiConfig = (config: AIConfig) => {
    if (!currentDef) return;
    const updatedDef = { ...currentDef, ai_config: config };
    setCurrentDef(updatedDef);
    setDefinitions(prev => prev.map(d => d.tier === currentDef.tier ? updatedDef : d));
    setHasChanges(true);
  };

  const handleTextureUpload = async (field: 'body_texture_url' | 'head_texture_url' | 'face_texture_url', file: File) => {
    if (!currentDef) return;

    setIsUploading(field);

    try {
      let fileToUpload = file;
      let fileName = file.name;

      if (needsAnimationProcessing(file)) {
        toast.info('Processing animated file...');
        const stripResult = await convertAnimationToStrip(file);
        fileToUpload = stripResult.file;
        fileName = stripResult.fileName;
      }

      const timestamp = Date.now();
      const ext = fileName.split('.').pop() || 'webp';
      const filePath = `shtickman/t${currentDef.tier}/${field.replace('_url', '')}_${timestamp}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(filePath, fileToUpload, {
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('block-textures')
        .getPublicUrl(filePath);

      updateDef(field, publicUrl);
      toast.success('Texture uploaded');
    } catch (err) {
      console.error('[ShtickmanDesign] Upload error:', err);
      toast.error('Failed to upload texture');
    } finally {
      setIsUploading(null);
    }
  };

  const handleSoundUpload = async (field: 'roar_sound_url' | 'throw_sound_url' | 'death_sound_url' | 'proximity_sound_url', file: File) => {
    if (!currentDef) return;

    setIsUploading(field);

    try {
      const timestamp = Date.now();
      const ext = file.name.split('.').pop() || 'mp3';
      const soundType = field.replace('_sound_url', '');
      const filePath = `shtickman/t${currentDef.tier}/${soundType}_${timestamp}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('block-textures')
        .getPublicUrl(filePath);

      updateDef(field, publicUrl);
      toast.success('Sound uploaded');
    } catch (err) {
      console.error('[ShtickmanDesign] Sound upload error:', err);
      toast.error('Failed to upload sound');
    } finally {
      setIsUploading(null);
    }
  };

  const saveDef = async () => {
    if (!currentDef) return;

    setIsSaving(true);

    const isNew = currentDef.id.startsWith('temp_');
    const { id, created_at, updated_at, ai_config, ...baseData } = currentDef;

    const saveData = {
      ...baseData,
      ai_config: ai_config ? JSON.parse(JSON.stringify(ai_config)) : null,
    };

    try {
      if (isNew) {
        const { data, error } = await supabase
          .from('shtickman_definitions')
          .upsert(saveData, { onConflict: 'tier' })
          .select()
          .single();

        if (error) throw error;

        setDefinitions(prev => prev.map(d =>
          d.tier === currentDef.tier ? (data as ShtickmanDefinition) : d
        ));
        setCurrentDef(data as ShtickmanDefinition);
      } else {
        const { data, error } = await supabase
          .from('shtickman_definitions')
          .update(saveData)
          .eq('id', id)
          .select()
          .single();

        if (error) throw error;

        setDefinitions(prev => prev.map(d =>
          d.tier === currentDef.tier ? (data as ShtickmanDefinition) : d
        ));
        setCurrentDef(data as ShtickmanDefinition);
      }

      queryClient.invalidateQueries({ queryKey: ['shtickman-definitions'] });
      setHasChanges(false);
      toast.success('Shtickman saved');
    } catch (err: any) {
      console.error('[ShtickmanDesign] Save error:', err);
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const clearTexture = (field: 'body_texture_url' | 'head_texture_url' | 'face_texture_url') => {
    updateDef(field, null);
  };

  const clearSound = (field: 'roar_sound_url' | 'throw_sound_url' | 'death_sound_url' | 'proximity_sound_url') => {
    updateDef(field, null);
  };

  if (isLoading) {
    return (
      <Card className={`p-6 ${className}`}>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading shtickman definitions...</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={`p-4 ${className || ''}`}>
      <div className="grid grid-cols-12 gap-4">
        {/* Tier Selector - Left Column */}
        <div className="col-span-3">
          <div className="border rounded-lg p-3 bg-muted/30">
            <h3 className="font-semibold mb-3 text-2xl">Shtickmen</h3>
            <ScrollArea className="h-[500px]">
              <div className="space-y-1 pr-2">
                {definitions.map(def => {
                  const isNew = def.id.startsWith('temp_');
                  const rarity = getRarityForTier(def.tier);
                  return (
                    <Button
                      key={def.tier}
                      variant={selectedTier === def.tier ? 'default' : 'ghost'}
                      size="sm"
                      className="w-full justify-between text-xs"
                      onClick={() => selectTier(def.tier)}
                    >
                      <span className="flex items-center gap-2">
                        <User className="h-3 w-3" />
                        T{def.tier}
                      </span>
                      <span className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: RARITY_COLORS[rarity] }}
                        />
                        {getHeightBlocks(def.tier)}m
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
        <div className="col-span-9">
          {currentDef && (
            <ScrollArea className="h-[540px] pr-4">
              <div className="space-y-4">
                {/* Header with Save */}
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold">Tier {currentDef.tier} - {getRarityForTier(currentDef.tier)}</h4>
                    <p className="text-sm text-muted-foreground">
                      Height: {getHeightBlocks(currentDef.tier)}m
                    </p>
                  </div>
                  {hasChanges && (
                    <Button onClick={saveDef} disabled={isSaving} size="sm">
                      <Save className="w-4 h-4 mr-2" />
                      {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                  )}
                </div>

                {/* Name */}
                <div>
                  <Label>Name</Label>
                  <Input
                    value={currentDef.name}
                    onChange={(e) => updateDef('name', e.target.value)}
                  />
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Speed: {currentDef.speed.toFixed(2)}</Label>
                    <Slider
                      value={[currentDef.speed]}
                      onValueChange={([v]) => updateDef('speed', v)}
                      min={0.5}
                      max={5}
                      step={0.05}
                    />
                  </div>
                  <div>
                    <Label>Health: {currentDef.health}</Label>
                    <Slider
                      value={[currentDef.health]}
                      onValueChange={([v]) => updateDef('health', v)}
                      min={100}
                      max={2000}
                      step={50}
                    />
                  </div>
                  <div>
                    <Label>Knockback Received: {currentDef.knockback_received.toFixed(1)}</Label>
                    <Slider
                      value={[currentDef.knockback_received]}
                      onValueChange={([v]) => updateDef('knockback_received', v)}
                      min={0}
                      max={5}
                      step={0.1}
                    />
                  </div>
                  <div>
                    <Label>Damage Per Hit: {currentDef.damage_per_hit}</Label>
                    <Slider
                      value={[currentDef.damage_per_hit]}
                      onValueChange={([v]) => updateDef('damage_per_hit', v)}
                      min={0}
                      max={100}
                      step={5}
                    />
                  </div>
                </div>

                {/* Textures Section */}
                <div className="border-t pt-4 mt-4">
                  <h4 className="font-semibold mb-3">Textures</h4>
                  <div className="grid grid-cols-3 gap-4">
                    {/* Body Texture */}
                    <div>
                      <Label>Body</Label>
                      <div className="flex items-center gap-2 mt-1">
                        {currentDef.body_texture_url ? (
                          <>
                            <AnimatedTexturePreview url={currentDef.body_texture_url} size={48} />
                            <Button size="sm" variant="ghost" onClick={() => clearTexture('body_texture_url')}>
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => bodyTextureInputRef.current?.click()}
                            disabled={isUploading === 'body_texture_url'}
                          >
                            <Upload className="w-4 h-4 mr-1" />
                            {isUploading === 'body_texture_url' ? '...' : 'Upload'}
                          </Button>
                        )}
                        <input
                          ref={bodyTextureInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleTextureUpload('body_texture_url', e.target.files[0])}
                        />
                      </div>
                    </div>

                    {/* Head Texture */}
                    <div>
                      <Label>Head</Label>
                      <div className="flex items-center gap-2 mt-1">
                        {currentDef.head_texture_url ? (
                          <>
                            <AnimatedTexturePreview url={currentDef.head_texture_url} size={48} />
                            <Button size="sm" variant="ghost" onClick={() => clearTexture('head_texture_url')}>
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => headTextureInputRef.current?.click()}
                            disabled={isUploading === 'head_texture_url'}
                          >
                            <Upload className="w-4 h-4 mr-1" />
                            {isUploading === 'head_texture_url' ? '...' : 'Upload'}
                          </Button>
                        )}
                        <input
                          ref={headTextureInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleTextureUpload('head_texture_url', e.target.files[0])}
                        />
                      </div>
                    </div>

                    {/* Face Texture */}
                    <div>
                      <Label>Face (animated)</Label>
                      <div className="flex items-center gap-2 mt-1">
                        {currentDef.face_texture_url ? (
                          <>
                            <AnimatedTexturePreview url={currentDef.face_texture_url} size={48} />
                            <Button size="sm" variant="ghost" onClick={() => clearTexture('face_texture_url')}>
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => faceTextureInputRef.current?.click()}
                            disabled={isUploading === 'face_texture_url'}
                          >
                            <Upload className="w-4 h-4 mr-1" />
                            {isUploading === 'face_texture_url' ? '...' : 'Upload'}
                          </Button>
                        )}
                        <input
                          ref={faceTextureInputRef}
                          type="file"
                          accept="image/*,video/*"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleTextureUpload('face_texture_url', e.target.files[0])}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sounds Section */}
                <div className="border-t pt-4 mt-4">
                  <h4 className="font-semibold mb-3">Sounds</h4>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Roar Sound */}
                    <div>
                      <Label>Roar</Label>
                      <div className="flex items-center gap-2 mt-1">
                        {currentDef.roar_sound_url ? (
                          <>
                            <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                              {currentDef.roar_sound_url.split('/').pop()}
                            </span>
                            <Button size="sm" variant="ghost" onClick={() => clearSound('roar_sound_url')}>
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => roarSoundInputRef.current?.click()}
                            disabled={isUploading === 'roar_sound_url'}
                          >
                            <Upload className="w-4 h-4 mr-1" />
                            {isUploading === 'roar_sound_url' ? '...' : 'Upload'}
                          </Button>
                        )}
                        <input
                          ref={roarSoundInputRef}
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleSoundUpload('roar_sound_url', e.target.files[0])}
                        />
                      </div>
                    </div>

                    {/* Throw Sound */}
                    <div>
                      <Label>Throw</Label>
                      <div className="flex items-center gap-2 mt-1">
                        {currentDef.throw_sound_url ? (
                          <>
                            <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                              {currentDef.throw_sound_url.split('/').pop()}
                            </span>
                            <Button size="sm" variant="ghost" onClick={() => clearSound('throw_sound_url')}>
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => throwSoundInputRef.current?.click()}
                            disabled={isUploading === 'throw_sound_url'}
                          >
                            <Upload className="w-4 h-4 mr-1" />
                            {isUploading === 'throw_sound_url' ? '...' : 'Upload'}
                          </Button>
                        )}
                        <input
                          ref={throwSoundInputRef}
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleSoundUpload('throw_sound_url', e.target.files[0])}
                        />
                      </div>
                    </div>

                    {/* Death Sound */}
                    <div>
                      <Label>Death</Label>
                      <div className="flex items-center gap-2 mt-1">
                        {currentDef.death_sound_url ? (
                          <>
                            <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                              {currentDef.death_sound_url.split('/').pop()}
                            </span>
                            <Button size="sm" variant="ghost" onClick={() => clearSound('death_sound_url')}>
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deathSoundInputRef.current?.click()}
                            disabled={isUploading === 'death_sound_url'}
                          >
                            <Upload className="w-4 h-4 mr-1" />
                            {isUploading === 'death_sound_url' ? '...' : 'Upload'}
                          </Button>
                        )}
                        <input
                          ref={deathSoundInputRef}
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleSoundUpload('death_sound_url', e.target.files[0])}
                        />
                      </div>
                    </div>

                    {/* Proximity Sound */}
                    <div>
                      <Label>Proximity</Label>
                      <div className="flex items-center gap-2 mt-1">
                        {currentDef.proximity_sound_url ? (
                          <>
                            <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                              {currentDef.proximity_sound_url.split('/').pop()}
                            </span>
                            <Button size="sm" variant="ghost" onClick={() => clearSound('proximity_sound_url')}>
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-muted-foreground">(default)</span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => proximitySoundInputRef.current?.click()}
                              disabled={isUploading === 'proximity_sound_url'}
                            >
                              <Upload className="w-4 h-4 mr-1" />
                              {isUploading === 'proximity_sound_url' ? '...' : 'Custom'}
                            </Button>
                          </>
                        )}
                        <input
                          ref={proximitySoundInputRef}
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleSoundUpload('proximity_sound_url', e.target.files[0])}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* AI Behavior */}
                <div className="border-t pt-4 mt-4">
                  <EnemyBehaviorSettings
                    aiConfig={currentDef.ai_config || {}}
                    onConfigChange={updateAiConfig}
                  />
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </Card>
  );
}
