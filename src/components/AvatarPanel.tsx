import React, { useState } from 'react';
import { useAvatar } from '@/contexts/AvatarContext';
import { useModelsData } from '@/hooks/useModelsData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Play, Trash2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AvatarModelPreview } from './AvatarModelPreview';
import { AnimationConfig } from '@/types/models';

export function AvatarPanel() {
  const { 
    avatarConfig, 
    updateAvatarConfig, 
    updateAnimation, 
    addAnimation,
    removeAnimation,
    triggerAnimation,
    currentAnimation 
  } = useAvatar();

  const { models, isLoading: modelsLoading } = useModelsData();

  const [isGiantMode, setIsGiantMode] = useState(false);
  const [newAnim, setNewAnim] = useState<Partial<AnimationConfig>>({
    name: '',
    file: '',
    trigger: 'manual',
    speed: 1.0,
    loop: true,
    fadeInDuration: 0.2,
    fadeOutDuration: 0.2,
  });

  const handleAddAnimation = () => {
    if (newAnim.name && newAnim.file) {
      addAnimation(newAnim as AnimationConfig);
      setNewAnim({
        name: '',
        file: '',
        trigger: 'manual',
        speed: 1.0,
        loop: true,
        fadeInDuration: 0.2,
        fadeOutDuration: 0.2,
      });
    }
  };

  return (
    <div className="space-y-6 overflow-y-auto max-h-[calc(100vh-8rem)] pr-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle>MODEL</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => document.getElementById('model-file-input')?.click()}
          >
            <Plus className="h-4 w-4 mr-2" />
            IMPORT MODEL
          </Button>
          <input
            id="model-file-input"
            type="file"
            accept=".fbx,.glb,.gltf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                // For now, just show the file name - actual upload functionality to be implemented
                console.log('Model file selected:', file.name);
                // TODO: Implement file upload to storage
              }
            }}
          />
        </CardHeader>
        <CardContent>
          <Select
            value={avatarConfig.model}
            onValueChange={(value) => {
              const model = models.find(m => m.model_url === value);
              if (model) {
                updateAvatarConfig({
                  model: model.model_url,
                  scale: model.default_scale,
                  scaleX: model.default_scale_x,
                  scaleY: model.default_scale_y,
                  scaleZ: model.default_scale_z,
                  color: model.default_color,
                  animations: model.animations,
                });
              }
            }}
            disabled={modelsLoading}
          >
            <SelectTrigger>
              <SelectValue placeholder={modelsLoading ? "Loading models..." : "Select a model"} />
            </SelectTrigger>
            <SelectContent>
              {['Character', 'NPC', 'Enemy'].map(type => {
                const typeModels = models.filter(m => m.model_type === type);
                if (typeModels.length === 0) return null;
                return (
                  <div key={type}>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      {type}s
                    </div>
                    {typeModels.map(model => (
                      <SelectItem key={model.id} value={model.model_url}>
                        <div className="flex items-center gap-2">
                          <span>{model.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {model.rarity}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </div>
                );
              })}
            </SelectContent>
          </Select>
          
          {avatarConfig.model && (() => {
            const currentModel = models.find(m => m.model_url === avatarConfig.model);
            return currentModel?.description ? (
              <p className="text-sm text-muted-foreground mt-2">
                {currentModel.description}
              </p>
            ) : null;
          })()}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex gap-6">
            <div className="flex-1 space-y-4">
              <div>
                <CardTitle>Model Settings</CardTitle>
                <CardDescription>Configure the avatar model and positioning</CardDescription>
              </div>

              <div className="space-y-2">
                <Label htmlFor="model">Model Path</Label>
                <Input
                  id="model"
                  value={avatarConfig.model}
                  onChange={(e) => updateAvatarConfig({ model: e.target.value })}
                  placeholder="/y-bot.fbx"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="scale">Height: {(avatarConfig.scale / 0.01 * 1.7).toFixed(2)}m</Label>
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="giant-mode"
                      checked={isGiantMode}
                      onCheckedChange={(checked) => {
                        setIsGiantMode(checked === true);
                        if (checked === true) {
                          // When enabling giant mode, ensure height is at least 3.0m
                          const currentHeight = avatarConfig.scale / 0.01 * 1.7;
                          if (currentHeight < 3.0) {
                            updateAvatarConfig({ scale: 3.0 * 0.01 / 1.7 });
                          }
                        } else {
                          // When disabling giant mode, set to standard 1.8m
                          updateAvatarConfig({ scale: 1.8 * 0.01 / 1.7 });
                        }
                      }}
                    />
                    <Label htmlFor="giant-mode" className="cursor-pointer">GIANT</Label>
                  </div>
                </div>
                <Slider
                  id="scale"
                  min={isGiantMode ? 3 : 0.1}
                  max={isGiantMode ? 20 : 3}
                  step={isGiantMode ? 0.5 : 0.1}
                  value={[avatarConfig.scale / 0.01 * 1.7]}
                  onValueChange={([value]) => updateAvatarConfig({ scale: value * 0.01 / 1.7 })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="color">Avatar Color</Label>
                <div className="flex gap-2">
                  <Input
                    id="color"
                    type="color"
                    value={avatarConfig.color}
                    onChange={(e) => updateAvatarConfig({ color: e.target.value })}
                    className="w-20 h-10"
                  />
                  <Input
                    value={avatarConfig.color}
                    onChange={(e) => updateAvatarConfig({ color: e.target.value })}
                    placeholder="#4a9eff"
                  />
                </div>
              </div>
            </div>

            <div className="w-96 h-96 flex-shrink-0">
              <AvatarModelPreview
                key={`${avatarConfig.model}-${avatarConfig.scale}-${avatarConfig.scaleX}-${avatarConfig.scaleY}-${avatarConfig.scaleZ}`}
                modelPath={avatarConfig.model}
                color={avatarConfig.color}
                scale={avatarConfig.scale}
                scaleX={avatarConfig.scaleX}
                scaleY={avatarConfig.scaleY}
                scaleZ={avatarConfig.scaleZ}
                animationPath={avatarConfig.animations.find(a => a.trigger === 'movement')?.file}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="scaleX">Width (X): {avatarConfig.scaleX.toFixed(2)}x</Label>
              <Slider
                id="scaleX"
                min={0.5}
                max={2}
                step={0.1}
                value={[avatarConfig.scaleX]}
                onValueChange={([value]) => updateAvatarConfig({ scaleX: value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scaleY">Height (Y): {avatarConfig.scaleY.toFixed(2)}x</Label>
              <Slider
                id="scaleY"
                min={0.5}
                max={2}
                step={0.1}
                value={[avatarConfig.scaleY]}
                onValueChange={([value]) => updateAvatarConfig({ scaleY: value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scaleZ">Depth (Z): {avatarConfig.scaleZ.toFixed(2)}x</Label>
              <Slider
                id="scaleZ"
                min={0.5}
                max={2}
                step={0.1}
                value={[avatarConfig.scaleZ]}
                onValueChange={([value]) => updateAvatarConfig({ scaleZ: value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Animation Library</CardTitle>
          <CardDescription>Manage and test avatar animations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {avatarConfig.animations.map((anim) => (
            <Card key={anim.name} className={currentAnimation === anim.name ? 'border-primary' : ''}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{anim.name}</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => triggerAnimation(anim.name)}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => removeAnimation(anim.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">{anim.file}</div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Trigger</Label>
                    <Select
                      value={anim.trigger}
                      onValueChange={(value) => updateAnimation(anim.name, { trigger: value as any })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="movement">Movement</SelectItem>
                        <SelectItem value="idle">Idle</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                        <SelectItem value="jump">Jump</SelectItem>
                        <SelectItem value="crouch">Crouch</SelectItem>
                        <SelectItem value="attack">Attack</SelectItem>
                        <SelectItem value="death">Death</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Speed: {anim.speed.toFixed(2)}</Label>
                    <Slider
                      min={0.1}
                      max={3}
                      step={0.1}
                      value={[anim.speed]}
                      onValueChange={([value]) => updateAnimation(anim.name, { speed: value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Fade In: {anim.fadeInDuration.toFixed(2)}s</Label>
                    <Slider
                      min={0}
                      max={2}
                      step={0.1}
                      value={[anim.fadeInDuration]}
                      onValueChange={([value]) => updateAnimation(anim.name, { fadeInDuration: value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Fade Out: {anim.fadeOutDuration.toFixed(2)}s</Label>
                    <Slider
                      min={0}
                      max={2}
                      step={0.1}
                      value={[anim.fadeOutDuration]}
                      onValueChange={([value]) => updateAnimation(anim.name, { fadeOutDuration: value })}
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    checked={anim.loop}
                    onCheckedChange={(checked) => updateAnimation(anim.name, { loop: checked })}
                  />
                  <Label>Loop Animation</Label>
                </div>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add New Animation</CardTitle>
          <CardDescription>Add a new animation to the library</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-name">Animation Name</Label>
            <Input
              id="new-name"
              value={newAnim.name}
              onChange={(e) => setNewAnim({ ...newAnim, name: e.target.value })}
              placeholder="Run"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-file">File Path</Label>
            <Input
              id="new-file"
              value={newAnim.file}
              onChange={(e) => setNewAnim({ ...newAnim, file: e.target.value })}
              placeholder="/Running.fbx"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-trigger">Trigger</Label>
            <Select
              value={newAnim.trigger}
              onValueChange={(value) => setNewAnim({ ...newAnim, trigger: value as any })}
            >
              <SelectTrigger id="new-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="movement">Movement</SelectItem>
                <SelectItem value="idle">Idle</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="jump">Jump</SelectItem>
                <SelectItem value="crouch">Crouch</SelectItem>
                <SelectItem value="attack">Attack</SelectItem>
                <SelectItem value="death">Death</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              checked={newAnim.loop}
              onCheckedChange={(checked) => setNewAnim({ ...newAnim, loop: checked })}
            />
            <Label>Loop Animation</Label>
          </div>

          <Button onClick={handleAddAnimation} className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            Add Animation
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
