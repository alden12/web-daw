/**
 * A module-level clipboard for copied clip content, shared across ClipRail
 * instances. The rail remounts when the selected track changes, so a component
 * ref could not carry a copied clip from one track to another - this module
 * outlives those remounts, enabling copy/paste of clips across same-kind tracks.
 * Exposed as get/set functions (not a mutable export) so components never write
 * module state directly.
 */
import type { ClipContent } from "../audio/project/types";

let clipboard: ClipContent | null = null;

export const setClipClipboard = (content: ClipContent): void => {
  clipboard = content;
};

export const getClipClipboard = (): ClipContent | null => clipboard;
