import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

  const signInAnonymouslyInternal = async () => {
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      console.log('✅ Signed in anonymously:', data.user?.id);
      return data;
    } catch (error) {
      console.error('❌ Error signing in anonymously:', error);
      toast.error('Failed to authenticate. Please refresh the page.');
      setIsLoading(false);
      throw error;
    }
  };

  useEffect(() => {
    let isInitializing = true;
    
    // CRITICAL: Clear ALL Supabase auth data on mount to prevent stale sessions
    console.log('🧹 Clearing all auth storage to prevent stale sessions');
    localStorage.removeItem('sb-ditecxjpkgbqkeckebzb-auth-token');
    
    // Clean up old temp-user-id from localStorage (migration cleanup)
    const oldTempId = localStorage.getItem('temp-user-id');
    if (oldTempId) {
      console.log('🧹 Removing old temp-user-id from localStorage');
      localStorage.removeItem('temp-user-id');
    }

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('🔄 Auth state changed:', event, 'user:', session?.user?.id);
        setSession(session);
        setUser(session?.user ?? null);
        
        // Only set loading to false if we're not in the initial setup
        if (!isInitializing) {
          setIsLoading(false);
        }
      }
    );

    // THEN check for existing session or auto sign-in
    const initAuth = async () => {
      try {
        // After clearing storage, there should be no session
        console.log('🔑 Creating fresh anonymous user...');
        await signInAnonymouslyInternal();
      } catch (error) {
        console.error('❌ Error in initAuth:', error);
      } finally {
        isInitializing = false;
        setIsLoading(false);
      }
    };

    initAuth();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

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
