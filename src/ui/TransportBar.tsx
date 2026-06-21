/**
 * Transport controls: play/stop the scheduler and edit the tempo. Tempo is read
 * and written through the clip store, so MCP and the UI stay in sync.
 */
import type { ClipStore } from '../audio/sequencer/clipStore';
import type { Scheduler } from '../audio/sequencer/scheduler';
import { useClip } from '../audio/sequencer/useClip';

export function TransportBar({
  clipStore,
  scheduler,
  isPlaying,
  started,
}: {
  clipStore: ClipStore;
  scheduler: Scheduler;
  isPlaying: boolean;
  started: boolean;
}) {
  const clip = useClip(clipStore);

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
          value={clip.tempoBpm}
          onChange={(e) => clipStore.setTempo(Number(e.target.value))}
        />
        BPM
      </label>
      {!started && <span className="transport-hint">Start audio to play</span>}
    </div>
  );
}
