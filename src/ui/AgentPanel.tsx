/**
 * The activity panel (right): the project's history/activity feed, undo/redo, and
 * the MCP connection (the session is driven from Claude Code over MCP). Named for
 * its current role; it may grow to host a real in-app agent later. Collapses to a
 * thin rail - drag the edge to resize, or use the chevron to collapse and expand.
 */
import { useEffect, useMemo, useState } from "react";
import type { McpStatus } from "../audio/mcp/bridge";
import type { EditLog } from "../audio/commands/editLog";
import type { CommitSummary, VersionStore } from "../audio/commands/history";
import { useEditLog } from "../audio/commands/useEditLog";
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
  const { entries, notes, canUndo, canRedo } = useEditLog(editLog);
  const [tab, setTab] = useState<"activity" | "versions">("activity");

  // Commits, loaded from the version store and refreshed when it changes, so the
  // feed can show "saved" markers inline among the edits.
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  useEffect(() => {
    const load = () => void versionStore.history(200).then(setCommits);
    load();
    return versionStore.subscribe(load);
  }, [versionStore]);

  // Merge edits, feed notes, and commit markers into one stream, newest first.
  // All three share the edit `seq` counter; a commit sits at its last included
  // edit's seq, ranked above that edit so it reads as "saved, just after".
  type FeedItem =
    | { kind: "edit"; seq: number; entry: (typeof entries)[number] }
    | { kind: "note"; seq: number; note: (typeof notes)[number] }
    | { kind: "commit"; seq: number; commit: CommitSummary };
  const items = useMemo<FeedItem[]>(() => {
    const rank = (i: FeedItem) => (i.kind === "commit" ? 0 : 1);
    const merged: FeedItem[] = [
      ...entries.map((entry) => ({
        kind: "edit" as const,
        seq: entry.seq,
        entry,
      })),
      ...notes.map((note) => ({ kind: "note" as const, seq: note.seq, note })),
      ...commits.map((commit) => ({
        kind: "commit" as const,
        seq: commit.lastSeq,
        commit,
      })),
    ];
    return merged
      .sort((a, b) => b.seq - a.seq || rank(a) - rank(b))
      .slice(0, 120);
  }, [entries, notes, commits]);
  const histBtn =
    "flex items-center justify-center font-mono text-xl w-6 h-6 rounded-md border border-line bg-card text-ink cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed";

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Expand activity panel"
        title="Expand activity panel"
        className="[grid-area:agent] bg-panel border-l border-line flex flex-col items-center gap-3.5 py-3.5 cursor-pointer hover:bg-card/40"
      >
        <span className="text-lg leading-none text-muted">«</span>
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
              {items.length === 0 ? (
                <div className="border border-dashed border-line rounded-lg p-4 text-faint font-mono text-[11.5px] text-center">
                  Edits you and Claude make appear here.
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {items.map((item) => {
                    if (item.kind === "commit") {
                      const c = item.commit;
                      return (
                        <li
                          key={`c-${c.id}`}
                          className="flex items-center gap-2 px-2.5 py-1 my-0.5 text-faint"
                          title={`${c.auto ? "Autosaved" : "Saved"} · ${c.message} (by ${c.author})`}
                        >
                          <span className="h-px w-3 shrink-0 bg-line" />
                          <span className="font-mono text-[10px] min-w-0 truncate">
                            {c.auto ? "autosaved" : "saved"} · {c.message}
                          </span>
                          <span className="h-px flex-1 bg-line" />
                        </li>
                      );
                    }
                    if (item.kind === "note") {
                      const n = item.note;
                      return (
                        <li
                          key={`n-${n.seq}`}
                          className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md bg-card/40 border-l-2 ${
                            n.author === "claude"
                              ? "border-claude"
                              : "border-you"
                          }`}
                        >
                          <span className="text-[11px] shrink-0 text-muted">
                            “
                          </span>
                          <span className="text-[11.5px] italic text-muted min-w-0 wrap-break-word">
                            {n.text}
                          </span>
                        </li>
                      );
                    }
                    const entry = item.entry;
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
                          {editLog.describe(entry)}
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
