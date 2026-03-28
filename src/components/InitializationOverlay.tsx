import React, { useCallback, useRef, useEffect } from 'react';
import { useInitialization, InitStepStatus } from '@/contexts/InitializationContext';
import { Copy, Check } from 'lucide-react';
import fortressImage from '@/assets/fortress_loading_screen.webp';

// Status indicator component
const StatusIndicator: React.FC<{ status: InitStepStatus }> = ({ status }) => {
  switch (status) {
    case 'done':
      return <span className="text-emerald-400">✓</span>;
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
    dismissOverlay
  } = useInitialization();

  const [copied, setCopied] = React.useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new steps appear
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [steps]);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();

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

    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [steps, isInitializing, totalDurationSecs, elapsedMs]);

  const handleDismiss = useCallback(() => {
    if (!isInitializing) {
      dismissOverlay();
    }
  }, [isInitializing, dismissOverlay]);

  if (!isOverlayVisible) return null;

  const displayTime = isInitializing ? (elapsedMs / 1000).toFixed(1) : totalDurationSecs.toFixed(1);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={handleDismiss}
      style={{
        cursor: isInitializing ? 'wait' : 'pointer',
        backgroundColor: 'hsla(208, 85%, 8%, 0.65)',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {/* Content panel - 70% width, game UI style frame */}
      <div
        className="relative w-[70%] overflow-hidden rounded-xl shadow-2xl"
        style={{
          aspectRatio: '16 / 9',
          maxHeight: '85vh',
          backgroundColor: 'hsla(211, 30%, 51%, 0.35)',
          border: '1px solid hsla(211, 34%, 73%, 0.8)',
        }}
      >
        {/* Panel content */}
        <div className="relative z-10 h-full flex flex-col p-6">
          {/* Title with live timer */}
          <h1
            className="text-3xl md:text-4xl font-bold text-center mb-4 drop-shadow-lg"
            style={{ color: 'hsl(211, 32%, 90%)', fontFamily: 'Inter, sans-serif' }}
          >
            {isInitializing
              ? `Initializing World... ${displayTime}s`
              : `World Initialized in ${displayTime} Seconds!`
            }
          </h1>

          {/* Steps container - scrollable */}
          <div
            ref={scrollContainerRef}
            className="flex-1 rounded-lg p-4 backdrop-blur-sm overflow-y-auto min-h-0"
            style={{
              backgroundColor: 'hsla(208, 85%, 8%, 0.65)',
              border: '1px solid hsla(208, 85%, 20%, 0.5)',
            }}
            onClick={handleDismiss}
          >
            {steps.length === 0 ? (
              <p className="text-center py-4" style={{ color: 'hsla(211, 32%, 90%, 0.6)' }}>Starting initialization...</p>
            ) : (
              <div className="space-y-1 text-xs md:text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
                {steps.map((step) => (
                  <div key={step.id} className="flex items-start gap-2" style={{ color: 'hsla(211, 32%, 90%, 0.9)' }}>
                    <span className="w-4 flex-shrink-0">
                      <StatusIndicator status={step.status} />
                    </span>
                    <span className="w-14 flex-shrink-0 text-right" style={{ color: 'white' }}>
                      @{formatElapsed(step.startTime)}
                    </span>
                    <span className="flex-1">
                      <span className="text-cyan-400">[{step.file}]</span>{' '}
                      <span style={{ color: 'hsl(211, 32%, 90%)' }}>{step.message}</span>
                      {step.count !== undefined && (
                        <span className="text-emerald-400 font-bold"> {step.count}</span>
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
              <div className="mt-4 pt-3" style={{ borderTop: '1px solid hsla(211, 34%, 73%, 0.3)' }}>
                <p className="text-xl font-bold text-emerald-400 text-center">
                  ✓ Ready to Play!
                </p>
                <p className="text-center mt-1 text-sm" style={{ color: 'hsla(211, 32%, 90%, 0.6)' }}>
                  Click anywhere to continue
                </p>
              </div>
            )}
          </div>

          {/* Copy button - bottom right */}
          <div className="flex justify-end mt-3">
            <button
              onClick={(e) => { e.stopPropagation(); handleCopy(); }}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors"
              style={{
                backgroundColor: 'hsla(211, 30%, 51%, 0.35)',
                border: '1px solid hsla(211, 34%, 73%, 0.5)',
                color: 'hsl(211, 32%, 90%)',
                fontFamily: 'Inter, sans-serif',
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
