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
    console.log('🚀 AuthContext mounting...');
    let mounted = true;
    
    // Check localStorage immediately
    const lsKeys = Object.keys(localStorage);
    console.log('📦 localStorage has', lsKeys.length, 'keys');
    const authKeys = lsKeys.filter(k => k.includes('supabase') || k.includes('auth'));
    console.log('🔑 Auth-related keys:', authKeys);
    
    // Don't create ANY auth state listeners - just get session and create user if needed
    const initOnce = async () => {
      try {
        // Prevent multiple calls
        if (isSigningInRef.current) {
          console.log('⏸️ Already initializing, skipping');
          return;
        }
        
        isSigningInRef.current = true;
        console.log('🔍 Calling getSession()...');
        
        const { data: { session: existingSession }, error } = await supabase.auth.getSession();
        
        console.log('📊 getSession() returned:', {
          hasSession: !!existingSession,
          userId: existingSession?.user?.id,
          error: error?.message,
          isAnonymous: existingSession?.user?.is_anonymous
        });
        
        if (!mounted) {
          console.log('⚠️ Component unmounted, aborting');
          return;
        }

        if (existingSession) {
          console.log('✅ Session exists, using it');
          setSession(existingSession);
          setUser(existingSession.user);
          await blockDB.init();
          await blockDB.setUserId(existingSession.user.id);
        } else {
          console.log('❌ No session, creating anonymous user');
          const { data, error: signInError } = await supabase.auth.signInAnonymously();
          
          if (signInError) {
            console.error('❌ Sign in failed:', signInError);
            throw signInError;
          }
          
          console.log('✅ Created anonymous user:', data?.user?.id);
          setSession(data.session);
          setUser(data.user);
          
          if (data.user?.id) {
            await blockDB.init();
            await blockDB.setUserId(data.user.id);
          }
        }
      } catch (error) {
        console.error('❌ Init error:', error);
        toast.error('Failed to authenticate. Please refresh the page.');
      } finally {
        isSigningInRef.current = false;
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initOnce();

    // Set up listener for future changes ONLY
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('🔄 Auth state changed:', event);
        
        if (!mounted) return;
        
        // Ignore INITIAL_SESSION - we handle that manually above
        if (event === 'INITIAL_SESSION') {
          console.log('⏭️ Ignoring INITIAL_SESSION event');
          return;
        }
        
        setSession(session);
        setUser(session?.user ?? null);
        
        if (event === 'SIGNED_OUT') {
          blockDB.init().then(() => blockDB.clearUserId());
        }
        
        if (event === 'SIGNED_IN' && session?.user?.id) {
          blockDB.init().then(() => blockDB.setUserId(session.user.id));
        }
      }
    );

    return () => {
      console.log('🛑 AuthContext unmounting');
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
