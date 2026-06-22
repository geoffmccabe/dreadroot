// AdminPanel.ChestsPanel — define Magic Chests by number. Each chest has a Drop Table (from
// Admin/Items/Drop Tables) and a model style. Placing "Chest #N" in a map renders that style and
// rolls from its drop table. Persists to the `chests` table.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { CHEST_STYLES } from '@/components/siege/chest/chestStyles';

interface ChestRow { id: string; chest_number: number; drop_table_id: string | null; model_style: string; game: string; }
interface DropTable { id: string; name: string; }

export function ChestsPanel() {
  const [chests, setChests] = useState<ChestRow[]>([]);
  const [tables, setTables] = useState<DropTable[]>([]);
  const [num, setNum] = useState('');
  const [dt, setDt] = useState('');
  const [style, setStyle] = useState(CHEST_STYLES[0].id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const [c, t] = await Promise.all([
      supabase.from('chests').select('*').order('chest_number'),
      supabase.from('drop_tables').select('id, name').order('name'),
    ]);
    if (c.data) setChests(c.data as ChestRow[]);
    if (t.data) setTables(t.data as DropTable[]);
  };
  useEffect(() => { void load(); }, []);

  const add = async () => {
    const n = parseInt(num, 10);
    if (!Number.isFinite(n)) { setErr('Enter a chest number.'); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.from('chests').upsert(
      { chest_number: n, drop_table_id: dt || null, model_style: style, game: 'siege-worlds' },
      { onConflict: 'game,chest_number' },
    );
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setNum('');
    void load();
  };
  const del = async (id: string) => { await supabase.from('chests').delete().eq('id', id); void load(); };

  const sel = 'rounded bg-background/60 px-2 py-1 text-xs border border-border';

  return (
    <Card className="waterfall-card p-4 text-xs">
      <div className="font-bold text-primary mb-3">CHESTS — number → drop table + style</div>

      {/* Create / update */}
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <label className="flex flex-col gap-1">Chest #
          <input className={sel} style={{ width: 70 }} value={num} onChange={(e) => setNum(e.target.value)} placeholder="3" />
        </label>
        <label className="flex flex-col gap-1">Drop Table
          <select className={sel} value={dt} onChange={(e) => setDt(e.target.value)}>
            <option value="">(none)</option>
            {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">Style
          <select className={sel} value={style} onChange={(e) => setStyle(e.target.value)}>
            {CHEST_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <Button size="sm" className="h-7" disabled={busy} onClick={add}>Save chest</Button>
      </div>
      {err && <div className="text-destructive mb-2">{err}</div>}

      {/* Existing */}
      <div className="space-y-1">
        {chests.length === 0 && <div className="text-muted-foreground">No chests defined yet.</div>}
        {chests.map((c) => (
          <div key={c.id} className="flex items-center justify-between border-t border-border/40 py-1">
            <span><b>#{c.chest_number}</b> · {CHEST_STYLES.find((s) => s.id === c.model_style)?.label ?? c.model_style}
              {' · '}DT: {tables.find((t) => t.id === c.drop_table_id)?.name ?? '(none)'}</span>
            <Button size="sm" variant="destructive" className="h-6 px-2 text-[10px]" onClick={() => del(c.id)}>✕</Button>
          </div>
        ))}
      </div>
      <div className="text-muted-foreground mt-3">Tell me "put Chest #N at &lt;point&gt;" and I'll place it in the map.</div>
    </Card>
  );
}
