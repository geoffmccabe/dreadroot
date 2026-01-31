import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface FlamethrowerTierDef {
  tier: number;
  width: number;
  distance: number;
  speed: number;
  particles: number;
  transparency: number;
  color1: string;
  color2: string;
  color3: string;
  fireOpacity: number;
  smokeOpacity: number;
}

// Per-tier color defaults matching tier color scheme
const TIER_COLOR_DEFAULTS: Record<number, { color1: string; color2: string; color3: string }> = {
  1:  { color1: '#FFFF88', color2: '#FF8800', color3: '#553300' },  // yellow/brown
  2:  { color1: '#88FF88', color2: '#00FF00', color3: '#005500' },  // green
  3:  { color1: '#FFFFFF', color2: '#00FFFF', color3: '#0044FF' },  // blue (original look)
  4:  { color1: '#DD88FF', color2: '#8800FF', color3: '#440088' },  // purple
  5:  { color1: '#FFFF00', color2: '#FF4400', color3: '#880000' },  // red
  6:  { color1: '#FFFFFF', color2: '#EEEEFF', color3: '#AAAACC' },  // white
  7:  { color1: '#FFAAFF', color2: '#FF00FF', color3: '#880088' },  // pink/fuchsia
  8:  { color1: '#FF4444', color2: '#44FF44', color3: '#4444FF' },  // rainbow (R/G/B)
  9:  { color1: '#FF6600', color2: '#FF0000', color3: '#220000' },  // apocalyptic
  10: { color1: '#FFFFCC', color2: '#FFD700', color3: '#AA8800' },  // cosmic gold
};

const getDefaultFlamethrowerTier = (tier: number): FlamethrowerTierDef => {
  const colors = TIER_COLOR_DEFAULTS[tier] || { color1: '#FFFFFF', color2: '#00FFFF', color3: '#0044FF' };
  return {
    tier,
    width: 1.0,
    distance: 3 + tier,
    speed: 8.0,
    particles: 80,
    transparency: 1.0,
    color1: colors.color1,
    color2: colors.color2,
    color3: colors.color3,
    fireOpacity: 1.0,
    smokeOpacity: 1.0,
  };
};

interface FlamethrowerTiersContextType {
  definitions: Map<number, FlamethrowerTierDef>;
  getDefinition: (tier: number) => FlamethrowerTierDef;
  updateDefinition: (tier: number, def: FlamethrowerTierDef) => void;
  saveAllToDatabase: () => Promise<boolean>;
  loadFromDatabase: () => Promise<void>;
  hasUnsavedChanges: boolean;
  isLoading: boolean;
}

const FlamethrowerTiersContext = createContext<FlamethrowerTiersContextType | undefined>(undefined);

export const FlamethrowerTiersProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [definitions, setDefinitions] = useState<Map<number, FlamethrowerTierDef>>(() => {
    const map = new Map<number, FlamethrowerTierDef>();
    for (let tier = 1; tier <= 10; tier++) {
      map.set(tier, getDefaultFlamethrowerTier(tier));
    }
    return map;
  });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSavedState, setLastSavedState] = useState<string>('');

  const loadFromDatabase = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('flamethrower_tiers')
        .select('*')
        .order('tier', { ascending: true });

      if (error) {
        console.error('[FlamethrowerTiers] Load error:', error);
        return;
      }

      if (data && data.length > 0) {
        const newMap = new Map<number, FlamethrowerTierDef>();
        for (const row of data) {
          const defaults = getDefaultFlamethrowerTier(row.tier);
          newMap.set(row.tier, {
            tier: row.tier,
            width: row.width,
            distance: row.distance,
            speed: row.speed,
            particles: row.particles,
            transparency: row.transparency,
            color1: row.color1 || defaults.color1,
            color2: row.color2 || defaults.color2,
            color3: row.color3 || defaults.color3,
            fireOpacity: row.fire_opacity ?? defaults.fireOpacity,
            smokeOpacity: row.smoke_opacity ?? defaults.smokeOpacity,
          });
        }
        setDefinitions(newMap);
        setLastSavedState(JSON.stringify(Array.from(newMap.entries())));
        setHasUnsavedChanges(false);
        console.log('[FlamethrowerTiers] Loaded from database:', data.length, 'tiers');
      }
    } catch (err) {
      console.error('[FlamethrowerTiers] Load exception:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFromDatabase();
  }, [loadFromDatabase]);

  const getDefinition = useCallback((tier: number): FlamethrowerTierDef => {
    return definitions.get(tier) || getDefaultFlamethrowerTier(tier);
  }, [definitions]);

  const updateDefinition = useCallback((tier: number, def: FlamethrowerTierDef) => {
    setDefinitions(prev => {
      const updated = new Map(prev);
      updated.set(tier, def);
      const currentState = JSON.stringify(Array.from(updated.entries()));
      setHasUnsavedChanges(currentState !== lastSavedState);
      return updated;
    });
  }, [lastSavedState]);

  const saveAllToDatabase = useCallback(async (): Promise<boolean> => {
    try {
      for (const [tier, def] of definitions.entries()) {
        const { error } = await (supabase as any)
          .from('flamethrower_tiers')
          .update({
            width: def.width,
            distance: def.distance,
            speed: def.speed,
            particles: def.particles,
            transparency: def.transparency,
            color1: def.color1,
            color2: def.color2,
            color3: def.color3,
            fire_opacity: def.fireOpacity,
            smoke_opacity: def.smokeOpacity,
          })
          .eq('tier', tier);

        if (error) {
          console.error(`[FlamethrowerTiers] Save error for tier ${tier}:`, error);
          toast.error(`Failed to save tier ${tier}: ${error.message}`);
          return false;
        }
      }

      setLastSavedState(JSON.stringify(Array.from(definitions.entries())));
      setHasUnsavedChanges(false);
      toast.success('Flamethrower tier settings saved');
      console.log('[FlamethrowerTiers] Saved all tiers to database');
      return true;
    } catch (err) {
      console.error('[FlamethrowerTiers] Save exception:', err);
      toast.error('Failed to save flamethrower settings');
      return false;
    }
  }, [definitions]);

  return (
    <FlamethrowerTiersContext.Provider value={{
      definitions,
      getDefinition,
      updateDefinition,
      saveAllToDatabase,
      loadFromDatabase,
      hasUnsavedChanges,
      isLoading,
    }}>
      {children}
    </FlamethrowerTiersContext.Provider>
  );
};

export const useFlamethrowerTiers = () => {
  const context = useContext(FlamethrowerTiersContext);
  if (!context) {
    throw new Error('useFlamethrowerTiers must be used within FlamethrowerTiersProvider');
  }
  return context;
};
