/**
 * The version timeline: the commit DAG as a readable history (DESIGN.md section 7).
 * Save a named version, see the chain newest-first (two-voice colored, auto vs
 * named), expand a commit to see its semantic diff, and revert to it (which lands
 * a new commit - history stays append-only). The list is async (commits live in
 * the bundle), so it refetches when the version store or edit log changes.
 */
import { useEffect, useState } from "react";
import type { EditLog, FeedNote } from "../audio/commands/editLog";
import type { CommitSummary, VersionStore } from "../audio/commands/history";
import { voiceBorder, voiceDot } from "./authorVoice";

function timeAgo(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function VersionTimeline({ versionStore, editLog }: { versionStore: VersionStore; editLog: EditLog }) {
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [hasUncommitted, setHasUncommitted] = useState(false);
  const [message, setMessage] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [diff, setDiff] = useState<string[] | null>(null);
  const [notes, setNotes] = useState<FeedNote[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Keep relative times fresh without calling Date.now() during render.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      setHasUncommitted(versionStore.getState().hasUncommitted);
      void versionStore.history().then((commits) => {
        if (alive) setCommits(commits);
      });
    };
    refresh();
    const unsubV = versionStore.subscribe(refresh);
    const unsubE = editLog.subscribe(refresh);
    return () => {
      alive = false;
      unsubV();
      unsubE();
    };
  }, [versionStore, editLog]);

  const save = () => {
    void versionStore.commit(message.trim() || undefined, "you", false);
    setMessage("");
  };

  const toggle = (commit: CommitSummary) => {
    if (openId === commit.id) {
      setOpenId(null);
      setDiff(null);
      setNotes(null);
      return;
    }
    setOpenId(commit.id);
    setDiff(null);
    setNotes(null);
    // The intent narration captured with this version (notes are not edits).
    if (commit.noteCount > 0) void versionStore.getCommit(commit.id).then((full) => setNotes(full?.notes ?? []));
    else setNotes([]);
    if (!commit.parent) {
      setDiff([]); // root commit: nothing before it
      return;
    }
    void versionStore.diff(commit.parent, commit.id).then((diff) => setDiff(diff));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hasUncommitted) save();
          }}
          placeholder="Name this version…"
          className="flex-1 min-w-0 font-mono text-[11.5px] px-2 py-1.5 rounded-md border border-line bg-ground text-bright placeholder:text-faint"
        />
        <button
          type="button"
          onClick={save}
          disabled={!hasUncommitted}
          title={hasUncommitted ? "Save a named version" : "No changes since the last version"}
          className="font-mono text-[11.5px] px-2.5 py-1.5 rounded-md border border-you/45 bg-you/15 text-you cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed whitespace-nowrap"
        >
          Save
        </button>
      </div>

      {commits.length === 0 ? (
        <div className="border border-dashed border-line rounded-lg p-4 text-faint font-mono text-[11.5px] text-center">
          {hasUncommitted
            ? "Unsaved changes - save a version to start the history."
            : "Versions you and Claude save appear here."}
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {commits.map((commit) => {
            const open = openId === commit.id;
            return (
              <li key={commit.id} className={`rounded-md bg-card/60 border-l-2 ${voiceBorder(commit.author)}`}>
                <button
                  type="button"
                  onClick={() => toggle(commit)}
                  className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 cursor-pointer"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${voiceDot(commit.author)}`} />
                  <span className="font-mono text-[11.5px] truncate text-ink">{commit.message}</span>
                  {commit.auto && (
                    <span className="font-mono text-[9px] uppercase tracking-wide text-faint shrink-0">auto</span>
                  )}
                  {commit.noteCount > 0 && (
                    <span
                      title={`${commit.noteCount} intent ${commit.noteCount === 1 ? "note" : "notes"}`}
                      className="font-mono text-[10px] text-claude shrink-0"
                    >
                      “{commit.noteCount}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-faint shrink-0">{timeAgo(commit.time, now)}</span>
                </button>
                {open && (
                  <div className="px-2.5 pb-2 pt-0.5 flex flex-col gap-1.5">
                    {notes && notes.length > 0 && (
                      <ul className="flex flex-col gap-0.5 border-l-2 border-claude/50 pl-2">
                        {notes.map((note) => (
                          <li key={note.seq} className="font-mono text-[10.5px] italic text-muted wrap-break-word">
                            “{note.text}”
                          </li>
                        ))}
                      </ul>
                    )}
                    {diff === null ? (
                      <span className="font-mono text-[10.5px] text-faint">Diffing…</span>
                    ) : diff.length === 0 ? (
                      <span className="font-mono text-[10.5px] text-faint">
                        {commit.parent ? "No detected changes." : "Initial version."}
                      </span>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {diff.map((line, i) => (
                          <li key={i} className="font-mono text-[10.5px] text-muted">
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      title="Revert to this version (records a new version)"
                      onClick={() => void versionStore.revertTo(commit.id, "you")}
                      className="self-start font-mono text-[10.5px] px-2 py-1 rounded border border-line text-muted hover:text-ink hover:border-you cursor-pointer"
                    >
                      Revert to this version
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
