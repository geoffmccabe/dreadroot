// MapLoadModal — a small centred modal shown while a map switch streams in (terrain then objects),
// so the screen isn't blank/jarring. Reads mapLoadStatus. Rendered in the DOM overlay (outside Canvas).
import { Card } from '@/components/ui/card';
import { useMapLoadStatus } from './mapLoadStatus';

export function MapLoadModal() {
  const msg = useMapLoadStatus();
  if (!msg) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Card className="waterfall-card px-5 py-3 text-center font-mono">
        <div className="mb-1 text-sm font-bold text-primary">Loading world…</div>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary/40 border-t-primary" />
          {msg}
        </div>
      </Card>
    </div>
  );
}
