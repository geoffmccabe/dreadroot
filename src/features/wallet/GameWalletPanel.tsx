// GameWalletPanel — admin/superadmin-only overview of the GAME's reserves: the pool amount of every
// coin/token the game holds, plus each game wallet's deposit address (with a copy button) so the
// owner can top a pool up when it runs low. Collapsible; collapsed = just the "GAME WALLET" header.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { chainSectionLabel, displaySymbol, type TokenAsset } from './types';

interface VariantRow { id: string; asset_id: string | null; display_name: string; name: string; network: string; ticker_symbol: string | null; coin_image_url: string | null; }
interface AssetRow extends TokenAsset { is_active?: boolean }
interface PoolRow { token_theme_id: string; balance: number; source: 'funded' | 'minted'; deposit_address: string | null; }

interface Row { themeId: string; network: string; asset: TokenAsset; balance: number; source: string; address: string | null; }

const fmt = (n: number) => (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
const shortAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

export function GameWalletPanel() {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [vRes, aRes, pRes] = await Promise.all([
      supabase.from('token_themes').select('id, asset_id, display_name, name, network, ticker_symbol, coin_image_url').eq('is_active', true),
      supabase.from('token_assets' as never).select('*'),
      supabase.from('token_pools' as never).select('token_theme_id, balance, source, deposit_address'),
    ]);
    const variants = (vRes.data as unknown as VariantRow[]) ?? [];
    const assetById = new Map(((aRes.data as unknown as AssetRow[]) ?? []).map((a) => [a.id, a]));
    const poolByTheme = new Map(((pRes.data as unknown as PoolRow[]) ?? []).map((p) => [p.token_theme_id, p]));

    const out: Row[] = variants.map((v) => {
      const asset: TokenAsset = (v.asset_id && assetById.get(v.asset_id)) || {
        id: `theme:${v.id}`, symbol: v.ticker_symbol || v.name.toUpperCase(),
        display_name: v.display_name, kind: 'coin', logo_url: v.coin_image_url, sort_order: 9999,
      };
      const pool = poolByTheme.get(v.id);
      return { themeId: v.id, network: v.network || 'internal', asset, balance: pool?.balance ?? 0, source: pool?.source ?? 'none', address: pool?.deposit_address ?? null };
    });
    setRows(out);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const copy = async (addr: string) => {
    try { await navigator.clipboard.writeText(addr); setCopied(addr); setTimeout(() => setCopied((c) => (c === addr ? null : c)), 1500); } catch { /* ignore */ }
  };

  // Group chain-first (on-chain first, internal last).
  const byChain = new Map<string, Row[]>();
  for (const r of rows) { let a = byChain.get(r.network); if (!a) { a = []; byChain.set(r.network, a); } a.push(r); }
  const sections = Array.from(byChain.entries()).sort(([a], [b]) =>
    a === 'internal' ? 1 : b === 'internal' ? -1 : chainSectionLabel(a).localeCompare(chainSectionLabel(b)));

  return (
    <Card className="p-4">
      <button className="flex items-center gap-1.5 w-full text-left" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="w-4 h-4 text-foreground" /> : <ChevronRight className="w-4 h-4 text-foreground" />}
        <span className="font-bold text-foreground tracking-wide">GAME WALLET</span>
        <span className="text-[10px] text-foreground/60 ml-auto">admin</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {sections.map(([network, coins]) => (
            <div key={network} className="space-y-1.5">
              <div className="text-sm font-bold text-foreground">{chainSectionLabel(network)}</div>
              <div className="pl-3 ml-1 border-l border-foreground/25 space-y-1.5">
                {coins.map((r) => (
                  <div key={r.themeId} className="text-sm">
                    <div className="flex items-center justify-between text-foreground">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{displaySymbol(r.asset)}</span>
                        <span className="text-foreground/75">- {r.asset.display_name}</span>
                      </div>
                      <span className="tabular-nums font-bold">{fmt(r.balance)} <span className="text-[10px] font-normal text-foreground/60">in pool</span></span>
                    </div>
                    {r.address && (
                      <div className="flex items-center gap-1.5 text-foreground/75 mt-0.5">
                        <span className="font-mono text-xs">{shortAddr(r.address)}</span>
                        <button onClick={() => copy(r.address!)} title="Copy address" className="text-foreground/60 hover:text-foreground">
                          {copied === r.address ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!rows.length && <div className="text-sm text-foreground/70">No coins defined yet.</div>}
        </div>
      )}
    </Card>
  );
}
