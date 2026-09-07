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
import { Select } from "./controls/Select";
import { VersionTimeline } from "./VersionTimeline";
import { authorHex } from "./authorStyle";
import { authorLabel } from "./authorStyle";
import { useAuthorPresence } from "./authorColorsContext";
import { timeAgo, useNow } from "./timeAgo";

export function ActivityView({ editLog, versionStore }: { editLog: EditLog; versionStore: VersionStore }) {
  const { entries, notes } = useEditLog(editLog);
  // Per-author accent (hex), perspective-relative: my own edits read teal, every collaborator in their
  // own stable hue (not collapsed to one of three voice classes).
  const presence = useAuthorPresence();
  const { self } = presence;
  // The author id is now an email; show "You" for my own edits rather than my raw address.
  const label = (author: string) => (author === self ? "You" : authorLabel(author));
  const [tab, setTab] = useState<"activity" | "versions">("activity");
  const now = useNow();
  /** Which commit marker has its actions open. One at a time; a marker is a thin row, not a panel. */
  const [openCommitId, setOpenCommitId] = useState<string | null>(null);

  // Commits, loaded from the version store and refreshed when it changes, so the
  // feed can show "saved" markers inline among the edits.
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  useEffect(() => {
    const load = () => void versionStore.history(200).then(setCommits);
    load();
    return versionStore.subscribe(load);
  }, [versionStore]);

  /**
   * The last edit a **named** version swept up, so a row can say whether it is in one (DAW-8.4).
   *
   * Deliberately not "any commit", which is what the ticket first proposed. An auto checkpoint
   * lands 4 seconds after you stop editing (`CHECKPOINT_DEBOUNCE_MS`), so counting those would
   * grey a row for four seconds and then never again - a distinction that flickers and answers a
   * question nobody asked, since autosave is plumbing rather than an event. Against named versions
   * it answers a real one: these are the edits the Save button would capture, which is the same
   * boundary `hasUnnamedChanges` already lights that button on.
   *
   * A max rather than `commits[0].lastSeq`, so it does not quietly depend on the store's ordering.
   */
  const savedThrough = commits.reduce(
    (furthest, commit) => (commit.auto ? furthest : Math.max(furthest, commit.lastSeq)),
    -1,
  );

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
      // Named versions only (DAW-8.4). An autosave is not an event anyone chose, and a marker per
      // autosave buried the edits it sat between. What it was there to tell you - that the work is
      // safe - is now carried by the edits themselves, which is where you were already looking.
      ...commits
        .filter((commit) => !commit.auto)
        .map((commit) => ({ kind: "commit" as const, seq: commit.lastSeq, commit })),
    ];
    return merged.sort((a, b) => b.seq - a.seq || rank(a) - rank(b)).slice(0, 120);
  }, [entries, notes, commits]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3.5 py-2 shrink-0">
        <Select
          aria-label="Activity view"
          value={tab}
          onChange={(e) => setTab(e.target.value as "activity" | "versions")}
          size="md"
          className="font-semibold text-strong"
        >
          <option value="activity">Activity</option>
          <option value="versions">Versions</option>
        </Select>
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
                const open = openCommitId === c.id;
                return (
                  <li key={`c-${c.id}`} className="my-0.5 text-faint">
                    {/* The marker is a button, not a caption: a version you can see is a version
                        you will want to go back to, and the Versions tab already had the action.
                        Expanding rather than acting on the press, because reverting from a row you
                        might have tapped by accident is the wrong kind of easy. */}
                    <button
                      type="button"
                      onClick={() => setOpenCommitId(open ? null : c.id)}
                      title={`Saved · ${c.message} (by ${label(c.author)})`}
                      className="flex items-center gap-2 w-full px-2.5 py-1 cursor-pointer hover:text-muted"
                    >
                      <span className="h-px w-3 shrink-0 bg-line" />
                      <span className="font-mono text-[10px] min-w-0 truncate">saved · {c.message}</span>
                      <span className="h-px flex-1 bg-line" />
                      <span className="font-mono text-[10px] shrink-0">{timeAgo(c.time, now)}</span>
                    </button>
                    {open && (
                      <div className="px-2.5 pt-1 pb-0.5">
                        <button
                          type="button"
                          title="Revert to this version (records a new version, it does not erase these edits)"
                          onClick={() => {
                            setOpenCommitId(null);
                            void versionStore.revertTo(c.id, "you");
                          }}
                          className="font-mono text-[10.5px] px-2 py-1 rounded border border-line text-muted hover:text-ink hover:border-you cursor-pointer"
                        >
                          Revert to this version
                        </button>
                      </div>
                    )}
                  </li>
                );
              }
              if (item.kind === "note") {
                const n = item.note;
                return (
                  <li
                    key={`n-${n.seq}`}
                    className="flex items-start gap-2 px-2.5 py-1.5 rounded-md bg-card/40 border-l-2"
                    style={{ borderLeftColor: authorHex(n.author, presence) }}
                  >
                    <span className="text-[11px] shrink-0 text-muted">“</span>
                    <span className="text-[11.5px] italic text-muted min-w-0 wrap-break-word">{n.text}</span>
                  </li>
                );
              }
              const entry = item.entry;
              const isUndoRedo = entry.kind === "undo" || entry.kind === "redo";
              // Two independent things, so they get two independent channels (DAW-8.4): colour says
              // whether the edit is in the history yet, italics say it was an undo or a redo. Reusing
              // one for both is what made the old feed unreadable the moment you undid anything.
              const saved = entry.seq <= savedThrough;
              return (
                <li
                  key={entry.seq}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-card/60 border-l-2"
                  style={{ borderLeftColor: authorHex(entry.author, presence) }}
                  title={saved ? "Saved in a version" : "Not saved in a version yet"}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: authorHex(entry.author, presence) }}
                  />
                  <span
                    className={`font-mono text-[11.5px] truncate ${saved ? "text-ink" : "text-muted"} ${
                      isUndoRedo ? "italic" : ""
                    }`}
                  >
                    {editLog.describe(entry)}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-faint shrink-0">{label(entry.author)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
