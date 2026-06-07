/**
 * One-shot tool to migrate every existing `.gif` texture URL in the
 * database to a strip-WebP via convertAnimationToStrip. Used to clean
 * up rows that were uploaded BEFORE the admin upload paths were fixed
 * (v4.12.13). After running once and seeing zero remaining rows, this
 * component can be deleted.
 *
 * Tables + columns scanned:
 *   blocks.texture_url
 *   shpider_definitions.body_texture_url
 *   shpider_definitions.leg_texture_url
 *   shpider_definitions.face_texture_url
 *
 * Per row: fetch the source URL, run convertAnimationToStrip in the
 * browser, upload the strip WebP to block-textures, write the new URL
 * back. Failures are surfaced inline; other rows continue.
 */

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { convertAnimationToStrip } from '@/lib/animationToStrip';
import { CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';

interface Target {
  table: 'blocks' | 'shpider_definitions' | 'seed_definitions';
  column: string;
  rowId: string | number;
  label: string;
  url: string;
}

interface RowState {
  target: Target;
  status: 'pending' | 'running' | 'done' | 'error';
  newUrl?: string;
  error?: string;
}

export function GifMigrationPanel() {
  const [rows, setRows] = useState<RowState[]>([]);
  const [scanning, setScanning] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const targets: Target[] = [];

      // blocks.texture_url
      {
        const { data, error } = await supabase
          .from('blocks')
          .select('id, key, name, texture_url')
          .ilike('texture_url', '%.gif');
        if (error) throw error;
        for (const row of (data ?? [])) {
          targets.push({
            table: 'blocks',
            column: 'texture_url',
            rowId: row.id,
            label: `block #${row.id} (${row.key ?? row.name ?? '?'})`,
            url: row.texture_url as string,
          });
        }
      }

      // shpider_definitions: three texture columns
      {
        const { data, error } = await supabase
          .from('shpider_definitions' as any)
          .select('id, tier, body_texture_url, leg_texture_url, face_texture_url');
        if (error) throw error;
        for (const row of (data as any[] ?? [])) {
          for (const col of ['body_texture_url', 'leg_texture_url', 'face_texture_url']) {
            const u = row[col] as string | null;
            if (u && u.toLowerCase().endsWith('.gif')) {
              targets.push({
                table: 'shpider_definitions',
                column: col,
                rowId: row.id,
                label: `shpider T${row.tier} ${col.replace('_texture_url', '')}`,
                url: u,
              });
            }
          }
        }
      }

      // seed_definitions: all texture columns (trunk/branch/fruit/fungal)
      {
        const seedCols = [
          'trunk_texture_url', 'branch_texture_url', 'fruit_texture_url',
          'fungal_cap_top_texture_url', 'fungal_cap_underside_texture_url', 'fungal_stem_texture_url',
        ];
        const { data, error } = await supabase
          .from('seed_definitions' as any)
          .select(`id, tier, ${seedCols.join(', ')}`);
        if (error) throw error;
        for (const row of (data as any[] ?? [])) {
          for (const col of seedCols) {
            const u = row[col] as string | null;
            if (u && u.toLowerCase().endsWith('.gif')) {
              targets.push({
                table: 'seed_definitions',
                column: col,
                rowId: row.id,
                label: `seed T${row.tier} ${col.replace('_texture_url', '')}`,
                url: u,
              });
            }
          }
        }
      }

      setRows(targets.map(t => ({ target: t, status: 'pending' })));
      toast.success(`Found ${targets.length} rows to migrate`);
    } catch (err: any) {
      toast.error(`Scan failed: ${err.message}`);
    } finally {
      setScanning(false);
    }
  }, []);

  const migrateOne = async (idx: number) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, status: 'running' } : r));
    const { target } = rows[idx];
    try {
      // Fetch the source GIF
      const resp = await fetch(target.url);
      if (!resp.ok) throw new Error(`fetch ${resp.status}`);
      const blob = await resp.blob();
      // Synthesize a File object with the original extension so
      // convertAnimationToStrip's GIF branch fires.
      const filename = target.url.split('/').pop() ?? 'source.gif';
      const file = new File([blob], filename, { type: 'image/gif' });

      const result = await convertAnimationToStrip(file, { frameSize: 256, maxFrames: 24 });

      // Upload the strip WebP. Use a path that mirrors how the live
      // admin panels name new uploads.
      const stripName = target.table === 'blocks'
        ? `${target.rowId}-${result.frameCount}f_${result.frameDelay}ms_${Date.now()}.webp`
        : `${target.table}/migrated/r${target.rowId}_${target.column.replace('_texture_url', '')}_${result.frameCount}f_${result.frameDelay}ms_${Date.now()}.webp`;

      const { error: upErr } = await supabase.storage
        .from('block-textures')
        .upload(stripName, result.stripBlob, { upsert: true });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('block-textures').getPublicUrl(stripName);
      const newUrl = urlData.publicUrl;

      // Persist the new URL. blocks uses the typed client; the definition
      // tables go through the `as any` escape hatch (same id+column shape).
      if (target.table === 'blocks') {
        const { error } = await supabase
          .from('blocks')
          .update({ [target.column]: newUrl })
          .eq('id', target.rowId);
        if (error) throw error;
      } else {
        const { error } = await (supabase
          .from(target.table as any)
          .update({ [target.column]: newUrl })
          .eq('id', target.rowId) as any);
        if (error) throw error;
      }

      setRows(prev => prev.map((r, i) => i === idx ? { ...r, status: 'done', newUrl } : r));
    } catch (err: any) {
      setRows(prev => prev.map((r, i) => i === idx ? { ...r, status: 'error', error: err?.message ?? String(err) } : r));
    }
  };

  const migrateAll = useCallback(async () => {
    setMigrating(true);
    try {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].status === 'done') continue;
        await migrateOne(i);
      }
      toast.success('Migration complete');
    } finally {
      setMigrating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  const remaining = rows.filter(r => r.status !== 'done').length;
  const done = rows.filter(r => r.status === 'done').length;
  const errored = rows.filter(r => r.status === 'error').length;

  return (
    <Card className="p-6 flex flex-col h-full overflow-hidden">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-lg font-semibold mb-1">GIF → Strip Migration</h3>
          <p className="text-sm text-muted-foreground max-w-2xl">
            One-shot tool to convert every existing <code className="bg-muted px-1 rounded">.gif</code> texture
            in <code>blocks</code> and <code>shpider_definitions</code> into a horizontal-strip WebP
            via <code>convertAnimationToStrip</code>. After running, rerun the scan to confirm zero
            remaining rows. Then it's safe to delete the legacy <code>useAnimatedTexture</code> code.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button onClick={scan} disabled={scanning || migrating} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${scanning ? 'animate-spin' : ''}`} />
            Scan
          </Button>
          <Button onClick={migrateAll} disabled={!rows.length || migrating || remaining === 0}>
            {migrating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Run migration ({remaining} rows)
          </Button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="text-sm text-muted-foreground mb-3">
          {done} done, {remaining} remaining, {errored} failed
        </div>
      )}

      <ScrollArea className="flex-1 pr-4">
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-3 p-2 rounded border">
              <div className="flex-shrink-0">
                {r.status === 'pending' && <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />}
                {r.status === 'running' && <Loader2 className="h-5 w-5 animate-spin text-blue-500" />}
                {r.status === 'done' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                {r.status === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm">{r.target.label}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.status === 'done' ? `→ ${r.newUrl}` : r.status === 'error' ? r.error : r.target.url}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={r.status === 'running' || migrating}
                onClick={() => migrateOne(i)}
              >
                {r.status === 'done' ? 'Re-run' : 'Migrate'}
              </Button>
            </div>
          ))}
          {!rows.length && !scanning && (
            <p className="text-sm text-muted-foreground italic">
              Click <strong>Scan</strong> to find rows with <code>.gif</code> URLs.
            </p>
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
