// WaxWalletPanel — embeds the LW-SSO Wax wallet UI (TLM + Alien Worlds planet coins + NFTs) as a
// native-feeling panel via an iframe. The SSO page is account-parameterized (?account=…) so it shows
// public on-chain data without needing its login session inside the frame. DISPLAY only — token-
// gating reads server-synced holdings, never the iframe (which a client could forge).
//
// Per-user (S3): loads the user's linked Wax account; if they connect a wallet inside the iframe the
// SSO posts it back ({source:'lw-sso', type:'wax-account', account}) and we persist + use it. Until
// a real account is linked it falls back to a test account so the embed can be verified end-to-end.
// See docs/WAX_WALLET_IFRAME_PLAN.md.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { worldStore } from '@/services/worldStore';

const SSO_BASE_URL = ((import.meta.env.VITE_SSO_BASE_URL as string | undefined) || 'https://sso.lightningworks.io').replace(/\/$/, '');
const SSO_ORIGIN = (() => { try { return new URL(SSO_BASE_URL).origin; } catch { return SSO_BASE_URL; } })();
const TEST_ACCOUNT = 'phmo4.c.wam';   // temporary fallback so the embed can be tested before any link exists

// Snapshot the User Panel's *effective* theme (custom props inherit, so reading from the panel-scoped
// element gives the per-world accent + frosted-blue HUD colors) and hand them to the SSO iframe as theme
// params. The SSO wax page applies these when embed=1 so the wallet blends into the game's glass panel.
function buildThemeParams(el: HTMLElement | null): string {
  const cs = el ? getComputedStyle(el) : null;
  const v = (name: string, fb: string) => (cs?.getPropertyValue(name).trim() || fb);
  const bgH = v('--hud-bg-h', '211 30% 51%');          // base hue/sat/lum; alpha composed here
  const text = v('--hud-text', '211 32% 90%');
  const textDim = v('--hud-text-dim', '211 32% 70%');
  const textBright = v('--hud-text-bright', '211 32% 98%');
  const primary = v('--primary', '200 85% 55%');        // panel-scoped HUD accent (.user-panel-dialog)
  const radius = v('--hud-radius', '6px');
  return new URLSearchParams({
    primary_color: `hsl(${primary})`,
    primary_hover_color: `hsl(${primary})`,
    bg_color: 'transparent',                            // let the game's frosted panel show through
    panel_bg_color: `hsl(${bgH} / 0.18)`,
    wallet_row_bg_color: `hsl(${bgH} / 0.28)`,
    text_color: `hsl(${text})`,
    text_secondary_color: `hsl(${textDim})`,
    text_muted_color: `hsl(${textDim})`,
    text_white_color: `hsl(${textBright})`,
    divider_color: `hsl(${bgH} / 0.5)`,
    border_radius: radius,
    font_family: "'Inter', sans-serif",
  }).toString();
}

export function WaxWalletPanel({ userId }: { userId: string | null }) {
  const [account, setAccount] = useState<string | null>(null);
  const [height, setHeight] = useState(560);
  const [loaded, setLoaded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [themeQS, setThemeQS] = useState('');

  // Read the live panel colors before paint, once mounted, so the iframe URL carries the real theme.
  useLayoutEffect(() => { setThemeQS(buildThemeParams(cardRef.current)); }, []);

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
  const src = `${SSO_BASE_URL}/wallet/wax?account=${encodeURIComponent(effectiveAccount)}&embed=1&${themeQS}`;

  return (
    <Card ref={cardRef} className="p-0 overflow-hidden">
      <div className="px-4 pt-3 text-sm font-bold text-foreground">Wax Wallet</div>
      {!loaded && <div className="px-4 py-6 text-sm text-foreground/70">Loading Wax wallet…</div>}
      {themeQS && (
        <iframe
          title="Wax Wallet"
          src={src}
          onLoad={() => setLoaded(true)}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
          style={{ width: '100%', height, border: 0, background: 'transparent', display: loaded ? 'block' : 'none' }}
        />
      )}
    </Card>
  );
}
