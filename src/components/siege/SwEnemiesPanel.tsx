// SwEnemiesPanel — Admin → NPC → "Enemies SW". An editable card per Siege Worlds monster: edit the
// base stats (health, damage, range, speed, aggro, etc.), the gait, the CC-immunity flags, the
// searchable tags, and the display name. Edits persist to Supabase (sw_monster_overrides), cache to
// IndexedDB, and apply to every new spawn + to challenges (whose % multipliers ride on this base).
// Component-driven monsters (skeleton horde, Ghost, Crawler) show read-only stats — only their name +
// tags are editable. Native AI/pathfinding is listed read-only. List auto-sorts by name.
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useEffect } from 'react';
import { useSwMonsters, type SwMonster } from './siegeMonsterRegistry';
import { saveMonsterOverride, clearMonsterOverride, syncMonsterStats } from './monsterStats';
import { TAG_GROUPS } from './monsterTags';
import { MonsterHexThumb, MonsterPortCanvas, defaultColor } from './challenge/MonsterPreview';

const STAT_FIELDS: { key: keyof SwMonster; label: string }[] = [
  { key: 'health', label: 'Health' },
  { key: 'dmgMin', label: 'Dmg min' }, { key: 'dmgMax', label: 'Dmg max' },
  { key: 'kbMin', label: 'KB min' }, { key: 'kbMax', label: 'KB max' },
  { key: 'attackRange', label: 'Atk range (m)' }, { key: 'attackMs', label: 'Atk every (ms)' },
  { key: 'speed', label: 'Speed (m/s)' },
  { key: 'aggro', label: 'Aggro (m)' }, { key: 'wanderRadius', label: 'Wander (m)' },
  { key: 'height', label: 'Height (m)' },
  { key: 'sizeJitter', label: 'Size jitter' }, { key: 'speedJitter', label: 'Speed jitter' },
  { key: 'animSpeed', label: 'Anim speed' },
];
const BOOL_FIELDS: { key: keyof SwMonster; label: string }[] = [
  { key: 'noStun', label: 'Stun-immune' },
  { key: 'noKnockback', label: 'KB-immune' },
  { key: 'enrageOnHit', label: 'Enrages on hit' },
];

const saveNum = (id: number, key: string, raw: string) => {
  const v = raw.trim() === '' ? null : Number(raw);
  if (v != null && Number.isNaN(v)) return;
  void saveMonsterOverride(id, { [key]: v });
};

function NumField({ m, fkey, label }: { m: SwMonster; fkey: keyof SwMonster; label: string }) {
  const val = m[fkey] as number | null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Input
        type="number"
        // key includes the value so the uncontrolled input refreshes after a save/reset.
        key={`${m.id}-${String(fkey)}-${val ?? ''}`}
        defaultValue={val ?? ''}
        disabled={!m.editable}
        onBlur={(e) => saveNum(m.id, String(fkey), e.target.value)}
        className="h-7 text-xs"
      />
    </div>
  );
}

function MonsterCard({ m }: { m: SwMonster }) {
  return (
    // 20% darker than the surrounding panel so each monster card stands out.
    <Card className="relative" style={{ boxShadow: 'inset 0 0 0 100vmax rgba(0,0,0,0.2)' }}>
     <div className="flex items-stretch gap-1">
      {/* Live rotating model in a hexagon, popping out over the frame (left rail). */}
      <div className="flex items-center justify-center pl-3 pr-1 shrink-0">
        <MonsterHexThumb type={m.id} color={defaultColor(m.id)} size={88} />
      </div>
      <div className="flex-1 min-w-0">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3 flex-wrap">
          <Label className="text-xs text-muted-foreground">Name</Label>
          <Input
            key={`name-${m.id}-${m.name}`}
            defaultValue={m.name}
            onBlur={(e) => saveMonsterOverride(m.id, { name: e.target.value.trim() || null })}
            className="max-w-[220px] h-8 font-semibold"
          />
          <span className="text-[11px] text-muted-foreground">npcType {m.id}</span>
          {!m.editable && <span className="text-[10px] text-amber-400">component-driven · name + tags only</span>}
          <Button variant="outline" size="sm" className="h-7 ml-auto text-xs" onClick={() => clearMonsterOverride(m.id)}>
            Reset to default
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Editable stats */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-3 gap-y-1">
          {STAT_FIELDS.map((f) => <NumField key={String(f.key)} m={m} fkey={f.key} label={f.label} />)}
          {/* Gait */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">Gait</span>
            <select
              key={`gait-${m.id}-${m.gait}`}
              defaultValue={m.gait}
              disabled={!m.editable}
              onChange={(e) => saveMonsterOverride(m.id, { gait: e.target.value })}
              className="h-7 text-xs rounded-md border border-input bg-background px-2"
            >
              <option value="climb">climb</option>
              <option value="hop">hop</option>
            </select>
          </div>
        </div>

        {/* Flags */}
        <div className="flex flex-wrap gap-4">
          {BOOL_FIELDS.map((f) => (
            <label key={String(f.key)} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={!!m[f.key]}
                disabled={!m.editable}
                onChange={(e) => saveMonsterOverride(m.id, { [f.key]: e.target.checked })}
              />
              {f.label}
            </label>
          ))}
          <span className="text-xs text-muted-foreground ml-auto">Model: {m.model}</span>
        </div>

        {/* Tags — editable chips, grouped */}
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground">Tags (searchable — click to toggle)</span>
          <div className="flex flex-wrap gap-1.5">
            {TAG_GROUPS.flatMap((g) => g.tags).map((tag) => {
              const on = m.tags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => saveMonsterOverride(m.id, { tags: on ? m.tags.filter((t) => t !== tag) : [...m.tags, tag] })}
                  className={`px-2 py-0.5 rounded-full text-[11px] border ${on ? 'bg-primary/80 text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-border'}`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        {/* Native AI — read-only */}
        <div className="text-xs space-y-0.5 pt-1 border-t border-border/40">
          <div className="flex gap-2"><span className="text-muted-foreground shrink-0">Pathfinding</span><span>{m.pathfinding}</span></div>
          <div className="flex gap-2"><span className="text-muted-foreground shrink-0">Behavior</span><span>{m.behavior}</span></div>
          <div className="flex gap-2"><span className="text-muted-foreground shrink-0">Spawn</span><span>{m.spawn}</span></div>
        </div>
      </CardContent>
      </div>
     </div>
    </Card>
  );
}

export function SwEnemiesPanel() {
  const monsters = useSwMonsters();
  // Pull the latest overrides from Supabase when the admin opens the panel (Dreadroot doesn't
  // sync at world-init, and another admin may have edited from a different device).
  useEffect(() => { void syncMonsterStats(); }, []);
  return (
    <div className="space-y-4">
      {/* One shared WebGL canvas behind the hex thumbs (all rows draw into it). */}
      <MonsterPortCanvas />
      {monsters.map((m) => <MonsterCard key={m.id} m={m} />)}
      <p className="text-xs text-muted-foreground pt-1">
        Edits save to Supabase, cache locally, and apply to every new spawn — and to challenges (their
        boss % multipliers ride on top of this base). Tags are searchable; defaults are auto-derived and
        editable. Component-driven monsters show read-only stats (name + tags still editable). Structural
        effects (spray/spin/flames) and native AI stay code-defined and are listed read-only.
      </p>
    </div>
  );
}
