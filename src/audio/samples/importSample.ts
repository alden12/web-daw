/**
 * Importing a local audio file into the project sample library. Shared by the
 * Library panel and the Sampler picker so both go through one path: store the
 * bytes (content-addressed, deduped), reuse an existing asset record if those
 * exact bytes are already in the library, otherwise mint a stable id and dispatch
 * an `addSample` edit. Returns the "asset:<id>" ref for the caller to select.
 *
 * Dedup lives here (not in `applyEdit`) so `addSample` stays a pure append - the
 * edit log replays it deterministically.
 */
import { audioStorageAvailable, putAudio } from "../audioStore";
import { assetRef, type SampleAsset } from "./catalog";
import type { Dispatch } from "../commands/types";

const newSampleId = () => `smp-${crypto.randomUUID().slice(0, 8)}`;
const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, "") || fileName;

/**
 * Store `file` and add it to the library. Resolves to its "asset:<id>" ref, or
 * null if audio storage is unavailable or the import fails (the caller surfaces
 * the message; this never throws).
 */
export async function importSampleFile(
  file: File,
  existing: SampleAsset[],
  dispatch: Dispatch,
): Promise<string | null> {
  if (!audioStorageAvailable()) return null;
  try {
    const contentHash = await putAudio(file);
    // Same bytes already imported -> reuse that library entry (dedup).
    const match = existing.find((asset) => asset.contentHash === contentHash);
    if (match) return assetRef(match.id);

    const id = newSampleId();
    dispatch({ type: "addSample", id, name: baseName(file.name), contentHash, source: "import" });
    return assetRef(id);
  } catch {
    return null;
  }
}
