import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export type InitStepStatus = 'running' | 'done' | 'error';

export interface InitStep {
  id: string;
  file: string;
  message: string;
  count?: number;
  durationSecs: number;
  timestamp: number;
  status: InitStepStatus;
  errorMessage?: string;
}

interface InitializationContextType {
  isInitializing: boolean;
  steps: InitStep[];
  totalDurationSecs: number;
  startInitialization: () => void;
  addStep: (file: string, message: string, count?: number) => void;
  startStep: (file: string, message: string) => string;
  finishStep: (id: string, count?: number) => void;
  errorStep: (id: string, message?: string) => void;
  finishInitialization: () => void;
  dismissOverlay: () => void;
  isOverlayVisible: boolean;
}

const InitializationContext = createContext<InitializationContextType | null>(null);

// Global refs for hooks that can't use context (before React tree is mounted)
let globalAddStep: ((file: string, message: string, count?: number) => void) | null = null;
let globalStartInit: (() => void) | null = null;
let globalFinishInit: (() => void) | null = null;
let globalStartStep: ((file: string, message: string) => string) | null = null;
let globalFinishStep: ((id: string, count?: number) => void) | null = null;
let globalErrorStep: ((id: string, message?: string) => void) | null = null;

// Max steps to prevent memory issues
const MAX_STEPS = 250;

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

/**
 * Start a step and return its ID for later completion
 * Returns null if not initializing
 */
export function initLogStartStep(file: string, message: string): string | null {
  if (globalStartStep) {
    return globalStartStep(file, message);
  }
  return null;
}

/**
 * Finish a running step with optional count
 */
export function initLogFinishStep(id: string, count?: number): void {
  if (globalFinishStep) {
    globalFinishStep(id, count);
  }
}

/**
 * Mark a step as errored with optional error message
 */
export function initLogErrorStep(id: string, message?: string): void {
  if (globalErrorStep) {
    globalErrorStep(id, message);
  }
}

let stepIdCounter = 0;

export function InitializationProvider({ children }: { children: React.ReactNode }) {
  const [isInitializing, setIsInitializing] = useState(false);
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  const [steps, setSteps] = useState<InitStep[]>([]);
  const [totalDurationSecs, setTotalDurationSecs] = useState(0);
  
  // Initialize with current time so early steps have valid baseline
  const startTimeRef = useRef<number>(performance.now());
  const lastStepTimeRef = useRef<number>(performance.now());
  const isInitializingRef = useRef(false);

  const startInitialization = useCallback(() => {
    const now = performance.now();
    startTimeRef.current = now;
    lastStepTimeRef.current = now;
    stepIdCounter = 0;
    setSteps([]);
    setIsInitializing(true);
    isInitializingRef.current = true;
    setIsOverlayVisible(true);
    setTotalDurationSecs(0);
  }, []);

  // Legacy addStep - creates a "done" step immediately
  const addStep = useCallback((file: string, message: string, count?: number) => {
    if (!isInitializingRef.current) return;
    
    const now = performance.now();
    const durationSecs = (now - lastStepTimeRef.current) / 1000;
    lastStepTimeRef.current = now;
    const id = `step-${++stepIdCounter}`;
    
    setSteps(prev => {
      if (prev.length >= MAX_STEPS) return prev;
      return [...prev, {
        id,
        file,
        message,
        count,
        durationSecs,
        timestamp: now - startTimeRef.current,
        status: 'done' as InitStepStatus
      }];
    });
  }, []);

  // Start a step (status = 'running')
  const startStep = useCallback((file: string, message: string): string => {
    const id = `step-${++stepIdCounter}`;
    
    if (!isInitializingRef.current) return id;
    
    const now = performance.now();
    const durationSecs = (now - lastStepTimeRef.current) / 1000;
    lastStepTimeRef.current = now;
    
    setSteps(prev => {
      if (prev.length >= MAX_STEPS) return prev;
      return [...prev, {
        id,
        file,
        message,
        durationSecs,
        timestamp: now - startTimeRef.current,
        status: 'running' as InitStepStatus
      }];
    });
    
    return id;
  }, []);

  // Finish a running step
  const finishStep = useCallback((id: string, count?: number) => {
    if (!isInitializingRef.current) return;
    
    const now = performance.now();
    
    setSteps(prev => prev.map(step => {
      if (step.id !== id) return step;
      return {
        ...step,
        status: 'done' as InitStepStatus,
        count,
        durationSecs: (now - startTimeRef.current - step.timestamp) / 1000
      };
    }));
  }, []);

  // Mark a step as errored
  const errorStep = useCallback((id: string, message?: string) => {
    if (!isInitializingRef.current) return;
    
    const now = performance.now();
    
    setSteps(prev => prev.map(step => {
      if (step.id !== id) return step;
      return {
        ...step,
        status: 'error' as InitStepStatus,
        errorMessage: message,
        durationSecs: (now - startTimeRef.current - step.timestamp) / 1000
      };
    }));
  }, []);

  const finishInitialization = useCallback(() => {
    const now = performance.now();
    const total = (now - startTimeRef.current) / 1000;
    setTotalDurationSecs(total);
    setIsInitializing(false);
    isInitializingRef.current = false;
  }, []);

  const dismissOverlay = useCallback(() => {
    setIsOverlayVisible(false);
  }, []);

  // Register global functions
  React.useEffect(() => {
    globalAddStep = addStep;
    globalStartInit = startInitialization;
    globalFinishInit = finishInitialization;
    globalStartStep = startStep;
    globalFinishStep = finishStep;
    globalErrorStep = errorStep;
    return () => {
      globalAddStep = null;
      globalStartInit = null;
      globalFinishInit = null;
      globalStartStep = null;
      globalFinishStep = null;
      globalErrorStep = null;
    };
  }, [addStep, startInitialization, finishInitialization, startStep, finishStep, errorStep]);

  return (
    <InitializationContext.Provider value={{
      isInitializing,
      steps,
      totalDurationSecs,
      startInitialization,
      addStep,
      startStep,
      finishStep,
      errorStep,
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
