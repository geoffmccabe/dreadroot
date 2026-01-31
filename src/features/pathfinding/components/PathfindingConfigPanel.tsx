/**
 * Pathfinding Configuration Panel
 *
 * Admin panel for managing pathfinding configurations.
 * Displays available algorithms and allows CRUD operations on configs.
 */

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, Save, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import {
  usePathfindingConfigs,
  useCreatePathfindingConfig,
  useUpdatePathfindingConfig,
  useDeletePathfindingConfig,
  usePathfindingAlgorithms,
} from '@/hooks/usePathfindingConfigs';
import type { PathfindingConfig, PathfindingConfigFormData, RandomizationMode } from '@/lib/pathfinding';

const RANDOMIZATION_MODES: { value: RandomizationMode; label: string; description: string }[] = [
  { value: 'straight', label: 'Straight', description: 'No randomization, exact path' },
  { value: 'curved', label: 'Curved', description: 'Smooth bezier curves between waypoints' },
  { value: 'jagged', label: 'Jagged', description: 'Random offsets at each waypoint' },
];

interface ConfigCardProps {
  config: PathfindingConfig;
  index: number;
  algorithms: { code: string; name: string }[] | undefined;
  onSave: (id: string, data: Partial<PathfindingConfigFormData>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isSaving: boolean;
  isDeleting: boolean;
}

function ConfigCard({ config, index, algorithms, onSave, onDelete, isSaving, isDeleting }: ConfigCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<PathfindingConfigFormData>>({
    name: config.name,
    description: config.description || '',
    algorithm_code: config.algorithm_code,
    grid_size: config.grid_size,
    max_iterations: config.max_iterations,
    default_randomization: config.default_randomization,
    randomization_mode: config.randomization_mode,
    is_default: config.is_default,
  });
  const [hasChanges, setHasChanges] = useState(false);

  const shortCode = `#PF${index + 1}`;

  const updateField = (field: keyof PathfindingConfigFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    await onSave(config.id, formData);
    setHasChanges(false);
  };

  const algorithmName = algorithms?.find(a => a.code === config.algorithm_code)?.name || config.algorithm_code;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="w-full">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <Badge variant="outline" className="font-mono text-xs">
                  {shortCode}
                </Badge>
                <CardTitle className="text-base">{config.name}</CardTitle>
                <code className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                  {config.code}
                </code>
                {config.is_default && (
                  <Badge variant="secondary" className="text-xs">Default</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">{algorithmName}</Badge>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <div className="space-y-4">
              {/* Description - Full */}
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">{config.description || 'No description provided.'}</p>
              </div>

              <Separator />

              {/* Editable Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`name-${config.id}`}>Display Name</Label>
                  <Input
                    id={`name-${config.id}`}
                    value={formData.name || ''}
                    onChange={(e) => updateField('name', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Algorithm</Label>
                  <Select
                    value={formData.algorithm_code || 'astar'}
                    onValueChange={(v) => updateField('algorithm_code', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {algorithms?.map((algo) => (
                        <SelectItem key={algo.code} value={algo.code}>
                          {algo.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`desc-${config.id}`}>Description</Label>
                <Textarea
                  id={`desc-${config.id}`}
                  value={formData.description || ''}
                  onChange={(e) => updateField('description', e.target.value)}
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Randomization Mode</Label>
                  <Select
                    value={formData.randomization_mode || 'straight'}
                    onValueChange={(v) => updateField('randomization_mode', v as RandomizationMode)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RANDOMIZATION_MODES.map((mode) => (
                        <SelectItem key={mode.value} value={mode.value}>
                          {mode.label} - {mode.description}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <Switch
                    checked={formData.is_default || false}
                    onCheckedChange={(v) => updateField('is_default', v)}
                  />
                  <Label>Set as default configuration</Label>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Grid Size (m): {formData.grid_size?.toFixed(1)}</Label>
                  <Slider
                    value={[formData.grid_size || 2]}
                    onValueChange={([v]) => updateField('grid_size', v)}
                    min={0.5}
                    max={8}
                    step={0.5}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Max Iterations: {formData.max_iterations}</Label>
                  <Slider
                    value={[formData.max_iterations || 3000]}
                    onValueChange={([v]) => updateField('max_iterations', v)}
                    min={500}
                    max={10000}
                    step={500}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Randomization (m): {formData.default_randomization?.toFixed(1)}</Label>
                  <Slider
                    value={[formData.default_randomization || 0]}
                    onValueChange={([v]) => updateField('default_randomization', v)}
                    min={0}
                    max={5}
                    step={0.5}
                  />
                </div>
              </div>

              <Separator />

              <div className="flex justify-between">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onDelete(config.id)}
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Delete
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={isSaving || !hasChanges}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save Changes
                </Button>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export function PathfindingConfigPanel() {
  const { toast } = useToast();
  const { data: configs, isLoading: configsLoading, refetch } = usePathfindingConfigs();
  const { data: algorithms } = usePathfindingAlgorithms();
  const createMutation = useCreatePathfindingConfig();
  const updateMutation = useUpdatePathfindingConfig();
  const deleteMutation = useDeletePathfindingConfig();

  const [isCreating, setIsCreating] = useState(false);
  const [newFormData, setNewFormData] = useState<Partial<PathfindingConfigFormData>>({});

  // Sort configs alphabetically by name
  const sortedConfigs = useMemo(() => {
    if (!configs) return [];
    return [...configs].sort((a, b) => a.name.localeCompare(b.name));
  }, [configs]);

  const startCreate = () => {
    setIsCreating(true);
    setNewFormData({
      code: '',
      name: '',
      description: '',
      algorithm_code: 'astar',
      grid_size: 2,
      max_iterations: 3000,
      default_randomization: 0,
      randomization_mode: 'straight',
      algorithm_params: {},
      is_default: false,
    });
  };

  const cancelCreate = () => {
    setIsCreating(false);
    setNewFormData({});
  };

  const handleCreate = async () => {
    if (!newFormData.code || !newFormData.name || !newFormData.algorithm_code) {
      toast({ title: 'Error', description: 'Code, name, and algorithm are required', variant: 'destructive' });
      return;
    }

    try {
      await createMutation.mutateAsync(newFormData as PathfindingConfigFormData);
      toast({ title: 'Success', description: 'Configuration created' });
      cancelCreate();
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to create configuration', variant: 'destructive' });
    }
  };

  const handleSave = async (id: string, data: Partial<PathfindingConfigFormData>) => {
    try {
      await updateMutation.mutateAsync({ id, ...data });
      toast({ title: 'Success', description: 'Configuration updated' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save configuration', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast({ title: 'Success', description: 'Configuration deleted' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to delete configuration', variant: 'destructive' });
    }
  };

  if (configsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Pathfinding Configurations</h3>
          <p className="text-sm text-muted-foreground">
            {sortedConfigs.length} configurations available
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" onClick={startCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New Config
          </Button>
        </div>
      </div>

      {/* Algorithm Reference */}
      <Card>
        <Collapsible>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center gap-2">
                <ChevronRight className="h-4 w-4" />
                <CardTitle className="text-base">Algorithm Reference</CardTitle>
                <Badge variant="outline" className="text-xs">{algorithms?.length || 0} algorithms</Badge>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 gap-2">
                {algorithms?.map((algo) => (
                  <div key={algo.code} className="p-3 border rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{algo.name}</span>
                      <Badge variant="outline" className="text-xs">{algo.category}</Badge>
                      <code className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{algo.code}</code>
                    </div>
                    <p className="text-sm text-muted-foreground">{algo.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* New Config Form */}
      {isCreating && (
        <Card className="border-primary">
          <CardHeader className="py-3">
            <CardTitle className="text-base">New Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code (unique identifier)</Label>
                <Input
                  value={newFormData.code || ''}
                  onChange={(e) => setNewFormData({ ...newFormData, code: e.target.value })}
                  placeholder="e.g., astar_boss"
                />
              </div>
              <div className="space-y-2">
                <Label>Display Name</Label>
                <Input
                  value={newFormData.name || ''}
                  onChange={(e) => setNewFormData({ ...newFormData, name: e.target.value })}
                  placeholder="e.g., A* for Bosses"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={newFormData.description || ''}
                onChange={(e) => setNewFormData({ ...newFormData, description: e.target.value })}
                placeholder="Describe when to use this configuration..."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Algorithm</Label>
                <Select
                  value={newFormData.algorithm_code || 'astar'}
                  onValueChange={(v) => setNewFormData({ ...newFormData, algorithm_code: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {algorithms?.map((algo) => (
                      <SelectItem key={algo.code} value={algo.code}>
                        {algo.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Randomization Mode</Label>
                <Select
                  value={newFormData.randomization_mode || 'straight'}
                  onValueChange={(v) => setNewFormData({ ...newFormData, randomization_mode: v as RandomizationMode })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RANDOMIZATION_MODES.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value}>
                        {mode.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={cancelCreate}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Create
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Config List - Full Width, Alphabetized */}
      <div className="space-y-2">
        {sortedConfigs.map((config, index) => (
          <ConfigCard
            key={config.id}
            config={config}
            index={index}
            algorithms={algorithms}
            onSave={handleSave}
            onDelete={handleDelete}
            isSaving={updateMutation.isPending}
            isDeleting={deleteMutation.isPending}
          />
        ))}
        {sortedConfigs.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No configurations found. Click "New Config" to create one.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
