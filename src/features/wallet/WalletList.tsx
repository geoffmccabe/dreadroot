// WalletList — the player's multi-coin holdings, organised CHAIN-FIRST: each network/chain is a
// section header ("… Chain/Network"), with the individual coins held on that chain listed
// underneath (monetary instruments shown as $SYMBOL - Name).
import { Card } from '@/components/ui/card';
import { useWallet } from './useWallet';
import { chainSectionLabel, displaySymbol, type WalletHolding } from './types';

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

export function WalletList({ userId }: { userId: string | null }) {
  const { holdings, isLoading } = useWallet(userId);

  if (isLoading) {
    return <Card className="p-4"><div className="text-sm text-foreground/70">Loading wallet…</div></Card>;
  }
  if (!holdings.length) {
    return (
      <Card className="p-4">
        <div className="text-sm text-foreground/70">
          No coins yet. Earn DIVI or other coins in the world and a wallet is created for you automatically.
        </div>
      </Card>
    );
  }

  // Group chain-first: network → coins held on it.
  const byChain = new Map<string, WalletHolding[]>();
  for (const h of holdings) {
    const key = h.variant.network || 'internal';
    let arr = byChain.get(key);
    if (!arr) { arr = []; byChain.set(key, arr); }
    arr.push(h);
  }
  // On-chain networks first, the internal game ledger last.
  const sections = Array.from(byChain.entries()).sort(([a], [b]) => {
    if (a === 'internal') return 1;
    if (b === 'internal') return -1;
    return chainSectionLabel(a).localeCompare(chainSectionLabel(b));
  });

  return (
    <Card className="p-4 space-y-4">
      {sections.map(([network, coins]) => (
        <div key={network} className="space-y-1.5">
          {/* Chain section header */}
          <div className="text-sm font-bold text-foreground">{chainSectionLabel(network)}</div>
          {/* Coins on this chain */}
          <div className="pl-3 ml-1 border-l border-foreground/25 space-y-1.5">
            {coins.map((h) => (
              <div key={h.variant.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-foreground">
                  {h.asset.logo_url && <img src={h.asset.logo_url} alt="" className="w-5 h-5 rounded-full" />}
                  <span className="font-semibold">{displaySymbol(h.asset)}</span>
                  <span className="text-foreground/75">- {h.asset.display_name}</span>
                  {h.variant.is_onchain && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-primary/20 text-primary">on-chain</span>
                  )}
                </div>
                <span className="tabular-nums font-bold text-foreground">{fmt(h.coins)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}
