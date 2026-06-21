/**
 * The top bar: brand, transport (play/stop + tempo, via TransportBar), the
 * workspace mode toggle (resizes the agent pane), the audio-start gesture, and
 * the MCP status. Pure chrome over state owned by AppShell.
 */
import type { ProjectStore } from '../audio/project/projectStore';
import type { Scheduler } from '../audio/sequencer/scheduler';
import type { McpStatus } from '../audio/mcp/bridge';
import type { EditLog } from '../audio/commands/editLog';
import type { Dispatch } from '../audio/commands/types';
import { useEditLog } from '../audio/commands/useEditLog';
import { TransportBar } from './TransportBar';

export type Mode = 'converse' | 'balanced' | 'produce';
const MODES: Mode[] = ['converse', 'balanced', 'produce'];

const DOT: Record<McpStatus, string> = {
  connected: 'bg-good',
  connecting: 'bg-warn',
  disconnected: 'bg-claude',
};

export function TopBar({
  projectStore,
  scheduler,
  editLog,
  dispatch,
  isPlaying,
  started,
  mcpStatus,
  mode,
  onMode,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  editLog: EditLog;
  dispatch: Dispatch;
  isPlaying: boolean;
  started: boolean;
  mcpStatus: McpStatus;
  mode: Mode;
  onMode: (mode: Mode) => void;
}) {
  const { canUndo, canRedo } = useEditLog(editLog);
  const histBtn = 'font-mono text-[13px] w-7 h-7 rounded-md border border-line bg-card text-ink cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed';
  return (
    <div className="flex items-center gap-4 px-3.5 py-2.5 bg-rail border-b border-line font-mono text-xs">
      <div className="flex items-center gap-2 font-semibold text-bright">
        <span
          className="w-4 h-4 rounded-full"
          style={{ background: 'conic-gradient(from 200deg, var(--color-you), var(--color-claude), var(--color-you))' }}
        />
        web-daw
      </div>

      <TransportBar projectStore={projectStore} scheduler={scheduler} dispatch={dispatch} isPlaying={isPlaying} started={started} />

      <div className="flex gap-1" role="group" aria-label="History">
        <button type="button" title="Undo (Cmd/Ctrl-Z)" disabled={!canUndo} onClick={() => editLog.undo()} className={histBtn}>
          ↶
        </button>
        <button type="button" title="Redo (Shift+Cmd/Ctrl-Z)" disabled={!canRedo} onClick={() => editLog.redo()} className={histBtn}>
          ↷
        </button>
      </div>

      <div className="ml-auto flex gap-0.5 bg-card border border-line rounded-lg p-0.5" role="group" aria-label="Workspace mode">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => onMode(m)}
            className={`font-mono text-[11px] tracking-wide px-2.5 py-1 rounded-md cursor-pointer ${
              mode === m ? 'bg-ground text-ink' : 'text-muted'
            }`}
          >
            {m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted">
        <span className={`w-2 h-2 rounded-full ${DOT[mcpStatus]}`} /> MCP: {mcpStatus}
      </span>
    </div>
  );
}
