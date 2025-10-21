import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export interface UserProfile {
  id: string;
  user_id: string;
  coins: number;
  blockchain_address?: string;
  created_at: string;
  updated_at: string;
}

export interface UserInventoryItem {
  id: string;
  user_id: string;
  item_type: string;
  quantity: number;
  created_at: string;
  updated_at: string;
}

export const useUserData = () => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [inventory, setInventory] = useState<UserInventoryItem[]>([]);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();

  useEffect(() => {
    // Wait for auth to load before querying user data
    if (!authLoading) {
      loadUserData();
    }
  }, [user?.id, authLoading]);

  const loadUserData = async () => {
    // If no authenticated user, clear state
    if (!user?.id) {
      setProfile(null);
      setInventory([]);
      setUserRoles([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      console.log('Loading user data for authenticated user:', user.id);
      
      // Load profile, inventory, and roles in parallel for faster loading
      const [
        { data: existingProfile, error: profileError },
        { data: inventoryData, error: inventoryError },
        { data: rolesData, error: rolesError }
      ] = await Promise.all([
        supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', user.id)
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

      if (profileError) {
        console.error('Error loading profile:', profileError);
        throw profileError;
      }

      if (inventoryError) {
        console.error('Error loading inventory:', inventoryError);
        throw inventoryError;
      }

      if (rolesError) {
        console.error('Error loading roles:', rolesError);
        // Don't throw for roles error, just log it
      }

      if (!existingProfile) {
        console.error('Profile not found for user:', user.id);
        toast({
          title: "Profile Error",
          description: "Please sign in to continue.",
          variant: "destructive"
        });
        setIsLoading(false);
        return;
      }

      setProfile(existingProfile);
      setInventory(inventoryData || []);
      setUserRoles(rolesData?.map(r => r.role) || []);
      console.log('Loaded profile:', existingProfile);
      console.log('Loaded inventory:', inventoryData);
      console.log('Loaded roles:', rolesData);

    } catch (error) {
      console.error('Error loading user data:', error);
      toast({
        title: "Error",
        description: "Failed to load user data",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const buyBlock = async (itemType: string, cost: number) => {
    if (!user?.id) {
      toast({
        title: "Authentication required",
        description: "Please wait for authentication to complete",
        variant: "destructive"
      });
      return false;
    }

    if (!profile || profile.coins < cost) {
      toast({
        title: "Insufficient coins",
        description: `You need ${cost} coins to buy this block`,
        variant: "destructive"
      });
      return false;
    }

    try {
      console.log(`Starting purchase: ${itemType} for ${cost} coins. Current coins: ${profile.coins}`);
      
      // Deduct coins
      const newCoinAmount = profile.coins - cost;
      const { error: coinsError } = await supabase
        .from('user_profiles')
        .update({ coins: newCoinAmount })
        .eq('user_id', user.id);

      if (coinsError) {
        console.error('Error updating coins:', coinsError);
        throw coinsError;
      }
      console.log(`Coins updated: ${profile.coins} -> ${newCoinAmount}`);

      // Add to inventory
      const existingItem = inventory.find(item => item.item_type === itemType);
      
      if (existingItem) {
        // Update existing inventory item
        const newQuantity = existingItem.quantity + 1;
        const { error: updateError } = await supabase
          .from('user_inventory')
          .update({ quantity: newQuantity })
          .eq('id', existingItem.id);

        if (updateError) {
          console.error('Error updating inventory:', updateError);
          throw updateError;
        }
        console.log(`Inventory updated: ${itemType} quantity ${existingItem.quantity} -> ${newQuantity}`);
      } else {
        // Create new inventory item
        const { error: insertError } = await supabase
          .from('user_inventory')
          .insert([{
            user_id: user.id,
            item_type: itemType,
            quantity: 1
          }]);

        if (insertError) {
          console.error('Error inserting inventory item:', insertError);
          throw insertError;
        }
        console.log(`New inventory item created: ${itemType} with quantity 1`);
      }

      // Update local state immediately for better UX
      setProfile(prev => prev ? { ...prev, coins: newCoinAmount } : null);
      
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
    const item = inventory.find(i => i.item_type === itemType);
    console.log(`useBlock called for ${itemType}. Found item:`, item);
    console.log('Current inventory:', inventory);
    
    if (!item || item.quantity <= 0) {
      console.log(`No ${itemType} blocks available in inventory`);
      toast({
        title: "No blocks available",
        description: `You don't have any ${itemType} blocks in your inventory`,
        variant: "destructive"
      });
      return false;
    }

    try {
      console.log(`Using ${itemType} block. Current quantity: ${item.quantity}`);
      
      const newQuantity = item.quantity - 1;
      const { error } = await supabase
        .from('user_inventory')
        .update({ quantity: newQuantity })
        .eq('id', item.id);

      if (error) throw error;

      // Update local state immediately for instant feedback
      setInventory(prev => prev.map(i => 
        i.id === item.id 
          ? { ...i, quantity: newQuantity }
          : i
      )); // Keep items with 0 quantity to maintain UI consistency

      console.log(`Successfully used ${itemType} block. New quantity: ${newQuantity}`);
      console.log('Updated inventory state:', inventory.map(i => `${i.item_type}:${i.quantity}`));
      
      // Refresh data to ensure consistency
      await loadUserData();
      
      return true;
    } catch (error) {
      console.error('Error using block:', error);
      toast({
        title: "Error",
        description: "Failed to use block from inventory",
        variant: "destructive"
      });
      return false;
    }
  };

  const addCoins = async (amount: number) => {
    if (!user?.id || !profile) {
      console.log('No authenticated user or profile found, cannot add coins');
      return false;
    }

    try {
      console.log(`Adding ${amount} coins to profile:`, profile.id);
      const newCoinAmount = profile.coins + amount;
      const { error } = await supabase
        .from('user_profiles')
        .update({ coins: newCoinAmount })
        .eq('user_id', user.id);

      if (error) {
        console.error('Error updating coins:', error);
        throw error;
      }

      // Update local state
      setProfile(prev => prev ? { ...prev, coins: newCoinAmount } : null);
      console.log(`Successfully added ${amount} coins. New total: ${newCoinAmount}`);
      
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
    if (!user?.id || !profile) {
      console.log('No authenticated user or profile found, cannot update blockchain address');
      return false;
    }

    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ blockchain_address: address })
        .eq('user_id', user.id);

      if (error) {
        console.error('Error updating blockchain address:', error);
        throw error;
      }

      // Update local state
      setProfile(prev => prev ? { ...prev, blockchain_address: address } : null);
      
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

  const refreshData = async () => {
    console.log('refreshData called');
    await loadUserData();
  };

  return {
    profile,
    inventory,
    userRoles,
    isLoading,
    buyBlock,
    useBlock,
    addCoins,
    updateBlockchainAddress,
    refreshData
  };
};