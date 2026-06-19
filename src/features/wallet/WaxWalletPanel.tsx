// WaxWalletPanel — embeds the LW-SSO Wax wallet UI (TLM + Alien Worlds planet coins + NFTs) as a
// native-feeling panel via an iframe. The SSO page is account-parameterized (?account=…) so it shows
// public on-chain data without needing its login session inside the frame. The iframe is DISPLAY
// only — token-gating reads server-synced holdings, never the iframe (which a client could forge).
// See docs/WAX_WALLET_IFRAME_PLAN.md.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';

const SSO_BASE_URL = ((import.meta.env.VITE_SSO_BASE_URL as string | undefined) || 'https://sso.lightningworks.io').replace(/\/$/, '');
const SSO_ORIGIN = (() => { try { return new URL(SSO_BASE_URL).origin; } catch { return SSO_BASE_URL; } })();

export function WaxWalletPanel({ account }: { account: string | null }) {
  const [height, setHeight] = useState(560);
  const [loaded, setLoaded] = useState(false);

  // Only ever trust messages from the SSO origin (a forged message from elsewhere is ignored).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== SSO_ORIGIN) return;
      const d = e.data as { source?: string; type?: string; height?: number } | null;
      if (!d || d.source !== 'lw-sso') return;
      if (d.type === 'resize' && typeof d.height === 'number') {
        setHeight(Math.max(240, Math.min(2000, Math.round(d.height))));
      }
      // 'wax-account' is handled by the wallet integration (stores the linked account) — added in S3.
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  if (!account) {
    return (
      <Card className="p-4">
        <div className="text-sm font-bold text-foreground mb-1">Wax Wallet</div>
        <div className="text-sm text-foreground/70">
          Connect your Wax wallet in Lightningworks to see your Trilium, planet coins and Alien Worlds NFTs here.
        </div>
      </Card>
    );
  }

  const src = `${SSO_BASE_URL}/wallet/wax?account=${encodeURIComponent(account)}&embed=1&theme=dreadroot`;
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 pt-3 text-sm font-bold text-foreground">Wax Wallet</div>
      {!loaded && <div className="px-4 py-6 text-sm text-foreground/70">Loading Wax wallet…</div>}
      <iframe
        title="Wax Wallet"
        src={src}
        onLoad={() => setLoaded(true)}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
        style={{ width: '100%', height, border: 0, display: loaded ? 'block' : 'none' }}
      />
    </Card>
  );
}
