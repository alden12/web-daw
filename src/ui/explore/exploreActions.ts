/**
 * What each kind of Explore item does when you take it, keyed by its source (the `ItemSource`
 * kinds), so a new kind of item is one entry per map rather than a branch in the row.
 */
import type { ItemSource } from "./exploreItems";
import type { LibraryActions } from "./useLibraryActions";

type Handlers<Result> = {
  [Kind in ItemSource["kind"]]: (source: Extract<ItemSource, { kind: Kind }>, actions: LibraryActions) => Result;
};

/** The row's primary tap: audition it on the selected track (see `useLibraryActions`). */
const PICK: Handlers<void> = {
  instrument: (source, actions) => actions.applyInstrument(source.type),
  patch: (source, actions) => actions.applyPatch(source.patch),
  effect: (source, actions) => actions.addEffect(source.type),
  midi: (source, actions) => actions.addMidiDevice(source.type),
  sample: (source, actions) => actions.addSamplerTrack(source.id),
};

/** What the primary tap says it will do, for its tooltip and accessible description. */
export const PICK_HINT: Record<ItemSource["kind"], (name: string) => string> = {
  instrument: (name) => `Set the selected track to ${name}`,
  patch: (name) => `Apply "${name}" to the selected track`,
  effect: (name) => `Add ${name} to the selected track`,
  midi: (name) => `Add ${name} to the selected track`,
  sample: (name) => `Add a Sampler track playing "${name}"`,
};

/** The "+": a new track, for the kinds that make one. Effects and samples have no second action. */
const ADD_TRACK: Partial<Handlers<void>> = {
  instrument: (source, actions) => actions.addInstrument(source.type),
  patch: (source, actions) => actions.addPatch(source.patch),
};

export const pickItem = (source: ItemSource, actions: LibraryActions) =>
  (PICK[source.kind] as (source: ItemSource, actions: LibraryActions) => void)(source, actions);

/** `undefined` when the item has no add-as-a-new-track action. */
export const addTrackFor = (source: ItemSource, actions: LibraryActions) => {
  const add = ADD_TRACK[source.kind] as ((source: ItemSource, actions: LibraryActions) => void) | undefined;
  return add && (() => add(source, actions));
};
