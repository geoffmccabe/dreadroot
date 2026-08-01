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

/**
 * Layers that have been dropped, so the HUD can SAY SO.
 *
 * A console.error is invisible to anyone playing the game. When the arena layer is dropped the
 * fight stops being simulated entirely — no separation, no weapons, no AI — and every one of those
 * reads as a separate bug ("colliders do not work", "I cannot fire"). One line on screen turns
 * that from three mysteries into one fact.
 */
export const failedLayers = new Set<string>();

export class GlobeErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log loudly but keep going. Silent failure here would be worse than the crash: the layer
    // would simply be missing with no explanation.
    failedLayers.add(this.props.label);
    console.error(`[earth] "${this.props.label}" layer failed and was dropped:`, error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
