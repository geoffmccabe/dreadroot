// Flame & Nebula Effects Admin Panel - Demo and adjust effects in real-time
// Uses FlameDemoSpawner (R3F bridge) to spawn effects in the game world

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useAdminPanel } from '@/contexts/AdminPanelContext';
import { useBulletDefinitions } from '@/contexts/BulletDefinitionsContext';
import { useFlamethrowerTiers } from '@/contexts/FlamethrowerTiersContext';
import { FLAME_PRESETS, type FlameEffectPreset, type FlameColorMode } from './fortress/flameEffectPresets';
import { getDefaultEditorParams, buildNebulaPreset } from '@/features/particles/presets';
import { captureEffect, getAllCapturedEffects } from '@/features/particles/nebulaEffectRegistry';
import {
  NEBULA_EFFECT_IDS,
  NEBULA_EFFECT_CODES,
  NEBULA_EFFECT_NAMES,
  type NebulaEffectId,
  type NebulaEditorParams,
  type CapturedNebulaEffect,
} from '@/features/particles/types';
import { toast } from 'sonner';

const COLOR_MODES: FlameColorMode[] = ['static', 'rainbow', 'black'];

const SPRITE_INFO = [
  { label: 'Glow', size: '512x512', tiles: '1x1' },
  { label: 'Smoke', size: '512x512', tiles: '2x2' },
  { label: 'Embers', size: '256x256', tiles: '1x1' },
  { label: 'Main Flame', size: '2048x2048', tiles: '3x6' },
];

const FADE_EASINGS = ['easeOutQuart', 'easeOutCubic', 'easeLinear', 'easeOutQuad', 'easeInOutSine'];

type PanelMode = 'flame-effects' | 'flamethrower-sprites' | 'nebula-effects';

export function FlameEffectsPanel() {
  const { flameDemoRef } = useAdminPanel();
  const { getDefinition } = useBulletDefinitions();
  const ftTiers = useFlamethrowerTiers();

  const [panelMode, setPanelMode] = useState<PanelMode>('flame-effects');

  // --- Flame Effects state ---
  const [selectedPresetId, setSelectedPresetId] = useState<string>(FLAME_PRESETS[0].id);
  const [selectedTier, setSelectedTier] = useState<number | null>(null);
  const [size, setSize] = useState(FLAME_PRESETS[0].defaults.size);
  const [height, setHeight] = useState(FLAME_PRESETS[0].defaults.height);
  const [duration, setDuration] = useState(FLAME_PRESETS[0].defaults.duration);
  const [particleCount, setParticleCount] = useState(FLAME_PRESETS[0].defaults.particleCount);
  const [colors, setColors] = useState<string[]>([...FLAME_PRESETS[0].defaults.colors]);
  const [colorMode, setColorMode] = useState<FlameColorMode>(FLAME_PRESETS[0].defaults.colorMode || 'static');

  const selectedPreset = FLAME_PRESETS.find(p => p.id === selectedPresetId)!;

  // --- Flamethrower state ---
  const [ftSelectedTier, setFtSelectedTier] = useState<number>(1);
  const [ftWidth, setFtWidth] = useState(1.0);
  const [ftDistance, setFtDistance] = useState(4.0);
  const [ftSpeed, setFtSpeed] = useState(21.6);
  const [ftParticles, setFtParticles] = useState(80);
  const [ftTransparency, setFtTransparency] = useState(1.0);
  const [ftColor1, setFtColor1] = useState('#FFFFFF');
  const [ftColor2, setFtColor2] = useState('#00FFFF');
  const [ftColor3, setFtColor3] = useState('#0044FF');
  const [ftFireOpacity, setFtFireOpacity] = useState(1.0);
  const [ftSmokeOpacity, setFtSmokeOpacity] = useState(1.0);
  const [spriteDataUrls, setSpriteDataUrls] = useState<string[]>([]);
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null, null]);

  // --- Nebula Effects state ---
  const [nebulaParams, setNebulaParams] = useState<NebulaEditorParams>(() => getDefaultEditorParams('fire'));
  const [capturedEffects, setCapturedEffects] = useState<CapturedNebulaEffect[]>([]);

  const updateNebulaParam = useCallback(<K extends keyof NebulaEditorParams>(key: K, value: NebulaEditorParams[K]) => {
    setNebulaParams(prev => ({ ...prev, [key]: value }));
  }, []);

  // Load sprites from flamethrower.json on mount
  useEffect(() => {
    fetch('/flamethrower.json')
      .then(r => r.json())
      .then(json => {
        if (json.images) {
          setSpriteDataUrls(json.images.map((img: any) => img.url));
        }
      })
      .catch(err => console.error('[FlameEffectsPanel] Failed to load flamethrower.json:', err));
  }, []);

  // Load flamethrower tier settings when tier changes
  useEffect(() => {
    const def = ftTiers.getDefinition(ftSelectedTier);
    setFtWidth(def.width);
    setFtDistance(def.distance);
    setFtSpeed(def.speed);
    setFtParticles(def.particles);
    setFtTransparency(def.transparency);
    setFtColor1(def.color1);
    setFtColor2(def.color2);
    setFtColor3(def.color3);
    setFtFireOpacity(def.fireOpacity);
    setFtSmokeOpacity(def.smokeOpacity);
  }, [ftSelectedTier, ftTiers]);

  // --- Flame Effects callbacks ---
  const selectPreset = useCallback((preset: FlameEffectPreset) => {
    setPanelMode('flame-effects');
    setSelectedPresetId(preset.id);
    setSize(preset.defaults.size);
    setHeight(preset.defaults.height);
    setDuration(preset.defaults.duration);
    setParticleCount(preset.defaults.particleCount);
    setColors([...preset.defaults.colors]);
    setColorMode(preset.defaults.colorMode || 'static');
    setSelectedTier(null);
  }, []);

  const selectTier = useCallback((tier: number) => {
    setSelectedTier(tier);
    const def = getDefinition(tier);
    if (def.colors.length > 0) {
      const c = [...def.colors];
      while (c.length < 3) c.push(c[c.length - 1] || '#FFFFFF');
      setColors(c.slice(0, 3));
    }
  }, [getDefinition]);

  const updateColor = useCallback((index: number, value: string) => {
    setColors(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const spawnDemo = useCallback(() => {
    const demo = flameDemoRef.current;
    if (!demo) return;
    demo.spawnDemo({
      system: selectedPreset.system,
      type: selectedPreset.type,
      colors,
      size,
      height,
      duration,
      particleCount,
      colorMode: selectedPreset.system === 'ufr' ? colorMode : undefined,
    });
  }, [flameDemoRef, selectedPreset, colors, size, height, duration, particleCount, colorMode]);

  // --- Flamethrower callbacks ---
  const saveFtTier = useCallback(() => {
    ftTiers.updateDefinition(ftSelectedTier, {
      tier: ftSelectedTier,
      width: ftWidth,
      distance: ftDistance,
      speed: ftSpeed,
      particles: ftParticles,
      transparency: ftTransparency,
      color1: ftColor1,
      color2: ftColor2,
      color3: ftColor3,
      fireOpacity: ftFireOpacity,
      smokeOpacity: ftSmokeOpacity,
    });
    ftTiers.saveAllToDatabase();
  }, [ftTiers, ftSelectedTier, ftWidth, ftDistance, ftSpeed, ftParticles, ftTransparency, ftColor1, ftColor2, ftColor3, ftFireOpacity, ftSmokeOpacity]);

  const handleSpriteUpload = useCallback(async (index: number, file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const base64Url = reader.result as string;
      setSpriteDataUrls(prev => {
        const next = [...prev];
        next[index] = base64Url;
        return next;
      });
      try {
        const resp = await fetch('/api/flamethrower-sprite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageIndex: index, base64Url }),
        });
        if (resp.ok) {
          toast.success(`Updated ${SPRITE_INFO[index].label} sprite`);
        } else {
          const err = await resp.json();
          toast.error(`Failed to save sprite: ${err.error}`);
        }
      } catch (err) {
        toast.error('Failed to save sprite to disk');
      }
    };
    reader.readAsDataURL(file);
  }, []);

  // --- Nebula Effects callbacks ---
  const selectNebulaEffect = useCallback((effectId: NebulaEffectId) => {
    setPanelMode('nebula-effects');
    setNebulaParams(getDefaultEditorParams(effectId));
  }, []);

  const spawnNebulaDemo = useCallback(() => {
    const demo = flameDemoRef.current;
    if (!demo) return;
    const preset = buildNebulaPreset(nebulaParams);
    demo.spawnDemo({
      system: 'nebula',
      type: nebulaParams.effectId,
      nebulaPreset: preset,
      colors: [nebulaParams.colorA, nebulaParams.colorB],
      size: nebulaParams.scale,
      height: 1,
      duration: 5,
      particleCount: nebulaParams.preParticles,
    });
  }, [flameDemoRef, nebulaParams]);

  const captureNebulaEffect = useCallback(() => {
    const code = captureEffect(nebulaParams.effectId, nebulaParams);
    setCapturedEffects(getAllCapturedEffects());
    toast.success(`Captured ${code}`);
  }, [nebulaParams]);

  const loadCapturedEffect = useCallback((captured: CapturedNebulaEffect) => {
    setPanelMode('nebula-effects');
    setNebulaParams({ ...captured.params });
  }, []);

  // --- Auto-spawn effect in game world on param changes (debounced) ---
  const autoSpawnRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (autoSpawnRef.current) clearTimeout(autoSpawnRef.current);

    // Clear any running demo when switching to a mode without auto-spawn
    if (panelMode === 'flamethrower-sprites') {
      flameDemoRef.current?.clearDemo();
      return;
    }

    autoSpawnRef.current = setTimeout(() => {
      const demo = flameDemoRef.current;
      if (!demo) return;

      if (panelMode === 'nebula-effects') {
        const preset = buildNebulaPreset(nebulaParams);
        demo.spawnDemo({
          system: 'nebula',
          type: nebulaParams.effectId,
          nebulaPreset: preset,
          colors: [nebulaParams.colorA, nebulaParams.colorB],
          size: nebulaParams.scale,
          height: 1,
          duration: 5,
          particleCount: nebulaParams.preParticles,
        });
      } else if (panelMode === 'flame-effects') {
        demo.spawnDemo({
          system: selectedPreset.system,
          type: selectedPreset.type,
          colors,
          size,
          height,
          duration,
          particleCount,
          colorMode: selectedPreset.system === 'ufr' ? colorMode : undefined,
        });
      }
    }, 400);

    return () => {
      if (autoSpawnRef.current) clearTimeout(autoSpawnRef.current);
    };
  }, [
    panelMode, flameDemoRef,
    nebulaParams,
    selectedPreset, colors, size, height, duration, particleCount, colorMode,
  ]);

  // Stop repeating demos when panel unmounts (admin panel closes)
  useEffect(() => {
    return () => {
      flameDemoRef.current?.clearDemo();
    };
  }, [flameDemoRef]);

  // --- Render ---
  const eid = nebulaParams.effectId;

  return (
    <div className="space-y-3">
      {/* Captured effects cards */}
      {capturedEffects.length > 0 && (
        <div className="border rounded-lg p-3 bg-muted/30">
          <h4 className="text-xs font-semibold text-muted-foreground mb-2">Captured Effects</h4>
          <div className="grid grid-cols-5 gap-2">
            {capturedEffects.map(cap => (
              <button
                key={cap.code}
                className={`border rounded-md p-2 text-center text-xs font-mono cursor-pointer transition-colors ${
                  panelMode === 'nebula-effects' && nebulaParams.effectId === cap.effectId
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted/50 hover:bg-muted border-border'
                }`}
                onClick={() => loadCapturedEffect(cap)}
              >
                <div className="font-semibold">{cap.code}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{NEBULA_EFFECT_NAMES[cap.effectId]}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
      {/* Left: Effect preset selector */}
      <div className="col-span-3">
        <div className="border rounded-lg p-3 bg-muted/30">
          <h3 className="font-semibold mb-3 text-lg">Effects</h3>

          <h4 className="text-xs font-semibold text-muted-foreground mb-2">Volumetric (TPF)</h4>
          <div className="space-y-1 mb-3">
            {FLAME_PRESETS.filter(p => p.system === 'tpf').map(preset => (
              <Button
                key={preset.id}
                variant={panelMode === 'flame-effects' && selectedPresetId === preset.id ? 'default' : 'ghost'}
                size="sm"
                className="w-full justify-start text-xs h-auto py-1.5"
                onClick={() => selectPreset(preset)}
              >
                {preset.name}
              </Button>
            ))}
          </div>

          <h4 className="text-xs font-semibold text-muted-foreground mb-2">Sprite (UFR)</h4>
          <div className="space-y-1 mb-3">
            {FLAME_PRESETS.filter(p => p.system === 'ufr').map(preset => (
              <Button
                key={preset.id}
                variant={panelMode === 'flame-effects' && selectedPresetId === preset.id ? 'default' : 'ghost'}
                size="sm"
                className="w-full justify-start text-xs h-auto py-1.5"
                onClick={() => selectPreset(preset)}
              >
                {preset.name}
              </Button>
            ))}
          </div>

          <h4 className="text-xs font-semibold text-muted-foreground mb-2">Flamethrower</h4>
          <div className="space-y-1 mb-3">
            <Button
              variant={panelMode === 'flamethrower-sprites' ? 'default' : 'ghost'}
              size="sm"
              className="w-full justify-start text-xs h-auto py-1.5"
              onClick={() => setPanelMode('flamethrower-sprites')}
            >
              Sprites
            </Button>
          </div>

          <h4 className="text-xs font-semibold text-muted-foreground mb-2">Nebula (GPU)</h4>
          <div className="space-y-1">
            {NEBULA_EFFECT_IDS.map(id => (
              <Button
                key={id}
                variant={panelMode === 'nebula-effects' && nebulaParams.effectId === id ? 'default' : 'ghost'}
                size="sm"
                className="w-full justify-start text-xs h-auto py-1.5"
                onClick={() => selectNebulaEffect(id)}
              >
                {NEBULA_EFFECT_NAMES[id]} ({NEBULA_EFFECT_CODES[id]})
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Editor */}
      <div className="col-span-9">
        {panelMode === 'flame-effects' ? (
          <Card className="p-4">
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b">
                <div>
                  <h3 className="font-semibold">{selectedPreset.name}</h3>
                  <span className="text-xs text-muted-foreground">
                    System: {selectedPreset.system === 'tpf' ? 'three-particle-fire' : 'UniversalFlameRenderer'}
                  </span>
                </div>
                <Button onClick={spawnDemo}>
                  Spawn Demo
                </Button>
              </div>

              {/* Tier selector */}
              <div>
                <Label className="text-xs font-semibold">Tier Colors</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(tier => (
                    <Button
                      key={tier}
                      variant={selectedTier === tier ? 'default' : 'outline'}
                      size="sm"
                      className="w-8 h-8 p-0 text-xs"
                      onClick={() => selectTier(tier)}
                    >
                      {tier}
                    </Button>
                  ))}
                  <Button
                    variant={selectedTier === null ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => {
                      setSelectedTier(null);
                      setColors([...selectedPreset.defaults.colors]);
                    }}
                  >
                    Custom
                  </Button>
                </div>
              </div>

              {/* Parameters */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Size: {size.toFixed(2)}</Label>
                  <Slider value={[size]} onValueChange={([v]) => setSize(v)} min={0.1} max={5.0} step={0.05} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Height: {height.toFixed(2)}</Label>
                  <Slider value={[height]} onValueChange={([v]) => setHeight(v)} min={0.1} max={5.0} step={0.05} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Duration: {duration.toFixed(2)}s</Label>
                  <Slider value={[duration]} onValueChange={([v]) => setDuration(v)} min={0.1} max={5.0} step={0.05} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Particles: {particleCount}</Label>
                  <Slider value={[particleCount]} onValueChange={([v]) => setParticleCount(Math.round(v))} min={10} max={200} step={5} />
                </div>
              </div>

              {/* Colors */}
              <div>
                <Label className="text-xs font-semibold">Colors</Label>
                <div className="flex gap-3 mt-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">C{i + 1}</Label>
                      <Input
                        type="color"
                        value={colors[i] || '#FFFFFF'}
                        onChange={e => updateColor(i, e.target.value)}
                        className="w-10 h-8 p-0.5 cursor-pointer"
                      />
                      <Input
                        type="text"
                        value={colors[i] || '#FFFFFF'}
                        onChange={e => updateColor(i, e.target.value)}
                        className="w-20 h-8 text-xs font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Color Mode (UFR only) */}
              {selectedPreset.system === 'ufr' && (
                <div>
                  <Label className="text-xs font-semibold">Color Mode</Label>
                  <div className="flex gap-1 mt-1">
                    {COLOR_MODES.map(mode => (
                      <Button
                        key={mode}
                        variant={colorMode === mode ? 'default' : 'outline'}
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => setColorMode(mode)}
                      >
                        {mode}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Info box */}
              <div className="mt-2 p-3 bg-muted/50 rounded-lg">
                <h4 className="text-xs font-semibold mb-1">Current Settings</h4>
                <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground">
                  <div>Size: {size.toFixed(2)}</div>
                  <div>Height: {height.toFixed(2)}</div>
                  <div>Duration: {duration.toFixed(2)}s</div>
                  <div>Particles: {particleCount}</div>
                </div>
              </div>
            </div>
          </Card>
        ) : panelMode === 'nebula-effects' ? (
          /* ─── Nebula Effects Editor ────────────────────────────────── */
          <Card className="p-4">
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b">
                <div>
                  <h3 className="font-semibold">
                    {NEBULA_EFFECT_NAMES[eid]}{' '}
                    <Badge variant="secondary" className="text-xs ml-1">{NEBULA_EFFECT_CODES[eid]}</Badge>
                  </h3>
                  <span className="text-xs text-muted-foreground">three-nebula GPU particle system</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={captureNebulaEffect}>
                    Capture
                  </Button>
                  <Button onClick={spawnNebulaDemo}>
                    Spawn Demo
                  </Button>
                </div>
              </div>

              {/* Common Parameters */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Scale: {nebulaParams.scale.toFixed(2)}</Label>
                  <Slider value={[nebulaParams.scale]} onValueChange={([v]) => updateNebulaParam('scale', v)} min={0.1} max={5.0} step={0.1} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Particles: {nebulaParams.preParticles}</Label>
                  <Slider value={[nebulaParams.preParticles]} onValueChange={([v]) => updateNebulaParam('preParticles', Math.round(v))} min={10} max={500} step={10} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Alpha Start: {nebulaParams.alphaStart.toFixed(2)}</Label>
                  <Slider value={[nebulaParams.alphaStart]} onValueChange={([v]) => updateNebulaParam('alphaStart', v)} min={0} max={1} step={0.05} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Alpha End: {nebulaParams.alphaEnd.toFixed(2)}</Label>
                  <Slider value={[nebulaParams.alphaEnd]} onValueChange={([v]) => updateNebulaParam('alphaEnd', v)} min={0} max={1} step={0.05} />
                </div>
              </div>

              {/* Force Direction */}
              <div>
                <Label className="text-xs font-semibold">Force Direction</Label>
                <div className="grid grid-cols-3 gap-4 mt-1">
                  <div className="space-y-2">
                    <Label className="text-xs">X (side): {nebulaParams.forceX.toFixed(1)}</Label>
                    <Slider value={[nebulaParams.forceX]} onValueChange={([v]) => updateNebulaParam('forceX', v)} min={-10} max={10} step={0.1} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Y (up/down): {nebulaParams.forceY.toFixed(1)}</Label>
                    <Slider value={[nebulaParams.forceY]} onValueChange={([v]) => updateNebulaParam('forceY', v)} min={-10} max={10} step={0.1} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Z (side): {nebulaParams.forceZ.toFixed(1)}</Label>
                    <Slider value={[nebulaParams.forceZ]} onValueChange={([v]) => updateNebulaParam('forceZ', v)} min={-10} max={10} step={0.1} />
                  </div>
                </div>
              </div>

              {/* Colors */}
              <div>
                <Label className="text-xs font-semibold">Colors</Label>
                <div className="flex gap-3 mt-1">
                  {(['colorA', 'colorB'] as const).map((key, i) => (
                    <div key={key} className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">{i === 0 ? 'Start' : 'End'}</Label>
                      <Input
                        type="color"
                        value={nebulaParams[key]}
                        onChange={e => updateNebulaParam(key, e.target.value)}
                        className="w-10 h-8 p-0.5 cursor-pointer"
                      />
                      <Input
                        type="text"
                        value={nebulaParams[key]}
                        onChange={e => updateNebulaParam(key, e.target.value)}
                        className="w-20 h-8 text-xs font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Effect-specific Parameters */}
              <div>
                <Label className="text-xs font-semibold mb-2 block">
                  {NEBULA_EFFECT_NAMES[eid]} Parameters
                </Label>
                <div className="grid grid-cols-2 gap-4">
                  {/* Fire */}
                  {eid === 'fire' && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-xs">Drift: {(nebulaParams.driftX ?? 0).toFixed(2)}</Label>
                        <Slider value={[nebulaParams.driftX ?? 0.5]} onValueChange={([v]) => updateNebulaParam('driftX', v)} min={0} max={3} step={0.05} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Radius Min: {(nebulaParams.radiusMin ?? 0).toFixed(2)}</Label>
                        <Slider value={[nebulaParams.radiusMin ?? 0.3]} onValueChange={([v]) => updateNebulaParam('radiusMin', v)} min={0.01} max={2} step={0.01} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Radius Max: {(nebulaParams.radiusMax ?? 0).toFixed(2)}</Label>
                        <Slider value={[nebulaParams.radiusMax ?? 0.8]} onValueChange={([v]) => updateNebulaParam('radiusMax', v)} min={0.01} max={3} step={0.01} />
                      </div>
                    </>
                  )}

                  {/* Explosion */}
                  {eid === 'explosion' && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-xs">Radial Velocity: {(nebulaParams.radialVelocity ?? 0).toFixed(1)}</Label>
                        <Slider value={[nebulaParams.radialVelocity ?? 15]} onValueChange={([v]) => updateNebulaParam('radialVelocity', v)} min={1} max={30} step={0.5} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Fade Easing</Label>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {FADE_EASINGS.map(easing => (
                            <Button
                              key={easing}
                              variant={nebulaParams.fadeEasing === easing ? 'default' : 'outline'}
                              size="sm"
                              className="text-[10px] h-6 px-2"
                              onClick={() => updateNebulaParam('fadeEasing', easing)}
                            >
                              {easing.replace('ease', '')}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Sparkles */}
                  {eid === 'sparkles' && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-xs">Drift: {(nebulaParams.driftX ?? 0).toFixed(2)}</Label>
                        <Slider value={[nebulaParams.driftX ?? 1]} onValueChange={([v]) => updateNebulaParam('driftX', v)} min={0} max={3} step={0.05} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Twinkle Speed: {(nebulaParams.twinkleSpeed ?? 0).toFixed(3)}</Label>
                        <Slider value={[nebulaParams.twinkleSpeed ?? 0.1]} onValueChange={([v]) => updateNebulaParam('twinkleSpeed', v)} min={0.01} max={0.5} step={0.01} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Radius Min: {(nebulaParams.radiusMin ?? 0).toFixed(2)}</Label>
                        <Slider value={[nebulaParams.radiusMin ?? 0.1]} onValueChange={([v]) => updateNebulaParam('radiusMin', v)} min={0.01} max={1} step={0.01} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Radius Max: {(nebulaParams.radiusMax ?? 0).toFixed(2)}</Label>
                        <Slider value={[nebulaParams.radiusMax ?? 0.3]} onValueChange={([v]) => updateNebulaParam('radiusMax', v)} min={0.01} max={1} step={0.01} />
                      </div>
                    </>
                  )}

                  {/* Smoke */}
                  {eid === 'smoke' && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-xs">Scale Expansion: {(nebulaParams.scaleEnd ?? 0).toFixed(1)}</Label>
                        <Slider value={[nebulaParams.scaleEnd ?? 3]} onValueChange={([v]) => updateNebulaParam('scaleEnd', v)} min={1} max={10} step={0.1} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Radius Max: {(nebulaParams.radiusMax ?? 0).toFixed(2)}</Label>
                        <Slider value={[nebulaParams.radiusMax ?? 1.5]} onValueChange={([v]) => updateNebulaParam('radiusMax', v)} min={0.5} max={5} step={0.1} />
                      </div>
                    </>
                  )}

                  {/* Magic */}
                  {eid === 'magic' && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-xs">Spring: {(nebulaParams.springStrength ?? 0).toFixed(3)}</Label>
                        <Slider value={[nebulaParams.springStrength ?? 0.02]} onValueChange={([v]) => updateNebulaParam('springStrength', v)} min={0.001} max={0.1} step={0.001} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Friction: {(nebulaParams.friction ?? 0).toFixed(2)}</Label>
                        <Slider value={[nebulaParams.friction ?? 0.95]} onValueChange={([v]) => updateNebulaParam('friction', v)} min={0.8} max={0.99} step={0.01} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Drift: {(nebulaParams.driftX ?? 0).toFixed(2)}</Label>
                        <Slider value={[nebulaParams.driftX ?? 1]} onValueChange={([v]) => updateNebulaParam('driftX', v)} min={0} max={5} step={0.1} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Radial Velocity: {(nebulaParams.radialVelocity ?? 0).toFixed(1)}</Label>
                        <Slider value={[nebulaParams.radialVelocity ?? 5]} onValueChange={([v]) => updateNebulaParam('radialVelocity', v)} min={1} max={15} step={0.5} />
                      </div>
                    </>
                  )}
                </div>
              </div>

            </div>
          </Card>
        ) : (
          /* ─── Flamethrower Sprites panel ────────────────────────── */
          <Card className="p-4">
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b">
                <div>
                  <h3 className="font-semibold">Flamethrower — Sprites</h3>
                  <span className="text-xs text-muted-foreground">
                    three.quarks particle system
                  </span>
                </div>
                <Button onClick={saveFtTier}>
                  Save Tier {ftSelectedTier}
                </Button>
              </div>

              {/* Tier selector */}
              <div>
                <Label className="text-xs font-semibold">Tier</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(tier => (
                    <Button
                      key={tier}
                      variant={ftSelectedTier === tier ? 'default' : 'outline'}
                      size="sm"
                      className="w-8 h-8 p-0 text-xs"
                      onClick={() => setFtSelectedTier(tier)}
                    >
                      {tier}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Sliders */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Width: {ftWidth.toFixed(2)}</Label>
                  <Slider value={[ftWidth]} onValueChange={([v]) => setFtWidth(v)} min={0.1} max={5.0} step={0.05} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Distance: {ftDistance.toFixed(1)}</Label>
                  <Slider value={[ftDistance]} onValueChange={([v]) => setFtDistance(v)} min={1} max={50} step={0.5} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Speed: {ftSpeed.toFixed(1)}</Label>
                  <Slider value={[ftSpeed]} onValueChange={([v]) => setFtSpeed(v)} min={1} max={100} step={1} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Particles: {ftParticles}</Label>
                  <Slider value={[ftParticles]} onValueChange={([v]) => setFtParticles(Math.round(v))} min={10} max={500} step={5} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Transparency: {ftTransparency.toFixed(2)}</Label>
                  <Slider value={[ftTransparency]} onValueChange={([v]) => setFtTransparency(v)} min={0} max={1} step={0.01} />
                </div>
              </div>

              {/* Fire Colors */}
              <div>
                <Label className="text-xs font-semibold">Fire Colors</Label>
                <div className="flex gap-3 mt-1">
                  {[
                    { label: 'Bright', value: ftColor1, set: setFtColor1 },
                    { label: 'Mid', value: ftColor2, set: setFtColor2 },
                    { label: 'Dark', value: ftColor3, set: setFtColor3 },
                  ].map(({ label, value, set }) => (
                    <div key={label} className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">{label}</Label>
                      <Input
                        type="color"
                        value={value}
                        onChange={e => set(e.target.value)}
                        className="w-10 h-8 p-0.5 cursor-pointer"
                      />
                      <Input
                        type="text"
                        value={value}
                        onChange={e => set(e.target.value)}
                        className="w-20 h-8 text-xs font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Opacity sliders */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Fire Opacity: {ftFireOpacity.toFixed(2)}</Label>
                  <Slider value={[ftFireOpacity]} onValueChange={([v]) => setFtFireOpacity(v)} min={0} max={1} step={0.01} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Smoke Opacity: {ftSmokeOpacity.toFixed(2)}</Label>
                  <Slider value={[ftSmokeOpacity]} onValueChange={([v]) => setFtSmokeOpacity(v)} min={0} max={1} step={0.01} />
                </div>
              </div>

              {/* Sprite thumbnails */}
              <div>
                <Label className="text-xs font-semibold">Sprites (click to replace, right-click to save)</Label>
                <div className="grid grid-cols-4 gap-3 mt-2">
                  {SPRITE_INFO.map((info, i) => (
                    <div key={i} className="border rounded-lg p-2 bg-black/50 text-center">
                      {spriteDataUrls[i] ? (
                        <img
                          src={spriteDataUrls[i]}
                          alt={info.label}
                          className="w-full aspect-square object-contain cursor-pointer rounded"
                          onClick={() => fileInputRefs.current[i]?.click()}
                          title={`Click to replace ${info.label}`}
                        />
                      ) : (
                        <div
                          className="w-full aspect-square bg-muted/20 rounded flex items-center justify-center text-xs text-muted-foreground cursor-pointer"
                          onClick={() => fileInputRefs.current[i]?.click()}
                        >
                          Loading...
                        </div>
                      )}
                      <div className="mt-1 text-xs font-medium text-foreground">{info.label}</div>
                      <div className="text-xs text-muted-foreground">{info.size} ({info.tiles})</div>
                      <input
                        ref={el => { fileInputRefs.current[i] = el; }}
                        type="file"
                        accept=".png,.webp"
                        className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) handleSpriteUpload(i, file);
                          e.target.value = '';
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
    </div>
  );
}
