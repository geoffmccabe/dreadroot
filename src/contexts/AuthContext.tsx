import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { initLogStep } from '@/contexts/InitializationContext';

// Dedupe guard for init log - prevents duplicate "User: email" rows
let lastInitLoggedEmail: string | null = null;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signInWithSSO: () => void;
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
        
        // Log user info for initialization overlay (only once per email to avoid duplicates)
        if (newSession?.user) {
          const email = newSession.user.email || 'unknown';
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

  const signOut = async () => {
    // Force navigate to clear session page which will handle cleanup
    window.location.href = '/clear-session';
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signUp, signIn, signInWithSSO, signOut }}>
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
