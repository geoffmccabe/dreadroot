import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useCoinTheme } from '@/contexts/CoinThemeContext';
import { findInventoryItem } from '@/lib/inventoryHelpers';
import { worldStore } from '@/services/worldStore';
import { getLevelForPoints } from '@/lib/levelSystem';
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
      
      // Load profile, token balance, inventory (blocks/seeds), slots
      // (items in inv/qs/vault), roles, and all token balances in parallel.
      // v4.11.0: items live in user_slots; user_inventory keeps only
      // blocks (item_id IS NULL) and seeds (item_type LIKE 'seed_tier_%').
      const [
        { data: existingProfile, error: profileError },
        { data: tokenBalanceData, error: tokenBalanceError },
        { data: inventoryData, error: inventoryError },
        { data: userSlotsData },
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
          .from('user_slots' as any)
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
        try {
          const newBalance = await worldStore.ensureTokenBalance(currentTheme.id, 100);
          if (newBalance) setTokenBalance(newBalance);
        } catch (err) {
          console.error('[useUserData] ensureTokenBalance failed:', err);
        }
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
      // v4.11.0: merged inventory = items (from user_slots) + blocks/seeds (from user_inventory).
      const slotItemRows: UserInventoryItem[] = ((userSlotsData as any[]) ?? [])
        .filter((s: any) => s.region === 'inventory')
        .map((s: any) => ({
          id: s.id, user_id: s.user_id, item_type: 'item',
          item_id: s.item_id, quantity: 1,
          created_at: s.created_at, updated_at: s.updated_at,
        }));
      const legacyBlocksSeedsRows = (inventoryData || [])
        .filter(r => r.item_type !== 'item' || r.item_id === null);
      setInventory([...slotItemRows, ...legacyBlocksSeedsRows]);
      // QS equipped state: derive from user_slots region='quick_select'.
      const qsRows = ((userSlotsData as any[]) ?? [])
        .filter((s: any) => s.region === 'quick_select')
        .map((s: any) => ({ slot: s.slot, itemId: s.item_id }));
      // Diagnostic: confirm what came back from the server. If
      // qsRows is empty but you have equipped items, RLS / realtime /
      // query is the culprit.
      console.warn('[LOAD]', {
        userSlotsRows: ((userSlotsData as any[]) ?? []).length,
        inventoryFromSlots: slotItemRows.length,
        qsFromSlots: qsRows.length,
        qsSlotsList: qsRows.map(r => `${r.slot}:${r.itemId.slice(0, 8)}`),
        vaultFromSlots: ((userSlotsData as any[]) ?? []).filter((s: any) => s.region === 'vault').length,
      });
      setEquippedItems(qsRows);
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

      // Duplicate-row consolidation now lives server-side (one-shot
      // migration ran in D-final-cleanup, and the D-races advisory lock
      // prevents new duplicates from forming). No client-side merge needed.
      const inv = inventoryData || [];

      // Starter items (#15 Pistol, #193 Flame Glove) are for brand-new
      // players. If the user already has ANY user_slots rows
      // (inventory or QS), they're not a new player — skip the grant
      // entirely. Without this guard, every login tries to top up to
      // 4-of-each, which overflows into QS when inventory is full and
      // creates phantom items the user can't see.
      const hasAnySlots = ((userSlotsData as any[]) ?? []).some(
        (s: any) => s.region === 'inventory' || s.region === 'quick_select'
      );
      const { data: starterDefs } = hasAnySlots
        ? { data: null as any[] | null }
        : await supabase
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

      // QS equipped state is now sourced from user_slots region='quick_select'
      // (set earlier in this function). user_equipped_items is legacy and
      // empty post-migration. Starter equip happens via grant_slot + transfer
      // RPCs and is handled at a different layer.

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
      .on(
        // v4.11.0: user_slots is the unified inv/QS/vault table for
        // items. Realtime here drives both inventory items and QS
        // state simultaneously — no more 3-table sync drift.
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_slots',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row: any = payload.new ?? payload.old;
          if (!row) return;
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            if (row.region === 'inventory') {
              // Item row → derive UserInventoryItem and inject.
              const invRow: UserInventoryItem = {
                id: row.id, user_id: row.user_id, item_type: 'item',
                item_id: row.item_id, quantity: 1,
                created_at: row.created_at, updated_at: row.updated_at,
              };
              setInventory(prev => {
                const filtered = prev.filter(i => i.id !== row.id);
                return [...filtered, invRow];
              });
            } else if (row.region === 'quick_select') {
              setEquippedItems(prev => {
                const filtered = prev.filter(e => e.slot !== row.slot);
                return [...filtered, { slot: row.slot, itemId: row.item_id }];
              });
            }
            // vault changes are read by useVaultData via its own select; not handled here.
          } else if (payload.eventType === 'DELETE') {
            if (row.region === 'inventory') {
              setInventory(prev => prev.filter(i => i.id !== row.id));
            } else if (row.region === 'quick_select') {
              setEquippedItems(prev => prev.filter(e => e.slot !== row.slot));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, currentTheme?.id]);

  // Atomic block purchase. The RPC deducts coins AND grants the block
  // in a single transaction — if anything fails, both roll back so the
  // user never loses coins for nothing. UI is still optimistic for
  // responsiveness; we revert on RPC failure.
  const buyBlock = async (itemType: string, cost: number): Promise<boolean> => {
    if (!user?.id || !currentTheme?.id) {
      toast({
        title: "Authentication required",
        description: "Please wait for authentication to complete",
        variant: "destructive"
      });
      return false;
    }

    const currentBalance = tokenBalanceRef.current;
    if (!currentBalance || currentBalance.coins < cost) {
      toast({
        title: "Insufficient coins",
        description: `You need ${cost} coins to buy this block`,
        variant: "destructive"
      });
      return false;
    }

    const optimisticBalance = currentBalance.coins - cost;
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    setTokenBalance(prev => prev ? { ...prev, coins: optimisticBalance } : null);
    setInventory(prev => {
      const existingItem = prev.find(item => item.item_type === itemType || item.item_id === itemType);
      if (existingItem) {
        return prev.map(item =>
          item.id === existingItem.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, {
        id: tempId, user_id: user.id, item_type: itemType, item_id: null, quantity: 1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }];
    });
    toast({ title: "Purchase successful!", description: `You bought 1 ${itemType} for ${cost} coins`, duration: 2000 });

    try {
      const result = await worldStore.buyBlock(itemType, cost, currentTheme.id);
      // Reconcile with server result
      setTokenBalance(prev => prev ? { ...prev, coins: result.newBalance } : null);
      setInventory(prev => {
        let next = prev.filter(i => i.id !== tempId);
        for (const row of result.rows) {
          const idx = next.findIndex(i => i.id === row.id);
          if (idx >= 0) next[idx] = row as UserInventoryItem;
          else next.push(row as UserInventoryItem);
        }
        return next;
      });
      return true;
    } catch (err) {
      console.error('[buyBlock] RPC failed:', err);
      // Revert optimistic update
      setTokenBalance(prev => prev ? { ...prev, coins: currentBalance.coins } : null);
      setInventory(prev => prev.filter(i => i.id !== tempId).map(item => {
        const existing = item.item_type === itemType || item.item_id === itemType;
        if (existing && item.id !== tempId) {
          return { ...item, quantity: Math.max(0, item.quantity - 1) };
        }
        return item;
      }).filter(i => i.quantity > 0));
      toast({
        title: "Purchase failed",
        description: "Could not complete the purchase. Please try again.",
        variant: "destructive",
      });
      return false;
    }
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
      const result = await worldStore.grantCurrency(currentTheme.id, amount);
      setTokenBalance(prev => prev ? { ...prev, coins: result.newBalance } : null);
      return true;
    } catch (error) {
      console.error('Error adding coins:', error);
      toast({ title: "Error", description: "Failed to add coins", variant: "destructive" });
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

  // Add points (from dealing damage to enemies). Server is authoritative:
  // RPC atomically increments total_points and recomputes level. Optimistic
  // local update first; we reconcile from the RPC result.
  const addPoints = useCallback(async (amount: number): Promise<{ newLevel: number | null }> => {
    if (!user?.id || !profile) return { newLevel: null };

    const prevPoints = profile.total_points || 0;
    const prevLevel = profile.current_level || 1;

    setProfile(prev => prev ? {
      ...prev,
      total_points: prevPoints + amount,
      current_level: getLevelForPoints(prevPoints + amount),
    } : null);

    try {
      const result = await worldStore.grantPoints(amount);
      setProfile(prev => prev ? {
        ...prev,
        total_points: result.newTotalPoints,
        current_level: result.newLevel,
      } : null);
      return { newLevel: result.leveledUp ? result.newLevel : null };
    } catch (err) {
      console.error('Error syncing points:', err);
      // Revert
      setProfile(prev => prev ? { ...prev, total_points: prevPoints, current_level: prevLevel } : null);
      return { newLevel: null };
    }
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

  // Orphan-equipped cleanup was needed in the OLD model where QS slots
  // pointed at user_inventory rows by item_id, and a slot could be
  // left pointing at a row that had already been consumed. Under the
  // v4.11.0 unified user_slots model, the QS row IS the item — there
  // is no inventory-side row to be orphaned from. The cleanup is now
  // a no-op (kept here as documentation of the prior behavior).

  // v4.11.0: unified user_slots model. Equip = move item from inv
  // slot to QS slot via transferSlot. Unequip = move from QS to first
  // empty inv slot. Legacy callers keep their (slot, itemId) signature.
  const updateEquippedSlot = useCallback(async (slot: number, itemId: string | null) => {
    if (!user?.id) return;

    setEquippedItems(prev => {
      const filtered = prev.filter(e => e.slot !== slot);
      if (itemId) filtered.push({ slot, itemId });
      return filtered;
    });

    try {
      if (itemId) {
        // Find the inv slot holding this item. inventoryRef has the
        // synthesized rows from user_slots region='inventory'.
        // For now: query user_slots directly to find the slot index.
        const { data: srcRow } = await supabase.from('user_slots' as any)
          .select('slot').eq('user_id', user.id).eq('region', 'inventory')
          .eq('item_id', itemId).limit(1).maybeSingle();
        if (!srcRow) {
          console.warn(`[updateEquippedSlot] no inv slot for item ${itemId}`);
          setEquippedItems(prev => prev.filter(e => e.slot !== slot));
          return;
        }
        await worldStore.transferSlot(
          { region: 'inventory', page: 0, slot: (srcRow as any).slot },
          { region: 'quick_select', page: 0, slot },
          1,
        );
      } else {
        // Find first empty inv slot.
        const { data: occupiedRows } = await supabase.from('user_slots' as any)
          .select('slot').eq('user_id', user.id).eq('region', 'inventory');
        const occupied = new Set(((occupiedRows as any[]) ?? []).map((r: any) => r.slot));
        let dstSlot = 0;
        while (occupied.has(dstSlot)) dstSlot++;
        await worldStore.transferSlot(
          { region: 'quick_select', page: 0, slot },
          { region: 'inventory', page: 0, slot: dstSlot },
          1,
        );
      }
    } catch (err) {
      console.error('[updateEquippedSlot] failed:', err);
    }
  }, [user?.id]);

  // Consume the item in a QS slot (item destroyed, not moved). Used
  // by grenade throw, egg hatch, potion drink. Atomic single-RPC.
  const consumeQuickSlot = useCallback(async (slot: number) => {
    if (!user?.id) return;
    // Optimistic remove from local state.
    setEquippedItems(prev => prev.filter(e => e.slot !== slot));
    try {
      await worldStore.consumeQuickSlot(slot);
    } catch (err) {
      console.error('[consumeQuickSlot] failed:', err);
    }
  }, [user?.id]);

  // Optimistic equip — used by the cursor-stack reducer's QS transfer
  // handlers so the UI updates instantly without waiting for realtime
  // (which has been flaky in practice for these tables).
  const setEquippedSlotOptimistic = useCallback((slot: number, itemId: string | null) => {
    setEquippedItems(prev => {
      const filtered = prev.filter(e => e.slot !== slot);
      if (itemId) filtered.push({ slot, itemId });
      return filtered;
    });
  }, []);

  // Optimistic inv row removal — called after a transfer RPC moves
  // an inv row to QS or vault. Realtime SHOULD also deliver the
  // DELETE event and remove the row, but the local mutation makes
  // the UI snap immediately. The realtime path becomes a no-op
  // dedupe (filter on an id that's already gone).
  const removeInventoryRowOptimistic = useCallback((rowId: string) => {
    setInventory(prev => prev.filter(r => r.id !== rowId));
  }, []);

  // Optimistic inv row add — used when a QS→Inv or Vault→Inv transfer
  // succeeds and we want the new tile to appear instantly. The real
  // row gets reconciled in by realtime/refetch later; this synthetic
  // row carries the same itemId so the inventory grid renders the
  // correct sprite.
  const addInventoryRowOptimistic = useCallback((itemId: string) => {
    setInventory(prev => {
      const synthetic: UserInventoryItem = {
        id: `tmp-${Math.random().toString(36).slice(2)}`,
        user_id: user?.id ?? '',
        item_type: 'item',
        item_id: itemId,
        quantity: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      return [...prev, synthetic];
    });
  }, [user?.id]);

  // Brute-force resync of inventory + QS state from server. Called
  // after every QS transfer so client state can't drift from DB —
  // realtime has proven too unreliable to depend on. The cost is
  // one extra round-trip per transfer; the gain is correctness.
  //
  // v4.11.0+: items live in user_slots, blocks/seeds still in
  // user_inventory. Both must be re-read and merged the same way as
  // the initial load.
  const refetchInventoryAndQs = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [invRes, slotRes] = await Promise.all([
        supabase.from('user_inventory').select('*').eq('user_id', user.id),
        supabase.from('user_slots' as any).select('*').eq('user_id', user.id),
      ]);
      const slotItemRows: UserInventoryItem[] = (((slotRes as any).data as any[]) ?? [])
        .filter((s: any) => s.region === 'inventory')
        .map((s: any) => ({
          id: s.id, user_id: s.user_id, item_type: 'item',
          item_id: s.item_id, quantity: 1,
          created_at: s.created_at, updated_at: s.updated_at,
        }));
      const legacyBlocksSeedsRows = (invRes.data || [])
        .filter((r: any) => r.item_type !== 'item' || r.item_id === null);
      setInventory([...slotItemRows, ...legacyBlocksSeedsRows]);
      const qsRows = (((slotRes as any).data as any[]) ?? [])
        .filter((s: any) => s.region === 'quick_select')
        .map((s: any) => ({ slot: s.slot, itemId: s.item_id }));
      setEquippedItems(qsRows);
    } catch (err) {
      console.error('[refetchInventoryAndQs] failed:', err);
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
    consumeQuickSlot,
    setEquippedSlotOptimistic,
    removeInventoryRowOptimistic,
    addInventoryRowOptimistic,
    refetchInventoryAndQs,
    updateDisplayName,
    updateAvatarUrl,
    updateVisualDistance,
    updateFogEnabled,
    refreshData,
    collectWispBlock,
    returnSeed
  };
};