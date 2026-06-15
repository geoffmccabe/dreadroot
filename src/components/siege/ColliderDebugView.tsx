// Collider wireframe debug view. Ctrl+Cmd+= (the "+"/"=" key) toggles green wireframe boxes
// around every collider currently in worldCollisionGrid — so troublesome ones (e.g. big
// rocks blocking a path) can be spotted, pointed at with the L laser, and reported/removed.
// Snapshots the colliders when toggled on (static building/rock boxes are what matters here).
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

export function ColliderDebugView() {
  const [on, setOn] = useState(false);
  const ref = useRef<THREE.Group>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl + Cmd + "+"/"=" toggles the collider wireframes. Capture phase + stopPropagation
      // so the game's keybinds and the browser zoom don't eat it first.
      if ((e.ctrlKey || e.metaKey) && (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=')) {
        e.preventDefault();
        e.stopPropagation();
        setOn((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    while (g.children.length) g.remove(g.children[0]);
    if (!on) return;
    const cells = (worldCollisionGrid as unknown as { colliderCells?: Map<THREE.Box3, unknown> }).colliderCells;
    if (!cells) return;
    let n = 0;
    for (const box of cells.keys()) {
      const h = new THREE.Box3Helper(box, new THREE.Color(0x00ff88) as unknown as number);
      // Draw through walls/terrain so the boxes are always visible for inspection.
      const mat = h.material as THREE.LineBasicMaterial;
      mat.depthTest = false; mat.depthWrite = false; mat.transparent = true;
      h.renderOrder = 999;
      g.add(h);
      n++;
    }
    console.log(`[ColliderDebug] showing ${n} collider wireframes (Ctrl+Cmd+= to toggle)`);
  }, [on]);

  return <group ref={ref} />;
}
