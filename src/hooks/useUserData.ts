import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useTokenTheme } from '@/contexts/TokenThemeContext';
import { findInventoryItem } from '@/lib/inventoryHelpers';

export interface UserProfile {
  id: string;
  user_id: string;
  coins: number;
  blockchain_address?: string;
  visual_distance?: number;
  fog_enabled?: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserTokenBalance {
  id: string;
  user_id: string;
  token_theme_id: string;
  coins: number;
  blockchain_address?: string;
  created_at: string;
  updated_at: string;
}

export interface UserInventoryItem {
  id: string;
  user_id: string;
  item_type: string;
  item_id: string | null;
  quantity: number;
  created_at: string;
  updated_at: string;
}

export const useUserData = () => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tokenBalance, setTokenBalance] = useState<UserTokenBalance | null>(null);
  const [inventory, setInventory] = useState<UserInventoryItem[]>([]);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const { currentTheme } = useTokenTheme();
  const loadingRef = useRef(false);
  
  // Refs for instant access to current state (avoids stale closures in rapid calls)
  const tokenBalanceRef = useRef(tokenBalance);
  const inventoryRef = useRef(inventory);
  
  // Track pending purchases per item type (for accurate database sync)
  const pendingPurchasesRef = useRef<Map<string, number>>(new Map());
  // Track pending coin deductions (for accurate database sync)
  const pendingCoinDeductionRef = useRef<number>(0);
  // Debounce timer for database sync
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Keep refs in sync with state
  useEffect(() => {
    tokenBalanceRef.current = tokenBalance;
  }, [tokenBalance]);
  
  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  const loadUserData = useCallback(async () => {
    if (loadingRef.current) return;
    // If no authenticated user or theme, clear state
    if (!user?.id || !currentTheme?.id) {
      setProfile(null);
      setTokenBalance(null);
      setInventory([]);
      setUserRoles([]);
      setIsLoading(false);
      return;
    }

    try {
      loadingRef.current = true;
      setIsLoading(true);
      
      // Load profile, token balance, inventory, and roles in parallel
      const [
        { data: existingProfile, error: profileError },
        { data: tokenBalanceData, error: tokenBalanceError },
        { data: inventoryData, error: inventoryError },
        { data: rolesData, error: rolesError }
      ] = await Promise.all([
        supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('user_token_balances')
          .select('*')
          .eq('user_id', user.id)
          .eq('token_theme_id', currentTheme.id)
          .maybeSingle(),
        supabase
          .from('user_inventory')
          .select('*')
          .eq('user_id', user.id),
        supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
      ]);

      if (profileError) throw profileError;
      if (inventoryError) throw inventoryError;

      if (!existingProfile) {
        toast({
          title: "Profile Error",
          description: "Please sign in to continue.",
          variant: "destructive"
        });
        setIsLoading(false);
        return;
      }

      if (!tokenBalanceData) {
        const { data: newBalance, error: createError } = await supabase
          .from('user_token_balances')
          .insert({
            user_id: user.id,
            token_theme_id: currentTheme.id,
            coins: 100
          })
          .select()
          .single();

        if (!createError) setTokenBalance(newBalance);
      } else {
        setTokenBalance(tokenBalanceData);
      }

      setProfile(existingProfile);
      setInventory(inventoryData || []);
      setUserRoles(rolesData?.map(r => r.role) || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load user data",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [user, currentTheme?.id]);

  useEffect(() => {
    if (!authLoading && currentTheme) {
      loadUserData();
    }
  }, [user?.id, authLoading, currentTheme?.id, loadUserData]);

  // Consolidated real-time subscription
  useEffect(() => {
    if (!user?.id || !currentTheme?.id) return;

    const channel = supabase
      .channel('user-data-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_profiles',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            setProfile(payload.new as UserProfile);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_token_balances',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            const balance = payload.new as UserTokenBalance;
            if (balance.token_theme_id === currentTheme.id) {
              setTokenBalance(balance);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_inventory',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' && payload.new) {
            setInventory(prev => [...prev, payload.new as UserInventoryItem]);
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            setInventory(prev =>
              prev.map(item =>
                item.id === (payload.new as UserInventoryItem).id ? payload.new as UserInventoryItem : item
              )
            );
          } else if (payload.eventType === 'DELETE' && payload.old) {
            setInventory(prev => prev.filter(item => item.id !== (payload.old as UserInventoryItem).id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, currentTheme?.id]);

  const buyBlock = async (itemType: string, cost: number): Promise<boolean> => {
    if (!user?.id || !currentTheme?.id) {
      toast({
        title: "Authentication required",
        description: "Please wait for authentication to complete",
        variant: "destructive"
      });
      return false;
    }

    // Get FRESH balance from ref
    const currentBalance = tokenBalanceRef.current;
    if (!currentBalance || currentBalance.coins < cost) {
      toast({
        title: "Insufficient coins",
        description: `You need ${cost} coins to buy this block`,
        variant: "destructive"
      });
      return false;
    }

    const newCoinAmount = currentBalance.coins - cost;
    
    // Track pending purchase for database sync
    const currentPending = pendingPurchasesRef.current.get(itemType) || 0;
    pendingPurchasesRef.current.set(itemType, currentPending + 1);
    pendingCoinDeductionRef.current += cost;
    
    // OPTIMISTIC UPDATE - update UI immediately using refs for fresh state
    setTokenBalance(prev => prev ? { ...prev, coins: newCoinAmount } : null);
    setInventory(prev => {
      const existingItem = prev.find(item => item.item_type === itemType || item.item_id === itemType);
      if (existingItem) {
        return prev.map(item => 
          item.id === existingItem.id 
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        const tempId = `temp-${Date.now()}-${Math.random()}`;
        return [...prev, {
          id: tempId,
          user_id: user.id,
          item_type: itemType,
          item_id: null,
          quantity: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }];
      }
    });
    
    toast({
      title: "Purchase successful!",
      description: `You bought 1 ${itemType} for ${cost} coins`,
      duration: 2000,
    });

    // Debounced database sync - collects rapid purchases into one update
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }
    
    syncTimerRef.current = setTimeout(async () => {
      try {
        const userId = user.id;
        const themeId = currentTheme.id;
        
        // Get current database values and apply ALL pending changes at once
        const pendingCoins = pendingCoinDeductionRef.current;
        const pendingItems = new Map(pendingPurchasesRef.current);
        
        // Clear pending counters BEFORE async operations
        pendingCoinDeductionRef.current = 0;
        pendingPurchasesRef.current.clear();
        
        // Fetch current database balance
        const { data: dbBalance } = await supabase
          .from('user_token_balances')
          .select('coins')
          .eq('user_id', userId)
          .eq('token_theme_id', themeId)
          .single();
        
        if (dbBalance) {
          const newDbCoins = dbBalance.coins - pendingCoins;
          await supabase
            .from('user_token_balances')
            .update({ coins: newDbCoins })
            .eq('user_id', userId)
            .eq('token_theme_id', themeId);
        }

        // Update inventory for each pending item type
        for (const [pendingItemType, pendingCount] of pendingItems) {
          const { data: existingInvItem } = await supabase
            .from('user_inventory')
            .select('*')
            .eq('user_id', userId)
            .eq('item_type', pendingItemType)
            .maybeSingle();

          if (existingInvItem) {
            await supabase
              .from('user_inventory')
              .update({ quantity: existingInvItem.quantity + pendingCount })
              .eq('id', existingInvItem.id);
          } else {
            const { data: newItem } = await supabase
              .from('user_inventory')
              .insert([{ user_id: userId, item_type: pendingItemType, quantity: pendingCount }])
              .select()
              .single();
            
            // Replace temp item with real item
            if (newItem) {
              setInventory(prev => prev.map(item => 
                item.id.startsWith('temp-') && item.item_type === pendingItemType
                  ? { ...newItem } as UserInventoryItem
                  : item
              ));
            }
          }
        }
      } catch (error) {
        console.error('Error syncing purchase:', error);
      }
    }, 300); // 300ms debounce - fast enough to feel instant, slow enough to batch
    
    return true;
  };

  const useBlock = async (itemKey: string) => {
    // Use functional update to ensure we get latest state
    let success = false;
    let itemId: string | null = null;
    let originalQuantity = 0;
    
    setInventory(prev => {
      const item = prev.find(i => i.item_type === itemKey || i.item_id === itemKey);
      if (!item || item.quantity <= 0) {
        success = false;
        return prev;
      }
      
      success = true;
      itemId = item.id;
      originalQuantity = item.quantity;
      
      return prev.map(i => 
        i.id === item.id 
          ? { ...i, quantity: i.quantity - 1 }
          : i
      );
    });
    
    if (!success) {
      toast({
        title: "No blocks available",
        description: `You don't have any ${itemKey} blocks in your inventory`,
        variant: "destructive"
      });
      return false;
    }

    // Sync to database in background (non-blocking)
    if (itemId) {
      supabase
        .from('user_inventory')
        .update({ quantity: originalQuantity - 1 })
        .eq('id', itemId)
        .then(({ error }) => {
          if (error) {
            console.error('Error syncing inventory:', error);
            // Revert optimistic update on error
            setInventory(prev => prev.map(i => 
              i.id === itemId 
                ? { ...i, quantity: originalQuantity }
                : i
            ));
          }
        });
    }
    
    return true;
  };

  const addCoins = async (amount: number) => {
    if (!user?.id || !currentTheme?.id || !tokenBalance) return false;

    try {
      const newCoinAmount = tokenBalance.coins + amount;
      const { error } = await supabase
        .from('user_token_balances')
        .update({ coins: newCoinAmount })
        .eq('user_id', user.id)
        .eq('token_theme_id', currentTheme.id);

      if (error) throw error;

      setTokenBalance(prev => prev ? { ...prev, coins: newCoinAmount } : null);
      
      return true;
    } catch (error) {
      console.error('Error adding coins:', error);
      toast({
        title: "Error",
        description: "Failed to add coins",
        variant: "destructive"
      });
      return false;
    }
  };

  const updateBlockchainAddress = async (address: string) => {
    if (!user?.id || !currentTheme?.id || !tokenBalance) return false;

    try{
      const { error } = await supabase
        .from('user_token_balances')
        .update({ blockchain_address: address })
        .eq('user_id', user.id)
        .eq('token_theme_id', currentTheme.id);

      if (error) throw error;

      setTokenBalance(prev => prev ? { ...prev, blockchain_address: address } : null);
      
      return true;
    } catch (error) {
      console.error('Error updating blockchain address:', error);
      toast({
        title: "Error",
        description: "Failed to update blockchain address",
        variant: "destructive"
      });
      return false;
    }
  };

  const updateVisualDistance = async (distance: number) => {
    if (!user?.id || !profile) return false;

    const clampedDistance = Math.max(1, Math.min(20, distance));

    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ visual_distance: clampedDistance })
        .eq('user_id', user.id);

      if (error) throw error;

      setProfile(prev => prev ? { ...prev, visual_distance: clampedDistance } : null);
      
      return true;
    } catch (error) {
      console.error('Error updating visual distance:', error);
      toast({
        title: "Error",
        description: "Failed to update visual distance",
        variant: "destructive"
      });
      return false;
    }
  };

  const updateFogEnabled = async (enabled: boolean) => {
    if (!user?.id || !profile) return false;

    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ fog_enabled: enabled })
        .eq('user_id', user.id);

      if (error) throw error;

      setProfile(prev => prev ? { ...prev, fog_enabled: enabled } : null);
      
      return true;
    } catch (error) {
      console.error('Error updating fog setting:', error);
      toast({
        title: "Error",
        description: "Failed to update fog setting",
        variant: "destructive"
      });
      return false;
    }
  };

  const refreshData = async () => {
    console.log('refreshData called');
    await loadUserData();
  };

  // Collect wisp block (free addition to inventory)
  const collectWispBlock = async (blockKey: string) => {
    if (!user?.id) {
      toast({
        title: "Authentication required",
        description: "Please wait for authentication to complete",
        variant: "destructive"
      });
      return false;
    }

    try {
      // Verify block exists in blocks table
      const { data: blockData, error: blockError } = await supabase
        .from('blocks')
        .select('id, name')
        .eq('key', blockKey)
        .maybeSingle();

      if (blockError) throw blockError;
      if (!blockData) {
        toast({
          title: "Block not found",
          description: "This block type is not available",
          variant: "destructive"
        });
        return false;
      }

      // Query database directly to avoid race conditions with local state
      const { data: existingItems, error: queryError } = await supabase
        .from('user_inventory')
        .select('*')
        .eq('user_id', user.id)
        .eq('item_type', blockKey)
        .is('item_id', null);

      if (queryError) throw queryError;
      
      if (existingItems && existingItems.length > 0) {
        // Update existing inventory item
        const existingItem = existingItems[0];
        const newQuantity = existingItem.quantity + 1;
        const { error: updateError } = await supabase
          .from('user_inventory')
          .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
          .eq('id', existingItem.id);

        if (updateError) throw updateError;
        
        // Update local state
        setInventory(prev => 
          prev.map(i => 
            i.id === existingItem.id 
              ? { ...i, quantity: newQuantity, updated_at: new Date().toISOString() }
              : i
          )
        );
      } else {
        // Create new inventory item for block (item_id is NULL for blocks)
        const { data: newItem, error: insertError } = await supabase
          .from('user_inventory')
          .insert([{
            user_id: user.id,
            item_type: blockKey,
            item_id: null,
            quantity: 1
          }])
          .select()
          .single();

        if (insertError) throw insertError;
        
        // Update local state
        if (newItem) {
          setInventory(prev => [...prev, newItem]);
        }
      }
      
      console.log(`✨ Wisp collected: +1 ${blockData.name} (${blockKey})`);
      
      toast({
        title: "Wisp collected!",
        description: `You caught a ${blockKey} wisp! +1 block added to inventory`,
      });
      
      return true;
    } catch (error) {
      console.error('Error collecting wisp:', error);
      toast({
        title: "Collection failed",
        description: "Failed to add wisp block to inventory",
        variant: "destructive"
      });
      return false;
    }
  };

  return {
    profile,
    tokenBalance,
    inventory,
    userRoles,
    isLoading,
    buyBlock,
    useBlock,
    addCoins,
    updateBlockchainAddress,
    updateVisualDistance,
    updateFogEnabled,
    refreshData,
    collectWispBlock
  };
};