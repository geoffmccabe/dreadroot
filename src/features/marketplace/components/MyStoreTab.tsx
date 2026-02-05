// MyStoreTab - Manage user's store settings

import React, { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Store, Save, Upload } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '../hooks/useStore';
import { STORE_NAME_MAX_LENGTH, STORE_DESCRIPTION_MAX_LENGTH } from '../constants';

// Banner aspect ratio: 3:2 (width:height)
const BANNER_ASPECT_RATIO = 3 / 2;
const BANNER_WIDTH = 600;
const BANNER_HEIGHT = BANNER_WIDTH / BANNER_ASPECT_RATIO; // 400

interface MyStoreTabProps {
  userId: string | null;
}

export function MyStoreTab({ userId }: MyStoreTabProps) {
  const { store, isLoading, error, createStore, updateStore, isSaving } = useStore(userId);

  // Form state
  const [storeName, setStoreName] = useState('');
  const [description, setDescription] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [bannerUploading, setBannerUploading] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  // Sync form with store data
  useEffect(() => {
    if (store) {
      setStoreName(store.store_name);
      setDescription(store.description || '');
      setBannerUrl(store.banner_url || '');
      setIsActive(store.is_active);
    }
  }, [store]);

  const handleCreate = async () => {
    setFormError(null);
    setSuccessMessage(null);

    const result = await createStore(storeName, description, bannerUrl);

    if (result.success) {
      setSuccessMessage('Store created successfully!');
    } else {
      setFormError(result.error || 'Failed to create store');
    }
  };

  const handleSave = async () => {
    setFormError(null);
    setSuccessMessage(null);

    const updates: any = {};

    if (storeName !== store?.store_name) {
      updates.store_name = storeName;
    }
    if (description !== (store?.description || '')) {
      updates.description = description || null;
    }
    if (bannerUrl !== (store?.banner_url || '')) {
      updates.banner_url = bannerUrl || null;
    }
    if (isActive !== store?.is_active) {
      updates.is_active = isActive;
    }

    if (Object.keys(updates).length === 0) {
      setSuccessMessage('No changes to save');
      return;
    }

    const result = await updateStore(updates);

    if (result.success) {
      setSuccessMessage('Store updated successfully!');
    } else {
      setFormError(result.error || 'Failed to update store');
    }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    setBannerUploading(true);
    setFormError(null);

    try {
      // Load image
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = URL.createObjectURL(file);
      });

      // Crop to 3:2 aspect ratio (center crop)
      const srcAspect = img.width / img.height;
      let sx = 0, sy = 0, sWidth = img.width, sHeight = img.height;

      if (srcAspect > BANNER_ASPECT_RATIO) {
        // Source is wider - crop sides
        sWidth = img.height * BANNER_ASPECT_RATIO;
        sx = (img.width - sWidth) / 2;
      } else {
        // Source is taller - crop top/bottom
        sHeight = img.width / BANNER_ASPECT_RATIO;
        sy = (img.height - sHeight) / 2;
      }

      // Draw to canvas at target size
      const canvas = document.createElement('canvas');
      canvas.width = BANNER_WIDTH;
      canvas.height = BANNER_HEIGHT;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, BANNER_WIDTH, BANNER_HEIGHT);

      // Export as webp
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/webp', 0.85);
      });

      // Upload to storage
      const path = `store_banner_${userId}_${Date.now()}.webp`;
      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(path, blob, { upsert: true, contentType: 'image/webp' });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('block-textures')
        .getPublicUrl(path);

      setBannerUrl(urlData.publicUrl);
      setSuccessMessage('Banner uploaded! Click Save to apply.');
    } catch (err: any) {
      console.error('[MyStoreTab] Banner upload failed:', err);
      setFormError('Failed to upload banner: ' + (err.message || 'Unknown error'));
    } finally {
      setBannerUploading(false);
      if (bannerInputRef.current) bannerInputRef.current.value = '';
    }
  };

  if (!userId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Please log in to manage your store.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading store...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <Card className="p-6" style={{ background: 'hsla(var(--hud-bg), 0.4)' }}>
        <div className="flex items-center gap-3 mb-6">
          <Store className="w-8 h-8" />
          <div>
            <h3 className="text-lg font-semibold">
              {store ? 'Store Settings' : 'Create Your Store'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {store
                ? 'Customize your store appearance'
                : 'Set up a store to brand your listings'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Store name */}
          <div className="space-y-2">
            <Label>Store Name *</Label>
            <Input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value.slice(0, STORE_NAME_MAX_LENGTH))}
              placeholder="Enter your store name..."
              maxLength={STORE_NAME_MAX_LENGTH}
            />
            <div className="text-xs text-muted-foreground text-right">
              {storeName.length}/{STORE_NAME_MAX_LENGTH}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, STORE_DESCRIPTION_MAX_LENGTH))}
              placeholder="Tell buyers about your store..."
              rows={3}
              maxLength={STORE_DESCRIPTION_MAX_LENGTH}
            />
            <div className="text-xs text-muted-foreground text-right">
              {description.length}/{STORE_DESCRIPTION_MAX_LENGTH}
            </div>
          </div>

          {/* Banner Image */}
          <div className="space-y-2">
            <Label>Banner Image (3:2 aspect ratio)</Label>
            <div className="flex gap-2">
              <Input
                value={bannerUrl}
                onChange={(e) => setBannerUrl(e.target.value)}
                placeholder="https://example.com/banner.jpg or upload below"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => bannerInputRef.current?.click()}
                disabled={bannerUploading}
              >
                <Upload className="w-4 h-4 mr-2" />
                {bannerUploading ? 'Uploading...' : 'Upload'}
              </Button>
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleBannerUpload}
                style={{ display: 'none' }}
              />
            </div>
            {bannerUrl && (
              <div
                className="rounded-lg border mt-2 relative overflow-hidden"
                style={{
                  aspectRatio: '3/2',
                  maxHeight: '200px',
                  background: `url(${bannerUrl}) center/cover`,
                  borderColor: 'hsla(var(--hud-border), 0.5)',
                }}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Images will be cropped to 3:2 ratio. Recommended size: 600x400px
            </p>
          </div>

          {/* Active toggle (only show for existing stores) */}
          {store && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-black/20">
              <div>
                <Label>Store Active</Label>
                <p className="text-xs text-muted-foreground">
                  When inactive, your store name won't appear on listings
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}

          {/* Stats (only show for existing stores) */}
          {store && (
            <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-black/20">
              <div>
                <div className="text-2xl font-bold">{store.total_sales}</div>
                <div className="text-sm text-muted-foreground">Total Sales</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {store.rating ? store.rating.toFixed(1) : '—'}
                </div>
                <div className="text-sm text-muted-foreground">Rating</div>
              </div>
            </div>
          )}

          {/* Messages */}
          {formError && (
            <div className="p-3 rounded-lg bg-red-500/20 text-red-400 text-sm">
              {formError}
            </div>
          )}
          {successMessage && (
            <div className="p-3 rounded-lg bg-green-500/20 text-green-400 text-sm">
              {successMessage}
            </div>
          )}

          {/* Submit button */}
          <Button
            onClick={store ? handleSave : handleCreate}
            disabled={!storeName.trim() || isSaving}
            className="w-full"
          >
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? 'Saving...' : store ? 'Save Changes' : 'Create Store'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
