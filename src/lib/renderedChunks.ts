/**
 * Module-level set of chunk keys currently RENDERED to the scene.
 *
 * `loadedChunksRef` in BlocksContext means "we have the block data in memory."
 * That fires before the chunk's actual mesh is committed to React/Three. So
 * for things that should only show when their host chunk is visually present
 * (e.g. fruits — otherwise they float in the sky before the tree appears),
 * gate on this set, not on the loaded set.
 *
 * Updated by FortressScene.CameraTrackedBlocks as it hands chunks to the
 * progressive renderer.
 */
export const renderedChunkKeys = new Set<string>();
