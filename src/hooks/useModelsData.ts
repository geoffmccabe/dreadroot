import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ModelType, AnimationConfig } from '@/types/models';

export const useModelsData = () => {
  const [models, setModels] = useState<ModelType[]>([]);
  const [modelsMap, setModelsMap] = useState<Map<string, ModelType>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const { data, error } = await supabase
          .from('models')
          .select('*')
          .eq('is_active', true)
          .order('model_type', { ascending: true })
          .order('rarity', { ascending: true });

        if (error) throw error;

        const typedModels: ModelType[] = (data || []).map(model => ({
          ...model,
          model_type: model.model_type as 'Character' | 'NPC' | 'Enemy',
          file_format: model.file_format as 'fbx' | 'glb' | 'gltf',
          rarity: model.rarity as 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary',
          animations: model.animations as unknown as AnimationConfig[]
        }));

        const modelMap = new Map<string, ModelType>();
        typedModels.forEach(model => modelMap.set(model.key, model));

        setModels(typedModels);
        setModelsMap(modelMap);
      } catch (error) {
        console.error('Failed to load models:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadModels();

    // Listen for model updates
    const handleModelsUpdated = () => {
      loadModels();
    };

    window.addEventListener('modelsUpdated', handleModelsUpdated);

    return () => {
      window.removeEventListener('modelsUpdated', handleModelsUpdated);
    };
  }, []);

  const getModelByKey = (key: string): ModelType | undefined => {
    return modelsMap.get(key);
  };

  const refreshModels = async () => {
    setIsLoading(true);

    try {
      const { data, error } = await supabase
        .from('models')
        .select('*')
        .eq('is_active', true)
        .order('model_type', { ascending: true });

      if (error) throw error;

      const typedModels: ModelType[] = (data || []).map(model => ({
        ...model,
        model_type: model.model_type as 'Character' | 'NPC' | 'Enemy',
        file_format: model.file_format as 'fbx' | 'glb' | 'gltf',
        rarity: model.rarity as 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary',
        animations: model.animations as unknown as AnimationConfig[]
      }));

      const modelMap = new Map<string, ModelType>();
      typedModels.forEach(model => modelMap.set(model.key, model));

      setModels(typedModels);
      setModelsMap(modelMap);
    } catch (error) {
      console.error('Failed to refresh models:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return { models, modelsMap, isLoading, getModelByKey, refreshModels };
};
