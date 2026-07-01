// AssetGridLabels — floating "code · name" tags in the ASSETGRID sampler showrooms. One tag hovers
// just above the ground in front of each asset so you can read its typeable code + name. Big packs
// have 700–2300 models, so we only mount tags for assets NEAR the camera (fade-in radius), capped,
// and recomputed a few times a second — you read every asset by walking past it, framerate holds.
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { sampleHeight } from '../terrainHeight';

export interface GridLabel { code: string; name: string; x: number; z: number; }

const RADIUS = 18;      // metres: labels fade in within this range of the camera
const CAP = 40;         // max labels mounted at once (draw-call ceiling)
const EVERY = 6;        // recompute the visible set every N frames (not every frame)
const Y_OFFSET = 0.6;   // float this far above the ground

interface Positioned extends GridLabel { y: number; }

export function AssetGridLabels({ items }: { items: GridLabel[] }) {
  const camera = useThree((s) => s.camera);
  // Ground height per label is static — sample once.
  const placed = useMemo<Positioned[]>(
    () => items.map((it) => ({ ...it, y: (sampleHeight(it.x, it.z) ?? 0) + Y_OFFSET })),
    [items],
  );
  const [visible, setVisible] = useState<Positioned[]>([]);
  const frame = useRef(0);
  const sig = useRef('');

  useFrame(() => {
    if ((frame.current = (frame.current + 1) % EVERY) !== 0) return;
    const cx = camera.position.x, cz = camera.position.z;
    const near = placed
      .map((p) => ({ p, d: (p.x - cx) * (p.x - cx) + (p.z - cz) * (p.z - cz) }))
      .filter((o) => o.d <= RADIUS * RADIUS)
      .sort((a, b) => a.d - b.d)
      .slice(0, CAP)
      .map((o) => o.p);
    const s = near.map((p) => p.code).join(',');
    if (s !== sig.current) { sig.current = s; setVisible(near); }
  });

  return (
    <>
      {visible.map((p) => (
        <Billboard key={p.code} position={[p.x, p.y, p.z]}>
          <Text fontSize={0.42} color="#eaf6ff" anchorX="center" anchorY="middle"
            outlineWidth={0.04} outlineColor="#0a1622" textAlign="center" maxWidth={12}>
            {`${p.code}\n${p.name}`}
          </Text>
        </Billboard>
      ))}
    </>
  );
}
