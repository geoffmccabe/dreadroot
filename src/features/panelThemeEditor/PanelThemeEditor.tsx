// The panel-styling (CSS) editor — Admin → Worlds → Settings → CSS. One tab per
// panel CLASS (User / Admin / Debug / Build). Every control edits the live theme
// store, so panels restyle instantly; the persistence layer saves per game.
// Build is a placeholder for now — its tools are being wired to the Build class
// separately.
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePanelThemes, panelThemeStore } from '@/theme/panelThemeStore';
import { TEXT_ROLES, type PanelClass, type PanelSurface, type PanelText, type TextRole } from '@/theme/panelTheme';
import { ColorRow, SliderRow, SwitchRow, SelectRow } from './controls';

const FONTS = [
  { label: 'Sans (Inter)', value: "'Inter', sans-serif" },
  { label: 'Monospace', value: 'ui-monospace, monospace' },
  { label: 'Serif', value: 'Georgia, serif' },
  { label: 'System', value: 'system-ui, sans-serif' },
];
const WEIGHTS = [
  { label: 'Light', value: '300' }, { label: 'Regular', value: '400' },
  { label: 'Medium', value: '500' }, { label: 'Semibold', value: '600' },
  { label: 'Bold', value: '700' },
];
const ROLE_LABEL: Record<TextRole, string> = {
  heading: 'Heading', subheading: 'Sub-heading', body: 'Body', info: 'Info', micro: 'Micro',
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => Math.round(x * 100);

function ClassEditor({ cls }: { cls: PanelClass }) {
  const themes = usePanelThemes();
  const t = themes[cls];
  const s = t.surface;
  const ps = (patch: Partial<PanelSurface>) => panelThemeStore.patchSurface(cls, patch);

  return (
    <div className="space-y-4 pt-2">
      <section className="space-y-0.5">
        <h4 className="text-sm font-semibold mb-1">Panel surface</h4>
        <ColorRow label="Background" color={s.bg} onChange={(c) => ps({ bg: c })} />
        <SliderRow label="Transparency" value={r2(s.bgOpacity)} min={0} max={1} step={0.05} onChange={(v) => ps({ bgOpacity: v })} />
        <ColorRow label="Border" color={s.border} onChange={(c) => ps({ border: c })} />
        <SliderRow label="Border opacity" value={r2(s.borderOpacity)} min={0} max={1} step={0.05} onChange={(v) => ps({ borderOpacity: v })} />
        <SliderRow label="Border width" value={s.borderWidth} min={0} max={5} step={1} unit="px" onChange={(v) => ps({ borderWidth: v })} />
        <SliderRow label="Corner radius" value={s.radius} min={0} max={30} step={1} unit="px" onChange={(v) => ps({ radius: v })} />
        <SliderRow label="Blur" value={s.blur} min={0} max={30} step={1} unit="px" onChange={(v) => ps({ blur: v })} />
        <SliderRow label="Darken behind" value={pct(s.darken)} min={0} max={100} step={5} unit="%" onChange={(v) => ps({ darken: v / 100 })} />
        <ColorRow label="Glow" color={s.glow} onChange={(c) => ps({ glow: c })} />
        <SliderRow label="Glow opacity" value={r2(s.glowOpacity)} min={0} max={1} step={0.05} onChange={(v) => ps({ glowOpacity: v })} />
        <SliderRow label="Glow size" value={s.glowSize} min={0} max={40} step={1} unit="px" onChange={(v) => ps({ glowSize: v })} />
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Text</h4>
        {TEXT_ROLES.map((role) => {
          const tx: PanelText = t.text[role];
          const pt = (patch: Partial<PanelText>) => panelThemeStore.patchText(cls, role, patch);
          return (
            <div key={role} className="rounded border border-white/10 p-2 space-y-0.5">
              <div className="text-xs font-semibold opacity-90 mb-1">{ROLE_LABEL[role]}</div>
              <SelectRow label="Font" value={tx.family} options={FONTS} onChange={(v) => pt({ family: v })} />
              <SliderRow label="Size" value={tx.size} min={8} max={40} step={1} unit="px" onChange={(v) => pt({ size: v })} />
              <SelectRow label="Weight" value={String(tx.weight)} options={WEIGHTS} onChange={(v) => pt({ weight: parseInt(v, 10) })} />
              <SwitchRow label="Italic" checked={tx.italic} onChange={(v) => pt({ italic: v })} />
              <ColorRow label="Color" color={tx.color} onChange={(c) => pt({ color: c })} />
              <SliderRow label="Opacity" value={r2(tx.colorOpacity)} min={0} max={1} step={0.05} onChange={(v) => pt({ colorOpacity: v })} />
              <SliderRow label="Letter spacing" value={tx.letterSpacing} min={-0.05} max={0.3} step={0.01} unit="em" onChange={(v) => pt({ letterSpacing: v })} />
            </div>
          );
        })}
      </section>

      <Button variant="outline" size="sm" onClick={() => panelThemeStore.reset(cls)}>
        Reset {cls} to defaults
      </Button>
    </div>
  );
}

export function PanelThemeEditor() {
  return (
    <div className="space-y-3">
      <p className="text-xs opacity-70">
        Live styling for each class of panel. Changes preview instantly and save automatically (per game).
      </p>
      <Tabs defaultValue="user">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="user">User</TabsTrigger>
          <TabsTrigger value="admin">Admin</TabsTrigger>
          <TabsTrigger value="debug">Debug</TabsTrigger>
          <TabsTrigger value="build">Build</TabsTrigger>
        </TabsList>
        <TabsContent value="user"><ClassEditor cls="user" /></TabsContent>
        <TabsContent value="admin"><ClassEditor cls="admin" /></TabsContent>
        <TabsContent value="debug"><ClassEditor cls="debug" /></TabsContent>
        <TabsContent value="build">
          <Card className="p-4 mt-2">
            <p className="text-xs opacity-75">
              Build‑tools styling is being wired up separately. This tab will control the
              Terrain, Model Placer, Voxelize and Adjust panels once they're hooked to the
              Build class.
            </p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
