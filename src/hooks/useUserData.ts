import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useCoinTheme } from '@/contexts/CoinThemeContext';
import { findInventoryItem } from '@/lib/inventoryHelpers';
import { worldStore } from '@/services/worldStore';
import { checkLevelUp, getLevelForPoints } from '@/lib/levelSystem';
import { initLogStep } from '@/contexts/InitializationContext';

export interface UserProfile {
  id: string;
  user_id: string;
  coins: number;
  blockchain_address?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  visual_distance?: number;
  fog_enabled?: boolean;
  total_points?: number;
  current_level?: number;
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
  const [allTokenBalances, setAllTokenBalances] = useState<UserTokenBalance[]>([]);
  const [inventory, setInventory] = useState<UserInventoryItem[]>([]);
  const [equippedItems, setEquippedItems] = useState<Array<{ slot: number; itemId: string }>>([]);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const { currentTheme } = useCoinTheme();
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
      
      // Load profile, token balance, inventory, roles, and all token balances in parallel
      const [
        { data: existingProfile, error: profileError },
        { data: tokenBalanceData, error: tokenBalanceError },
        { data: inventoryData, error: inventoryError },
        { data: rolesData, error: rolesError },
        { data: allBalancesData, error: allBalancesError }
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
          .eq('user_id', user.id),
        supabase
          .from('user_token_balances')
          .select('*')
          .eq('user_id', user.id)
      ]);

      // Check all errors - log but don't throw for non-critical ones
      if (profileError) {
        console.error('[useUserData] Profile error:', profileError);
        throw profileError;
      }
      if (inventoryError) {
        console.error('[useUserData] Inventory error:', inventoryError);
        throw inventoryError;
      }
      if (tokenBalanceError) {
        console.error('[useUserData] Token balance error:', tokenBalanceError);
        // Non-critical - will create new balance below
      }
      if (rolesError) {
        console.error('[useUserData] Roles error:', rolesError);
        // Non-critical - default to empty roles
      }
      if (allBalancesError) {
        console.error('[useUserData] All balances error:', allBalancesError);
        // Non-critical - default to empty array
      }

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

      // Recalculate level from points (in case formula changed)
      const correctLevel = getLevelForPoints(existingProfile.total_points || 0);
      if (correctLevel !== existingProfile.current_level) {
        console.log(`[UserData] Fixing stale level: ${existingProfile.current_level} → ${correctLevel} (${existingProfile.total_points} pts)`);
        existingProfile.current_level = correctLevel;
        // Update DB in background
        supabase
          .from('user_profiles')
          .update({ current_level: correctLevel })
          .eq('user_id', user.id)
          .then(({ error }) => {
            if (error) console.error('Error fixing level:', error);
          });
      }
      
      // Log player data for initialization overlay
      initLogStep('useUserData.ts', `Player Level: ${correctLevel}`);
      initLogStep('useUserData.ts', `Player Points: ${existingProfile.total_points || 0}`);
      initLogStep('useUserData.ts', `Player Coins: ${tokenBalanceData?.coins || 100}`);
      
      // Count inventory items
      const totalItems = (inventoryData || []).reduce((sum, item) => sum + item.quantity, 0);
      const uniqueTypes = new Set((inventoryData || []).map(item => item.item_type)).size;
      initLogStep('useUserData.ts', `Inventory: ${totalItems} items (${uniqueTypes} types)`);
      
      // Log roles
      const roles = rolesData?.map(r => r.role) || [];
      initLogStep('useUserData.ts', `Roles: ${roles.length > 0 ? roles.join(', ') : 'user'}`);
      
      setProfile(existingProfile);
      setInventory(inventoryData || []);
      setUserRoles(roles);

      // One-time avatar backfill from OAuth metadata. If the profile
      // has no avatar yet AND the auth user came in with a picture
      // (Google `picture`, generic OAuth `avatar_url`), copy it once.
      // Never overwrite an existing avatar — user uploads + earlier
      // auth providers always win.
      if (existingProfile && !existingProfile.avatar_url && user) {
        const meta: any = user.user_metadata || {};
        const oauthPicture: string | undefined =
          meta.picture || meta.avatar_url || meta.photoURL;
        if (oauthPicture && typeof oauthPicture === 'string') {
          // Optimistic local update, then persist. If the update
          // fails we don't roll back — they can re-upload from the
          // panel — but this isn't a hot path so failures are rare.
          setProfile(prev => prev ? { ...prev, avatar_url: oauthPicture } : null);
          supabase
            .from('user_profiles')
            .update({ avatar_url: oauthPicture })
            .eq('user_id', user.id)
            .then(({ error }) => {
              if (error) console.error('[avatar backfill]', error);
            });
        }
      }

      // Consolidate duplicate inventory rows (same user + item_type + item_id)
      const inv = inventoryData || [];
      const seen = new Map<string, typeof inv[0]>();
      for (const row of inv) {
        if (row.item_type !== 'item' || !row.item_id) continue;
        const key = `${row.item_type}:${row.item_id}`;
        const prev = seen.get(key);
        if (prev) {
          // Merge: add quantity to first row, delete duplicate
          const newQty = prev.quantity + row.quantity;
          await supabase.from('user_inventory').update({ quantity: newQty }).eq('id', prev.id);
          await supabase.from('user_inventory').delete().eq('id', row.id);
          prev.quantity = newQty;
        } else {
          seen.set(key, row);
        }
      }

      // Ensure starter items (#15 Pistol, #193 Flame Glove) with quantity >= 4
      const { data: starterDefs } = await supabase
        .from('items')
        .select('id, item_number')
        .in('item_number', [15, 193]);

      if (starterDefs && starterDefs.length > 0) {
        for (const sd of starterDefs) {
          const existing = inv.find(i => i.item_type === 'item' && i.item_id === sd.id);
          const needed = existing ? Math.max(0, 4 - existing.quantity) : 4;
          if (needed === 0) continue;
          try {
            const result = await worldStore.grantInventoryItem(sd.id, needed);
            if (result.rows && result.rows.length > 0) {
              setInventory(prev => {
                const next = [...prev];
                for (const row of result.rows) {
                  const idx = next.findIndex(i => i.id === row.id);
                  if (idx >= 0) next[idx] = row as UserInventoryItem;
                  else next.push(row as UserInventoryItem);
                }
                return next;
              });
            }
          } catch (err) {
            console.error('[starter items] grantInventoryItem failed:', err);
          }
        }
      }

      // Load equipped items (hotbar slots 1-6)
      const { data: equippedData } = await supabase
        .from('user_equipped_items')
        .select('slot_type, item_id')
        .eq('user_id', user.id)
        .like('slot_type', 'hotbar_%');

      if (equippedData && equippedData.length > 0) {
        setEquippedItems(equippedData.map(e => ({
          slot: parseInt(e.slot_type.replace('hotbar_', '')),
          itemId: e.item_id,
        })));
      } else {
        // First time: equip starter items — #15 Pistol in slot 1, #193 Flame Glove in slot 2
        if (starterDefs && starterDefs.length > 0) {
          const pistol = starterDefs.find(d => d.item_number === 15);
          const glove = starterDefs.find(d => d.item_number === 193);
          const starterEquips: Array<{ user_id: string; item_id: string; slot_type: string }> = [];
          if (pistol) starterEquips.push({ user_id: user.id, item_id: pistol.id, slot_type: 'hotbar_1' });
          if (glove) starterEquips.push({ user_id: user.id, item_id: glove.id, slot_type: 'hotbar_2' });
          if (starterEquips.length > 0) {
            await supabase.from('user_equipped_items').insert(starterEquips);
            setEquippedItems(starterEquips.map(e => ({
              slot: parseInt(e.slot_type.replace('hotbar_', '')),
              itemId: e.item_id,
            })));
          }
        }
      }

      setAllTokenBalances(allBalancesData || []);
    } catch (error: any) {
      console.error('[useUserData] Load failed:', error);
      const errorMsg = error?.message || error?.code || 'Unknown error';
      const isTimeout = errorMsg.includes('timeout') || errorMsg.includes('TIMEOUT');
      const isOverloaded = errorMsg.includes('CPU') || errorMsg.includes('overload') || errorMsg.includes('too many');

      toast({
        title: "Error loading user data",
        description: isTimeout || isOverloaded
          ? "Server is busy. Please wait a moment and refresh."
          : `Database error: ${errorMsg}`,
        variant: "destructive",
        duration: 5000,
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

    // Unique channel name per effect run. supabase.channel() resolves a
    // channel by topic name; removeChannel() is async, so when this effect
    // re-runs (user id + theme settling right after sign-in, or re-auth)
    // the previous, still-subscribing channel was returned and .on() after
    // subscribe() threw "cannot add postgres_changes callbacks ... after
    // subscribe()" — an UNCAUGHT error that white-screened the whole app
    // on login. A fresh name each run can never collide with a channel
    // whose async teardown is still in flight.
    const channelName = `user-data-changes-${user.id}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
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

  // Consume one of `itemKey` (matches by item_type for blocks or
  // item_id for items via the RPC's OR-match). Server is authoritative:
  // local state updates from the RPC response.
  const useBlock = async (itemKey: string) => {
    try {
      const result = await worldStore.consumeInventoryTarget(itemKey, 1);
      setInventory(prev => {
        let next = prev;
        if (result.deletedRowIds.length > 0) {
          next = next.filter(i => !result.deletedRowIds.includes(i.id));
        }
        if (result.rows.length > 0) {
          next = [...next];
          for (const row of result.rows) {
            const idx = next.findIndex(i => i.id === row.id);
            if (idx >= 0) next[idx] = row as UserInventoryItem;
            else next.push(row as UserInventoryItem);
          }
        }
        return next;
      });
      return true;
    } catch (err: any) {
      // PGRST/SQL error means no matching row or insufficient quantity.
      console.error('[useBlock] consumeInventoryTarget failed:', err);
      toast({
        title: "No blocks available",
        description: `You don't have any ${itemKey} blocks in your inventory`,
        variant: "destructive"
      });
      return false;
    }
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
    const prevDistance = profile.visual_distance;

    // Optimistic update for immediate UI response
    setProfile(prev => prev ? { ...prev, visual_distance: clampedDistance } : null);

    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ visual_distance: clampedDistance })
        .eq('user_id', user.id);

      if (error) throw error;

      return true;
    } catch (error) {
      // Revert on failure
      setProfile(prev => prev ? { ...prev, visual_distance: prevDistance } : null);
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

    const prevFog = profile.fog_enabled;

    // Optimistic update for immediate UI response
    setProfile(prev => prev ? { ...prev, fog_enabled: enabled } : null);

    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ fog_enabled: enabled })
        .eq('user_id', user.id);

      if (error) throw error;

      return true;
    } catch (error) {
      // Revert on failure
      setProfile(prev => prev ? { ...prev, fog_enabled: prevFog } : null);
      console.error('Error updating fog setting:', error);
      toast({
        title: "Error",
        description: "Failed to update fog setting",
        variant: "destructive"
      });
      return false;
    }
  };

  const refreshData = useCallback(async () => {
    await loadUserData();
  }, [loadUserData]);

  // Collect wisp block via L1 Write API. The RPC validates the block
  // key against the blocks table, handles existing-row lookup, and
  // increments the count atomically.
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
      const result = await worldStore.grantInventoryBlock(blockKey, 1);
      if (result.rows && result.rows.length > 0) {
        setInventory(prev => {
          const next = [...prev];
          for (const row of result.rows) {
            const idx = next.findIndex(i => i.id === row.id);
            if (idx >= 0) next[idx] = row as UserInventoryItem;
            else next.push(row as UserInventoryItem);
          }
          return next;
        });
      }
      console.log(`✨ Wisp collected: +1 ${blockKey}`);
      toast({
        title: "Wisp collected!",
        description: `You caught a ${blockKey} wisp! +1 block added to inventory`,
      });
      return true;
    } catch (err) {
      console.error('[collectWispBlock] grantInventoryBlock failed:', err);
      toast({
        title: "Collection failed",
        description: "Failed to add wisp block to inventory",
        variant: "destructive"
      });
      return false;
    }
  };

  // Return a seed to inventory (after chopping a tree) via L1 Write API.
  // We still look up the tier client-side to construct the item_type
  // (`seed_tier_${tier}`). The RPC validates the seedDefId against
  // seed_definitions and handles the stack-or-insert.
  const returnSeed = async (seedDefId: string): Promise<boolean> => {
    if (!user?.id) {
      toast({
        title: "Authentication required",
        description: "Please wait for authentication to complete",
        variant: "destructive"
      });
      return false;
    }

    try {
      const { data: seedDef, error: seedError } = await supabase
        .from('seed_definitions')
        .select('tier, name')
        .eq('id', seedDefId)
        .maybeSingle();
      if (seedError) throw seedError;
      if (!seedDef) {
        console.warn('Seed definition not found for id:', seedDefId);
        return false;
      }

      const result = await worldStore.grantInventorySeed(seedDefId, seedDef.tier, 1);
      if (result.rows && result.rows.length > 0) {
        setInventory(prev => {
          const next = [...prev];
          for (const row of result.rows) {
            const idx = next.findIndex(i => i.id === row.id);
            if (idx >= 0) next[idx] = row as UserInventoryItem;
            else next.push(row as UserInventoryItem);
          }
          return next;
        });
      }
      console.log(`🌱 Seed returned: +1 ${seedDef.name || `Tier ${seedDef.tier}`} seed`);
      return true;
    } catch (err) {
      console.error('[returnSeed] grantInventorySeed failed:', err);
      toast({
        title: "Return failed",
        description: "Failed to return seed to inventory",
        variant: "destructive"
      });
      return false;
    }
  };

  // Add points (from dealing damage to enemies)
  const addPoints = useCallback(async (amount: number): Promise<{ newLevel: number | null }> => {
    if (!user?.id || !profile) return { newLevel: null };
    
    const currentPoints = profile.total_points || 0;
    const currentLevel = profile.current_level || 1;
    const newPoints = currentPoints + amount;
    const newLevel = getLevelForPoints(newPoints);
    const leveledUp = checkLevelUp(currentPoints, newPoints);
    
    // Optimistic update
    setProfile(prev => prev ? { 
      ...prev, 
      total_points: newPoints, 
      current_level: newLevel 
    } : null);
    
    // Sync to database in background
    supabase
      .from('user_profiles')
      .update({ total_points: newPoints, current_level: newLevel })
      .eq('user_id', user.id)
      .then(({ error }) => {
        if (error) {
          console.error('Error syncing points:', error);
          // Revert on error
          setProfile(prev => prev ? {
            ...prev,
            total_points: currentPoints,
            current_level: currentLevel
          } : null);
        }
      });
    
    return { newLevel: leveledUp };
  }, [user?.id, profile]);

  // Add an item to inventory via the L1 Write API. The RPC handles
  // auth, replay protection, stackable vs non-stackable lookup, and
  // returns the affected inventory rows. We merge those rows into
  // local state by id (replace if present, append if new), which is
  // duplicate-safe if the realtime channel ALSO delivers the same row.
  const addItem = async (itemId: string, quantity: number = 1): Promise<boolean> => {
    if (!user?.id) return false;

    try {
      const result = await worldStore.grantInventoryItem(itemId, quantity);
      if (result.rows && result.rows.length > 0) {
        setInventory(prev => {
          const next = [...prev];
          for (const row of result.rows) {
            const idx = next.findIndex(i => i.id === row.id);
            if (idx >= 0) next[idx] = row as UserInventoryItem;
            else next.push(row as UserInventoryItem);
          }
          return next;
        });
      }
      return true;
    } catch (err) {
      console.error('[addItem] grantInventoryItem failed:', err);
      return false;
    }
  };

  // Delete one specific inventory row. Used to consume non-stackable
  // items (each row holds quantity=1, so consuming = deleting). Returns
  // true on success.
  const removeInventoryRow = async (rowId: string): Promise<boolean> => {
    if (!user?.id) return false;
    try {
      const result = await worldStore.deleteInventoryRow(rowId);
      if (result.deletedRowIds.length > 0) {
        setInventory(prev => prev.filter(i => !result.deletedRowIds.includes(i.id)));
      }
      return true;
    } catch (err) {
      console.error('[removeInventoryRow] deleteInventoryRow failed:', err);
      // Refetch on failure to recover from any local-state drift.
      const { data } = await supabase.from('user_inventory').select('*').eq('user_id', user.id);
      if (data) setInventory(data);
      return false;
    }
  };

  // Remove items from inventory via the L1 Write API. The RPC handles
  // ownership + quantity validation server-side.
  const removeItems = async (itemId: string, quantity: number): Promise<boolean> => {
    if (!user?.id) return false;
    try {
      const result = await worldStore.consumeInventoryTarget(itemId, quantity);
      setInventory(prev => {
        let next = prev;
        if (result.deletedRowIds.length > 0) {
          next = next.filter(i => !result.deletedRowIds.includes(i.id));
        }
        if (result.rows.length > 0) {
          next = [...next];
          for (const row of result.rows) {
            const idx = next.findIndex(i => i.id === row.id);
            if (idx >= 0) next[idx] = row as UserInventoryItem;
            else next.push(row as UserInventoryItem);
          }
        }
        return next;
      });
      return true;
    } catch (err) {
      console.error('[removeItems] consumeInventoryTarget failed:', err);
      return false;
    }
  };

  // Orphan-equipped cleanup. After consumeGrenade/consumeEgg/etc.
  // delete the last inventory row of an item, the equipped slot is
  // left pointing at a row that no longer exists. The slot then
  // "looks armed" (G arms it because the slot has the grenade itemId)
  // but throws silently fail because consumeGrenade can't find a row.
  // This effect scans equipped slots and unequips any whose item_id
  // has no live inventory backing. Single round-trip per orphan.
  useEffect(() => {
    if (!user?.id || equippedItems.length === 0) return;
    const liveItemIds = new Set<string>();
    for (const inv of inventory) {
      if (inv.item_type === 'item' && inv.item_id && inv.quantity > 0) {
        liveItemIds.add(inv.item_id);
      }
    }
    const orphans = equippedItems.filter(eq => eq.itemId && !liveItemIds.has(eq.itemId));
    if (orphans.length === 0) return;
    (async () => {
      const slotTypes = orphans.map(o => `hotbar_${o.slot}`);
      const { error } = await supabase
        .from('user_equipped_items')
        .delete()
        .eq('user_id', user.id)
        .in('slot_type', slotTypes);
      if (error) {
        console.warn('[OrphanEquip] cleanup failed:', error.message);
        return;
      }
      setEquippedItems(prev => prev.filter(eq => !orphans.some(o => o.slot === eq.slot)));
    })();
  }, [user?.id, inventory, equippedItems]);

  const updateEquippedSlot = useCallback(async (slot: number, itemId: string | null) => {
    if (!user?.id) return;
    const slotType = `hotbar_${slot}`;

    // Optimistic update
    setEquippedItems(prev => {
      const filtered = prev.filter(e => e.slot !== slot);
      if (itemId) filtered.push({ slot, itemId });
      return filtered;
    });

    if (itemId) {
      // Upsert: try update first, insert if not found
      const { data: existing } = await supabase
        .from('user_equipped_items')
        .select('id')
        .eq('user_id', user.id)
        .eq('slot_type', slotType)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('user_equipped_items')
          .update({ item_id: itemId })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('user_equipped_items')
          .insert({ user_id: user.id, item_id: itemId, slot_type: slotType });
      }
    } else {
      // Remove from slot
      await supabase
        .from('user_equipped_items')
        .delete()
        .eq('user_id', user.id)
        .eq('slot_type', slotType);
    }
  }, [user?.id]);

  const updateDisplayName = useCallback(async (name: string) => {
    if (!user?.id) return;
    const trimmed = name.trim() || null;
    setProfile(prev => prev ? { ...prev, display_name: trimmed } : null);
    const { error } = await supabase
      .from('user_profiles')
      .update({ display_name: trimmed })
      .eq('user_id', user.id);
    if (error) {
      console.error('Error updating display name:', error);
      toast({ title: `Failed to save display name: ${error.message}`, variant: 'destructive' });
    }
  }, [user?.id, toast]);

  const updateAvatarUrl = useCallback(async (url: string) => {
    if (!user?.id) return;
    setProfile(prev => prev ? { ...prev, avatar_url: url } : null);
    const { error } = await supabase
      .from('user_profiles')
      .update({ avatar_url: url })
      .eq('user_id', user.id);
    if (error) {
      console.error('Error updating user image URL:', error);
      toast({ title: `Failed to save user image: ${error.message}`, variant: 'destructive' });
    }
  }, [user?.id, toast]);

  return {
    profile,
    tokenBalance,
    allTokenBalances,
    inventory,
    equippedItems,
    userRoles,
    isLoading,
    buyBlock,
    useBlock,
    addCoins,
    addPoints,
    addItem,
    removeItems,
    removeInventoryRow,
    updateBlockchainAddress,
    updateEquippedSlot,
    updateDisplayName,
    updateAvatarUrl,
    updateVisualDistance,
    updateFogEnabled,
    refreshData,
    collectWispBlock,
    returnSeed
  };
};