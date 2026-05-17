import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

// Normal logout: clear ONLY the Supabase auth session. Preserve the
// IndexedDB chunk cache + cache-version + settings — nuking those on every
// logout was forcing 100% cold re-fetch from Supabase (0% cache hit, the
// dominant GC-churn / lag source, and why trees loaded slow/cold).
//
// /clear-session?hard=1  still does the full wipe (debug recovery escape).
export default function ClearSession() {
  const navigate = useNavigate();

  useEffect(() => {
    const run = async () => {
      const hard = new URLSearchParams(window.location.search).has('hard');

      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn('signOut error (continuing):', e);
      }

      if (hard) {
        console.log('[ClearSession] HARD reset — wiping all storage + IndexedDB');
        localStorage.clear();
        sessionStorage.clear();
        try {
          const dbs = await indexedDB.databases();
          for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
        } catch (e) {
          console.warn('Could not clear IndexedDB:', e);
        }
      } else {
        // Auth-only: drop leftover Supabase auth keys, keep cache/settings.
        try {
          for (const k of Object.keys(localStorage)) {
            if (k.startsWith('sb-') || k === 'temp-user-id') localStorage.removeItem(k);
          }
        } catch { /* ignore */ }
      }

      navigate('/auth', { replace: true });
    };
    run();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-secondary/10">
      <div className="text-center">
        <div className="text-xl mb-4">Signing out…</div>
        <div className="text-sm text-muted-foreground">Please wait</div>
      </div>
    </div>
  );
}
