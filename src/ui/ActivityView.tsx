/**
 * The Activity view (a library-rail view): the project's history as one stream -
 * authored edits, intent notes, and "saved" commit markers - plus a Versions tab
 * onto the commit DAG. Lifted out of the old right-hand AgentPanel when Activity
 * moved into the left rail; undo/redo and the MCP status moved to the toolbar, so
 * this is now purely the feed. The right side is reserved for the future agent.
 */
import { useEffect, useMemo, useState } from "react";
import type { EditLog } from "../audio/commands/editLog";
import type { CommitSummary, VersionStore } from "../audio/commands/history";
import { useEditLog } from "../audio/commands/useEditLog";
import { VersionTimeline } from "./VersionTimeline";

export function ActivityView({ editLog, versionStore }: { editLog: EditLog; versionStore: VersionStore }) {
  const { entries, notes } = useEditLog(editLog);
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
      ...entries.map((entry) => ({ kind: "edit" as const, seq: entry.seq, entry })),
      ...notes.map((note) => ({ kind: "note" as const, seq: note.seq, note })),
      ...commits.map((commit) => ({ kind: "commit" as const, seq: commit.lastSeq, commit })),
    ];
    return merged.sort((a, b) => b.seq - a.seq || rank(a) - rank(b)).slice(0, 120);
  }, [entries, notes, commits]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3.5 py-2 shrink-0">
        <select
          aria-label="Activity view"
          value={tab}
          onChange={(e) => setTab(e.target.value as "activity" | "versions")}
          className="text-[12.5px] font-semibold text-bright bg-card border border-line rounded-md px-1.5 py-0.5 cursor-pointer"
        >
          <option value="activity">Activity</option>
          <option value="versions">Versions</option>
        </select>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-4">
        {tab === "versions" ? (
          <VersionTimeline versionStore={versionStore} editLog={editLog} />
        ) : items.length === 0 ? (
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
                      n.author === "claude" ? "border-claude" : "border-you"
                    }`}
                  >
                    <span className="text-[11px] shrink-0 text-muted">“</span>
                    <span className="text-[11.5px] italic text-muted min-w-0 wrap-break-word">{n.text}</span>
                  </li>
                );
              }
              const entry = item.entry;
              const isUndoRedo = entry.kind === "undo" || entry.kind === "redo";
              return (
                <li
                  key={entry.seq}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-card/60 border-l-2 ${
                    entry.author === "claude" ? "border-claude" : "border-you"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${entry.author === "claude" ? "bg-claude" : "bg-you"}`}
                  />
                  <span className={`font-mono text-[11.5px] truncate ${isUndoRedo ? "text-muted italic" : "text-ink"}`}>
                    {editLog.describe(entry)}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-faint shrink-0">{entry.author}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
