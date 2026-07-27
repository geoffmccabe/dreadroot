// GlobeErrorBoundary — keep one broken Mini Earth feature from taking down the whole game.
//
// Written after a single unreachable asset (the warpgate .glb failing to fetch) threw out of
// Suspense with no boundary above it, unmounted the React tree and white-screened everything.
// The map is assembled from several independent layers, none of which is worth losing the game
// over: if portals cannot load you should still have a planet, a Kaiju and an ocean.
//
// Mirrors the ModelBoundary pattern already used in SetSampler for exactly this reason.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; label: string }
interface State { failed: boolean }

export class GlobeErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log loudly but keep going. Silent failure here would be worse than the crash: the layer
    // would simply be missing with no explanation.
    console.error(`[earth] "${this.props.label}" layer failed and was dropped:`, error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
