import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { initLogStep } from '@/contexts/InitializationContext';
import { getOrCreateDeviceId, loadGuestIdentity, saveGuestIdentity } from '@/features/guest/guestIdentity';

/** Resolve to `fallback` if a promise has not settled in time. Browser storage
 *  can hang rather than fail, and a hang is indistinguishable from a dead
 *  button. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// Dedupe guard for init log - prevents duplicate "User: email" rows
let lastInitLoggedEmail: string | null = null;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signInWithSSO: () => void;
  signInAsGuest: () => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

// Lightningworks SSO base URL (override per-env via VITE_SSO_BASE_URL).
const SSO_BASE_URL = (
  (import.meta.env.VITE_SSO_BASE_URL as string | undefined) || 'https://sso.lightningworks.io'
).replace(/\/$/, '');

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { saveUserSession, getUserSession, clearUserSession } = useIndexedDB();

  // Separate effect for IndexedDB sync - reacts to session changes
  useEffect(() => {
    if (session?.user?.id) {
      // Save to IndexedDB when we have a session
      saveUserSession(session.user.id).catch(err => {
        console.error('Failed to save user session to IndexedDB:', err);
      });
    } else if (session === null && user === null && !isLoading) {
      // Clear IndexedDB when explicitly signed out
      clearUserSession().catch(err => {
        console.error('Failed to clear user session from IndexedDB:', err);
      });
    }
  }, [session, user, isLoading, saveUserSession, clearUserSession]);

  useEffect(() => {
    // Clean up old temp-user-id from localStorage (migration cleanup)
    const oldTempId = localStorage.getItem('temp-user-id');
    if (oldTempId) {
      console.log('Removing old temp-user-id from localStorage');
      localStorage.removeItem('temp-user-id');
    }

    // Set up auth state listener FIRST (synchronous only - no async calls)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        console.log('🔔 Auth state changed:', event, newSession?.user?.id);
        // Only update state - IndexedDB handled in separate effect
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setIsLoading(false);
        
        // Guests: keep our stored refresh token current. Supabase ROTATES the
        // refresh token on every renewal, so a copy taken once at sign-in goes
        // stale and the "come back weeks later" resume would silently fail.
        if (newSession?.user?.is_anonymous && newSession.refresh_token) {
          void saveGuestIdentity({
            guestUserId: newSession.user.id,
            refreshToken: newSession.refresh_token,
          });
        }

        // Log user info for initialization overlay (only once per email to avoid duplicates)
        if (newSession?.user) {
          const email = newSession.user.email || (newSession.user.is_anonymous ? 'guest' : 'unknown');
          if (email !== lastInitLoggedEmail) {
            lastInitLoggedEmail = email;
            initLogStep('AuthContext.tsx', `User: ${email}`);
          }
        }
      }
    );

    // THEN check for existing session
    const initAuth = async () => {
      console.log('🔐 Starting auth initialization...');
      
      // Check Supabase localStorage session
      const { data: { session: supabaseSession } } = await supabase.auth.getSession();
      console.log('📦 Supabase session:', supabaseSession?.user?.id || 'null');
      
      if (supabaseSession) {
        // Supabase has a session - let onAuthStateChange handle state update
        console.log('✅ Using Supabase session:', supabaseSession.user.id);
      } else {
        // No session - user will be redirected to /auth by route protection
        console.log('❌ No session found');
        setIsLoading(false);
      }
    };

    initAuth();

    return () => subscription.unsubscribe();
  }, []); // Empty deps - only run once on mount

  const signUp = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`
        }
      });
      
      if (error) return { error };
      
      console.log('Signed up successfully:', data.user?.id);
      return { error: null };
    } catch (error) {
      console.error('Error signing up:', error);
      return { error };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      
      if (error) return { error };
      
      console.log('Signed in successfully:', data.user?.id);
      return { error: null };
    } catch (error) {
      console.error('Error signing in:', error);
      return { error };
    }
  };

  // Lightningworks SSO: hand off to the SSO login page. It returns to
  // /auth/callback with the token in the URL fragment (handled by AuthCallback).
  const signInWithSSO = () => {
    const redirect = `${window.location.origin}/auth/callback`;
    window.location.href =
      `${SSO_BASE_URL}/login?app=dreadroot&redirect=${encodeURIComponent(redirect)}`;
  };

  /**
   * "Play Without Account" — one guest account per device.
   *
   * The guest is a genuine Supabase ANONYMOUS auth user, so auth.uid(), RLS,
   * the signup trigger and every existing RPC keep working with no special
   * cases. What it lacks is an email, which is what makes it unrecoverable
   * once the browser forgets it.
   *
   * RESUME FIRST. If this device already has a guest and we still hold its
   * refresh token, we revive that account rather than making a new one — that
   * is what lets somebody come back days or weeks later and still find their
   * stuff. If the token is gone or expired, they get a fresh guest and the old
   * one is simply abandoned, which the design accepts.
   */
  const signInAsGuest = async () => {
    /**
     * SIGN IN FIRST. Storage bookkeeping comes AFTER, and never blocks.
     *
     * This used to await getOrCreateDeviceId() before touching Supabase, which
     * put IndexedDB on the critical path of "let me play". In a private window
     * that is exactly the wrong order: storage there is restricted, fresh, and
     * in some configurations opening a database hangs or throws — so the one
     * flow whose entire promise is "start instantly, no account" was gated on
     * the slowest, least reliable thing in the browser.
     *
     * The device id only exists so a guest can be RESUMED on a later visit.
     * Failing to record it costs a future resume; failing to sign in costs the
     * whole feature. So the ordering follows the stakes.
     */
    try {
      // A returning guest, if this browser still holds their token. Wrapped
      // and time-boxed so unavailable storage cannot stall the button.
      const saved = await withTimeout(loadGuestIdentity(), 1500, null);
      if (saved?.refreshToken) {
        const { data, error } = await supabase.auth.refreshSession({
          refresh_token: saved.refreshToken,
        });
        if (!error && data.session) {
          void rememberGuest(data.session.user.id, data.session.refresh_token);
          return { error: null };
        }
        // Expired or revoked — fall through and start a fresh guest.
      }

      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.error('[guest] signInAnonymously failed', error);
        toast.error('Could not start a guest session', { description: error.message });
        return { error };
      }
      if (!data.session) {
        const msg = 'no session returned';
        console.error('[guest] ' + msg, data);
        toast.error('Could not start a guest session', { description: msg });
        return { error: new Error(msg) };
      }

      // Bookkeeping, deliberately NOT awaited: the player is already in.
      void rememberGuest(data.session.user.id, data.session.refresh_token);
      return { error: null };
    } catch (err) {
      // Never swallow this. A silent catch here is why "clicking does nothing"
      // was all anyone could report.
      console.error('[guest] unexpected failure', err);
      toast.error('Could not start a guest session', {
        description: (err as Error)?.message ?? String(err),
      });
      return { error: err };
    }
  };

  /** Record the guest for a future resume. Best-effort by design — every step
   *  here is optional, and none of it should ever stop someone playing. */
  const rememberGuest = async (userId: string, refreshToken: string) => {
    try {
      const deviceId = await withTimeout(getOrCreateDeviceId(), 2000, null);
      if (!deviceId) return;
      await saveGuestIdentity({ deviceId, guestUserId: userId, refreshToken });
      await registerDevice(deviceId);
    } catch (err) {
      console.warn('[guest] could not record this device — resume may not work later', err);
    }
  };

  /** Bind this device to the signed-in guest. Never blocks entering the game:
   *  failing to record the device costs a future resume, not this session. */
  const registerDevice = async (deviceId: string) => {
    try {
      await supabase.rpc('register_guest_device', {
        p_device_id: deviceId,
        p_user_agent: navigator.userAgent,
      });
    } catch {
      /* non-fatal by design */
    }
  };

  const signOut = async () => {
    // Force navigate to clear session page which will handle cleanup
    window.location.href = '/clear-session';
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signUp, signIn, signInWithSSO, signInAsGuest, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
