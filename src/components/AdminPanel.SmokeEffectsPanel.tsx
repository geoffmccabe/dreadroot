// Smoke / VFX authoring panel — design a smoke/steam/glitter variant with live
// preview and save it to `effect_definitions`. Built from shadcn components +
// semantic theme tokens ONLY (no hardcoded chrome colors), so it auto-themes
// per game via --hud-bg-h (the universal-engine per-game-CSS requirement). The
// effect COLOR pickers write hex into the recipe (that's effect data, not theme).

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { useAdminPanel } from '@/contexts/AdminPanelContext';
import { FIRE_SMOKE, getRecipe, allRecipeCodes } from '@/effects/recipes';
import { loadEffectRecipesFromDB, saveEffectRecipe } from '@/effects/effectsDb';
import type { EffectRecipe } from '@/effects/types';

type NumKey = keyof EffectRecipe;
interface FieldDef { key: NumKey; label: string; min: number; max: number; step: number; }

const BODY_FIELDS: FieldDef[] = [
  { key: 'spawnRate', label: 'Particle rate (/s)', min: 1, max: 200, step: 1 },
  { key: 'lifetime', label: 'Lifetime (s)', min: 0.5, max: 8, step: 0.1 },
  { key: 'size0', label: 'Size start (m)', min: 0.02, max: 1.5, step: 0.01 },
  { key: 'size1', label: 'Size end (m)', min: 0.1, max: 3, step: 0.01 },
  { key: 'disperseGrow', label: 'Disperse grow', min: 0, max: 2, step: 0.05 },
  { key: 'opacity0', label: 'Opacity', min: 0, max: 1, step: 0.01 },
  { key: 'spread', label: 'Spread (m)', min: 0, max: 1, step: 0.01 },
  { key: 'rise', label: 'Rise (m/s)', min: -2, max: 4, step: 0.05 },
  { key: 'gravity', label: 'Gravity (sink)', min: -2, max: 4, step: 0.05 },
  { key: 'flutterAmp', label: 'Flutter amount', min: 0, max: 1, step: 0.01 },
  { key: 'flutterFreq', label: 'Flutter speed', min: 0, max: 4, step: 0.05 },
  { key: 'spin', label: 'Puff spin', min: 0, max: 3, step: 0.05 },
];

const SPIRAL_FIELDS: FieldDef[] = [
  { key: 'spiralRate', label: 'Spirals (/s)', min: 0, max: 40, step: 1 },
  { key: 'spiralSize0', label: 'Spiral size start', min: 0.1, max: 2, step: 0.02 },
  { key: 'spiralSize1', label: 'Spiral size end', min: 0.2, max: 3, step: 0.02 },
  { key: 'spiralOpacity', label: 'Spiral opacity', min: 0, max: 1, step: 0.01 },
  { key: 'spiralLighten', label: 'Spiral lighten', min: 0, max: 0.6, step: 0.01 },
  { key: 'spiralTurns', label: 'Spiral turns', min: 1, max: 5, step: 1 },
  { key: 'spiralSpinMinSec', label: 'Spin fast (s/rev)', min: 0.2, max: 2, step: 0.05 },
  { key: 'spiralSpinMaxSec', label: 'Spin slow (s/rev)', min: 0.2, max: 3, step: 0.05 },
];

const CULL_FIELDS: FieldDef[] = [
  { key: 'cullDistance', label: 'Cull distance (m)', min: 20, max: 300, step: 5 },
  { key: 'fadeStart', label: 'Fade start (m)', min: 10, max: 300, step: 5 },
  { key: 'fadeEnd', label: 'Fade end (m)', min: 20, max: 320, step: 5 },
];

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';

export function SmokeEffectsPanel() {
  const { effectsRef } = useAdminPanel();
  const [recipe, setRecipe] = useState<EffectRecipe>(() => ({ ...FIRE_SMOKE }));
  const [name, setName] = useState('Fire Smoke');
  const [previewing, setPreviewing] = useState(false);
  const [codes, setCodes] = useState<string[]>(() => allRecipeCodes());
  const [saving, setSaving] = useState(false);

  // Load DB variants into the registry + the dropdown on mount.
  useEffect(() => {
    let alive = true;
    loadEffectRecipesFromDB().then(() => { if (alive) setCodes(allRecipeCodes()); });
    return () => { alive = false; };
  }, []);

  // Drive the in-world live preview from the current recipe while previewing.
  useEffect(() => {
    const fx = effectsRef.current;
    if (!fx) return;
    fx.setPreview(previewing ? recipe : null);
  }, [recipe, previewing, effectsRef]);

  // Stop the preview when the panel unmounts.
  useEffect(() => () => { effectsRef.current?.setPreview(null); }, [effectsRef]);

  const num = (key: NumKey) => Number(recipe[key] ?? 0);
  const set = (partial: Partial<EffectRecipe>) => setRecipe((r) => ({ ...r, ...partial }));

  const loadVariant = (code: string) => {
    const r = { ...getRecipe(code) };
    setRecipe(r);
    setName(r.code.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
  };

  const save = async () => {
    setSaving(true);
    try {
      const toSave: EffectRecipe = { ...recipe, code: slugify(name) };
      await saveEffectRecipe({ recipe: toSave, name });
      setRecipe(toSave);
      setCodes(allRecipeCodes());
      toast.success(`Saved effect "${name}"`);
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message ?? e}. Built-in names can't be overwritten — try a new name.`);
    } finally {
      setSaving(false);
    }
  };

  const Field = ({ f }: { f: FieldDef }) => (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <Label className="text-xs">{f.label}</Label>
        <span className="text-xs text-muted-foreground tabular-nums">
          {num(f.key).toFixed(f.step < 1 ? 2 : 0)}
        </span>
      </div>
      <Slider
        value={[num(f.key)]}
        min={f.min}
        max={f.max}
        step={f.step}
        onValueChange={(v) => set({ [f.key]: v[0] } as Partial<EffectRecipe>)}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Top bar: preview toggle + variant loader */}
      <Card className="p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Smoke / VFX</h3>
            <Badge variant="secondary">{recipe.family}</Badge>
          </div>
          <Button
            size="sm"
            variant={previewing ? 'default' : 'outline'}
            onClick={() => setPreviewing((p) => !p)}
          >
            {previewing ? 'Preview: ON' : 'Preview'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {codes.map((c) => (
            <Button key={c} size="sm" variant="outline" className="h-7 text-xs" onClick={() => loadVariant(c)}>
              {c}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Toggle Preview to see a live cloud in front of you. Tweak, name it, Save.
        </p>
      </Card>

      {/* Body */}
      <Card className="p-3 space-y-3">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">Smoke body</h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {BODY_FIELDS.map((f) => <Field key={f.key} f={f} />)}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Color start</Label>
            <Input type="color" value={recipe.color0} onChange={(e) => set({ color0: e.target.value })} className="h-8 p-1" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Color end</Label>
            <Input type="color" value={recipe.color1} onChange={(e) => set({ color1: e.target.value })} className="h-8 p-1" />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={recipe.blend === 'alpha' ? 'default' : 'outline'} onClick={() => set({ blend: 'alpha' })}>Alpha</Button>
          <Button size="sm" variant={recipe.blend === 'additive' ? 'default' : 'outline'} onClick={() => set({ blend: 'additive' })}>Additive</Button>
        </div>
      </Card>

      {/* Spiral add-on */}
      <Card className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">Spiral add-on</h4>
          <Button
            size="sm"
            variant={recipe.spiral ? 'default' : 'outline'}
            onClick={() => set({ spiral: !recipe.spiral })}
          >
            {recipe.spiral ? 'Spiral: ON' : 'Spiral: OFF'}
          </Button>
        </div>
        {recipe.spiral && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {SPIRAL_FIELDS.map((f) => <Field key={f.key} f={f} />)}
          </div>
        )}
      </Card>

      {/* Culling */}
      <Card className="p-3 space-y-3">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">Distance / culling</h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {CULL_FIELDS.map((f) => <Field key={f.key} f={f} />)}
        </div>
      </Card>

      {/* Save */}
      <Card className="p-3 space-y-2">
        <Label className="text-xs">Name</Label>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Toxic Smoke" />
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
        <p className="text-xs text-muted-foreground">Saves as code <span className="font-mono">{slugify(name)}</span>.</p>
      </Card>
    </div>
  );
}
