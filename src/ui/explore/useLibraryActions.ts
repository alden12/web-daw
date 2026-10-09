/**
 * What taking something from the library does, shared by Explore (COMM-1.9.1) and the search
 * results view: each pick is one authored edit, or a short run of them.
 *
 * **Audition by default.** Picking an instrument or patch applies it to the selected instrument
 * track, so you hear it on your part; the "+" beside it adds a new track instead. With no
 * instrument track selected (none yet, or an audio track is), both add a new track.
 */
import type { ProjectStore } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import { newEffectId, newMidiDeviceId, newTrackId } from "../../audio/commands/ids";
import type { Patch } from "../../audio/patches/library";
import { assetRef } from "../../audio/samples/catalog";
import { useProject } from "../../audio/project/useProject";

/**
 * A patch's chains with fresh ids. Minted here and carried in the command, so undo/redo and
 * history replay reproduce the same track exactly.
 */
const patchChains = (patch: Patch) => ({
  name: patch.name,
  instrumentType: patch.instrumentType,
  params: patch.params,
  midiDevices: (patch.midiDevices ?? []).map((device) => ({
    id: newMidiDeviceId(),
    type: device.type,
    bypassed: device.bypassed,
    params: device.params,
  })),
  effects: patch.effects.map((effect) => ({
    id: newEffectId(),
    type: effect.type,
    bypassed: effect.bypassed,
    params: effect.params,
  })),
});

export type LibraryActions = ReturnType<typeof useLibraryActions>;

export function useLibraryActions(projectStore: ProjectStore, dispatch: Dispatch) {
  const project = useProject(projectStore);
  const selectedInstrumentTrack = project.tracks.find(
    (track) => track.id === project.selectedTrackId && track.kind === "instrument",
  );

  const addInstrument = (type: string) => dispatch({ type: "createTrack", instrumentType: type, id: newTrackId() });
  const addPatch = (patch: Patch) =>
    dispatch({ type: "createTrackFromPatch", id: newTrackId(), ...patchChains(patch) });

  return {
    addInstrument,
    addPatch,
    applyInstrument: (type: string) =>
      selectedInstrumentTrack
        ? dispatch({ type: "setInstrument", trackId: selectedInstrumentTrack.id, instrumentType: type })
        : addInstrument(type),
    applyPatch: (patch: Patch) =>
      selectedInstrumentTrack
        ? dispatch({ type: "applyPatch", trackId: selectedInstrumentTrack.id, ...patchChains(patch) })
        : addPatch(patch),
    addEffect: (type: string) => {
      const hostId = projectStore.selectedId;
      if (hostId) dispatch({ type: "addEffect", hostId, effectType: type, id: newEffectId() });
    },
    addMidiDevice: (type: string) => {
      const trackId = projectStore.selectedId;
      if (trackId) dispatch({ type: "addMidiDevice", trackId, deviceType: type, id: newMidiDeviceId() });
    },
    /** A Sampler track preloaded with a project sample (mirrors picking an instrument). */
    addSamplerTrack: (assetId: string) => {
      const id = newTrackId();
      dispatch({ type: "createTrack", instrumentType: "sampler", id });
      dispatch({ type: "setParam", trackId: id, id: "sampler.sample", value: assetRef(assetId) });
    },
  };
}
