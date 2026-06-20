/**
 * The top-level DAW UI. Owns the project (tracks), the AudioEngine, and the
 * Scheduler; renders the track list and the selected track's instrument panel +
 * piano roll, plus transport; handles the audio-start gesture and computer-
 * keyboard input (to the selected track); restores/persists the project; and
 * bridges everything to MCP.
 */
import { useEffect, useState } from 'react';
import { ProjectStore } from '../audio/project/projectStore';
import { AudioEngine } from '../audio/engine/AudioEngine';
import { Scheduler } from '../audio/sequencer/scheduler';
import { connectMcpBridge, type McpStatus } from '../audio/mcp/bridge';
import { attachAutosave, restoreProject } from '../audio/persistence';
import { useProject } from '../audio/project/useProject';
import { TrackList } from './TrackList';
import { InstrumentPanel } from './InstrumentPanel';
import { EffectChain } from './EffectChain';
import { TransportBar } from './TransportBar';
import { PianoRoll } from './PianoRoll';

// Computer-keyboard -> MIDI note, one octave from C4 (the classic tracker layout).
const KEY_MAP: Record<string, number> = {
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66,
  g: 67, y: 68, h: 69, u: 70, j: 71, k: 72,
};

export function SynthPanel() {
  const [projectStore] = useState(() => new ProjectStore());
  const [engine] = useState(() => new AudioEngine());
  const [started, setStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scheduler] = useState(() => new Scheduler(engine, projectStore, setIsPlaying));
  const [mcpStatus, setMcpStatus] = useState<McpStatus>('connecting');

  const project = useProject(projectStore);
  const selectedTrack = project.selectedTrackId ? projectStore.getTrack(project.selectedTrackId) : undefined;

  // Restore the saved project, then autosave on any change (runs before the
  // bridge connects, so the first snapshot reflects the restored project).
  useEffect(() => {
    restoreProject(projectStore);
    return attachAutosave(projectStore);
  }, [projectStore]);

  useEffect(() => () => {
    scheduler.dispose();
    engine.dispose();
  }, [scheduler, engine]);

  useEffect(() => {
    const handle = connectMcpBridge({ projectStore, engine, scheduler }, { onStatus: setMcpStatus });
    return () => handle.dispose();
  }, [projectStore, engine, scheduler]);

  // Computer-keyboard plays the selected track's instrument (polyphonic).
  useEffect(() => {
    if (!started) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const midi = KEY_MAP[e.key.toLowerCase()];
      const id = projectStore.selectedId;
      if (midi !== undefined && id) engine.getInstrument(id)?.noteOn(midi);
    };
    const onUp = (e: KeyboardEvent) => {
      const midi = KEY_MAP[e.key.toLowerCase()];
      const id = projectStore.selectedId;
      if (midi !== undefined && id) engine.getInstrument(id)?.noteOff(midi);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [started, projectStore, engine]);

  const handleStart = async () => {
    await engine.start(projectStore);
    setStarted(true);
  };

  return (
    <div className="synth">
      <header className="synth-header">
        <h1>web-daw</h1>
        {started ? (
          <p className="hint">Selected track plays from keyboard row A-K (W, E, T, Y, U for sharps).</p>
        ) : (
          <button type="button" className="start" onClick={handleStart}>
            Start audio
          </button>
        )}
        <p className={`mcp-status mcp-${mcpStatus}`}>
          <span className="mcp-dot" /> MCP: {mcpStatus}
        </p>
      </header>

      <TrackList projectStore={projectStore} />

      {selectedTrack && (
        <div className="track-detail" key={selectedTrack.id}>
          <InstrumentPanel params={selectedTrack.params} instrumentType={selectedTrack.instrumentType} />
          <EffectChain projectStore={projectStore} trackId={selectedTrack.id} />
          <TransportBar projectStore={projectStore} scheduler={scheduler} isPlaying={isPlaying} started={started} />
          <PianoRoll clipStore={selectedTrack.clip} scheduler={scheduler} />
        </div>
      )}
    </div>
  );
}
