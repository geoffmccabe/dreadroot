// PlantedTreesPanel - Collapsible admin panel listing planted trees by type
// Allows viewing, teleporting to, and deleting planted trees with seed return to owner

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronUp, Trash2, SquareArrowOutUpRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useBlocks } from '@/contexts/BlocksContext';
import { PlantedTree, SeedDefinition, TreeType } from '../types';
import { deleteTree } from '../hooks/useLocalGrowth';
import { returnSeedToUser } from '../hooks/useTreeChopping';

const TYPE_LABELS: Record<string, string> = {
  original: 'Original',
  wide: 'Wide',
  fungal: 'Fungal',
};

interface PlantedTreeWithProfile extends PlantedTree {
  owner_name?: string;
}

interface PlantedTreesPanelProps {
  treeType: TreeType;
}

export function PlantedTreesPanel({ treeType }: PlantedTreesPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [trees, setTrees] = useState<PlantedTreeWithProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { toast } = useToast();
  const { currentWorldId } = useBlocks();

  const fetchTrees = useCallback(async () => {
    if (!currentWorldId) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('planted_trees')
        .select(`
          *,
          seed_definition:seed_definitions!planted_trees_seed_definition_id_fkey(*)
        `)
        .eq('world_id', currentWorldId)
        .order('planted_at', { ascending: false });

      if (error) {
        console.error('[PlantedTreesPanel] Fetch error:', error);
        return;
      }

      // Filter by tree type
      const filtered = (data || []).filter(t => {
        const seedDef = t.seed_definition as any as SeedDefinition | null;
        const type = seedDef?.tree_type || 'original';
        return type === treeType;
      });

      // Fetch owner display names
      const userIds = [...new Set(filtered.map(t => t.planted_by))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', userIds);
        if (profiles) {
          for (const p of profiles) {
            profileMap[p.id] = p.display_name || p.id.slice(0, 8);
          }
        }
      }

      const treesWithNames: PlantedTreeWithProfile[] = filtered.map(t => ({
        ...t,
        seed_definition: t.seed_definition as any as SeedDefinition,
        owner_name: profileMap[t.planted_by] || t.planted_by.slice(0, 8),
      }));

      setTrees(treesWithNames);
    } catch (err) {
      console.error('[PlantedTreesPanel] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentWorldId, treeType]);

  useEffect(() => {
    if (isOpen) {
      fetchTrees();
    }
  }, [isOpen, fetchTrees]);

  const handleTeleport = (tree: PlantedTreeWithProfile) => {
    // Position player a few blocks away on +Z side, looking toward the seed
    const offsetZ = 5;
    window.dispatchEvent(new CustomEvent('playerTeleport', {
      detail: { x: tree.base_x, y: tree.base_y + 1, z: tree.base_z + offsetZ },
    }));
    toast({ title: 'Teleported', description: `Jumped to tree at ${tree.base_x},${tree.base_y},${tree.base_z}` });
  };

  const handleDelete = async (tree: PlantedTreeWithProfile) => {
    if (!tree.seed_definition) return;
    setDeletingId(tree.id);

    try {
      const seedDef = tree.seed_definition;

      // Delete tree and all its blocks
      const result = await deleteTree(tree, seedDef, undefined, true);

      if (!result.success) {
        toast({ title: 'Delete failed', description: result.error, variant: 'destructive' });
        return;
      }

      // Return seed to owner
      const seedReturned = await returnSeedToUser(seedDef.id, seedDef, tree.planted_by);
      if (!seedReturned) {
        toast({ title: 'Tree deleted', description: 'Warning: failed to return seed to owner' });
      } else {
        toast({ title: 'Tree deleted', description: `Seed returned to ${tree.owner_name}` });
      }

      // Refresh list
      await fetchTrees();
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to delete tree', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card className="p-3 mb-4 bg-muted/30">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full">
          <h4 className="text-sm font-semibold">
            Planted Trees ({isOpen ? trees.length : '...'})
          </h4>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-3">
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : trees.length === 0 ? (
            <p className="text-xs text-muted-foreground">No planted trees of this type.</p>
          ) : (
            <div className="max-h-[200px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left pb-1 pr-2">Tier</th>
                    <th className="text-left pb-1 pr-2">Type</th>
                    <th className="text-left pb-1 pr-2">Owner</th>
                    <th className="text-left pb-1 pr-2">Blocks</th>
                    <th className="text-left pb-1 pr-2">Location</th>
                    <th className="text-left pb-1 pr-2">Status</th>
                    <th className="text-right pb-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {trees.map(tree => {
                    const seedDef = tree.seed_definition;
                    const tier = seedDef?.tier ?? '?';
                    const type = (seedDef as any)?.tree_type || 'original';
                    const isComplete = tree.is_fully_grown;
                    return (
                      <tr key={tree.id} className="border-b border-muted/50">
                        <td className="py-1 pr-2">T{tier}</td>
                        <td className="py-1 pr-2">{TYPE_LABELS[type] || type}</td>
                        <td className="py-1 pr-2">{tree.owner_name}</td>
                        <td className="py-1 pr-2">
                          {tree.current_block_count}/{tree.target_block_count}
                        </td>
                        <td className="py-1 pr-2 whitespace-nowrap">
                          {tree.base_x},{tree.base_y},{tree.base_z}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 ml-1 inline-flex text-muted-foreground hover:text-foreground"
                            onClick={() => handleTeleport(tree)}
                            title="Jump to tree"
                          >
                            <SquareArrowOutUpRight className="h-3 w-3" />
                          </Button>
                        </td>
                        <td className="py-1 pr-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            isComplete
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {isComplete ? 'Complete' : 'Growing'}
                          </span>
                        </td>
                        <td className="py-1 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(tree)}
                            disabled={deletingId === tree.id}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
