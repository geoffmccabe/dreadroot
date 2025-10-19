import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
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
  const isSigningInRef = useRef(false); // Guard against multiple sign-in attempts

  const signInAnonymouslyInternal = async () => {
    // Prevent multiple simultaneous sign-in attempts
    if (isSigningInRef.current) {
      console.log('⏸️ Sign-in already in progress, skipping');
      return;
    }

    try {
      isSigningInRef.current = true;
      console.log('🔑 Starting anonymous sign-in...');
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      console.log('✅ Signed in anonymously:', data.user?.id);
      return data;
    } catch (error) {
      console.error('❌ Error signing in anonymously:', error);
      toast.error('Failed to authenticate. Please refresh the page.');
      setIsLoading(false);
      throw error;
    } finally {
      isSigningInRef.current = false;
    }
  };

  useEffect(() => {
    let isInitializing = true;
    
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
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('❌ Error getting session:', error);
        }
        
        if (session) {
          console.log('✅ Found existing session:', session.user?.id);
          setSession(session);
          setUser(session.user);
        } else {
          // Only auto sign-in if there's truly no session
          console.log('🔑 No existing session, creating anonymous user...');
          await signInAnonymouslyInternal();
        }
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
