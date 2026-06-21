/**
 * The center workbench: everything about the selected track in one focused
 * surface. For an instrument track, the instrument + effect chain form a compact
 * horizontally-scrolling signal strip up top and the clip's MIDI fills the rest.
 * For an audio track, an audio-clip panel takes the place of the instrument +
 * piano roll; the effect chain is shared (audio tracks have inserts too).
 */
import type { ProjectStore, Track, AudioTrack } from '../audio/project/projectStore';
import type { Scheduler } from '../audio/sequencer/scheduler';
import type { Dispatch } from '../audio/commands/types';
import { InstrumentPanel } from './InstrumentPanel';
import { EffectChain } from './EffectChain';
import { PianoRoll } from './PianoRoll';

function AudioClipPanel({ track, dispatch }: { track: AudioTrack; dispatch: Dispatch }) {
  const clip = track.audioClip;
  return (
    <div className="flex-1 min-h-0 p-3">
      <div className="h-full flex flex-col rounded-lg border border-line bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-3 py-2 border-b border-line">
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">Audio clip</span>
          <span className="font-mono text-[12.5px] text-bright truncate">{clip.name}</span>
          {clip.durationSec > 0 && (
            <span className="ml-auto font-mono text-[10.5px] text-faint">{clip.durationSec.toFixed(2)}s</span>
          )}
        </div>
        <div className="flex-1 min-h-0 p-3 flex flex-col gap-3">
          {/* Region preview (waveform peaks are a follow-up; show a filled block). */}
          <div className="relative h-20 rounded bg-ground border border-line border-t-2 border-t-you overflow-hidden">
            <div className="absolute inset-y-0 left-0 right-0 bg-you/15" />
            <span className="absolute left-2 top-1.5 font-mono text-[10px] text-muted">{clip.name}</span>
          </div>
          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-2 font-mono text-[11px] text-muted">
              Start
              <input
                type="number"
                min={0}
                step={0.25}
                value={clip.startBeat}
                onChange={(e) => dispatch({ type: 'setAudioClip', trackId: track.id, patch: { startBeat: Number(e.target.value) } })}
                className="w-16 font-mono text-[12px] px-1.5 py-1 rounded-md border border-line bg-ground text-bright"
              />
              beats
            </label>
            <label className="inline-flex items-center gap-2 font-mono text-[11px] text-muted">
              Gain
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={clip.gain}
                onChange={(e) => dispatch({ type: 'setAudioClip', trackId: track.id, patch: { gain: Number(e.target.value) } })}
                className="w-28"
              />
              <span className="text-faint w-8">{clip.gain.toFixed(2)}</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CenterWorkbench({
  projectStore,
  scheduler,
  dispatch,
  selectedTrack,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  dispatch: Dispatch;
  selectedTrack: Track | undefined;
}) {
  if (!selectedTrack) {
    return (
      <div className="[grid-area:center] bg-center flex flex-col min-w-0 min-h-0">
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          No track selected. Add an instrument or import audio from the library.
        </div>
      </div>
    );
  }

  const kindLabel = selectedTrack.kind === 'audio' ? 'audio' : selectedTrack.instrumentType;

  return (
    <div className="[grid-area:center] bg-center flex flex-col min-w-0 min-h-0">
      <div className="flex items-center gap-2.5 h-12 px-4 border-b border-line shrink-0">
        <span className="w-2 h-2 rounded-full bg-you" />
        <span className="font-semibold text-sm text-bright">{selectedTrack.name}</span>
        <span className="font-mono text-[10.5px] text-faint">{kindLabel}</span>
      </div>

      <div className="shrink-0 border-b border-line overflow-x-auto" key={`${selectedTrack.id}:dev`}>
        <div className="flex items-stretch gap-2 p-3 min-w-max">
          {selectedTrack.kind === 'instrument' && (
            <InstrumentPanel
              params={selectedTrack.params}
              instrumentType={selectedTrack.instrumentType}
              trackId={selectedTrack.id}
              dispatch={dispatch}
            />
          )}
          <EffectChain projectStore={projectStore} trackId={selectedTrack.id} dispatch={dispatch} />
        </div>
      </div>

      {selectedTrack.kind === 'instrument' ? (
        <div className="flex-1 min-h-0 p-3" key={`${selectedTrack.id}:roll`}>
          <PianoRoll clipStore={selectedTrack.clip} scheduler={scheduler} trackId={selectedTrack.id} dispatch={dispatch} />
        </div>
      ) : (
        <AudioClipPanel track={selectedTrack} dispatch={dispatch} key={`${selectedTrack.id}:audio`} />
      )}
    </div>
  );
}
