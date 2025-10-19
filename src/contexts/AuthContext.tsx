import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useIndexedDB } from '@/hooks/useIndexedDB';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

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

  const signOut = async () => {
    try {
      console.log('Signing out user:', user?.id);
      
      // Clear IndexedDB session first
      await clearUserSession();
      
      // Then sign out from Supabase (this will trigger auth state change)
      const { error } = await supabase.auth.signOut();
      
      if (error) {
        console.error('Supabase signOut error:', error);
        throw error;
      }
      
      console.log('Successfully signed out');
      toast.success('Signed out successfully');
    } catch (error) {
      console.error('Error signing out:', error);
      toast.error('Failed to sign out');
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signUp, signIn, signOut }}>
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
