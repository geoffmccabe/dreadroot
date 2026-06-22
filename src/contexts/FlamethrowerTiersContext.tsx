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

// Per-tier color scheme (color1 = bright/inner, color2 = mid, color3 = outer/edge).
// Rarity → look: 1 Common brown/tan+grey · 2 Uncommon green+teal · 3 Rare blues ·
// 4 Epic purple · 5 Legendary red/orange+black · 6 Divine white/silver · 7 Mystic
// pink/fuchsia · 8 Rainbow · 9 Apocalyptic fire (yellow/orange/red) · 10 Cosmic metallic gold.
const TIER_COLOR_DEFAULTS: Record<number, { color1: string; color2: string; color3: string }> = {
  1:  { color1: '#D8C088', color2: '#9C7B4A', color3: '#707070' },  // common — brown/tan, grey
  2:  { color1: '#BFFFD0', color2: '#20D070', color3: '#0A8C8C' },  // uncommon — green, teal
  3:  { color1: '#DCF2FF', color2: '#2E8BFF', color3: '#0A2EAA' },  // rare — blue tones
  4:  { color1: '#E6B0FF', color2: '#9A40FF', color3: '#7A1E5A' },  // epic — purple (blue→reddish)
  5:  { color1: '#FFC060', color2: '#FF3010', color3: '#1A0000' },  // legendary — red/orange, black
  6:  { color1: '#FFFFFF', color2: '#EAEAF2', color3: '#B8BEC8' },  // divine — white, silver
  7:  { color1: '#FFD0F2', color2: '#FF40C0', color3: '#C0008A' },  // mystic — pink, fuchsia
  8:  { color1: '#FF3030', color2: '#30E030', color3: '#3060FF' },  // rainbow — vivid multi-hue
  9:  { color1: '#FFE040', color2: '#FF7000', color3: '#E01000' },  // apocalyptic — yellow/orange/red
  10: { color1: '#FFF2C0', color2: '#FFD000', color3: '#B8860B' },  // cosmic — metallic gold
};

const getDefaultFlamethrowerTier = (tier: number): FlamethrowerTierDef => {
  // Unknown/out-of-range tier → fall back to TIER 1, NOT blue. The old blue fallback
  // was identical to tier 3, so any tier mis-read silently showed the wrong (blue) flame.
  const colors = TIER_COLOR_DEFAULTS[tier] || TIER_COLOR_DEFAULTS[1];
  return {
    tier,
    width: 1.0,
    // Reach scales ~+2m per tier (tier 1 ≈ 5m … tier 10 ≈ 23m). Speed 10 keeps
    // lifetime = distance/speed ABOVE the 0.5s floor so each tier visibly reaches
    // farther (at the old speed 21.6 every tier floored to ~0.5s → all looked alike).
    distance: 3 + 2 * tier,
    speed: 10.0,
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
