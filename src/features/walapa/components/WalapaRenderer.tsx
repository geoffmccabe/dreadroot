import { useRef, useMemo, forwardRef, useImperativeHandle, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { generateWalapaBodyBlocks, getTierDimensions, type WalapaInstance, type WalapaPart } from '../types';
import {
  MAX_WALAPAS_TOTAL,
  TIER_COLORS,
  WALAPA_BOB_AMPLITUDE,
  WALAPA_RENDER_DISTANCE,
  WALAPA_HITBOX_RADIUS,
  WALAPA_HITBOX_HEIGHT,
} from '../constants';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { getGlobalAtlasTexture, isAtlasReady } from '@/hooks/useTextureAtlas';
import { getWalapaUVs } from '@/lib/atlasLookup';
import { createAtlasLambertMaterial, createUvOffsetAttribute, setInstanceUvOffset } from '@/lib/atlasMaterial';

// Pre-allocated objects for performance
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpColor = new THREE.Color();
const tmpEuler = new THREE.Euler();
const _scratchBoxMin = new THREE.Vector3();
const _scratchBoxMax = new THREE.Vector3();
const _scratchBox = new THREE.Box3();

// Shared box geometry for all block parts (1x1x1 meter)
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);

// Estimate max blocks per walapa (tier 10 has most blocks)
const MAX_BLOCKS_PER_WALAPA = 500;
const MAX_INSTANCES = MAX_WALAPAS_TOTAL * MAX_BLOCKS_PER_WALAPA;

// Cache generated body parts per tier
const tierBodyPartsCache = new Map<number, WalapaPart[]>();

function getBodyPartsForTier(tier: number): WalapaPart[] {
  if (!tierBodyPartsCache.has(tier)) {
    tierBodyPartsCache.set(tier, generateWalapaBodyBlocks(tier));
  }
  return tierBodyPartsCache.get(tier)!;
}

// Collider type for tracking
interface WalapaCollider {
  walapaId: string;
  box: THREE.Box3;
}

// Type for Box3 with walapa tracking data
interface WalapaTaggedBox3 extends THREE.Box3 {
  __walapaId?: string;
  __isWalapaCollider?: boolean;
}

export interface WalapaRendererHandle {
  getHitbox: (walapaId: string) => { center: THREE.Vector3; radius: number; height: number; width: number; depth: number } | null;
  getCollisionBoxes: (walapaId: string) => THREE.Box3[] | null;
}

interface WalapaRendererProps {
  walapas: WalapaInstance[];
  cameraRef: React.RefObject<THREE.Camera>;
}

export const WalapaRenderer = forwardRef<WalapaRendererHandle, WalapaRendererProps>(
  ({ walapas, cameraRef }, ref) => {
    const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
    const bellyMeshRef = useRef<THREE.InstancedMesh>(null);
    const eyesMeshRef = useRef<THREE.InstancedMesh>(null);

    const bodyUvAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
    const bellyUvAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
    const eyesUvAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);

    const bodyMaterialRef = useRef<THREE.MeshLambertMaterial | null>(null);
    const bellyMaterialRef = useRef<THREE.MeshLambertMaterial | null>(null);
    const eyesMaterialRef = useRef<THREE.MeshLambertMaterial | null>(null);

    const collidersRef = useRef<Map<string, WalapaCollider[]>>(new Map());
    const prevWalapaIdsRef = useRef<Set<string>>(new Set());

    // Create atlas materials — only use atlas if walapa textures exist in it,
    // otherwise fall back to plain Lambert that works with tier fallback colors
    const bodyMaterial = useMemo(() => {
      const atlasTexture = getGlobalAtlasTexture();
      const hasWalapaUvs = getWalapaUVs(1, 'body') !== null;
      if (!atlasTexture || !isAtlasReady() || !hasWalapaUvs) {
        const mat = new THREE.MeshLambertMaterial({
          color: 0xffffff,
          side: THREE.FrontSide,
        });
        bodyMaterialRef.current = mat;
        return mat;
      }

      const mat = createAtlasLambertMaterial(atlasTexture);
      bodyMaterialRef.current = mat;
      return mat;
    }, []);

    const bellyMaterial = useMemo(() => {
      const atlasTexture = getGlobalAtlasTexture();
      const hasWalapaUvs = getWalapaUVs(1, 'belly') !== null;
      if (!atlasTexture || !isAtlasReady() || !hasWalapaUvs) {
        const mat = new THREE.MeshLambertMaterial({
          color: 0xffffff,
          side: THREE.FrontSide,
        });
        bellyMaterialRef.current = mat;
        return mat;
      }

      const mat = createAtlasLambertMaterial(atlasTexture);
      bellyMaterialRef.current = mat;
      return mat;
    }, []);

    const eyesMaterial = useMemo(() => {
      const atlasTexture = getGlobalAtlasTexture();
      const hasWalapaUvs = getWalapaUVs(1, 'eyes') !== null;
      if (!atlasTexture || !isAtlasReady() || !hasWalapaUvs) {
        const mat = new THREE.MeshLambertMaterial({
          color: 0x111111,
          side: THREE.FrontSide,
        });
        eyesMaterialRef.current = mat;
        return mat;
      }

      const mat = createAtlasLambertMaterial(atlasTexture);
      eyesMaterialRef.current = mat;
      return mat;
    }, []);

    // Update materials when atlas becomes ready AND walapa textures exist in atlas
    useEffect(() => {
      const checkAtlas = () => {
        if (isAtlasReady()) {
          const atlasTexture = getGlobalAtlasTexture();
          if (!atlasTexture) return;

          // Only swap to atlas material if at least one walapa tier has UVs
          // Otherwise the atlas material would sample slot 0 (black) for unset UVs
          const anyWalapaUvs = getWalapaUVs(1, 'body') !== null;
          if (!anyWalapaUvs) return;

          if (bodyMeshRef.current && bodyMaterialRef.current && !bodyMaterialRef.current.map) {
            const newMat = createAtlasLambertMaterial(atlasTexture);
            bodyMaterialRef.current = newMat;
            bodyMeshRef.current.material = newMat;
          }
          if (bellyMeshRef.current && bellyMaterialRef.current && !bellyMaterialRef.current.map) {
            const newMat = createAtlasLambertMaterial(atlasTexture);
            bellyMaterialRef.current = newMat;
            bellyMeshRef.current.material = newMat;
          }
          if (eyesMeshRef.current && eyesMaterialRef.current && !eyesMaterialRef.current.map) {
            const newMat = createAtlasLambertMaterial(atlasTexture);
            eyesMaterialRef.current = newMat;
            eyesMeshRef.current.material = newMat;
          }
        }
      };

      const interval = setInterval(checkAtlas, 100);
      return () => clearInterval(interval);
    }, []);

    // Setup UV offset attributes when meshes are ready
    useEffect(() => {
      if (bodyMeshRef.current && !bodyUvAttrRef.current) {
        bodyUvAttrRef.current = createUvOffsetAttribute(bodyMeshRef.current, MAX_INSTANCES);
      }
      if (bellyMeshRef.current && !bellyUvAttrRef.current) {
        bellyUvAttrRef.current = createUvOffsetAttribute(bellyMeshRef.current, MAX_INSTANCES);
      }
      if (eyesMeshRef.current && !eyesUvAttrRef.current) {
        eyesUvAttrRef.current = createUvOffsetAttribute(eyesMeshRef.current, MAX_INSTANCES);
      }
    }, []);

    // Expose handle for collision detection
    useImperativeHandle(ref, () => ({
      getHitbox: (walapaId: string) => {
        const walapa = walapas.find(w => w.id === walapaId);
        if (!walapa || !walapa.isActive) return null;

        const dims = getTierDimensions(walapa.definition.tier);
        const bobOffset = Math.sin(walapa.bobPhase) * WALAPA_BOB_AMPLITUDE;

        return {
          center: new THREE.Vector3(
            walapa.position.x,
            walapa.position.y + bobOffset,
            walapa.position.z
          ),
          radius: WALAPA_HITBOX_RADIUS * dims.width / 7,
          height: dims.height * walapa.scale,
          width: dims.width * walapa.scale,
          depth: dims.length * walapa.scale,
        };
      },
      getCollisionBoxes: (walapaId: string) => {
        const colliders = collidersRef.current.get(walapaId);
        return colliders ? colliders.map(c => c.box) : null;
      },
    }), [walapas]);

    // Cleanup colliders when walapas are removed
    useEffect(() => {
      const currentIds = new Set(walapas.filter(w => w.isActive).map(w => w.id));
      const prevIds = prevWalapaIdsRef.current;

      for (const id of prevIds) {
        if (!currentIds.has(id)) {
          const colliders = collidersRef.current.get(id);
          if (colliders) {
            for (const collider of colliders) {
              worldCollisionGrid.remove(collider.box);
            }
            collidersRef.current.delete(id);
          }
        }
      }

      prevWalapaIdsRef.current = currentIds;
    }, [walapas]);

    // Cleanup all colliders on unmount
    useEffect(() => {
      return () => {
        for (const colliders of collidersRef.current.values()) {
          for (const collider of colliders) {
            worldCollisionGrid.remove(collider.box);
          }
        }
        collidersRef.current.clear();
      };
    }, []);

    useFrame(() => {
      const bodyMesh = bodyMeshRef.current;
      const bellyMesh = bellyMeshRef.current;
      const eyesMesh = eyesMeshRef.current;
      const camera = cameraRef.current;
      if (!bodyMesh || !bellyMesh || !eyesMesh || !camera) return;

      const bodyUvAttr = bodyUvAttrRef.current;
      const bellyUvAttr = bellyUvAttrRef.current;
      const eyesUvAttr = eyesUvAttrRef.current;

      if (walapas.length === 0) {
        bodyMesh.count = 0;
        bellyMesh.count = 0;
        eyesMesh.count = 0;
        return;
      }

      let bodyIndex = 0;
      let bellyIndex = 0;
      let eyesIndex = 0;
      const cameraPos = camera.position;

      for (const walapa of walapas) {
        if (!walapa.isActive) continue;

        const dx = walapa.position.x - cameraPos.x;
        const dy = walapa.position.y - cameraPos.y;
        const dz = walapa.position.z - cameraPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq > WALAPA_RENDER_DISTANCE * WALAPA_RENDER_DISTANCE) continue;

        const bodyParts = getBodyPartsForTier(walapa.definition.tier);
        const bobOffset = Math.sin(walapa.bobPhase) * WALAPA_BOB_AMPLITUDE;
        const tailWag = Math.sin(walapa.tailPhase) * 0.3;

        // Get UV offsets from atlas for each part type
        const bodyUvs = getWalapaUVs(walapa.definition.tier, 'body');
        const bellyUvs = getWalapaUVs(walapa.definition.tier, 'belly');
        const eyesUvs = getWalapaUVs(walapa.definition.tier, 'eyes');

        const tierColor = TIER_COLORS[walapa.definition.tier] || 0x6699cc;
        const hasBodyTexture = bodyUvs !== null;
        const hasBellyTexture = bellyUvs !== null;
        const hasEyesTexture = eyesUvs !== null;

        let collisionBoxCount = 0;
        const walapaColliders: WalapaCollider[] = collidersRef.current.get(walapa.id) || [];
        let colliderIndex = 0;

        const cosRot = Math.cos(walapa.rotation);
        const sinRot = Math.sin(walapa.rotation);

        for (const part of bodyParts) {
          let offsetX = part.offsetX * walapa.scale;
          let offsetY = part.offsetY * walapa.scale + bobOffset;
          let offsetZ = part.offsetZ * walapa.scale;

          if (part.name.startsWith('tail') || part.name.includes('Fluke')) {
            offsetX += tailWag * walapa.scale * (part.name.includes('left') || part.name.includes('Left') ? -1 : 1);
          }

          const rotatedX = offsetX * cosRot - offsetZ * sinRot;
          const rotatedZ = offsetX * sinRot + offsetZ * cosRot;

          tmpPosition.set(
            walapa.position.x + rotatedX,
            walapa.position.y + offsetY,
            walapa.position.z + rotatedZ
          );

          tmpScale.set(walapa.scale, walapa.scale, walapa.scale);
          tmpQuaternion.setFromEuler(tmpEuler.set(0, walapa.rotation, 0));
          tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);

          if (part.textureType === 'body') {
            if (bodyIndex < MAX_INSTANCES) {
              bodyMesh.setMatrixAt(bodyIndex, tmpMatrix);

              // Set UV offset for atlas
              if (bodyUvAttr && bodyUvs) {
                setInstanceUvOffset(bodyUvAttr, bodyIndex, bodyUvs.uvOffsetX, bodyUvs.uvOffsetY);
              }

              if (hasBodyTexture) {
                tmpColor.setRGB(1, 1, 1);
              } else {
                tmpColor.setHex(tierColor);
              }
              bodyMesh.setColorAt(bodyIndex, tmpColor);
              bodyIndex++;
            }
          } else if (part.textureType === 'belly') {
            if (bellyIndex < MAX_INSTANCES) {
              bellyMesh.setMatrixAt(bellyIndex, tmpMatrix);

              // Set UV offset for atlas
              if (bellyUvAttr && bellyUvs) {
                setInstanceUvOffset(bellyUvAttr, bellyIndex, bellyUvs.uvOffsetX, bellyUvs.uvOffsetY);
              }

              if (hasBellyTexture) {
                tmpColor.setRGB(1, 1, 1);
              } else {
                tmpColor.setHex(tierColor);
                tmpColor.lerp(new THREE.Color(0xffffff), 0.4);
              }
              bellyMesh.setColorAt(bellyIndex, tmpColor);
              bellyIndex++;
            }
          } else if (part.textureType === 'eyes') {
            if (eyesIndex < MAX_INSTANCES) {
              eyesMesh.setMatrixAt(eyesIndex, tmpMatrix);

              // Set UV offset for atlas
              if (eyesUvAttr && eyesUvs) {
                setInstanceUvOffset(eyesUvAttr, eyesIndex, eyesUvs.uvOffsetX, eyesUvs.uvOffsetY);
              }

              if (hasEyesTexture) {
                tmpColor.setRGB(1, 1, 1);
              } else {
                tmpColor.setHex(0x111111);
              }
              eyesMesh.setColorAt(eyesIndex, tmpColor);
              eyesIndex++;
            }
          }

          // Add collision box for body and belly blocks
          if (part.textureType === 'body' || part.textureType === 'belly') {
            const halfSize = walapa.scale / 2;
            _scratchBoxMin.set(
              tmpPosition.x - halfSize,
              tmpPosition.y - halfSize,
              tmpPosition.z - halfSize
            );
            _scratchBoxMax.set(
              tmpPosition.x + halfSize,
              tmpPosition.y + halfSize,
              tmpPosition.z + halfSize
            );
            _scratchBox.set(_scratchBoxMin, _scratchBoxMax);
            collisionBoxCount++;

            if (colliderIndex < walapaColliders.length) {
              walapaColliders[colliderIndex].box.copy(_scratchBox);
              worldCollisionGrid.update(walapaColliders[colliderIndex].box);
            } else {
              const newBox = _scratchBox.clone() as WalapaTaggedBox3;
              newBox.__walapaId = walapa.id;
              newBox.__isWalapaCollider = true;
              worldCollisionGrid.insert(newBox);
              walapaColliders.push({ walapaId: walapa.id, box: newBox });
            }
            colliderIndex++;
          }
        }

        while (colliderIndex < walapaColliders.length) {
          const removed = walapaColliders.pop()!;
          worldCollisionGrid.remove(removed.box);
        }

        collidersRef.current.set(walapa.id, walapaColliders);
      }

      bodyMesh.count = bodyIndex;
      bellyMesh.count = bellyIndex;
      eyesMesh.count = eyesIndex;

      bodyMesh.instanceMatrix.needsUpdate = true;
      bellyMesh.instanceMatrix.needsUpdate = true;
      eyesMesh.instanceMatrix.needsUpdate = true;

      if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
      if (bellyMesh.instanceColor) bellyMesh.instanceColor.needsUpdate = true;
      if (eyesMesh.instanceColor) eyesMesh.instanceColor.needsUpdate = true;

      if (bodyUvAttr) bodyUvAttr.needsUpdate = true;
      if (bellyUvAttr) bellyUvAttr.needsUpdate = true;
      if (eyesUvAttr) eyesUvAttr.needsUpdate = true;
    });

    return (
      <group>
        <instancedMesh
          ref={bodyMeshRef}
          args={[boxGeometry, bodyMaterial, MAX_INSTANCES]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
        <instancedMesh
          ref={bellyMeshRef}
          args={[boxGeometry, bellyMaterial, MAX_INSTANCES]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
        <instancedMesh
          ref={eyesMeshRef}
          args={[boxGeometry, eyesMaterial, MAX_INSTANCES]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
      </group>
    );
  }
);

WalapaRenderer.displayName = 'WalapaRenderer';
