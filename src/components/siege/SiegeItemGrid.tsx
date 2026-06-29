// SiegeItemGrid — a debug/confirmation grid of EVERY game item, floating above the
// Siege Worlds spawn so you can eyeball that all of them load + render. Each item is
// its sprite (/item-sprites/<id>.webp) on a camera-facing billboard, laid out 1m
// apart in row-major ID order: id = row * COLS + col. Missing sprites hide themselves.
//
// Toggle with the "I" key (Items). Off by default so it doesn't clutter normal play.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const COLS = 12;          // columns (X)
const ROWS = 20;          // rows (Z)
const COUNT = 229;        // item ids 0..228
const SPACING = 1;        // metres between items
// Centre the grid over the Lobby Island spawn (-96, 25, 325), 20m up.
const CENTER = new THREE.Vector3(-96, 45, 325);
const ITEM_SIZE = 0.85;   // sprite footprint (m), slightly under the 1m spacing

export function SiegeItemGrid() {
  const [visible, setVisible] = useState(false);
  const groupRef = useRef<THREE.Group | null>(null);

  // Toggle the debug item grid with Cmd+I (⌘I). NOT plain I (that's the inventory
  // key) and NOT Ctrl+I (taken by Inspector Mode + the siege Controls panel). We only
  // act on the exact Cmd+I combo and don't stopPropagation, so no other key is eaten.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Build (and load all 229 sprite textures) ONLY the first time the grid is opened — not on every
  // lobby load. It's a hidden Cmd+I debug grid; loading 229 sprites at startup was pure waste +
  // loading-manager contention during the world load.
  const [group, setGroup] = useState<THREE.Group | null>(null);
  useEffect(() => {
    if (!visible || group) return;
    const g = new THREE.Group();
    const loader = new THREE.TextureLoader();
    for (let id = 0; id < COUNT; id++) {
      const col = id % COLS;
      const row = Math.floor(id / COLS);
      const sprite = new THREE.Sprite();
      sprite.position.set(
        CENTER.x + (col - (COLS - 1) / 2) * SPACING,
        CENTER.y,
        CENTER.z + (row - (ROWS - 1) / 2) * SPACING,
      );
      sprite.scale.set(ITEM_SIZE, ITEM_SIZE, 1);
      sprite.visible = false; // shown once its texture loads
      loader.load(
        `/item-sprites/${id}.webp`,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          sprite.material = new THREE.SpriteMaterial({ map: tex, transparent: true });
          sprite.visible = true;
        },
        undefined,
        () => { /* missing sprite → stays hidden */ },
      );
      g.add(sprite);
    }
    setGroup(g);
  }, [visible, group]);

  useEffect(() => {
    return () => {
      group?.traverse((o) => {
        const s = o as THREE.Sprite;
        if (s.material) {
          (s.material.map as THREE.Texture | null)?.dispose?.();
          s.material.dispose();
        }
      });
    };
  }, [group]);

  if (!visible || !group) return null;
  return <primitive ref={groupRef} object={group} />;
}
