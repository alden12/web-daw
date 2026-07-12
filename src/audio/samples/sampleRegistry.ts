/**
 * A tiny runtime map from a project sample's stable id to its current content
 * hash (the OPFS blob key). Instruments only receive `(ctx, store)` and can't
 * reach the project, so the Sampler resolves an "asset:<id>" ref through this
 * registry instead. The AudioEngine keeps it in sync from `project.samples` on
 * every reconcile (a module singleton, mirroring `getRepository()`).
 */
import type { SampleAsset } from "./catalog";

const hashById = new Map<string, string>();

/** Replace the registry with the project's current sample library. */
export function setSampleAssets(assets: SampleAsset[]): void {
  hashById.clear();
  for (const asset of assets) hashById.set(asset.id, asset.contentHash);
}

/** The content hash for an asset id, or undefined if it isn't in the library. */
export function resolveSampleHash(id: string): string | undefined {
  return hashById.get(id);
}
