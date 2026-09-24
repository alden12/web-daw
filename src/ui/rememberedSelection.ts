/**
 * The track you last had selected in each project, remembered on this device.
 *
 * Selecting a track is navigation, not an edit (`selectTrack` is a NonEditType), so it never reaches
 * the server: a reload opened on whatever selection the server's copy last had - usually the track
 * most recently created, by you, a collaborator or the agent. Which track you are looking at is yours
 * rather than the project's, so it is kept here, per project, and put back when the project loads.
 */
import { useEffect } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import { readPersistent, writePersistent } from "./persistentStore";

const keyFor = (projectId: string) => `corrente:selected-track:${projectId}`;

/** Select the track last selected in `projectId` on this device, if it is still there. */
export function restoreSelection(projectId: string, store: ProjectStore): void {
  const remembered = readPersistent(keyFor(projectId));
  if (remembered && store.getTrack(remembered)) store.selectTrack(remembered);
}

/** Remember `trackId` as the selection in `projectId`. */
export function rememberSelection(projectId: string, trackId: string): void {
  writePersistent(keyFor(projectId), trackId);
}

/**
 * Put back the remembered selection when `projectId` finishes loading into `store`, then keep
 * remembering it. `projectId` is the project the store holds (null while none has loaded).
 */
export function useRememberedSelection(
  projectId: string | null,
  store: ProjectStore,
  selectedTrackId: string | null,
): void {
  // Restore first: effects run in order, so the remembering below sees the restored selection on
  // the render after, rather than overwriting it with the one the project loaded with.
  useEffect(() => {
    if (projectId) restoreSelection(projectId, store);
  }, [projectId, store]);

  useEffect(() => {
    if (projectId && selectedTrackId) rememberSelection(projectId, selectedTrackId);
  }, [projectId, selectedTrackId]);
}
