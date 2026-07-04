// MapLoadModal — a small centred modal shown while a map switch streams in (terrain then objects),
// so the screen isn't blank/jarring. Reads mapLoadStatus. Styled with the User-panel (hud) theme
// tokens — NOT the builder waterfall-card. Rendered in the DOM overlay (outside Canvas).
import { useMapLoadStatus } from './mapLoadStatus';

export function MapLoadModal() {
  const msg = useMapLoadStatus();
  if (!msg) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        className="hud-panel px-6 py-4 text-center"
        style={{
          background: 'hsla(var(--hud-bg))',
          border: '1px solid hsla(var(--hud-border))',
          borderRadius: 'var(--hud-radius)',
          backdropFilter: 'var(--hud-blur)',
          WebkitBackdropFilter: 'var(--hud-blur)',
          color: 'hsl(var(--hud-text))',
          fontFamily: 'var(--hud-font)',
          minWidth: 240,
        }}
      >
        <div className="mb-2 text-sm font-semibold" style={{ color: 'hsl(var(--hud-text-bright))' }}>Loading world…</div>
        <div className="flex items-center justify-center gap-2 text-xs">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: 'hsl(var(--hud-text-bright))', borderTopColor: 'transparent' }} />
          {msg}
        </div>
      </div>
    </div>
  );
}
