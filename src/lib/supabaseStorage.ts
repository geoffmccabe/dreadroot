import { blockDB } from '@/hooks/useIndexedDB';

/**
 * Custom storage adapter for Supabase that uses IndexedDB instead of localStorage
 * This provides better reliability for anonymous session persistence
 */
export const indexedDBStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return await blockDB.getAuthItem(key);
    } catch (error) {
      console.error('Error getting item from IndexedDB:', error);
      return null;
    }
  },
  
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      await blockDB.setAuthItem(key, value);
    } catch (error) {
      console.error('Error setting item in IndexedDB:', error);
    }
  },
  
  removeItem: async (key: string): Promise<void> => {
    try {
      await blockDB.removeAuthItem(key);
    } catch (error) {
      console.error('Error removing item from IndexedDB:', error);
    }
  },
};
