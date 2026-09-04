import React, { useCallback, useRef, useEffect } from 'react';
import { useInitialization, InitStepStatus } from '@/contexts/InitializationContext';
import { Copy, Check } from 'lucide-react';
import fortressImage from '@/assets/fortress_loading_screen.webp';
import { useActiveGame } from '@/config/activeGame';
import { BOOT_MAP } from '@/config/game';

// Status indicator component
const StatusIndicator: React.FC<{ status: InitStepStatus; accent?: string }> = ({ status, accent }) => {
  switch (status) {
    case 'done':
      return <span className="text-emerald-400" style={accent ? { color: accent } : undefined}>✓</span>;
    case 'running':
      return <span className="text-yellow-400 animate-pulse">…</span>;
    case 'error':
      return <span className="text-red-400">✗</span>;
    default:
      return null;
  }
};

// Format milliseconds to readable string
function formatMs(ms: number | undefined): string {
  if (ms === undefined || ms === 0) return '';
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// Format elapsed time (when step started relative to init start)
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function InitializationOverlay() {
  const {
    isInitializing,
    isOverlayVisible,
    steps,
    totalDurationSecs,
    elapsedMs,
    dismissOverlay,
    gameStarted
  } = useInitialization();

  const [copied, setCopied] = React.useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Per-game theming: a logo header above the panel, the panel lower on screen, and a
  // red/black tint for Siege Worlds (Dreadroot/others keep the default HUD theme).
  const activeGame = useActiveGame();
  const isSiege = activeGame === 'siege-worlds';
  // Starblink is its own game to the player even though it runs as Siege Worlds internally, so
  // it gets its own pair of logos here instead of the SWW wordmark.
  const isStarblink = !!BOOT_MAP;
  const logoSrc = isSiege ? '/sww_logo_transp_v1_hq.webp' : '/Dreadroot_words_logo_horiz_2400px.webp';
  // Translucent so the live 3D world shows THROUGH the overlay (darkened) while it streams in —
  // the player watches the lobby build up behind the logs, then "Ready to Play". Kept dark enough
  // to read the panel against a bright scene; the log panel itself stays opaque (panelBg).
  const overlayBg = isSiege ? 'rgba(6,0,0,0.6)' : 'rgba(0,0,0,0.6)';
  const panelBg = isSiege ? 'rgba(22,6,6,0.96)' : 'hsla(var(--hud-bg))';
  const panelBorder = isSiege ? '#a01818' : 'hsla(var(--hud-border))';
  const titleColor = isSiege ? '#ff5436' : 'hsl(var(--hud-text))';
  const fileColor = isSiege ? '#ff6a5a' : undefined;    // [file] tag: cyan/blue → red in SWW
  const accentColor = isSiege ? '#ff9a3c' : undefined;  // counts/✓: green → bright orange in SWW

  // Auto-scroll to the bottom as steps stream in AND when init completes (the "Ready to Play"
  // block is added on completion, not as a step — without this the log stops mid-list and the
  // user never sees the click-to-continue prompt). rAF so the new content has laid out first.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(id);
  }, [steps, isInitializing, totalDurationSecs]);

  const handleCopy = useCallback(() => {
    // Click sound (short blip) — gives audible feedback the button worked.
    try {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      if (AC) {
        const ctx = new AC();
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = 660; g.gain.value = 0.06;
        o.start(); o.stop(ctx.currentTime + 0.05);
        setTimeout(() => ctx.close(), 200);
      }
    } catch { /* ignore */ }

    const lines = steps.map(step => {
      const countStr = step.count !== undefined ? ` ${step.count}` : '';
      const statusStr = step.status === 'done' ? '✓' : step.status === 'running' ? '…' : '✗';
      const errorStr = step.errorMessage ? ` [${step.errorMessage}]` : '';
      const durationStr = step.durationMs && step.durationMs > 0 ? ` (${formatMs(step.durationMs)})` : '';
      const atStr = `@${formatElapsed(step.startTime)}`;
      return `${statusStr} ${atStr} [${step.file}] ${step.message}${countStr}${durationStr}${errorStr}`;
    });

    const totalStr = isInitializing
      ? `Initializing... (${(elapsedMs / 1000).toFixed(1)}s)`
      : `World Initialized in ${totalDurationSecs.toFixed(1)} Seconds!`;
    lines.unshift(totalStr);

    navigator.clipboard?.writeText(lines.join('\n')).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [steps, isInitializing, totalDurationSecs, elapsedMs]);

  const handleDismiss = useCallback(() => {
    if (!isInitializing) {
      dismissOverlay();
    }
  }, [isInitializing, dismissOverlay]);

  // Test-only (gated on ?perftest — no production effect): expose readiness
  // for the perf harness and auto-dismiss the overlay, since headless
  // automation cannot click "Ready to Play".
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!new URLSearchParams(window.location.search).has('perftest')) return;
    (window as any).__perfTestReady = !isInitializing;
    if (!isInitializing && isOverlayVisible) dismissOverlay();
  }, [isInitializing, isOverlayVisible, dismissOverlay]);

  // Init may run in the background before START; only show the overlay after.
  if (!isOverlayVisible || !gameStarted) return null;

  const displayTime = isInitializing ? (elapsedMs / 1000).toFixed(1) : totalDurationSecs.toFixed(1);

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center"
      onClick={handleDismiss}
      style={{
        cursor: isInitializing ? 'wait' : 'pointer',
        backgroundColor: overlayBg,
        fontFamily: 'var(--hud-font)',
        paddingTop: '11vh',
      }}
    >
      {/* Game logo header above the panel. Starblink shows its own wordmark beside the Alien
          Worlds Community logo; every other game shows its single wordmark.
          onError hides a logo rather than leaving a broken-image icon over the loading screen. */}
      {isStarblink ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '26px', marginBottom: '14px' }}>
          <img
            src="/starblink_logo.png"
            alt="Starblink"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            style={{ maxWidth: '340px', maxHeight: '112px', objectFit: 'contain', filter: 'drop-shadow(0 0 18px rgba(0,0,0,0.7))' }}
          />
          <img
            src="/alien_worlds_community_logo.png"
            alt="Alien Worlds Community"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            style={{ maxWidth: '190px', maxHeight: '96px', objectFit: 'contain', filter: 'drop-shadow(0 0 18px rgba(0,0,0,0.7))' }}
          />
        </div>
      ) : (
        <img
          src={logoSrc}
          alt=""
          style={{ maxWidth: '300px', maxHeight: '108px', objectFit: 'contain', marginBottom: '14px', filter: 'drop-shadow(0 0 18px rgba(0,0,0,0.7))' }}
        />
      )}
      {/* Content panel - game UI style frame, positioned below the logo header */}
      <div
        className="relative w-[64%] overflow-hidden rounded-xl shadow-2xl"
        style={{
          aspectRatio: '16 / 9',
          maxHeight: '62vh',
          backgroundColor: panelBg,
          border: `1px solid ${panelBorder}`,
        }}
      >
        {/* Panel content */}
        <div className="relative z-10 h-full flex flex-col p-6">
          {/* Title with live timer */}
          <h1
            className="text-3xl md:text-4xl font-bold text-center mb-4 drop-shadow-lg"
            style={{ color: titleColor, fontFamily: 'var(--hud-font)' }}
          >
            {isInitializing
              ? `Initializing World... ${displayTime}s`
              : `World Initialized in ${displayTime} Seconds!`
            }
          </h1>

          {/* Dark-theme scrollbar for the log (the default light one clashes on this dark overlay). */}
          <style>{`
            .init-log-scroll { scrollbar-width: thin; scrollbar-color: #888 #000; }
            .init-log-scroll::-webkit-scrollbar { width: 10px; }
            .init-log-scroll::-webkit-scrollbar-track { background: #000; border-radius: 5px; }
            .init-log-scroll::-webkit-scrollbar-thumb { background: #888; border-radius: 5px; border: 2px solid #000; background-clip: padding-box; }
            .init-log-scroll::-webkit-scrollbar-thumb:hover { background: #aaa; background-clip: padding-box; }
          `}</style>
          {/* Steps container - scrollable */}
          <div
            ref={scrollContainerRef}
            className="init-log-scroll flex-1 rounded-lg p-4 backdrop-blur-sm overflow-y-auto min-h-0"
            style={{
              backgroundColor: 'hsla(var(--panel-bg-strong))',
              border: '1px solid hsla(var(--panel-border-strong))',
            }}
            onClick={handleDismiss}
          >
            {steps.length === 0 ? (
              <p className="text-center py-4" style={{ color: 'hsl(var(--hud-text) / 0.6)' }}>Starting initialization...</p>
            ) : (
              <div className="space-y-1 text-xs md:text-sm" style={{ fontFamily: 'var(--hud-font)' }}>
                {steps.map((step) => (
                  <div key={step.id} className="flex items-start gap-2" style={{ color: 'hsl(var(--hud-text) / 0.9)' }}>
                    <span className="w-4 flex-shrink-0">
                      <StatusIndicator status={step.status} accent={accentColor} />
                    </span>
                    <span className="w-14 flex-shrink-0 text-right" style={{ color: 'white' }}>
                      @{formatElapsed(step.startTime)}
                    </span>
                    <span className="flex-1">
                      <span className="text-cyan-400" style={fileColor ? { color: fileColor } : undefined}>[{step.file}]</span>{' '}
                      <span style={{ color: 'hsl(var(--hud-text))' }}>{step.message}</span>
                      {step.count !== undefined && (
                        <span className="text-emerald-400 font-bold" style={accentColor ? { color: accentColor } : undefined}> {step.count}</span>
                      )}
                      {step.durationMs !== undefined && step.durationMs > 5 && (
                        <span className="text-yellow-400/80 ml-2">({formatMs(step.durationMs)})</span>
                      )}
                      {step.errorMessage && (
                        <span className="text-red-400"> [{step.errorMessage}]</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Completion message */}
            {!isInitializing && totalDurationSecs > 0 && (
              <div className="mt-4 pt-3" style={{ borderTop: '1px solid hsl(var(--hud-text) / 0.25)' }}>
                <p className="text-xl font-bold text-emerald-400 text-center" style={accentColor ? { color: accentColor } : undefined}>
                  ✓ Ready to Play!
                </p>
                <p className="text-center mt-1 text-sm" style={{ color: 'hsl(var(--hud-text) / 0.6)' }}>
                  Click anywhere to continue
                </p>
              </div>
            )}
          </div>

          {/* Copy button - bottom right */}
          <div className="flex justify-end mt-3">
            <button
              onClick={(e) => { e.stopPropagation(); handleCopy(); }}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-all active:scale-90"
              style={{
                backgroundColor: 'hsla(var(--hud-bg))',
                border: '1px solid hsla(var(--hud-border))',
                color: 'hsl(var(--hud-text))',
                fontFamily: 'var(--hud-font)',
              }}
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy Log</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
