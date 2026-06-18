// WalletList — the player's multi-coin holdings, grouped by ASSET with each chain VARIANT indented
// underneath and labeled by network (so USDT-on-Base reads separately from USDT-on-Ethereum).
import { Card } from '@/components/ui/card';
import { useWallet } from './useWallet';
import { networkLabel } from './types';

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function WalletList({ userId }: { userId: string | null }) {
  const { groups, isLoading } = useWallet(userId);

  if (isLoading) {
    return <Card className="p-4"><div className="text-sm text-muted-foreground">Loading wallet…</div></Card>;
  }
  if (!groups.length) {
    return (
      <Card className="p-4">
        <div className="text-sm text-muted-foreground">
          No coins yet. Earn DIVI or other coins in the world and a wallet is created for you automatically.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      {groups.map((g) => (
        <div key={g.asset.id} className="space-y-1">
          {/* Asset header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {g.asset.logo_url && <img src={g.asset.logo_url} alt="" className="w-6 h-6 rounded-full" />}
              <span className="font-semibold">{g.asset.symbol}</span>
              <span className="text-xs text-muted-foreground">{g.asset.display_name}</span>
              {g.asset.kind !== 'coin' && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {g.asset.kind}
                </span>
              )}
            </div>
            <span className="font-bold tabular-nums">{fmt(g.total)}</span>
          </div>
          {/* Per-chain variants, indented */}
          <div className="pl-8 space-y-0.5">
            {g.holdings.map((h) => (
              <div key={h.variant.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="opacity-60">└</span>
                  <span>{networkLabel(h.variant.network)}</span>
                  {h.variant.is_onchain && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-primary/15 text-primary">on-chain</span>
                  )}
                  {h.address && <span className="text-[10px] text-muted-foreground/70">{shortAddr(h.address)}</span>}
                </div>
                <span className="tabular-nums">{fmt(h.coins)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}
