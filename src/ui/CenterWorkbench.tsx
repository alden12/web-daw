/**
 * The center workbench: everything about the selected track in one focused
 * surface. For an instrument track, the instrument + effect chain form a compact
 * horizontally-scrolling signal strip up top and the clip's MIDI fills the rest.
 * For an audio track, an audio-clip panel takes the place of the instrument +
 * piano roll; the effect chain is shared (audio tracks have inserts too).
 */
import { useRef } from 'react';
import type { ProjectStore, Track, AudioTrack } from '../audio/project/projectStore';
import type { Scheduler } from '../audio/sequencer/scheduler';
import type { Dispatch } from '../audio/commands/types';
import { InstrumentPanel } from './InstrumentPanel';
import { EffectChain } from './EffectChain';
import { PianoRoll } from './PianoRoll';
import { VariantStrip } from './VariantStrip';
import { ResizeHandle } from './ResizeHandle';
import { usePersistentNumber } from './usePersistent';

function AudioClipPanel({ track, dispatch }: { track: AudioTrack; dispatch: Dispatch }) {
  const clip = track.clips.find((c) => c.id === track.activeClipId) ?? track.clips[0];
  if (!clip) return <div className="flex-1 min-h-0 p-3 text-muted text-sm">No audio clip.</div>;
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
            <span className="font-mono text-[10.5px] text-faint">Place it on the timeline below; drag to position.</span>
            <label className="inline-flex items-center gap-2 font-mono text-[11px] text-muted ml-auto">
              Gain
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={clip.gain}
                onChange={(e) => dispatch({ type: 'setAudioClip', trackId: track.id, clipId: clip.id, patch: { gain: Number(e.target.value) } })}
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
  // The instrument+effects rack is a resizable, wrapping panel above the roll.
  const [deviceH, setDeviceH] = usePersistentNumber('web-daw:devices-height', 168, 80, 620);
  const deviceRef = useRef<HTMLDivElement>(null);

  if (!selectedTrack) {
    return (
      <div className="[grid-area:center] bg-center flex flex-col min-w-0 min-h-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          No track selected. Add an instrument or import audio from the library.
        </div>
      </div>
    );
  }

  const kindLabel = selectedTrack.kind === 'audio' ? 'audio' : selectedTrack.instrumentType;

  return (
    <div className="[grid-area:center] bg-center flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="flex items-center gap-2.5 h-12 px-4 border-b border-line shrink-0">
        <span className="w-2 h-2 rounded-full bg-you" />
        <span className="font-semibold text-sm text-bright">{selectedTrack.name}</span>
        <span className="font-mono text-[10.5px] text-faint">{kindLabel}</span>
      </div>

      {/* device rack: fixed (resizable) height, wraps to fill the width */}
      <div ref={deviceRef} className="relative shrink-0 flex flex-col border-b border-line" style={{ height: deviceH }} key={`${selectedTrack.id}:dev`}>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-wrap items-stretch gap-2 p-3">
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
        <ResizeHandle
          ariaLabel="Resize devices"
          orientation="horizontal"
          onResize={(y) => setDeviceH(y - (deviceRef.current?.getBoundingClientRect().top ?? 0))}
          style={{ left: 0, right: 0, bottom: 0 }}
        />
      </div>

      {selectedTrack.kind === 'instrument' ? (
        <div className="flex-1 min-h-0 flex" key={`${selectedTrack.id}:roll`}>
          <VariantStrip projectStore={projectStore} trackId={selectedTrack.id} dispatch={dispatch} orientation="vertical" />
          <div className="flex-1 min-w-0 min-h-0 p-3">
            {(() => {
              const active = selectedTrack.clips.find((c) => c.id === selectedTrack.activeClipId) ?? selectedTrack.clips[0];
              // Key by the active clip so the roll remounts (re-fits, resets selection) on switch.
              return (
                <PianoRoll
                  key={active.id}
                  clipStore={active.store}
                  scheduler={scheduler}
                  trackId={selectedTrack.id}
                  dispatch={dispatch}
                />
              );
            })()}
          </div>
        </div>
      ) : (
        <AudioClipPanel track={selectedTrack} dispatch={dispatch} key={`${selectedTrack.id}:audio`} />
      )}
    </div>
  );
}
