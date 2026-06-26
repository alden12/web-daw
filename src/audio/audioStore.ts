/**
 * Audio sample storage, as seen by the engine and import UI. Samples are large, so
 * they live as content-addressed binary in the project bundle (see
 * `projectRepository.ts`) rather than in the synchronous project snapshot - the
 * snapshot only references a sample by its content hash (`fileId`). This module is
 * the thin façade the rest of the app calls; the bundle/backend lives behind it.
 */
import { getRepository } from "./projectRepository";

/** OPFS is required to *persist* samples; feature-detect so import can degrade. */
export function audioStorageAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
}

/** Store an audio blob; returns its content hash (used as the clip's `fileId`). */
export function putAudio(blob: Blob): Promise<string> {
  return getRepository().putSample(blob);
}

/** Read a sample back as an ArrayBuffer (ready for decodeAudioData). */
export function getAudioBuffer(id: string): Promise<ArrayBuffer> {
  return getRepository().getSample(id);
}
