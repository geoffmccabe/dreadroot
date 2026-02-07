// Global sound settings panel for enemy types (Shwarm/Shnake)
// Allows uploading custom sounds and adjusting volume

import React, { useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Upload, Volume2, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface SoundConfig {
  url: string | null;
  label: string;
  key: string;
}

interface EnemySoundSettingsProps {
  enemyType: 'shwarm' | 'shnake' | 'shombie' | 'walapa';
  sounds: SoundConfig[];
  volume: number; // 0-200
  onSoundChange: (key: string, url: string | null) => void;
  onVolumeChange: (volume: number) => void;
  className?: string;
}

export function EnemySoundSettings({
  enemyType,
  sounds,
  volume,
  onSoundChange,
  onVolumeChange,
  className,
}: EnemySoundSettingsProps) {
  const { toast } = useToast();
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const handleSoundUpload = async (key: string, file: File) => {
    try {
      const fileName = `${enemyType}_sound_${key}_${Date.now()}.mp3`;
      
      const { error: uploadError } = await supabase.storage
        .from('block-textures') // Reusing existing bucket
        .upload(fileName, file, { upsert: true, contentType: 'audio/mpeg' });
      
      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage
        .from('block-textures')
        .getPublicUrl(fileName);
      
      onSoundChange(key, publicUrl);
      toast({ title: 'Sound uploaded', description: `${key} sound saved` });
    } catch (err) {
      console.error('[EnemySoundSettings] Upload error:', err);
      toast({ title: 'Upload failed', variant: 'destructive' });
    }
  };

  const playPreview = (url: string) => {
    const audio = new Audio(url);
    audio.volume = volume / 100;
    audio.play().catch(() => {});
    audio.onended = () => { audio.src = ''; };
    audio.onerror = () => { audio.src = ''; };
  };

  return (
    <Card className={`p-4 mb-4 bg-muted/30 ${className || ''}`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <Volume2 className="h-4 w-4" />
          Global Sound Settings
        </h4>
        <div className="flex items-center gap-3">
          <Label className="text-xs text-muted-foreground">Volume</Label>
          <div className="w-32">
            <Slider
              value={[volume]}
              onValueChange={([v]) => onVolumeChange(v)}
              min={0}
              max={200}
              step={5}
            />
          </div>
          <span className="text-xs font-mono w-10 text-right">{volume}%</span>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        {sounds.map((sound) => (
          <div key={sound.key} className="flex items-center gap-2 p-2 rounded border border-border bg-background">
            <div className="flex-1">
              <Label className="text-xs">{sound.label}</Label>
              <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                {sound.url ? sound.url.split('/').pop() : 'Default'}
              </p>
            </div>
            
            <div className="flex items-center gap-1">
              {sound.url && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => playPreview(sound.url!)}
                    title="Preview"
                  >
                    <Volume2 className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive"
                    onClick={() => onSoundChange(sound.key, null)}
                    title="Reset to default"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  const input = fileInputRefs.current.get(sound.key);
                  input?.click();
                }}
              >
                <Upload className="h-3 w-3 mr-1" />
                Upload
              </Button>
              <input
                ref={(el) => {
                  if (el) fileInputRefs.current.set(sound.key, el);
                }}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleSoundUpload(sound.key, f);
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
