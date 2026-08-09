// GlobeCloudsGate — mounts the cloud decks only while the panel asks for them.
//
// A separate file so GlobeClouds itself stays a pure renderer with no opinion about whether it
// should exist. It is also known to paint over the terrain (see the note in GlobeLookControls: the
// camera's depth range is far too wide to sort anything at planetary distance), so being able to
// unmount it entirely — rather than draw it at zero opacity — is the point.

import { useGlobeLook } from '@/features/look/globeLookStore';
import { GlobeErrorBoundary } from './GlobeErrorBoundary';
import { GlobeClouds } from './GlobeClouds';

export function GlobeCloudsGate() {
  const g = useGlobeLook();
  if (!g.enabled || !g.cloudsOn) return null;
  return (
    <GlobeErrorBoundary label="globe-clouds">
      <GlobeClouds coverage={g.cloudCoverage} opacity={g.cloudOpacity} />
    </GlobeErrorBoundary>
  );
}
