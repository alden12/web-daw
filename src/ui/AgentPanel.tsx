/**
 * The activity panel (right): the project's history/activity feed, undo/redo, and
 * the MCP connection (the session is driven from Claude Code over MCP). Named for
 * its current role; it may grow to host a real in-app agent later. Collapses to a
 * thin rail - drag the edge to resize, or use the chevron to collapse and expand.
 */
import { useState } from "react";
import type { McpStatus } from "../audio/mcp/bridge";
import type { EditLog } from "../audio/commands/editLog";
import type { VersionStore } from "../audio/commands/history";
import { useEditLog } from "../audio/commands/useEditLog";
import { describeCommand } from "../audio/commands/describe";
import { VersionTimeline } from "./VersionTimeline";

const DOT: Record<McpStatus, string> = {
  connected: "bg-good",
  connecting: "bg-warn",
  disconnected: "bg-claude",
};

export function AgentPanel({
  mcpStatus,
  editLog,
  versionStore,
  collapsed,
  onToggle,
}: {
  mcpStatus: McpStatus;
  editLog: EditLog;
  versionStore: VersionStore;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { entries, canUndo, canRedo } = useEditLog(editLog);
  const [tab, setTab] = useState<"activity" | "versions">("activity");
  // Newest first (like a git log), so the latest edit is at the top, no scrolling.
  const recent = entries.slice(-100).reverse();
  const histBtn =
    "font-mono text-[12px] w-6 h-6 rounded-md border border-line bg-card text-ink cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed";

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Expand activity panel"
        title="Expand activity panel"
        className="[grid-area:agent] bg-panel border-l border-line flex flex-col items-center gap-3.5 py-3.5 cursor-pointer hover:bg-card/40"
      >
        <span className="text-[13px] leading-none text-muted">«</span>
        <span className={`w-2 h-2 rounded-full ${DOT[mcpStatus]}`} />
        <span className="w-2 h-2 rounded-full bg-you" />
      </button>
    );
  }

  return (
    <div className="[grid-area:agent] bg-panel border-l border-line flex flex-col min-w-0 overflow-hidden">
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 h-12 px-4 border-b border-line">
          <select
            aria-label="Panel view"
            value={tab}
            onChange={(e) => setTab(e.target.value as "activity" | "versions")}
            className="text-[12.5px] font-semibold text-bright bg-card border border-line rounded-md px-1.5 py-0.5 cursor-pointer"
          >
            <option value="activity">Activity</option>
            <option value="versions">Versions</option>
          </select>
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
          <span className="ml-auto inline-flex items-center gap-2 font-mono text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${DOT[mcpStatus]}`} /> MCP
            </span>
            <button
              type="button"
              onClick={onToggle}
              aria-label="Collapse activity panel"
              title="Collapse activity panel"
              className="text-lg leading-none text-muted hover:text-ink cursor-pointer px-1"
            >
              »
            </button>
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5">
          {tab === "versions" ? (
            <VersionTimeline versionStore={versionStore} editLog={editLog} />
          ) : (
            <div>
              {recent.length === 0 ? (
                <div className="border border-dashed border-line rounded-lg p-4 text-faint font-mono text-[11.5px] text-center">
                  Edits you and Claude make appear here.
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {recent.map((entry) => {
                    const isUndoRedo =
                      entry.kind === "undo" || entry.kind === "redo";
                    return (
                      <li
                        key={entry.seq}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-card/60 border-l-2 ${
                          entry.author === "claude"
                            ? "border-claude"
                            : "border-you"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${entry.author === "claude" ? "bg-claude" : "bg-you"}`}
                        />
                        <span
                          className={`font-mono text-[11.5px] truncate ${isUndoRedo ? "text-muted italic" : "text-ink"}`}
                        >
                          {entry.label ?? describeCommand(entry.command)}
                        </span>
                        <span className="ml-auto font-mono text-[10px] text-faint shrink-0">
                          {entry.author}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
