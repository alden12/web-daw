/**
 * Local binary storage for audio clips, backed by the Origin Private File System
 * (OPFS). Audio data is large, so it lives here rather than in the synchronous,
 * size-limited localStorage project snapshot - the snapshot only references a
 * file by its handle id. A network backend can later slot in behind this seam,
 * exactly as `persistence.ts` does for the project document.
 */

const DIR = 'audio';

/** OPFS is required for audio clips; feature-detect so callers can degrade. */
export function audioStorageAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

async function audioDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

/** Store an audio blob; returns the handle id used to read it back. */
export async function putAudio(blob: Blob): Promise<string> {
  const id = `au-${crypto.randomUUID().slice(0, 8)}`;
  const dir = await audioDir();
  const handle = await dir.getFileHandle(id, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return id;
}

/** Read an audio file back as an ArrayBuffer (ready for decodeAudioData). */
export async function getAudioBuffer(id: string): Promise<ArrayBuffer> {
  const dir = await audioDir();
  const handle = await dir.getFileHandle(id);
  const file = await handle.getFile();
  return file.arrayBuffer();
}

/** Best-effort delete (used when an audio clip/track is removed). */
export async function deleteAudio(id: string): Promise<void> {
  try {
    const dir = await audioDir();
    await dir.removeEntry(id);
  } catch {
    // already gone or unavailable - nothing to do
  }
}
