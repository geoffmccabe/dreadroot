// TierBenefitsEditor — the BENEFITS sub-panel of a supporter tier. Each row = a benefit from the
// catalog with a value (count / percent / on-off) + a per-benefit cadence (once / monthly /
// persistent) + an enable toggle. Phase 1: config only — NOT wired into gameplay yet.
// See docs/SUPPORTER_TIERS_PLAN.md.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BENEFIT_CATALOG, type SupporterBenefit, type BenefitCadence } from './types';

export function TierBenefitsEditor({ tierId }: { tierId: string }) {
  const [benefits, setBenefits] = useState<SupporterBenefit[]>([]);
  const [pick, setPick] = useState(BENEFIT_CATALOG[0].key);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('supporter_benefits' as never).select('*').eq('tier_id', tierId).order('sort_order');
    setBenefits((data as unknown as SupporterBenefit[]) ?? []);
  }, [tierId]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const cat = BENEFIT_CATALOG.find((c) => c.key === pick);
    if (!cat) return;
    setBusy(true);
    try {
      await supabase.from('supporter_benefits' as never).insert({
        tier_id: tierId, benefit_key: cat.key, value_type: cat.valueType,
        value: cat.valueType === 'toggle' ? 1 : 0, cadence: cat.defaultCadence, enabled: true,
        note: cat.key === 'blocks' && note ? note : null,
      } as never);
      setNote('');
      await load();
    } finally { setBusy(false); }
  };
  const patch = async (b: SupporterBenefit, fields: Partial<SupporterBenefit>) => {
    await supabase.from('supporter_benefits' as never).update(fields as never).eq('id', b.id); await load();
  };
  const del = async (id: string) => { await supabase.from('supporter_benefits' as never).delete().eq('id', id); await load(); };

  const label = (key: string) => BENEFIT_CATALOG.find((c) => c.key === key)?.label ?? key;

  return (
    <div className="space-y-1.5">
      {benefits.map((b) => (
        <div key={b.id} className="flex items-center gap-2 text-xs text-foreground">
          <input type="checkbox" checked={b.enabled} onChange={(e) => patch(b, { enabled: e.target.checked })} title="enabled" />
          <span className="flex-1 truncate">{label(b.benefit_key)}{b.note ? ` (${b.note})` : ''}</span>
          {b.value_type !== 'toggle' && (
            <Input
              className="h-6 text-xs w-16" type="number" value={String(b.value)}
              onChange={(e) => patch(b, { value: parseFloat(e.target.value) || 0 })}
              title={b.value_type === 'percent' ? 'percent' : 'count'}
            />
          )}
          {b.value_type === 'percent' && <span className="text-foreground/60">%</span>}
          <select className="text-xs border rounded px-1 py-0.5 bg-background" value={b.cadence}
                  onChange={(e) => patch(b, { cadence: e.target.value as BenefitCadence })}>
            <option value="once">once</option><option value="monthly">monthly</option><option value="persistent">persistent</option>
          </select>
          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => del(b.id)}>✕</Button>
        </div>
      ))}
      {!benefits.length && <div className="text-xs text-foreground/60">No benefits yet.</div>}

      {/* Add a benefit */}
      <div className="flex items-center gap-1.5 pt-1">
        <select className="text-xs border rounded px-1 py-1 bg-background" value={pick} onChange={(e) => setPick(e.target.value)}>
          {BENEFIT_CATALOG.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        {pick === 'blocks' && <Input className="h-7 text-xs w-28" placeholder="block type (opt)" value={note} onChange={(e) => setNote(e.target.value)} />}
        <Button size="sm" className="h-7" disabled={busy} onClick={add}>Add</Button>
      </div>
    </div>
  );
}
