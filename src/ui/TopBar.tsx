/**
 * The top bar: brand, transport (play/stop + tempo, via TransportBar), undo/redo,
 * and the audio-start gesture. Pure chrome over state owned by AppShell. The
 * activity panel owns its own collapse toggle and the MCP status, so they are not
 * duplicated here.
 */
import type { ProjectStore } from "../audio/project/projectStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { EditLog } from "../audio/commands/editLog";
import type { Dispatch } from "../audio/commands/types";
import { useEditLog } from "../audio/commands/useEditLog";
import { TransportBar } from "./TransportBar";

export function TopBar({
  projectStore,
  scheduler,
  editLog,
  dispatch,
  isPlaying,
  started,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  editLog: EditLog;
  dispatch: Dispatch;
  isPlaying: boolean;
  started: boolean;
}) {
  const { canUndo, canRedo } = useEditLog(editLog);
  const histBtn =
    "font-mono text-[13px] w-7 h-7 rounded-md border border-line bg-card text-ink cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed";
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-2.5 bg-rail border-b border-line font-mono text-xs">
      <div className="flex items-center gap-2 font-semibold text-bright">
        <span
          className="w-4 h-4 rounded-full"
          style={{
            background:
              "conic-gradient(from 200deg, var(--color-you), var(--color-claude), var(--color-you))",
          }}
        />
        web-daw
      </div>

      <TransportBar
        projectStore={projectStore}
        scheduler={scheduler}
        dispatch={dispatch}
        isPlaying={isPlaying}
        started={started}
      />

      <div className="flex gap-1" role="group" aria-label="History">
        <button
          type="button"
          title="Undo (Cmd/Ctrl-Z)"
          disabled={!canUndo}
          onClick={() => editLog.undo()}
          className={histBtn}
        >
          ↶
        </button>
        <button
          type="button"
          title="Redo (Shift+Cmd/Ctrl-Z)"
          disabled={!canRedo}
          onClick={() => editLog.redo()}
          className={histBtn}
        >
          ↷
        </button>
      </div>
    </div>
  );
}
