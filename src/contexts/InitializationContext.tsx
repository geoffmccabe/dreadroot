import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export interface InitStep {
  file: string;
  message: string;
  count?: number;
  durationSecs: number;
  timestamp: number;
}

interface InitializationContextType {
  isInitializing: boolean;
  steps: InitStep[];
  totalDurationSecs: number;
  startInitialization: () => void;
  addStep: (file: string, message: string, count?: number) => void;
  finishInitialization: () => void;
  dismissOverlay: () => void;
  isOverlayVisible: boolean;
}

const InitializationContext = createContext<InitializationContextType | null>(null);

// Global refs for hooks that can't use context (before React tree is mounted)
let globalAddStep: ((file: string, message: string, count?: number) => void) | null = null;
let globalStartInit: (() => void) | null = null;
let globalFinishInit: (() => void) | null = null;

// Exported functions for hooks that run outside React context
export function initLogStep(file: string, message: string, count?: number) {
  if (globalAddStep) {
    globalAddStep(file, message, count);
  }
}

export function initLogStart() {
  if (globalStartInit) {
    globalStartInit();
  }
}

export function initLogFinish() {
  if (globalFinishInit) {
    globalFinishInit();
  }
}

export function InitializationProvider({ children }: { children: React.ReactNode }) {
  const [isInitializing, setIsInitializing] = useState(false);
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  const [steps, setSteps] = useState<InitStep[]>([]);
  const [totalDurationSecs, setTotalDurationSecs] = useState(0);
  
  // Initialize with current time so early steps have valid baseline
  const startTimeRef = useRef<number>(performance.now());
  const lastStepTimeRef = useRef<number>(performance.now());

  const startInitialization = useCallback(() => {
    const now = performance.now();
    startTimeRef.current = now;
    lastStepTimeRef.current = now;
    setSteps([]);
    setIsInitializing(true);
    setIsOverlayVisible(true);
    setTotalDurationSecs(0);
  }, []);

  const addStep = useCallback((file: string, message: string, count?: number) => {
    const now = performance.now();
    const durationSecs = (now - lastStepTimeRef.current) / 1000;
    lastStepTimeRef.current = now;
    
    setSteps(prev => [...prev, {
      file,
      message,
      count,
      durationSecs,
      timestamp: now - startTimeRef.current
    }]);
  }, []);

  const finishInitialization = useCallback(() => {
    const now = performance.now();
    const total = (now - startTimeRef.current) / 1000;
    setTotalDurationSecs(total);
    setIsInitializing(false);
  }, []);

  const dismissOverlay = useCallback(() => {
    setIsOverlayVisible(false);
  }, []);

  // Register global functions
  React.useEffect(() => {
    globalAddStep = addStep;
    globalStartInit = startInitialization;
    globalFinishInit = finishInitialization;
    return () => {
      globalAddStep = null;
      globalStartInit = null;
      globalFinishInit = null;
    };
  }, [addStep, startInitialization, finishInitialization]);

  return (
    <InitializationContext.Provider value={{
      isInitializing,
      steps,
      totalDurationSecs,
      startInitialization,
      addStep,
      finishInitialization,
      dismissOverlay,
      isOverlayVisible
    }}>
      {children}
    </InitializationContext.Provider>
  );
}

export function useInitialization() {
  const context = useContext(InitializationContext);
  if (!context) {
    throw new Error('useInitialization must be used within InitializationProvider');
  }
  return context;
}
