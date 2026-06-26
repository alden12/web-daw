/**
 * Drag-and-drop wire format for placing a clip from the clip rail onto a track's
 * arrangement lane - including onto a *different* same-kind track. The clip id
 * travels as the payload (the fast path when dropping on the source track, where
 * the clip already exists); a per-kind marker type lets any same-kind lane accept
 * during dragover (when the payload is still hidden). The dragged clip's portable
 * content rides a module variable so a cross-track drop can copy it into the
 * target's pool. Shared by ClipRail (source) and the arrangement Lane (target).
 */
import type { ClipContent } from "../audio/project/types";
import type { TrackKind } from "../audio/project/types";

export const CLIP_DND_TYPE = "application/x-daw-clip";

export const clipDndKindType = (kind: TrackKind) => `application/x-daw-clip-kind-${kind}`;

let dragged: ClipContent | null = null;

export const setDraggedClip = (content: ClipContent): void => {
  dragged = content;
};

export const getDraggedClip = (): ClipContent | null => dragged;

export const clearDraggedClip = (): void => {
  dragged = null;
};
