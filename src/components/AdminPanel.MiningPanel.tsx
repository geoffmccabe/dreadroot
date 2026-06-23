// AdminPanel.MiningPanel — define Mining node types (the rules for each crystal/ore tier). Each
// type: tier, label, crystal model/colour, the pickaxe tier required to mine it, the hold time,
// and the yield (an ore item now; token/crypto later). Placing a crystal of a tier in a world
// uses these rules. Persists to `mining_node_types`.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { MINING_STYLES } from '@/components/siege/mining/miningStyles';

interface NodeType {
  id: string; game: string; tier: number; label: string; model_style: string;
  required_pickaxe_tier: number; mine_seconds: number; yield_type: string; yield_item_number: number | null;
}

export function MiningPanel() {
  const [rows, setRows] = useState<NodeType[]>([]);
  const [f, setF] = useState({ tier: '', label: '', model_style: MINING_STYLES[0].file, required_pickaxe_tier: '', mine_seconds: '3', yield_type: 'ore', yield_item_number: '' });
  const [err, setErr] = useState<string | null>(null);

  const load = async () => { const { data } = await supabase.from('mining_node_types').select('*').order('tier'); if (data) setRows(data as NodeType[]); };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    const tier = parseInt(f.tier, 10);
    if (!Number.isFinite(tier)) { setErr('Enter a tier number.'); return; }
    setErr(null);
    const { error } = await supabase.from('mining_node_types').upsert({
      game: 'siege-worlds', tier, label: f.label,
      model_style: f.model_style, required_pickaxe_tier: parseInt(f.required_pickaxe_tier, 10) || 0,
      mine_seconds: parseFloat(f.mine_seconds) || 3, yield_type: f.yield_type,
      yield_item_number: f.yield_item_number ? parseInt(f.yield_item_number, 10) : null,
    }, { onConflict: 'game,tier' });
    if (error) { setErr(error.message); return; }
    setF({ ...f, tier: '', label: '', yield_item_number: '' });
    void load();
  };
  const del = async (id: string) => { await supabase.from('mining_node_types').delete().eq('id', id); void load(); };

  const sel = 'rounded bg-background/60 px-2 py-1 text-xs border border-border';
  const fld = (w: number, key: keyof typeof f, ph: string) =>
    <input className={sel} style={{ width: w }} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} placeholder={ph} />;

  return (
    <Card className="waterfall-card p-4 text-xs">
      <div className="font-bold text-primary mb-3">MINING NODE TYPES — tier rules (pickaxe + time + yield)</div>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <label className="flex flex-col gap-1">Tier {fld(56, 'tier', '0')}</label>
        <label className="flex flex-col gap-1">Label {fld(110, 'label', 'Iron Crystal')}</label>
        <label className="flex flex-col gap-1">Crystal
          <select className={sel} value={f.model_style} onChange={(e) => setF({ ...f, model_style: e.target.value })}>
            {MINING_STYLES.map((s) => <option key={s.id} value={s.file}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">Pickaxe tier {fld(70, 'required_pickaxe_tier', '0')}</label>
        <label className="flex flex-col gap-1">Mine sec {fld(60, 'mine_seconds', '3')}</label>
        <label className="flex flex-col gap-1">Yield
          <select className={sel} value={f.yield_type} onChange={(e) => setF({ ...f, yield_type: e.target.value })}>
            <option value="ore">ore item</option><option value="token">token</option><option value="crypto">crypto</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">Ore item # {fld(70, 'yield_item_number', '162')}</label>
        <Button size="sm" className="h-7" onClick={save}>Save tier</Button>
      </div>
      {err && <div className="text-destructive mb-2">{err}</div>}
      <div className="space-y-1">
        {rows.length === 0 && <div className="text-muted-foreground">No mining tiers defined yet.</div>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between border-t border-border/40 py-1">
            <span><b style={{ fontSize: '14px' }}>TIER {r.tier}</b> &nbsp;·&nbsp; {r.label || '(unnamed)'}
              {' · '}{MINING_STYLES.find((s) => s.file === r.model_style)?.label ?? r.model_style}
              {' · '}pickaxe ≥{r.required_pickaxe_tier} · {r.mine_seconds}s · {r.yield_type}{r.yield_item_number != null ? ` #${r.yield_item_number}` : ''}</span>
            <Button size="sm" variant="destructive" className="h-6 px-2 text-[10px]" onClick={() => del(r.id)}>✕</Button>
          </div>
        ))}
      </div>
      <div className="text-muted-foreground mt-3">Then tell me "place a Tier-N crystal at &lt;point&gt;" and I'll hide it in the map.</div>
    </Card>
  );
}
