import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useTokenTheme } from '@/contexts/TokenThemeContext';

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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, currentTheme?.id]);

  const buyBlock = async (itemType: string, cost: number) => {
    if (!user?.id || !currentTheme?.id) {
      toast({
        title: "Authentication required",
        description: "Please wait for authentication to complete",
        variant: "destructive"
      });
      return false;
    }

    if (!tokenBalance || tokenBalance.coins < cost) {
      toast({
        title: "Insufficient coins",
        description: `You need ${cost} coins to buy this block`,
        variant: "destructive"
      });
      return false;
    }

    try {
      // Get item_id from items table
      const { data: itemData, error: itemError } = await supabase
        .from('items')
        .select('id')
        .eq('key', itemType)
        .maybeSingle();

      if (itemError) throw itemError;
      if (!itemData) {
        toast({
          title: "Item not found",
          description: "This item is not available",
          variant: "destructive"
        });
        return false;
      }

      // Deduct coins from token balance
      const newCoinAmount = tokenBalance.coins - cost;
      const { error: coinsError } = await supabase
        .from('user_token_balances')
        .update({ coins: newCoinAmount })
        .eq('user_id', user.id)
        .eq('token_theme_id', currentTheme.id);

      if (coinsError) throw coinsError;

      // Add to inventory
      const existingItem = inventory.find(item => item.item_type === itemType);
      
      if (existingItem) {
        // Update existing inventory item
        const newQuantity = existingItem.quantity + 1;
        const { error: updateError } = await supabase
          .from('user_inventory')
          .update({ quantity: newQuantity })
          .eq('id', existingItem.id);

        if (updateError) throw updateError;
      } else {
        // Create new inventory item with both item_type (legacy) and item_id (new)
        const { error: insertError } = await supabase
          .from('user_inventory')
          .insert([{
            user_id: user.id,
            item_type: itemType,
            item_id: itemData.id,
            quantity: 1
          }]);

        if (insertError) throw insertError;
      }

      // Update local state immediately for better UX
      setTokenBalance(prev => prev ? { ...prev, coins: newCoinAmount } : null);
      
      // Refresh data to ensure consistency
      await loadUserData();
      
      toast({
        title: "Purchase successful!",
        description: `You bought 1 ${itemType} for ${cost} coins`,
      });
      
      return true;
    } catch (error) {
      console.error('Error buying block:', error);
      toast({
        title: "Purchase failed",
        description: "Failed to complete purchase",
        variant: "destructive"
      });
      return false;
    }
  };

  const useBlock = async (itemType: string) => {
    const item = inventory.find(i => i.item_type === itemType || i.item_id === itemType);
    
    if (!item || item.quantity <= 0) {
      toast({
        title: "No blocks available",
        description: `You don't have any ${itemType} blocks in your inventory`,
        variant: "destructive"
      });
      return false;
    }

    const newQuantity = item.quantity - 1;
    
    // Update local state IMMEDIATELY for instant feedback (optimistic update)
    setInventory(prev => prev.map(i => 
      i.id === item.id 
        ? { ...i, quantity: newQuantity }
        : i
    ));

    // Sync to database in background (non-blocking)
    supabase
      .from('user_inventory')
      .update({ quantity: newQuantity })
      .eq('id', item.id)
      .then(({ error }) => {
        if (error) {
          console.error('Error syncing inventory:', error);
          // Revert optimistic update on error
          setInventory(prev => prev.map(i => 
            i.id === item.id 
              ? { ...i, quantity: item.quantity }
              : i
          ));
          toast({
            title: "Sync Error",
            description: "Failed to sync inventory. Block not placed.",
            variant: "destructive"
          });
        }
      });
    
    // Return immediately - don't wait for database
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
    refreshData
  };
};