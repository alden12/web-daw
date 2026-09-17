/**
 * The drum step sequencer: a pad x step grid for a drum-kit track, shown in the
 * workbench in place of the piano roll. Rows are the kit's loaded pads (a played note
 * selects a pad - see Drumkit.ts), columns are 16th-note steps across the clip. Click a
 * cell to toggle a hit; it writes the SAME note-clip model the piano roll and scheduler
 * use (one `addNote` / `removeNotes` edit per toggle), so a pattern is just notes -
 * playable, undoable, and editable either way. The step under the transport lights up as
 * it plays.
 *
 * Fully data-driven off the drumkit schema: the pad list (sample + assigned note) comes
 * from the track's `pad{n}.*` params, so it needs no per-kit code.
 */
import { useState } from "react";
import type { ClipStore } from "../audio/sequencer/clipStore";
import type { ParamStore } from "../audio/params/store";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Dispatch } from "../audio/commands/types";
import type { SampleAsset } from "../audio/samples/catalog";
import { GRID } from "../audio/sequencer/types";
import { useClip } from "../audio/sequencer/useClip";
import { newNoteId } from "../audio/commands/ids";
import { refLabel } from "../audio/samples/catalog";
import { usePads } from "./useDrumPads";
import { useAnimationFrame } from "./useAnimationFrame";

const STEP = GRID; // 16th-note steps
const STEPS_PER_BEAT = Math.round(1 / STEP);
const CELL = 20; // px, cell size

export function StepGrid({
  clipStore,
  params,
  trackId,
  clipId,
  samples,
  scheduler,
  dispatch,
}: {
  clipStore: ClipStore;
  params: ParamStore;
  trackId: string;
  clipId: string;
  samples: SampleAsset[];
  scheduler: Scheduler;
  dispatch: Dispatch;
}) {
  const clip = useClip(clipStore);
  const allPads = usePads(params);
  const [playStep, setPlayStep] = useState(-1);

  const steps = Math.max(1, Math.round(clip.lengthBeats / STEP));
  // Only show pads that have a sample loaded; each row's hits are notes at the pad's note.
  const pads = allPads.filter((pad) => pad.ref !== "" && pad.ref !== "none");

  const noteAt = (padNote: number, step: number) =>
    clip.notes.find((note) => note.pitch === padNote && Math.abs(note.start - step * STEP) < STEP / 2);

  const toggle = (padNote: number, step: number) => {
    const existing = noteAt(padNote, step);
    if (existing) {
      dispatch({ type: "removeNotes", trackId, clipId, ids: [existing.id] });
    } else {
      dispatch({
        type: "addNote",
        trackId,
        clipId,
        note: { id: newNoteId(), pitch: padNote, start: step * STEP, length: STEP, velocity: 0.85 },
      });
    }
  };

  // Follow the transport: re-render only when the current step changes (a few times a
  // second), not every frame. -1 when stopped.
  useAnimationFrame(() => {
    const next = scheduler.isPlaying
      ? Math.floor(((scheduler.getPositionBeats() % clip.lengthBeats) / STEP) % steps)
      : -1;
    setPlayStep((prev) => (prev === next ? prev : next));
  }, [scheduler, clip.lengthBeats, steps]);

  if (pads.length === 0) {
    return (
      <div className="flex-1 min-h-0 p-3 text-muted text-sm">
        This kit has no pads loaded. Add samples to its pads in the device rack below.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="inline-block min-w-full p-2">
        {pads.map((pad) => {
          const label = refLabel(pad.ref, samples);
          return (
            <div key={pad.index} className="flex items-center gap-1.5 mb-1">
              <span className="shrink-0 w-24 truncate text-right pr-2 font-mono text-[11px] text-muted" title={label}>
                {label}
              </span>
              <div className="flex">
                {Array.from({ length: steps }, (_unused, step) => {
                  const on = noteAt(pad.note, step) !== undefined;
                  const beatStart = step % STEPS_PER_BEAT === 0;
                  const playing = step === playStep;
                  return (
                    <div key={step} className={beatStart && step > 0 ? "ml-1.5" : ""}>
                      <button
                        type="button"
                        aria-label={`${label} step ${step + 1}`}
                        aria-pressed={on}
                        onClick={() => toggle(pad.note, step)}
                        style={{ width: `${CELL}px`, height: `${CELL}px` }}
                        className={`block mr-0.5 rounded-sm cursor-pointer ${
                          on ? "bg-you" : beatStart ? "bg-line/40 hover:bg-you/25" : "bg-ground hover:bg-you/25"
                        } ${playing ? "ring-1 ring-warn" : ""}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
