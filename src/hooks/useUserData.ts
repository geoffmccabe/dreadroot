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
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();

  useEffect(() => {
    // Wait for auth to load before querying user data
    if (!authLoading) {
      loadUserData();
    }
  }, [user?.id, authLoading]);

  const loadUserData = async (retryCount = 0) => {
    // If no authenticated user, clear state
    if (!user?.id) {
      setProfile(null);
      setInventory([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      console.log('Loading user data for authenticated user:', user.id);
      
      // Load both profile and inventory in parallel for faster loading
      const [
        { data: existingProfile, error: profileError },
        { data: inventoryData, error: inventoryError }
      ] = await Promise.all([
        supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('user_inventory')
          .select('*')
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

      if (!existingProfile) {
        // Profile not found - this can happen right after user creation
        // Retry a few times with exponential backoff
        if (retryCount < 3) {
          const delay = Math.pow(2, retryCount) * 500; // 500ms, 1s, 2s
          console.log(`Profile not found, retrying in ${delay}ms (attempt ${retryCount + 1}/3)`);
          setTimeout(() => loadUserData(retryCount + 1), delay);
          return;
        }
        
        console.error('Profile not found after retries for user:', user.id);
        toast({
          title: "Profile Error",
          description: "User profile not found. Please contact support.",
          variant: "destructive"
        });
        setIsLoading(false);
        return;
      }

      setProfile(existingProfile);
      setInventory(inventoryData || []);
      console.log('Loaded profile:', existingProfile);
      console.log('Loaded inventory:', inventoryData);

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

  const checkIsAdmin = async () => {
    if (!user?.id) return false;
    
    try {
      // Check for both admin and superadmin roles
      const { data: adminCheck, error: adminError } = await supabase.rpc('has_role', {
        _user_id: user.id,
        _role: 'admin'
      });

      if (adminError) {
        console.error('Error checking admin role:', adminError);
      }

      const { data: superadminCheck, error: superadminError } = await supabase.rpc('has_role', {
        _user_id: user.id,
        _role: 'superadmin'
      });

      if (superadminError) {
        console.error('Error checking superadmin role:', superadminError);
      }

      const isAdminUser = adminCheck || superadminCheck || false;
      console.log('Admin check result:', { adminCheck, superadminCheck, isAdminUser });
      return isAdminUser;
    } catch (error) {
      console.error('Error checking admin role:', error);
      return false;
    }
  };

  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (user?.id) {
      console.log('🔍 Checking admin status for user:', user.id);
      checkIsAdmin().then((result) => {
        console.log('✅ Admin check complete:', result);
        setIsAdmin(result);
      });
    } else {
      console.log('❌ No user ID, setting isAdmin to false');
      setIsAdmin(false);
    }
  }, [user?.id]);

  return {
    profile,
    inventory,
    isLoading,
    isAdmin,
    buyBlock,
    useBlock,
    addCoins,
    updateBlockchainAddress,
    refreshData
  };
};