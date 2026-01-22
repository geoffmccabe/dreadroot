import React, { useCallback } from 'react';
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

export function InitializationOverlay() {
  const {
    isInitializing,
    isOverlayVisible,
    steps,
    totalDurationSecs,
    dismissOverlay
  } = useInitialization();

  const [copied, setCopied] = React.useState(false);

  // Format time with appropriate precision: 3 digits for small values, 1 for large
  const formatTime = (secs: number): string => {
    if (secs < 0.1) {
      return secs.toFixed(3);
    } else if (secs < 1) {
      return secs.toFixed(2);
    }
    return secs.toFixed(1);
  };

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    
    const lines = steps.map(step => {
      const countStr = step.count !== undefined ? ` ${step.count}` : '';
      const statusStr = step.status === 'done' ? '✓' : step.status === 'running' ? '…' : '✗';
      const errorStr = step.errorMessage ? ` [${step.errorMessage}]` : '';
      return `${statusStr} [${step.file}] ${step.message}${countStr}${errorStr} t[${formatTime(step.durationSecs)} secs]`;
    });
    
    if (!isInitializing && totalDurationSecs > 0) {
      lines.push(`\nWorld Initialized in ${formatTime(totalDurationSecs)} Seconds!`);
    }
    
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [steps, isInitializing, totalDurationSecs]);

  const handleDismiss = useCallback(() => {
    if (!isInitializing) {
      dismissOverlay();
    }
  }, [isInitializing, dismissOverlay]);

  if (!isOverlayVisible) return null;

  // Aspect ratio of fortress_loading_screen.webp (approximately 16:9)
  // Panel is 70% of screen width
  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={handleDismiss}
      style={{ cursor: isInitializing ? 'wait' : 'pointer' }}
    >
      {/* NO background darkening - user can see the world behind */}
      
      {/* Content panel - 70% width, aspect ratio matching the loading image */}
      <div 
        className="relative w-[70%] overflow-hidden rounded-xl shadow-2xl"
        style={{
          aspectRatio: '16 / 9',
          maxHeight: '85vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Background image for the panel */}
        <div 
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${fortressImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        
        {/* Semi-transparent overlay for readability - only on the panel */}
        <div className="absolute inset-0 bg-black/60" />
        
        {/* Panel content */}
        <div className="relative z-10 h-full flex flex-col p-6">
          {/* Title */}
          <h1 className="text-3xl md:text-4xl font-bold text-white text-center mb-4 drop-shadow-lg">
            {isInitializing ? 'Initializing World...' : `World Initialized in ${formatTime(totalDurationSecs)} Seconds!`}
          </h1>
          
          {/* Steps container - scrollable */}
          <div className="flex-1 bg-black/40 rounded-lg p-4 backdrop-blur-sm border border-white/10 overflow-y-auto min-h-0">
            {steps.length === 0 ? (
              <p className="text-white/60 text-center py-4">Starting initialization...</p>
            ) : (
              <div className="space-y-1.5 font-mono text-xs md:text-sm">
                {steps.map((step) => (
                  <div key={step.id} className="text-white/90 flex items-start gap-2">
                    <span className="w-4 flex-shrink-0">
                      <StatusIndicator status={step.status} />
                    </span>
                    <span className="flex-1">
                      <span className="text-cyan-400">[{step.file}]</span>{' '}
                      <span className="text-white">{step.message}</span>
                      {step.count !== undefined && (
                        <span className="text-emerald-400 font-bold"> {step.count}</span>
                      )}
                      {step.errorMessage && (
                        <span className="text-red-400"> [{step.errorMessage}]</span>
                      )}
                      <span className="text-yellow-400/80 ml-2">t[{formatTime(step.durationSecs)} secs]</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            
            {/* Completion message */}
            {!isInitializing && totalDurationSecs > 0 && (
              <div className="mt-4 pt-3 border-t border-white/20">
                <p className="text-xl font-bold text-emerald-400 text-center">
                  ✓ World Initialized in {formatTime(totalDurationSecs)} Seconds!
                </p>
                <p className="text-white/60 text-center mt-1 text-sm">
                  Click anywhere to continue
                </p>
              </div>
            )}
          </div>
          
          {/* Copy button - bottom right */}
          <div className="flex justify-end mt-3">
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg transition-colors border border-white/20"
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