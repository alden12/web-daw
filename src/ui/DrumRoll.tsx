/**
 * The drum piano-roll: the same PianoRoll every instrument uses, but with its rows
 * mapped to the kit's pads - so instead of "C1 / C#1 / D1" the rows read as the
 * loaded pad names ("Kick / Snare / Hat"), loaded pads are tinted, and it frames to
 * the pad range. It edits the exact same note clip as the step grid (a hit is a note
 * at the pad's pitch), so a pattern drawn here and one drawn in the grid are identical
 * data - the two are just different editors over the same clip.
 */
import { useMemo } from "react";
import type { ClipStore } from "../audio/sequencer/clipStore";
import type { ParamStore } from "../audio/params/store";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Recorder } from "../audio/recording/recorder";
import type { Dispatch } from "../audio/commands/types";
import type { ProjectStore } from "../audio/project/projectStore";
import type { SampleAsset } from "../audio/samples/catalog";
import { DRUMKIT_BASE_NOTE, DRUMKIT_PADS } from "../audio/instruments/catalog";
import { refLabel } from "../audio/samples/catalog";
import { PianoRoll, type RollRows } from "./PianoRoll";
import { pitchName } from "./noteNames";
import { usePads } from "./useDrumPads";

export function DrumRoll({
  clipStore,
  params,
  trackId,
  samples,
  scheduler,
  recorder,
  dispatch,
  projectStore,
}: {
  clipStore: ClipStore;
  params: ParamStore;
  trackId: string;
  samples: SampleAsset[];
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
  projectStore?: ProjectStore;
}) {
  const pads = usePads(params);
  const rows = useMemo<RollRows>(() => {
    // Loaded pads keyed by their assigned note, so a pitch resolves to a pad (and its
    // drum name) in one lookup. If two pads share a note the later wins the row label.
    const loaded = pads.filter((pad) => pad.ref !== "" && pad.ref !== "none");
    const byNote = new Map(loaded.map((pad) => [pad.note, pad]));
    const assigned = loaded.map((pad) => pad.note);
    const drumName = (pitch: number) => {
      const pad = byNote.get(pitch);
      return pad ? refLabel(pad.ref, samples) : null;
    };
    return {
      // Gutter reads "C4 Kick": the note it is assigned to, then the drum on it.
      label: (pitch) => {
        const name = drumName(pitch);
        return name ? `${pitchName(pitch)} ${name}` : null;
      },
      highlight: (pitch) => byNote.has(pitch),
      // Reserve a left column so the pad names sit beside the notes, not over them.
      gutter: 92,
      // Frame to the assigned notes (fall back to the default pad range when empty).
      frame: {
        lo: assigned.length ? Math.min(...assigned) : DRUMKIT_BASE_NOTE,
        hi: assigned.length ? Math.max(...assigned) : DRUMKIT_BASE_NOTE + DRUMKIT_PADS - 1,
      },
    };
  }, [pads, samples]);

  return (
    <PianoRoll
      clipStore={clipStore}
      scheduler={scheduler}
      recorder={recorder}
      trackId={trackId}
      dispatch={dispatch}
      projectStore={projectStore}
      rows={rows}
    />
  );
}
