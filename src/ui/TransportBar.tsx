/**
 * Transport controls: play/stop the scheduler and edit the project tempo. Tempo
 * is read/written through the project store, so MCP and the UI stay in sync.
 */
import type { ProjectStore } from '../audio/project/projectStore';
import type { Scheduler } from '../audio/sequencer/scheduler';
import type { Dispatch } from '../audio/commands/types';
import { useProject } from '../audio/project/useProject';

export function TransportBar({
  projectStore,
  scheduler,
  dispatch,
  isPlaying,
  started,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  dispatch: Dispatch;
  isPlaying: boolean;
  started: boolean;
}) {
  const project = useProject(projectStore);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={!started}
        onClick={() => (isPlaying ? scheduler.stop() : scheduler.play())}
        className="font-mono text-[13px] min-w-18 px-3 py-1.5 rounded-lg text-you bg-you/15 border border-you/45 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPlaying ? '■ Stop' : '▶ Play'}
      </button>
      <label className="inline-flex items-center gap-2 font-mono text-xs text-muted">
        Tempo
        <input
          type="number"
          min={20}
          max={300}
          value={project.tempoBpm}
          onChange={(e) => dispatch({ type: 'setTempo', bpm: Number(e.target.value) })}
          className="w-14 font-mono text-[13px] px-1.5 py-1 rounded-md border border-line bg-ground text-bright"
        />
        BPM
      </label>
    </div>
  );
}
