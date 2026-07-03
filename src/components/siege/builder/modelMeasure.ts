// modelMeasure — the natural height (metres) of a model's bounding box, cached. Used when ACCEPTing a
// procedural batch: the generator picks a target height in metres, and a builder object stores a uniform
// scale multiplier, so scale = targetHeight / modelHeight.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { importUrl } from './mushroomCatalog';

const cache = new Map<string, number>();
let loader: GLTFLoader | null = null;
function getLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    loader.setDRACOLoader(draco);
  }
  return loader;
}

export async function modelHeight(file: string): Promise<number> {
  const cached = cache.get(file);
  if (cached != null) return cached;
  const gltf = await getLoader().loadAsync(importUrl(file));
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const h = Math.max(0.001, box.max.y - box.min.y);
  cache.set(file, h);
  return h;
}

// Measure a list once; returns file → height.
export async function modelHeights(files: string[]): Promise<Map<string, number>> {
  const uniq = [...new Set(files)];
  const hs = await Promise.all(uniq.map((f) => modelHeight(f)));
  return new Map(uniq.map((f, i) => [f, hs[i]]));
}
