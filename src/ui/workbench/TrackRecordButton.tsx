/**
 * Record a new take into one track (arms it first); stops if already recording. Audio
 * tracks capture the mic; instrument tracks capture live MIDI notes.
 *
 * Lives beside the clip list - the clip rail's footer on desktop, the Clips tab on
 * touch - because a take arrives as a new clip.
 */
import type { Recorder } from "../../audio/recording/recorder";

export function TrackRecordButton({
  trackId,
  recorder,
  recording,
}: {
  trackId: string;
  recorder: Recorder;
  recording: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => recorder.recordInto(trackId)}
      title={recording ? "Stop recording" : "Record a new take into this track"}
      className={`w-full inline-flex items-center justify-center gap-1.5 font-mono text-[11px] px-2 py-1 rounded-md border cursor-pointer ${
        recording ? "text-claude bg-claude/15 border-claude/55" : "text-claude/85 border-claude/40 hover:bg-claude/10"
      }`}
    >
      <span className={`w-2.5 h-2.5 rounded-full bg-current ${recording ? "animate-pulse" : ""}`} />
      {recording ? "Stop" : "Rec"}
    </button>
  );
}
