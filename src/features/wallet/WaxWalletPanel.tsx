// WaxWalletPanel — embeds the LW-SSO Wax wallet UI (TLM + Alien Worlds planet coins + NFTs) as a
// native-feeling panel via an iframe. The SSO page is account-parameterized (?account=…) so it shows
// public on-chain data without needing its login session inside the frame. DISPLAY only — token-
// gating reads server-synced holdings, never the iframe (which a client could forge).
//
// Per-user (S3): loads the user's linked Wax account; if they connect a wallet inside the iframe the
// SSO posts it back ({source:'lw-sso', type:'wax-account', account}) and we persist + use it. Until
// a real account is linked it falls back to a test account so the embed can be verified end-to-end.
// See docs/WAX_WALLET_IFRAME_PLAN.md.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { worldStore } from '@/services/worldStore';

const SSO_BASE_URL = ((import.meta.env.VITE_SSO_BASE_URL as string | undefined) || 'https://sso.lightningworks.io').replace(/\/$/, '');
const SSO_ORIGIN = (() => { try { return new URL(SSO_BASE_URL).origin; } catch { return SSO_BASE_URL; } })();
const TEST_ACCOUNT = 'phmo4.c.wam';   // temporary fallback so the embed can be tested before any link exists

export function WaxWalletPanel({ userId }: { userId: string | null }) {
  const [account, setAccount] = useState<string | null>(null);
  const [height, setHeight] = useState(560);
  const [loaded, setLoaded] = useState(false);

  // Load the user's linked Wax account.
  useEffect(() => {
    let alive = true;
    if (!userId) { setAccount(null); return; }
    worldStore.getWalletLink('wax').then((a) => { if (alive) setAccount(a); });
    return () => { alive = false; };
  }, [userId]);

  // Only trust messages from the SSO origin. Capture the connected Wax account + auto-resize.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== SSO_ORIGIN) return;
      const d = e.data as { source?: string; type?: string; height?: number; account?: string } | null;
      if (!d || d.source !== 'lw-sso') return;
      if (d.type === 'resize' && typeof d.height === 'number') {
        setHeight(Math.max(240, Math.min(2000, Math.round(d.height))));
      } else if (d.type === 'wax-account' && typeof d.account === 'string' && d.account) {
        setAccount(d.account);
        void worldStore.setWalletLink('wax', d.account);     // persist the link for next time + the sync
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const effectiveAccount = account ?? TEST_ACCOUNT;
  // ?account omitted → the SSO page shows its own "connect your Wax wallet" flow inside the iframe.
  const src = `${SSO_BASE_URL}/wallet/wax?account=${encodeURIComponent(effectiveAccount)}&embed=1&theme=dreadroot`;

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
