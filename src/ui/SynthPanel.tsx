/**
 * The top-level DAW UI. It owns the two stores (params + clip), the Synth engine,
 * and the Scheduler; renders the knob rack, transport, and piano roll (each a
 * view of a store); handles the audio-start gesture and computer-keyboard input;
 * restores/persists the project; and bridges everything to MCP.
 */
import { useEffect, useState } from 'react';
import { ParamStore } from '../audio/params/store';
import { Synth, synthSchema } from '../audio/synth/Synth';
import { ClipStore } from '../audio/sequencer/clipStore';
import { Scheduler } from '../audio/sequencer/scheduler';
import { connectMcpBridge, type McpStatus } from '../audio/mcp/bridge';
import { attachAutosave, restoreProject } from '../audio/persistence';
import { Knob } from './Knob';
import { TransportBar } from './TransportBar';
import { PianoRoll } from './PianoRoll';

// Computer-keyboard -> MIDI note, one octave from C4 (the classic tracker layout).
const KEY_MAP: Record<string, number> = {
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66,
  g: 67, y: 68, h: 69, u: 70, j: 71, k: 72,
};

export function SynthPanel() {
  const [paramStore] = useState(() => new ParamStore(synthSchema));
  const [clipStore] = useState(() => new ClipStore());
  const [synth] = useState(() => new Synth(paramStore));
  const [started, setStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scheduler] = useState(() => new Scheduler(synth, clipStore, setIsPlaying));
  const [mcpStatus, setMcpStatus] = useState<McpStatus>('connecting');

  // Restore the saved project, then autosave on any change. Runs before the
  // bridge connects (declared first), so the first snapshot reflects the project.
  useEffect(() => {
    restoreProject(paramStore, clipStore);
    return attachAutosave(paramStore, clipStore);
  }, [paramStore, clipStore]);

  // Tear engines down on unmount.
  useEffect(() => () => {
    scheduler.dispose();
    synth.dispose();
  }, [scheduler, synth]);

  // Bridge the stores/synth/scheduler to the MCP server (auto-reconnecting).
  useEffect(() => {
    const handle = connectMcpBridge(
      { paramStore, clipStore, synth, scheduler },
      { onStatus: setMcpStatus },
    );
    return () => handle.dispose();
  }, [paramStore, clipStore, synth, scheduler]);

  // Computer-keyboard note input (polyphonic).
  useEffect(() => {
    if (!started) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const midi = KEY_MAP[e.key.toLowerCase()];
      if (midi !== undefined) synth.noteOn(midi);
    };
    const onUp = (e: KeyboardEvent) => {
      const midi = KEY_MAP[e.key.toLowerCase()];
      if (midi !== undefined) synth.noteOff(midi);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [started, synth]);

  const handleStart = async () => {
    await synth.start();
    setStarted(true);
  };

  return (
    <div className="synth">
      <header className="synth-header">
        <h1>web-daw</h1>
        {started ? (
          <p className="hint">Play notes with the keyboard row A-K (W, E, T, Y, U for sharps).</p>
        ) : (
          <button type="button" className="start" onClick={handleStart}>
            Start audio
          </button>
        )}
        <p className={`mcp-status mcp-${mcpStatus}`}>
          <span className="mcp-dot" /> MCP: {mcpStatus}
        </p>
      </header>

      <div className="rack">
        {synthSchema.map((spec) => (
          <Knob key={spec.id} spec={spec} store={paramStore} />
        ))}
      </div>

      <TransportBar clipStore={clipStore} scheduler={scheduler} isPlaying={isPlaying} started={started} />
      <PianoRoll clipStore={clipStore} scheduler={scheduler} />
    </div>
  );
}
