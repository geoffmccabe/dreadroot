// Effects > Lights panel. Author a reusable light (first type: a spotlight — robot
// face/chest beam), preview it live as a headlamp, and Save it under a short reusable
// CODE in effect_definitions (family 'lights'). That code is then referenced anywhere
// in the game to attach this exact light. Mirrors the Smoke panel's conventions.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { lightStore, useLightStore } from '@/features/lights/lightStore';
import { slugifyCode, type LightDef } from '@/features/lights/lightTypes';
import { saveLight, loadLights, deleteLight, allLights } from '@/features/lights/lightsDb';

type NumKey = {
  [K in keyof LightDef]: LightDef[K] extends number ? K : never;
}[keyof LightDef];

interface FieldDef { key: NumKey; label: string; min: number; max: number; step: number; }

const BEAM: FieldDef[] = [
  { key: 'intensity', label: 'Intensity', min: 0, max: 4, step: 0.05 },
  { key: 'angleDeg', label: 'Cone angle°', min: 5, max: 90, step: 1 },
  { key: 'range', label: 'Range (m, falloff)', min: 4, max: 48, step: 1 },
  { key: 'penumbra', label: 'Edge softness', min: 0, max: 1, step: 0.02 },
  { key: 'decay', label: 'Decay', min: 0.5, max: 3, step: 0.1 },
  { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.02 },
];
const RIM: FieldDef[] = [
  { key: 'rimDarkness', label: 'Rim darkness', min: 0, max: 1, step: 0.02 },
  { key: 'rimSoftness', label: 'Rim softness', min: 0, max: 1, step: 0.02 },
];
const FOG: FieldDef[] = [
  { key: 'fogStrength', label: 'Fog beam strength', min: 0, max: 1, step: 0.02 },
  { key: 'fogLength', label: 'Fog beam length (m)', min: 2, max: 48, step: 1 },
];
const EMIT: FieldDef[] = [
  { key: 'emitterIntensity', label: 'Glow intensity', min: 0, max: 5, step: 0.1 },
  { key: 'emitterSize', label: 'Disc size (m)', min: 0.1, max: 2, step: 0.05 },
];
const MOUNT: FieldDef[] = [
  { key: 'offX', label: 'Offset X', min: -3, max: 3, step: 0.05 },
  { key: 'offY', label: 'Offset Y', min: -3, max: 3, step: 0.05 },
  { key: 'offZ', label: 'Offset Z', min: -3, max: 3, step: 0.05 },
  { key: 'pitchDeg', label: 'Aim pitch°', min: -45, max: 45, step: 1 },
];

export function LightsEffectsPanel() {
  const { previewOn, def } = useLightStore();
  const set = (patch: Partial<LightDef>) => lightStore.setDef(patch);

  const [name, setName] = useState(def.name);
  const [saved, setSaved] = useState<LightDef[]>([]);
  const [saving, setSaving] = useState(false);
  const refresh = () => setSaved(allLights());
  useEffect(() => { loadLights().then(() => refresh()); }, []);
  useEffect(() => { setName(def.name); }, [def.name]);

  const Field = ({ f }: { f: FieldDef }) => (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <Label className="text-xs">{f.label}</Label>
        <span className="text-xs text-muted-foreground tabular-nums">{(def[f.key] as number).toFixed(f.step < 1 ? 2 : 0)}</span>
      </div>
      <Slider value={[def[f.key] as number]} min={f.min} max={f.max} step={f.step} onValueChange={(v) => set({ [f.key]: v[0] } as Partial<LightDef>)} />
    </div>
  );
  const Grid = ({ fields }: { fields: FieldDef[] }) => (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">{fields.map((f) => <Field key={f.key} f={f} />)}</div>
  );
  const Color = ({ k, label }: { k: 'color' | 'fogColor' | 'emitterColor'; label: string }) => (
    <div className="flex items-center gap-2">
      <Label className="text-xs flex-1">{label}</Label>
      <input type="color" value={def[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<LightDef>)} className="h-7 w-10 rounded" />
    </div>
  );
  const Toggle = ({ k, label }: { k: 'fogOn' | 'shadowOn' | 'emitterOn'; label: string }) => (
    <Button size="sm" variant={def[k] ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => set({ [k]: !def[k] } as Partial<LightDef>)}>
      {label}: {def[k] ? 'ON' : 'OFF'}
    </Button>
  );

  const onSave = async () => {
    const code = slugifyCode(name);
    setSaving(true);
    try {
      await saveLight({ ...def, name, code });
      lightStore.setDef({ name, code });
      refresh();
    } finally { setSaving(false); }
  };
  const onLoad = (d: LightDef) => lightStore.replaceDef({ ...d });
  const onDelete = async (code: string) => { await deleteLight(code); refresh(); };

  const code = slugifyCode(name);

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Light (spotlight)</span>
          <Button size="sm" variant={previewOn ? 'default' : 'outline'} onClick={() => lightStore.setPreview(!previewOn)}>
            {previewOn ? 'Preview ON (aim with view)' : 'Preview'}
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">Reusable code: <span className="font-mono text-foreground">{code}</span></div>
      </Card>

      <Card className="p-3 space-y-2">
        <Color k="color" label="Beam colour" />
        <Grid fields={BEAM} />
      </Card>

      <Card className="p-3 space-y-2">
        <Label className="text-xs font-semibold">Dark-rim circle</Label>
        <Grid fields={RIM} />
      </Card>

      <Card className="p-3 space-y-2">
        <div className="flex items-center justify-between"><Label className="text-xs font-semibold">Fog beam</Label><Toggle k="fogOn" label="Fog" /></div>
        <Color k="fogColor" label="Fog colour" />
        <Grid fields={FOG} />
      </Card>

      <Card className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">Shadows (cheap)</Label>
          <Toggle k="shadowOn" label="Shadow" />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Label className="text-xs flex-1">Quality</Label>
          {[256, 512, 1024].map((s) => (
            <Button key={s} size="sm" variant={def.shadowSize === s ? 'default' : 'outline'} className="h-6 px-2" onClick={() => set({ shadowSize: s })}>{s}</Button>
          ))}
        </div>
      </Card>

      <Card className="p-3 space-y-2">
        <div className="flex items-center justify-between"><Label className="text-xs font-semibold">Glowing disc</Label><Toggle k="emitterOn" label="Disc" /></div>
        <Color k="emitterColor" label="Disc colour" />
        <Grid fields={EMIT} />
      </Card>

      <Card className="p-3 space-y-2">
        <Label className="text-xs font-semibold">Mount</Label>
        <Grid fields={MOUNT} />
      </Card>

      <Card className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="name this light" className="flex-1 h-8 text-xs" />
          <Button size="sm" disabled={saving || !name.trim()} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
        {saved.length > 0 && (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {saved.map((d) => (
              <div key={d.code} className="flex items-center gap-1 text-xs">
                <button className="flex-1 text-left truncate px-2 py-1 rounded bg-muted hover:opacity-80" onClick={() => onLoad(d)} title={`Load (code: ${d.code})`}>
                  {d.name} <span className="font-mono text-muted-foreground">· {d.code}</span>
                </button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => onDelete(d.code)} title="Delete">✕</Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
