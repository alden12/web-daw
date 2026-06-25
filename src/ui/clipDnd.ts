/**
 * Drag-and-drop wire format for placing a clip from the clip rail onto a track's
 * arrangement lane. The clip id travels as the payload; a per-track marker type
 * lets a lane accept only its own track's clips during dragover (when the payload
 * data is still hidden by the browser). Shared by ClipRail (source) and the
 * arrangement Lane (target).
 */
export const CLIP_DND_TYPE = 'application/x-daw-clip';

export const clipDndTrackType = (trackId: string) => `application/x-daw-clip-track-${trackId.toLowerCase()}`;
