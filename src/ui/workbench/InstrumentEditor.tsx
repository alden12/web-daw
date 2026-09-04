/**
 * The note editor for an instrument track: the editing surface, under a drum-mode toggle
 * on kit tracks only. The clip's name lives in the clip rail beside this, which is also
 * where it is renamed. A drum-kit track can be edited as a pad x step grid
 * ("Pads") or the drum-labelled piano roll ("Keys"), remembered per track; every
 * other instrument is the plain piano roll. All three drive the same note clip.
 *
 * Extracted from CenterWorkbench when the touch shell gave the editor its own tab
 * (MOBILE-1); the behaviour is unchanged.
 */
import type { InstrumentTrack, ProjectStore } from "../../audio/project/projectStore";
import type { Scheduler } from "../../audio/sequencer/scheduler";
import type { Recorder } from "../../audio/recording/recorder";
import type { Dispatch } from "../../audio/commands/types";
import type { SampleAsset } from "../../audio/samples/catalog";
import { usePersistentString } from "../usePersistent";
import { PianoRoll } from "../PianoRoll";
import { DrumRoll } from "../DrumRoll";
import { StepGrid } from "../StepGrid";

/** The two editor surfaces a drum-kit track offers over its one note clip. */
export type DrumEditor = "pads" | "keys";
const DRUM_EDITORS: readonly DrumEditor[] = ["keys", "pads"];
const DRUM_EDITOR_LABEL: Record<DrumEditor, string> = { pads: "Pads", keys: "Keys" };

/** A little Pads | Keys segmented toggle: pick the step grid or the piano roll. */
function DrumEditorToggle({ mode, onChange }: { mode: DrumEditor; onChange: (mode: DrumEditor) => void }) {
  return (
    <div className="ml-auto inline-flex items-center rounded-md border border-line overflow-hidden" role="group">
      {DRUM_EDITORS.map((editor) => (
        <button
          key={editor}
          type="button"
          aria-pressed={mode === editor}
          onClick={() => onChange(editor)}
          className={`font-mono text-[10.5px] px-2 py-0.5 cursor-pointer ${
            mode === editor ? "bg-you/20 text-you" : "text-muted hover:text-ink"
          }`}
        >
          {DRUM_EDITOR_LABEL[editor]}
        </button>
      ))}
    </div>
  );
}

export function InstrumentEditor({
  track,
  samples,
  scheduler,
  recorder,
  dispatch,
  projectStore,
  compact = false,
}: {
  track: InstrumentTrack;
  samples: SampleAsset[];
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
  projectStore: ProjectStore;
  /** Touch layout: the roll hands its toolbar to the shell's ⋮ (MOBILE-1). */
  compact?: boolean;
}) {
  const isDrumkit = track.instrumentType === "drumkit";
  const [mode, setMode] = usePersistentString<DrumEditor>(`web-daw:drum-editor:${track.id}`, "keys", DRUM_EDITORS);
  const active = track.clips.find((clip) => clip.id === track.activeClipId) ?? track.clips[0];

  return (
    <div className="flex-1 min-w-0 min-h-0 p-3 flex flex-col gap-2">
      {/* No clip name here: the clip rail beside this already names the active clip and is
          where you rename it, so a second copy only cost a row of vertical space. */}
      {isDrumkit && (
        <div className="shrink-0 flex items-center gap-2">
          <DrumEditorToggle mode={mode} onChange={setMode} />
        </div>
      )}
      {/* Key by the active clip so the surface remounts (re-fits, resets selection) on switch. */}
      <div className="flex-1 min-h-0">
        {isDrumkit && mode === "pads" ? (
          <StepGrid
            key={active.id}
            clipStore={active.store}
            params={track.params}
            trackId={track.id}
            clipId={active.id}
            samples={samples}
            scheduler={scheduler}
            dispatch={dispatch}
          />
        ) : isDrumkit ? (
          <DrumRoll
            key={active.id}
            clipStore={active.store}
            params={track.params}
            trackId={track.id}
            clipId={active.id}
            samples={samples}
            scheduler={scheduler}
            recorder={recorder}
            dispatch={dispatch}
            projectStore={projectStore}
          />
        ) : (
          <PianoRoll
            key={active.id}
            clipStore={active.store}
            scheduler={scheduler}
            recorder={recorder}
            trackId={track.id}
            clipId={active.id}
            dispatch={dispatch}
            projectStore={projectStore}
            compact={compact}
          />
        )}
      </div>
    </div>
  );
}
