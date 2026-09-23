/**
 * A clip's portable content: what a copy carries so a paste can recreate it on another track.
 * Notes come from the live clip store, so an unsaved edit is copied as it looks.
 */
import type { ProjectStore } from "../audio/project/projectStore";
import type { ClipContent } from "../audio/project/types";

export function clipContentOf(projectStore: ProjectStore, trackId: string, clipId: string): ClipContent | null {
  const track = projectStore.getTrack(trackId);
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  if (!track || !clip) return null;
  if (track.kind === "instrument") {
    const store = projectStore.getClipStore(trackId, clipId);
    if (!store) return null;
    const data = store.getClip();
    return {
      kind: "instrument",
      name: clip.name,
      notes: data.notes.map((note) => ({ ...note })),
      lengthBeats: data.lengthBeats,
    };
  }
  return "fileId" in clip
    ? { kind: "audio", name: clip.name, fileId: clip.fileId, gain: clip.gain, durationSec: clip.durationSec }
    : null;
}
