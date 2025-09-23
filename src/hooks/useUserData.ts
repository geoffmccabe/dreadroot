import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface UserProfile {
  id: string;
  user_id: string | null;
  coins: number;
  created_at: string;
  updated_at: string;
}

export interface UserInventoryItem {
  id: string;
  user_id: string | null;
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

  // For demo purposes, we'll use a temporary user ID
  // In a real app, this would come from authentication
  const tempUserId = 'temp-user-' + Date.now();

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      setIsLoading(true);
      
      // Load or create user profile
      let { data: existingProfile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', tempUserId)
        .maybeSingle();

      if (!existingProfile) {
        // Create new profile for demo user
        const { data: newProfile, error: profileError } = await supabase
          .from('user_profiles')
          .insert([{
            user_id: tempUserId,
            coins: 100
          }])
          .select()
          .single();

        if (profileError) throw profileError;
        existingProfile = newProfile;
      }

      setProfile(existingProfile);

      // Load inventory
      const { data: inventoryData, error: inventoryError } = await supabase
        .from('user_inventory')
        .select('*')
        .eq('user_id', tempUserId);

      if (inventoryError) throw inventoryError;
      setInventory(inventoryData || []);

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
    if (!profile || profile.coins < cost) {
      toast({
        title: "Insufficient coins",
        description: `You need ${cost} coins to buy this block`,
        variant: "destructive"
      });
      return false;
    }

    try {
      // Deduct coins
      const { error: coinsError } = await supabase
        .from('user_profiles')
        .update({ coins: profile.coins - cost })
        .eq('id', profile.id);

      if (coinsError) throw coinsError;

      // Add to inventory
      const existingItem = inventory.find(item => item.item_type === itemType);
      
      if (existingItem) {
        // Update existing inventory item
        const { error: updateError } = await supabase
          .from('user_inventory')
          .update({ quantity: existingItem.quantity + 1 })
          .eq('id', existingItem.id);

        if (updateError) throw updateError;
      } else {
        // Create new inventory item
        const { error: insertError } = await supabase
          .from('user_inventory')
          .insert([{
            user_id: tempUserId,
            item_type: itemType,
            quantity: 1
          }]);

        if (insertError) throw insertError;
      }

      // Refresh data
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
    if (!item || item.quantity <= 0) return false;

    try {
      const { error } = await supabase
        .from('user_inventory')
        .update({ quantity: item.quantity - 1 })
        .eq('id', item.id);

      if (error) throw error;

      await loadUserData();
      return true;
    } catch (error) {
      console.error('Error using block:', error);
      return false;
    }
  };

  return {
    profile,
    inventory,
    isLoading,
    buyBlock,
    useBlock,
    refreshData: loadUserData
  };
};