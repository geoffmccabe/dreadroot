// DiviGo connect — the player-facing half of the LW-SSO OAuth flow that lets DreadRoot read their
// authoritative custodial DIVI balance (proving wallet control via the SSO Telegram link).
//
//   startDivigoConnect()        -> full-page redirect to the SSO consent screen. On approve the SSO
//                                  redirects back to THIS url with #app_token=… in the fragment.
//   captureDivigoTokenOnBoot()  -> called once at app start: if we came back with a token, hand it to
//                                  the divigo-connect edge fn to store, then strip it from the URL.
// The token never hits a server log (fragment only) until we POST it over TLS to our own edge fn.
import { supabase } from '@/integrations/supabase/client';

const SSO_BASE_URL = ((import.meta.env.VITE_SSO_BASE_URL as string | undefined) || 'https://sso.lightningworks.io').replace(/\/$/, '');
const APP_SLUG = (import.meta.env.VITE_DIVIGO_APP_SLUG as string | undefined) || 'dreadroot';

/** Redirect to the SSO consent screen to authorize balance:read. Returns to the current page. */
export function startDivigoConnect(): void {
  const ret = window.location.origin + window.location.pathname;   // no hash/query — clean return target
  const url = `${SSO_BASE_URL}/wallet/divi/grant?app=${encodeURIComponent(APP_SLUG)}`
    + `&scopes=balance:read&return=${encodeURIComponent(ret)}`;
  window.location.href = url;
}

/**
 * If the SSO bounced us back with a DiviGo token, store it and clean the URL. Resolves to:
 *   'connected' | 'denied' | null (nothing to do). Safe to call on every boot.
 */
export async function captureDivigoTokenOnBoot(): Promise<'connected' | 'denied' | null> {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  const granted = new URLSearchParams(window.location.search).get('divigo_granted');
  if (!hash.includes('app_token=') && granted == null) return null;

  const token = new URLSearchParams(hash).get('app_token');
  const clean = () => {
    const u = new URL(window.location.href);
    u.hash = '';
    u.searchParams.delete('divigo_granted');
    window.history.replaceState({}, '', u.toString());
  };

  if (!token) { clean(); return granted === '0' ? 'denied' : null; }
  try {
    await supabase.functions.invoke('divigo-connect', { body: { app_token: token } });
    return 'connected';
  } catch {
    return null;
  } finally {
    clean();
  }
}
