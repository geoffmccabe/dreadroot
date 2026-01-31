import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export type InitStepStatus = 'running' | 'done' | 'error';

export interface InitStep {
  id: string;
  file: string;
  message: string;
  count?: number;
  startTime: number;      // When this step started (ms from init start)
  endTime?: number;       // When this step finished (ms from init start)
  durationMs?: number;    // Actual duration of this step
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
  elapsedMs: number;  // Current elapsed time for live updates
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
const MAX_STEPS = 150;

// Deduplication: track recent messages to avoid duplicates
const recentMessages = new Map<string, number>(); // message key -> timestamp
const DEDUPE_WINDOW_MS = 500; // Don't repeat same message within 500ms

function getMessageKey(file: string, message: string): string {
  return `${file}|${message}`;
}

function shouldDedupe(file: string, message: string): boolean {
  const key = getMessageKey(file, message);
  const lastTime = recentMessages.get(key);
  const now = performance.now();

  if (lastTime && now - lastTime < DEDUPE_WINDOW_MS) {
    return true; // Skip this message
  }

  recentMessages.set(key, now);
  return false;
}

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
  const [elapsedMs, setElapsedMs] = useState(0);

  const startTimeRef = useRef<number>(performance.now());
  const isInitializingRef = useRef(false);
  const elapsedIntervalRef = useRef<number | null>(null);

  const startInitialization = useCallback(() => {
    const now = performance.now();
    startTimeRef.current = now;
    stepIdCounter = 0;
    recentMessages.clear();
    setSteps([]);
    setIsInitializing(true);
    isInitializingRef.current = true;
    setIsOverlayVisible(true);
    setTotalDurationSecs(0);
    setElapsedMs(0);

    // Update elapsed time every 100ms for live display
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
    }
    elapsedIntervalRef.current = window.setInterval(() => {
      setElapsedMs(performance.now() - startTimeRef.current);
    }, 100);
  }, []);

  // Instant step - logs immediately as done (for info messages)
  const addStep = useCallback((file: string, message: string, count?: number) => {
    if (!isInitializingRef.current) return;

    // Deduplicate
    if (shouldDedupe(file, message)) return;

    const now = performance.now();
    const elapsed = now - startTimeRef.current;
    const id = `step-${++stepIdCounter}`;

    setSteps(prev => {
      if (prev.length >= MAX_STEPS) return prev;
      return [...prev, {
        id,
        file,
        message,
        count,
        startTime: elapsed,
        endTime: elapsed,
        durationMs: 0, // Instant step
        status: 'done' as InitStepStatus
      }];
    });
  }, []);

  // Start a step (status = 'running') - returns ID to finish later
  const startStep = useCallback((file: string, message: string): string => {
    const id = `step-${++stepIdCounter}`;

    if (!isInitializingRef.current) return id;

    // Don't dedupe start steps - they have unique IDs
    const now = performance.now();
    const elapsed = now - startTimeRef.current;

    setSteps(prev => {
      if (prev.length >= MAX_STEPS) return prev;
      return [...prev, {
        id,
        file,
        message,
        startTime: elapsed,
        status: 'running' as InitStepStatus
      }];
    });

    return id;
  }, []);

  // Finish a running step - calculates actual duration
  const finishStep = useCallback((id: string, count?: number) => {
    if (!isInitializingRef.current) return;

    const now = performance.now();
    const elapsed = now - startTimeRef.current;

    setSteps(prev => prev.map(step => {
      if (step.id !== id) return step;
      return {
        ...step,
        status: 'done' as InitStepStatus,
        count,
        endTime: elapsed,
        durationMs: elapsed - step.startTime
      };
    }));
  }, []);

  // Mark a step as errored
  const errorStep = useCallback((id: string, message?: string) => {
    if (!isInitializingRef.current) return;

    const now = performance.now();
    const elapsed = now - startTimeRef.current;

    setSteps(prev => prev.map(step => {
      if (step.id !== id) return step;
      return {
        ...step,
        status: 'error' as InitStepStatus,
        errorMessage: message,
        endTime: elapsed,
        durationMs: elapsed - step.startTime
      };
    }));
  }, []);

  const finishInitialization = useCallback(() => {
    const now = performance.now();
    const total = (now - startTimeRef.current) / 1000;
    setTotalDurationSecs(total);
    setElapsedMs(now - startTimeRef.current);
    setIsInitializing(false);
    isInitializingRef.current = false;

    // Stop elapsed timer
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
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
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
      }
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
      isOverlayVisible,
      elapsedMs
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
