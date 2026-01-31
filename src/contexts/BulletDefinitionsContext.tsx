import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Tier color definitions with defaults
// Color scheme: T1-3 yellow, T4-6 green, T7-9 blue, T10-12 purple, T13-15 red
const TIER_DEFAULTS: Record<number, { name: string; colors: string[] }> = {
  // Yellow tiers (1-3)
  1: { name: 'Yellow I', colors: ['#FFFF00'] },
  2: { name: 'Yellow II', colors: ['#FFEE00'] },
  3: { name: 'Yellow III', colors: ['#FFDD00'] },
  // Green tiers (4-6)
  4: { name: 'Green I', colors: ['#00FF00'] },
  5: { name: 'Green II', colors: ['#00EE00'] },
  6: { name: 'Green III', colors: ['#00DD00'] },
  // Blue tiers (7-9)
  7: { name: 'Blue I', colors: ['#0088FF'] },
  8: { name: 'Blue II', colors: ['#0066FF'] },
  9: { name: 'Blue III', colors: ['#0044FF'] },
  // Purple tiers (10-12)
  10: { name: 'Purple I', colors: ['#8B00FF'] },
  11: { name: 'Purple II', colors: ['#7700EE'] },
  12: { name: 'Purple III', colors: ['#6600DD'] },
  // Red tiers (13-15)
  13: { name: 'Red I', colors: ['#FF0000'] },
  14: { name: 'Red II', colors: ['#EE0000'] },
  15: { name: 'Red III', colors: ['#DD0000'] },
};

export interface BulletDefinition {
  tier: number;
  colors: string[];
  burn_time: number;
  burn_width: number;
  burn_height: number;
  velocity: number;
}

// Default velocities per tier
const DEFAULT_VELOCITIES: Record<number, number> = {
  1: 100, 2: 150, 3: 200, 4: 250, 5: 300,
  6: 350, 7: 400, 8: 450, 9: 500, 10: 550,
  11: 600, 12: 650, 13: 700, 14: 750, 15: 800,
};

// Get default bullet definition for a tier
export const getDefaultBullet = (tier: number): BulletDefinition => ({
  tier,
  colors: TIER_DEFAULTS[tier]?.colors || ['#FFFFFF'],
  burn_time: 0.5 + (tier - 1) * 0.05,
  burn_width: 0.25 + (tier - 1) * 0.025,
  burn_height: 0.5 + (tier - 1) * 0.05,
  velocity: DEFAULT_VELOCITIES[tier] || 100,
});

interface BulletDefinitionsContextType {
  definitions: Map<number, BulletDefinition>;
  getDefinition: (tier: number) => BulletDefinition;
  updateDefinition: (tier: number, def: BulletDefinition) => void;
  saveAllToDatabase: () => Promise<boolean>;
  loadFromDatabase: () => Promise<void>;
  hasUnsavedChanges: boolean;
  isLoading: boolean;
  tierDefaults: typeof TIER_DEFAULTS;
}

const BulletDefinitionsContext = createContext<BulletDefinitionsContextType | undefined>(undefined);

export const BulletDefinitionsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Initialize with defaults for all 10 tiers
  const [definitions, setDefinitions] = useState<Map<number, BulletDefinition>>(() => {
    const map = new Map<number, BulletDefinition>();
    for (let tier = 1; tier <= 10; tier++) {
      map.set(tier, getDefaultBullet(tier));
    }
    return map;
  });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSavedState, setLastSavedState] = useState<string>('');

  // Load from database on mount
  const loadFromDatabase = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('bullet_definitions')
        .select('*')
        .order('tier', { ascending: true });

      if (error) {
        console.error('[BulletDefinitions] Load error:', error);
        return;
      }

      if (data && data.length > 0) {
        const newMap = new Map<number, BulletDefinition>();
        for (const row of data) {
        newMap.set(row.tier, {
            tier: row.tier,
            colors: row.colors || ['#FFFFFF'],
            burn_time: row.burn_time,
            burn_width: row.burn_width,
            burn_height: row.burn_height,
            velocity: row.velocity || DEFAULT_VELOCITIES[row.tier] || 100,
          });
        }
        setDefinitions(newMap);
        setLastSavedState(JSON.stringify(Array.from(newMap.entries())));
        setHasUnsavedChanges(false);
        console.log('[BulletDefinitions] Loaded from database:', data.length, 'tiers');
      }
    } catch (err) {
      console.error('[BulletDefinitions] Load exception:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFromDatabase();
  }, [loadFromDatabase]);

  const getDefinition = useCallback((tier: number): BulletDefinition => {
    return definitions.get(tier) || getDefaultBullet(tier);
  }, [definitions]);

  const updateDefinition = useCallback((tier: number, def: BulletDefinition) => {
    setDefinitions(prev => {
      const updated = new Map(prev);
      updated.set(tier, def);
      // Check if state differs from last saved
      const currentState = JSON.stringify(Array.from(updated.entries()));
      setHasUnsavedChanges(currentState !== lastSavedState);
      return updated;
    });
  }, [lastSavedState]);

  const saveAllToDatabase = useCallback(async (): Promise<boolean> => {
    try {
      const updates = Array.from(definitions.entries()).map(([tier, def]) => ({
        tier,
        colors: def.colors,
        burn_time: def.burn_time,
        burn_width: def.burn_width,
        burn_height: def.burn_height,
        velocity: def.velocity,
      }));

      // Upsert all definitions
      for (const update of updates) {
        const { error } = await supabase
          .from('bullet_definitions')
          .update({
            colors: update.colors,
            burn_time: update.burn_time,
            burn_width: update.burn_width,
            burn_height: update.burn_height,
            velocity: update.velocity,
          })
          .eq('tier', update.tier);

        if (error) {
          console.error(`[BulletDefinitions] Save error for tier ${update.tier}:`, error);
          toast.error(`Failed to save tier ${update.tier}: ${error.message}`);
          return false;
        }
      }

      setLastSavedState(JSON.stringify(Array.from(definitions.entries())));
      setHasUnsavedChanges(false);
      console.log('[BulletDefinitions] Saved all tiers to database');
      return true;
    } catch (err) {
      console.error('[BulletDefinitions] Save exception:', err);
      toast.error('Failed to save bullet definitions');
      return false;
    }
  }, [definitions]);

  return (
    <BulletDefinitionsContext.Provider value={{ 
      definitions, 
      getDefinition, 
      updateDefinition,
      saveAllToDatabase,
      loadFromDatabase,
      hasUnsavedChanges,
      isLoading,
      tierDefaults: TIER_DEFAULTS 
    }}>
      {children}
    </BulletDefinitionsContext.Provider>
  );
};

export const useBulletDefinitions = () => {
  const context = useContext(BulletDefinitionsContext);
  if (!context) {
    throw new Error('useBulletDefinitions must be used within BulletDefinitionsProvider');
  }
  return context;
};

// Utility: Blend multiple hex colors into one (averaged RGB)
export function blendColors(colors: string[]): string {
  if (colors.length === 0) return '#FFFFFF';
  if (colors.length === 1) return colors[0];
  
  let r = 0, g = 0, b = 0;
  for (const hex of colors) {
    const cleaned = hex.replace('#', '');
    r += parseInt(cleaned.substring(0, 2), 16);
    g += parseInt(cleaned.substring(2, 4), 16);
    b += parseInt(cleaned.substring(4, 6), 16);
  }
  
  const count = colors.length;
  const avgR = Math.round(r / count);
  const avgG = Math.round(g / count);
  const avgB = Math.round(b / count);
  
  return `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`;
}
