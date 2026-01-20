import React, { useCallback } from 'react';
import { useInitialization } from '@/contexts/InitializationContext';
import { Copy, Check } from 'lucide-react';
import fortressImage from '@/assets/fortress_loading_screen.webp';

export function InitializationOverlay() {
  const {
    isInitializing,
    isOverlayVisible,
    steps,
    totalDurationSecs,
    dismissOverlay
  } = useInitialization();

  const [copied, setCopied] = React.useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    
    const lines = steps.map(step => {
      const countStr = step.count !== undefined ? ` ${step.count}` : '';
      return `[${step.file}] ${step.message}${countStr} t[${step.durationSecs.toFixed(1)} secs]`;
    });
    
    if (!isInitializing && totalDurationSecs > 0) {
      lines.push(`\nWorld Initialized in ${totalDurationSecs.toFixed(1)} Seconds!`);
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

  return (
    <div 
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-start pt-16 overflow-auto"
      onClick={handleDismiss}
      style={{ cursor: isInitializing ? 'wait' : 'pointer' }}
    >
      {/* Background image - darkened and semi-transparent */}
      <div 
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${fortressImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'brightness(0.3)',
          opacity: 0.5,
        }}
      />
      
      {/* Dark overlay for additional dimming */}
      <div className="absolute inset-0 bg-black/70" />
      
      {/* Content */}
      <div className="relative z-10 max-w-3xl w-full px-6">
        {/* Title */}
        <h1 className="text-4xl md:text-5xl font-bold text-white text-center mb-8 drop-shadow-lg">
          {isInitializing ? 'Initializing World...' : `World Initialized in ${totalDurationSecs.toFixed(1)} Seconds!`}
        </h1>
        
        {/* Steps container */}
        <div className="bg-black/50 rounded-lg p-4 backdrop-blur-sm border border-white/10 max-h-[60vh] overflow-y-auto">
          {steps.length === 0 ? (
            <p className="text-white/60 text-center py-4">Starting initialization...</p>
          ) : (
            <div className="space-y-2 font-mono text-sm">
              {steps.map((step, index) => (
                <div key={index} className="text-white/90">
                  <span className="text-cyan-400">[{step.file}]</span>{' '}
                  <span className="text-white">{step.message}</span>
                  {step.count !== undefined && (
                    <span className="text-emerald-400 font-bold"> {step.count}</span>
                  )}
                  <span className="text-yellow-400/80 ml-2">t[{step.durationSecs.toFixed(1)} secs]</span>
                </div>
              ))}
            </div>
          )}
          
          {/* Completion message */}
          {!isInitializing && totalDurationSecs > 0 && (
            <div className="mt-6 pt-4 border-t border-white/20">
              <p className="text-2xl font-bold text-emerald-400 text-center">
                ✓ World Initialized in {totalDurationSecs.toFixed(1)} Seconds!
              </p>
              <p className="text-white/60 text-center mt-2 text-sm">
                Click anywhere to continue
              </p>
            </div>
          )}
        </div>
        
        {/* Copy button - bottom right */}
        <div className="flex justify-end mt-4">
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors border border-white/20"
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
  );
}
