import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ColorWeight {
  hex: string;
  weight: number;
}

interface CoinTheme {
  id: string;
  name: string;
  display_name: string;
  flow_speed: number;
  ms_between_drops: number;
  coin_rate: number;
  coin_size: number;
  color_palette: ColorWeight[];
  is_active: boolean;
  coin_image_url?: string | null;
  coin_name?: string | null;
  blockchain?: string | null;
  contract_address?: string | null;
  rpc_url?: string | null;
  chain_id?: string | null;
  block_explorer_url?: string | null;
  ticker_symbol?: string | null;
  website_url?: string | null;
  description?: string | null;
}

interface CoinThemeContextType {
  currentTheme: CoinTheme | null;
  availableThemes: CoinTheme[];
  isLoading: boolean;
  setActiveTheme: (themeId: string) => Promise<void>;
  updateThemeSettings: (settings: Partial<Omit<CoinTheme, 'id' | 'name' | 'display_name' | 'is_active'>>) => Promise<void>;
  refreshThemes: () => Promise<void>;
}

const CoinThemeContext = createContext<CoinThemeContextType | undefined>(undefined);

export const CoinThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentTheme, setCurrentTheme] = useState<CoinTheme | null>(null);
  const [availableThemes, setAvailableThemes] = useState<CoinTheme[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  // Load all available themes
  const loadThemes = async () => {
    try {
      const { data: themes, error } = await supabase
        .from('token_themes')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      
      // Transform Json type to ColorWeight[]
      const transformedThemes = (themes || []).map(theme => ({
        ...theme,
        color_palette: theme.color_palette as unknown as ColorWeight[]
      }));
      
      setAvailableThemes(transformedThemes);
      return transformedThemes;
    } catch (error) {
      console.error('Failed to load themes:', error);
      toast({
        title: "Failed to load themes",
        description: "Using default settings",
        variant: "destructive"
      });
      return [];
    }
  };

  // Load active theme from app settings
  const loadActiveTheme = async () => {
    try {
      setIsLoading(true);
      
      // First load all themes
      const themes = await loadThemes();
      
      // Get active theme ID from app_settings
      const { data: settings, error: settingsError } = await supabase
        .from('app_settings')
        .select('active_token_theme_id')
        .single();

      if (settingsError) {
        console.error('Failed to load app settings:', settingsError);
        // Default to first theme (Waterfall)
        if (themes.length > 0) {
          setCurrentTheme(themes[0]);
        }
        return;
      }

      // Find the active theme
      const activeTheme = themes.find(t => t.id === settings?.active_token_theme_id);
      if (activeTheme) {
        setCurrentTheme(activeTheme);
      } else if (themes.length > 0) {
        // Fallback to first theme
        setCurrentTheme(themes[0]);
      }
    } catch (error) {
      console.error('Failed to load active theme:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Set a new active theme
  const setActiveTheme = async (themeId: string) => {
    try {
      // Update app_settings
      const { error: updateError } = await supabase
        .from('app_settings')
        .update({ active_token_theme_id: themeId })
        .eq('id', (await supabase.from('app_settings').select('id').single()).data?.id);

      if (updateError) throw updateError;

      // Update local state
      const theme = availableThemes.find(t => t.id === themeId);
      if (theme) {
        setCurrentTheme(theme);
        toast({
          title: "Theme changed",
          description: `Switched to ${theme.display_name}`,
          duration: 2000
        });
      }
    } catch (error) {
      console.error('Failed to set active theme:', error);
      toast({
        title: "Failed to change theme",
        description: "Please try again",
        variant: "destructive"
      });
    }
  };

  // Update current theme's settings
  const updateThemeSettings = async (settings: Partial<Omit<CoinTheme, 'id' | 'name' | 'display_name' | 'is_active'>>) => {
    if (!currentTheme) return;

    try {
      // Transform ColorWeight[] to Json type for database
      const dbSettings = {
        ...settings,
        color_palette: settings.color_palette ? (settings.color_palette as unknown as any) : undefined
      };
      
      const { error } = await supabase
        .from('token_themes')
        .update(dbSettings)
        .eq('id', currentTheme.id);

      if (error) throw error;

      // Update local state
      setCurrentTheme({
        ...currentTheme,
        ...settings
      });

      // Also update the theme in availableThemes array
      setAvailableThemes(themes => 
        themes.map(t => t.id === currentTheme.id ? { ...t, ...settings } : t)
      );
    } catch (error) {
      console.error('Failed to update theme settings:', error);
      toast({
        title: "Failed to save settings",
        description: "Please try again",
        variant: "destructive"
      });
    }
  };

  const refreshThemes = async () => {
    await loadActiveTheme();
  };

  // Load on mount
  useEffect(() => {
    loadActiveTheme();
  }, []);

  return (
    <CoinThemeContext.Provider value={{
      currentTheme,
      availableThemes,
      isLoading,
      setActiveTheme,
      updateThemeSettings,
      refreshThemes
    }}>
      {children}
    </CoinThemeContext.Provider>
  );
};

export const useCoinTheme = () => {
  const context = useContext(CoinThemeContext);
  if (!context) {
    throw new Error('useCoinTheme must be used within CoinThemeProvider');
  }
  return context;
};
