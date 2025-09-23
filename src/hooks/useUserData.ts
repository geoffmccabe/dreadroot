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

// Generate a proper UUID for temporary demo users
const generateTempUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export const useUserData = () => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [inventory, setInventory] = useState<UserInventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  // Generate a consistent temp UUID for this session
  const [tempUserId] = useState(() => {
    const stored = localStorage.getItem('temp-user-id');
    if (stored) return stored;
    const newId = generateTempUUID();
    localStorage.setItem('temp-user-id', newId);
    return newId;
  });

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      setIsLoading(true);
      console.log('Loading user data for:', tempUserId);
      
      // Load or create user profile
      let { data: existingProfile, error: profileSelectError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', tempUserId)
        .maybeSingle();

      if (profileSelectError) {
        console.error('Error loading profile:', profileSelectError);
      }

      if (!existingProfile) {
        console.log('Creating new profile for:', tempUserId);
        // Create new profile for demo user
        const { data: newProfile, error: profileError } = await supabase
          .from('user_profiles')
          .insert([{
            user_id: tempUserId,
            coins: 100
          }])
          .select()
          .single();

        if (profileError) {
          console.error('Error creating profile:', profileError);
          throw profileError;
        }
        existingProfile = newProfile;
        console.log('Created profile:', existingProfile);
      } else {
        console.log('Loaded existing profile:', existingProfile);
      }

      setProfile(existingProfile);

      // Load inventory
      const { data: inventoryData, error: inventoryError } = await supabase
        .from('user_inventory')
        .select('*')
        .eq('user_id', tempUserId);

      if (inventoryError) throw inventoryError;
      setInventory(inventoryData || []);
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

  const addCoins = async (amount: number) => {
    if (!profile) {
      console.log('No profile found, cannot add coins');
      return false;
    }

    try {
      console.log(`Adding ${amount} coins to profile:`, profile.id);
      const newCoinAmount = profile.coins + amount;
      const { error } = await supabase
        .from('user_profiles')
        .update({ coins: newCoinAmount })
        .eq('id', profile.id);

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

  return {
    profile,
    inventory,
    isLoading,
    buyBlock,
    useBlock,
    addCoins,
    refreshData: loadUserData
  };
};