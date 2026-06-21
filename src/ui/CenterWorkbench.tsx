/**
 * The center workbench: everything about the selected track in one focused
 * surface. The instrument + effect chain form a compact, horizontally-scrolling
 * signal strip up top; the clip's MIDI fills the rest and is always visible.
 */
import type { ProjectStore, Track } from '../audio/project/projectStore';
import type { Scheduler } from '../audio/sequencer/scheduler';
import { InstrumentPanel } from './InstrumentPanel';
import { EffectChain } from './EffectChain';
import { PianoRoll } from './PianoRoll';

export function CenterWorkbench({
  projectStore,
  scheduler,
  selectedTrack,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  selectedTrack: Track | undefined;
}) {
  if (!selectedTrack) {
    return (
      <div className="[grid-area:center] bg-center flex flex-col min-w-0 min-h-0">
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          No track selected. Add an instrument from the library.
        </div>
      </div>
    );
  }

  return (
    <div className="[grid-area:center] bg-center flex flex-col min-w-0 min-h-0">
      <div className="flex items-center gap-2.5 h-12 px-4 border-b border-line shrink-0">
        <span className="w-2 h-2 rounded-full bg-you" />
        <span className="font-semibold text-sm text-bright">{selectedTrack.name}</span>
        <span className="font-mono text-[10.5px] text-faint">{selectedTrack.instrumentType}</span>
      </div>

      <div className="shrink-0 border-b border-line overflow-x-auto" key={`${selectedTrack.id}:dev`}>
        <div className="flex items-stretch gap-2 p-3 min-w-max">
          <InstrumentPanel params={selectedTrack.params} instrumentType={selectedTrack.instrumentType} />
          <EffectChain projectStore={projectStore} trackId={selectedTrack.id} />
        </div>
      </div>

      <div className="flex-1 min-h-0 p-3" key={`${selectedTrack.id}:roll`}>
        <PianoRoll clipStore={selectedTrack.clip} scheduler={scheduler} />
      </div>
    </div>
  );
}
