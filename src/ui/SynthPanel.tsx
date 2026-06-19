/**
 * The synth UI. It owns the ParamStore and the Synth engine, renders a Knob per
 * schema entry (no per-param code), handles the user gesture that starts audio,
 * and maps the computer keyboard to notes.
 */
import { useEffect, useState } from 'react';
import { ParamStore } from '../audio/params/store';
import { Synth, synthSchema } from '../audio/synth/Synth';
import { connectMcpBridge, type McpStatus } from '../audio/mcp/bridge';
import { Knob } from './Knob';

// Computer-keyboard -> MIDI note, one octave from C4 (the classic tracker layout).
const KEY_MAP: Record<string, number> = {
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66,
  g: 67, y: 68, h: 69, u: 70, j: 71, k: 72,
};

export function SynthPanel() {
  const [store] = useState(() => new ParamStore(synthSchema));
  const [synth] = useState(() => new Synth(store));
  const [started, setStarted] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<McpStatus>('connecting');

  // Tear the engine down when the panel unmounts.
  useEffect(() => () => synth.dispose(), [synth]);

  // Bridge the store/synth to the MCP server's WebSocket (auto-reconnecting).
  useEffect(() => {
    const handle = connectMcpBridge(store, synth, { onStatus: setMcpStatus });
    return () => handle.dispose();
  }, [store, synth]);

  // Computer-keyboard note input (mono: release only when no keys are held).
  useEffect(() => {
    if (!started) return;
    const held = new Set<string>();
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const midi = KEY_MAP[e.key.toLowerCase()];
      if (midi === undefined) return;
      held.add(e.key.toLowerCase());
      synth.noteOn(midi);
    };
    const onUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!(key in KEY_MAP)) return;
      held.delete(key);
      if (held.size === 0) synth.noteOff();
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
          <p className="hint">Play notes with the keyboard row A–K (W, E, T, Y, U for sharps).</p>
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
          <Knob key={spec.id} spec={spec} store={store} />
        ))}
      </div>
    </div>
  );
}
