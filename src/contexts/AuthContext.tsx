import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useIndexedDB } from '@/hooks/useIndexedDB';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signInAnonymously: () => Promise<void>;
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

    // THEN check for existing session or auto sign-in
    const initAuth = async () => {
      console.log('🔐 Starting auth initialization...');
      
      // Step 1: Check Supabase localStorage session
      const { data: { session: supabaseSession } } = await supabase.auth.getSession();
      console.log('📦 Supabase session:', supabaseSession?.user?.id || 'null');
      
      // Step 2: Check IndexedDB for last known user
      const storedSession = await getUserSession();
      console.log('💾 IndexedDB stored user:', storedSession?.user_id || 'null');
      
      // Step 3: Decision logic
      if (supabaseSession) {
        // Supabase has a session - let onAuthStateChange handle state update
        console.log('✅ Using Supabase session:', supabaseSession.user.id);
        // Don't set state here - onAuthStateChange will handle it
        
      } else if (storedSession?.user_id) {
        // No Supabase session, but IndexedDB has a user
        console.log('⚠️ Supabase session lost, but IndexedDB has user:', storedSession.user_id);
        console.log('🔄 Creating new anonymous session (session expired)...');
        
        // Session expired - create new anonymous user
        await signInAnonymously();
        
      } else {
        // Neither Supabase nor IndexedDB has user data
        console.log('🆕 No existing user found - creating first anonymous user');
        await signInAnonymously();
      }
    };

    initAuth();

    return () => subscription.unsubscribe();
  }, []); // Empty deps - only run once on mount

  const signInAnonymously = async () => {
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      console.log('Signed in anonymously:', data.user?.id);
    } catch (error) {
      console.error('Error signing in anonymously:', error);
      toast.error('Failed to authenticate. Please refresh the page.');
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    try {
      // Clear IndexedDB session first
      await clearUserSession();
      
      // Then sign out from Supabase
      await supabase.auth.signOut();
      
      toast.success('Signed out successfully');
    } catch (error) {
      console.error('Error signing out:', error);
      toast.error('Failed to sign out');
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signInAnonymously, signOut }}>
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
