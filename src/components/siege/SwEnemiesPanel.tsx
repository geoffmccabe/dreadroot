// SwEnemiesPanel — Admin → NPC → "Enemies SW". Lists every Siege Worlds monster as a card
// (stats read from the gameplay catalog), sorted alphabetically by an editable name. Edit a
// name and the list re-sorts live. Kept separate from the EMS "Enemies" panel by design.
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useSwMonsters, setSwMonsterName } from './siegeMonsterRegistry';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function SwEnemiesPanel() {
  const monsters = useSwMonsters();
  return (
    <div className="space-y-4">
      {monsters.map((m) => (
        <Card key={m.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3 flex-wrap">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={m.name}
                onChange={(e) => setSwMonsterName(m.id, e.target.value)}
                className="max-w-[220px] font-semibold"
              />
              {m.special && <Badge variant="outline">{m.special}</Badge>}
            </div>
          </CardHeader>
          <CardContent className="text-sm grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1">
            <Stat label="Model" value={m.model} />
            <Stat label="Health" value={m.health || '—'} />
            <Stat label="Damage" value={m.dmgMin != null ? `${m.dmgMin}–${m.dmgMax}` : '—'} />
            <Stat label="Attack range" value={m.attackRange != null ? `${m.attackRange} m` : '—'} />
            <Stat label="Attack every" value={m.attackMs != null ? `${m.attackMs} ms` : '—'} />
            <Stat label="Speed" value={m.speed != null ? `${m.speed} m/s` : '—'} />
            <Stat label="Gait" value={m.gait} />
            <Stat label="npcType" value={m.special.includes('decor') ? '—' : m.id} />
            {/* How to spawn — full width (the SiegeSpawner key sequence). */}
            <div className="col-span-2 sm:col-span-3 flex justify-between gap-2 pt-1 mt-1 border-t border-border/40">
              <span className="text-muted-foreground">Spawn</span>
              <span className="font-medium text-right">{m.spawn}</span>
            </div>
            {/* Native AI — read-only (lives in the monster's renderer, not editable here). */}
            <div className="col-span-2 sm:col-span-3 flex justify-between gap-3">
              <span className="text-muted-foreground shrink-0">Pathfinding</span>
              <span className="font-medium text-right">{m.pathfinding}</span>
            </div>
            <div className="col-span-2 sm:col-span-3 flex justify-between gap-3">
              <span className="text-muted-foreground shrink-0">Behavior</span>
              <span className="font-medium text-right">{m.behavior}</span>
            </div>
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted-foreground pt-1">
        Every Siege Worlds monster (catalog types 1–18) plus the Pole Dancer (decor). Stats come from
        the SWW monster catalog; names are editable here and the list auto-sorts alphabetically.
        Spawn in-game with the SiegeSpawner: press <b>!</b>, the two-digit npcType, then a quantity
        (0 = 10) — e.g. <b>!07</b> then <b>3</b> spawns 3 Spintrolls. Full stat editing lands with the
        unified monster registry.
      </p>
    </div>
  );
}
