import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { blockDB } from '@/hooks/useIndexedDB';

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
      
      // Store user ID in IndexedDB for persistent tracking
      if (data.user?.id) {
        await blockDB.setUserId(data.user.id);
      }
      
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
    let mounted = true;

    const initAuth = async () => {
      try {
        // CRITICAL: Check for existing session FIRST, before listener fires
        console.log('🔍 Checking for existing session...');
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        
        if (!mounted) return;

        if (existingSession) {
          console.log('✅ Found existing session, restoring:', existingSession.user?.id);
          setSession(existingSession);
          setUser(existingSession.user);
          
          // Sync IndexedDB in background
          blockDB.init().then(() => {
            blockDB.setUserId(existingSession.user.id).catch(console.error);
          });
        } else {
          console.log('❌ No existing session found, creating new anonymous user');
          await signInAnonymouslyInternal();
        }
      } catch (error) {
        console.error('❌ Error in initAuth:', error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    // Set up listener for future auth changes (after initial check)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('🔄 Auth state changed:', event, 'user:', session?.user?.id);
        
        if (!mounted) return;
        
        setSession(session);
        setUser(session?.user ?? null);
        
        // Handle sign out
        if (event === 'SIGNED_OUT') {
          blockDB.init().then(() => {
            blockDB.clearUserId().catch(console.error);
          });
        }
        
        // Sync IndexedDB on sign in
        if (event === 'SIGNED_IN' && session?.user?.id) {
          blockDB.init().then(() => {
            blockDB.setUserId(session.user.id).catch(console.error);
          });
        }
      }
    );

    // Initialize auth
    initAuth();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInAnonymously = async () => {
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      console.log('Signed in anonymously:', data.user?.id);
      if (data.user?.id) {
        await blockDB.setUserId(data.user.id);
      }
    } catch (error) {
      console.error('Error signing in anonymously:', error);
      toast.error('Failed to authenticate. Please refresh the page.');
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    try {
      await blockDB.clearUserId();
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
