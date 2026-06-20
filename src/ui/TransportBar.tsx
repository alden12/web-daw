/**
 * Transport controls: play/stop the scheduler and edit the project tempo. Tempo
 * is read/written through the project store, so MCP and the UI stay in sync.
 */
import type { ProjectStore } from '../audio/project/projectStore';
import type { Scheduler } from '../audio/sequencer/scheduler';
import { useProject } from '../audio/project/useProject';

export function TransportBar({
  projectStore,
  scheduler,
  isPlaying,
  started,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  isPlaying: boolean;
  started: boolean;
}) {
  const project = useProject(projectStore);

  return (
    <div className="transport">
      <button
        type="button"
        className="transport-btn"
        disabled={!started}
        onClick={() => (isPlaying ? scheduler.stop() : scheduler.play())}
      >
        {isPlaying ? '■ Stop' : '▶ Play'}
      </button>
      <label className="tempo">
        Tempo
        <input
          type="number"
          min={20}
          max={300}
          value={project.tempoBpm}
          onChange={(e) => projectStore.setTempo(Number(e.target.value))}
        />
        BPM
      </label>
      {!started && <span className="transport-hint">Start audio to play</span>}
    </div>
  );
}
