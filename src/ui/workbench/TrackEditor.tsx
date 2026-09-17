/**
 * The editing surface for whichever track is selected - the piano roll / pad grid for
 * an instrument, the audio-clip panel for audio. One component so both shells host the
 * same thing: the desktop workbench puts it beside the clip rail and above the device
 * rack, the touch shell gives it a whole tab (MOBILE-1).
 *
 * Reads the project values the audio panel needs (tempo, meter, loop region) from the
 * store itself rather than making every caller thread them through.
 */
import type { ProjectStore, Track } from "../../audio/project/projectStore";
import type { Scheduler } from "../../audio/sequencer/scheduler";
import type { Recorder } from "../../audio/recording/recorder";
import type { Dispatch } from "../../audio/commands/types";
import { useProject } from "../../audio/project/useProject";
import { InstrumentEditor } from "./InstrumentEditor";
import { AudioClipPanel } from "./AudioClipPanel";

export function TrackEditor({
  track,
  scheduler,
  recorder,
  dispatch,
  projectStore,
  compact = false,
}: {
  track: Track;
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
  projectStore: ProjectStore;
  /** Touch layout: the editor hands its toolbar to the shell's ⋮ (MOBILE-1). */
  compact?: boolean;
}) {
  const project = useProject(projectStore);

  if (track.kind === "instrument")
    return (
      <InstrumentEditor
        key={track.id}
        track={track}
        samples={project.samples}
        scheduler={scheduler}
        recorder={recorder}
        dispatch={dispatch}
        projectStore={projectStore}
        compact={compact}
      />
    );

  return (
    <AudioClipPanel
      track={track}
      scheduler={scheduler}
      tempoBpm={project.tempoBpm}
      timeSignature={project.timeSignature}
      loopStart={project.loopStart}
      loopLength={project.lengthBeats - project.loopStart}
      dispatch={dispatch}
    />
  );
}
