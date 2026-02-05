import React, { useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { useGameSounds, GameSound } from '@/hooks/useGameSounds';
import { Play, Square, Upload, RotateCcw, Volume2, Box } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SoundSettingsPanel() {
  const { sounds, isLoading, error, uploadSound, resetSound, updateSound, playPreview, stopPreview } = useGameSounds();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [pendingUploadKey, setPendingUploadKey] = useState<string | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingUploadKey) return;

    setUploadingKey(pendingUploadKey);
    try {
      await uploadSound(pendingUploadKey, file);
      toast({
        title: 'Sound uploaded',
        description: 'The sound has been updated successfully.',
      });
    } catch (err) {
      toast({
        title: 'Upload failed',
        description: err instanceof Error ? err.message : 'Failed to upload sound',
        variant: 'destructive',
      });
    } finally {
      setUploadingKey(null);
      setPendingUploadKey(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleUploadClick = (soundKey: string) => {
    setPendingUploadKey(soundKey);
    fileInputRef.current?.click();
  };

  const handleReset = async (sound: GameSound) => {
    if (sound.sound_url === sound.default_url) {
      toast({
        title: 'Already default',
        description: 'This sound is already using the default.',
      });
      return;
    }

    try {
      await resetSound(sound.sound_key);
      toast({
        title: 'Sound reset',
        description: `${sound.display_name} has been reset to default.`,
      });
    } catch (err) {
      toast({
        title: 'Reset failed',
        description: err instanceof Error ? err.message : 'Failed to reset sound',
        variant: 'destructive',
      });
    }
  };

  const handlePlay = (sound: GameSound) => {
    if (playingKey === sound.sound_key) {
      stopPreview();
      setPlayingKey(null);
    } else {
      setPlayingKey(sound.sound_key);
      playPreview(sound.sound_url, sound.volume);
      // Auto-clear playing state after a reasonable time
      setTimeout(() => setPlayingKey(null), 10000);
    }
  };

  const handleVolumeChange = async (sound: GameSound, volume: number) => {
    try {
      await updateSound(sound.sound_key, { volume });
    } catch (err) {
      // Silent fail for volume changes to avoid spamming toasts
      console.error('Failed to update volume:', err);
    }
  };

  const handle3DToggle = async (sound: GameSound, checked: boolean) => {
    try {
      await updateSound(sound.sound_key, { is_3d_sound: checked });
      toast({
        title: '3D sound updated',
        description: `${sound.display_name} is now ${checked ? 'using' : 'not using'} 3D positional audio.`,
      });
    } catch (err) {
      toast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Failed to update setting',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return <div className="p-4 text-muted-foreground">Loading sounds...</div>;
  }

  if (error) {
    return (
      <div className="p-4 text-red-500">
        <p className="font-semibold">Error loading sounds:</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Game Sounds</h3>
        <p className="text-xs text-muted-foreground">
          {sounds.length} sounds configured
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        Upload custom sounds or adjust settings. Changes take effect immediately for all players.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4"
        className="hidden"
        onChange={handleFileSelect}
      />

      <div className="space-y-3">
        {sounds.map(sound => {
          const isCustom = sound.sound_url !== sound.default_url;
          const isUploading = uploadingKey === sound.sound_key;
          const isPlaying = playingKey === sound.sound_key;

          return (
            <Card
              key={sound.id}
              className={cn(
                "p-3 transition-all",
                isCustom && "border-blue-400/50 bg-blue-50/30 dark:bg-blue-950/20"
              )}
            >
              <div className="flex items-start gap-3">
                {/* Play button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0 flex-shrink-0"
                  onClick={() => handlePlay(sound)}
                >
                  {isPlaying ? (
                    <Square className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </Button>

                {/* Sound info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{sound.display_name}</span>
                    {isCustom && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-500 text-white rounded">
                        Custom
                      </span>
                    )}
                    {sound.is_3d_sound && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-purple-500 text-white rounded flex items-center gap-0.5">
                        <Box className="h-2.5 w-2.5" /> 3D
                      </span>
                    )}
                  </div>
                  {sound.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {sound.description}
                    </p>
                  )}

                  {/* Volume slider */}
                  <div className="flex items-center gap-2 mt-2">
                    <Volume2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    <Slider
                      value={[sound.volume * 100]}
                      min={0}
                      max={200}
                      step={5}
                      className="flex-1 max-w-[120px]"
                      onValueChange={([value]) => handleVolumeChange(sound, value / 100)}
                    />
                    <span className="text-xs text-muted-foreground w-8">
                      {Math.round(sound.volume * 100)}%
                    </span>
                  </div>

                  {/* 3D checkbox */}
                  <div className="flex items-center gap-2 mt-2">
                    <Checkbox
                      id={`3d-${sound.sound_key}`}
                      checked={sound.is_3d_sound}
                      onCheckedChange={(checked) => handle3DToggle(sound, checked === true)}
                    />
                    <Label
                      htmlFor={`3d-${sound.sound_key}`}
                      className="text-xs text-muted-foreground cursor-pointer"
                    >
                      3D Positional Audio
                    </Label>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-1 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    disabled={isUploading}
                    onClick={() => handleUploadClick(sound.sound_key)}
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    {isUploading ? 'Uploading...' : 'Upload'}
                  </Button>
                  {isCustom && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => handleReset(sound)}
                      title="Reset to default"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}

        {sounds.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No sounds configured. Run the migration to add default sounds.
          </div>
        )}
      </div>
    </div>
  );
}
