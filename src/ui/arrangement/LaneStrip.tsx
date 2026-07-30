/**
 * One track's arrangement lane, as a strip (MOBILE-1).
 *
 * The touch shell shows one surface at a time, so editing a clip would otherwise mean
 * losing sight of where it sits in the song. This pins the selected track's own lane
 * above every workspace: same bar grid, same zoom, same scroll offset and same playhead
 * as the Arrangement tab, so the two read as one timeline seen through two windows.
 *
 * It reuses `Lane` rather than redrawing placements, so tapping, dragging, resizing and
 * splitting a clip behave exactly as they do in the full arrangement - there is no second
 * implementation of a lane to keep in step.
 *
 * The track's identity sits in a slim title row *above* the lane rather than in a header
 * column beside it: a column costs the same absolute pixels here as in the arrangement,
 * and this strip is one row tall, so those pixels are better spent on the lane. The row
 * carries the two per-track controls worth reaching for while editing - a record button
 * (audio tracks, where a take is a mic capture) and the track's gain.
 */
import { useRef, useState } from "react";
import type { ProjectStore, Track } from "../../audio/project/projectStore";
import type { Scheduler } from "../../audio/sequencer/scheduler";
import type { Recorder } from "../../audio/recording/recorder";
import type { Dispatch } from "../../audio/commands/types";
import type { Placement } from "../../audio/project/types";
import { useProject } from "../../audio/project/useProject";
import { useRecorder } from "../useRecorder";
import { beatsPerBar as beatsPerBarOf } from "../../audio/project/schema";
import { useAnimationFrame } from "../useAnimationFrame";
import { Fader } from "../MixerControls";
import { Lane } from "./Lane";
import { beatToX } from "../timeline/timeGrid";
import { usePersistentBoolean, usePersistentNumber } from "../usePersistent";
import { useSharedGridScroll } from "./useSharedGridScroll";
import { TRAIL_BEATS, ZOOM, type Selection } from "./shared";

export function LaneStrip({
  track,
  projectStore,
  scheduler,
  recorder,
  dispatch,
}: {
  track: Track;
  projectStore: ProjectStore;
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
}) {
  const project = useProject(projectStore);
  const rec = useRecorder(recorder);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [dropBeat, setDropBeat] = useState<number | null>(null);

  // The same persisted view settings the Arrangement tab reads, so the strip is the same
  // grid rather than a lookalike.
  const [pxPerBeat] = usePersistentNumber("web-daw:arr-zoom", 24, ZOOM.min, ZOOM.max);
  const [snapOn] = usePersistentBoolean("web-daw:arr-snap-on", true);
  const [snapDiv] = usePersistentNumber("web-daw:arr-snap-div", 1, 0.5, 4);
  useSharedGridScroll(scrollRef, pxPerBeat);

  const beatsPerBar = beatsPerBarOf(project.timeSignature);
  // Width is measured over *every* track's content, not just this one, so the strip and
  // the full arrangement scroll through an identical range - a shorter strip would make a
  // shared offset point past its own end.
  const arrangedEnd = Math.max(
    project.lengthBeats,
    ...project.tracks.flatMap((candidate) =>
      candidate.placements.map((placement) => placement.startBeat + placement.length),
    ),
    0,
  );
  const laneWidth = beatToX(arrangedEnd + TRAIL_BEATS, pxPerBeat);
  const recording = rec.status === "recording" || rec.status === "counting";

  useAnimationFrame(() => {
    const el = playheadRef.current;
    if (!el) return;
    el.style.transform = `translateX(${beatToX(scheduler.getPositionBeats(), pxPerBeat)}px)`;
    el.style.opacity = scheduler.isPlaying ? "1" : "0";
  }, [scheduler, pxPerBeat]);

  // Tapping a placement makes its clip the active one, so the editor beside/below the
  // strip follows it. No paste marker here - that is an Arrangement-tab gesture.
  const selectPlacement = (trackId: string, placement: Placement) => {
    setSelection({ trackId, id: placement.id });
    projectStore.selectClip(trackId, placement.clipId);
  };

  return (
    <div className="shrink-0 flex flex-col border-b border-line bg-panel" data-testid="lane-strip">
      <div className="flex items-center gap-2 h-7 px-2 border-b border-line-soft">
        {track.kind === "audio" && (
          <button
            type="button"
            onClick={() => recorder.recordInto(track.id)}
            aria-label={recording ? "Stop recording" : "Record into this track"}
            title={recording ? "Stop recording" : "Record a new take into this track"}
            className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-full border cursor-pointer ${
              recording ? "bg-claude border-claude" : "border-claude/60 hover:bg-claude/20"
            }`}
          >
            <span className={`w-2 h-2 rounded-full bg-claude ${recording ? "bg-ground animate-pulse" : ""}`} />
          </button>
        )}
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-bright" title={track.name}>
          {track.name}
        </span>
        <Fader
          value={track.volume}
          title="Track gain"
          width={64}
          onChange={(volume) => dispatch({ type: "setTrack", trackId: track.id, volume })}
        />
      </div>
      <div ref={scrollRef} data-testid="lane-strip-scroll" className="relative overflow-x-auto">
        <div className="relative" style={{ width: laneWidth }}>
          <Lane
            track={track}
            width={laneWidth}
            pxPerBeat={pxPerBeat}
            beatsPerBar={beatsPerBar}
            snapOn={snapOn}
            snapDiv={snapDiv}
            selection={selection}
            markerBeat={null}
            dropBeat={dropBeat}
            onSelect={selectPlacement}
            onMark={() => setSelection(null)}
            onHover={setDropBeat}
            dispatch={dispatch}
            projectStore={projectStore}
          />
          <div
            ref={playheadRef}
            className="absolute top-0 bottom-0 left-0 w-0.5 bg-you pointer-events-none opacity-0 z-10"
          />
        </div>
      </div>
    </div>
  );
}
