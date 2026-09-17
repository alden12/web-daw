/**
 * The reconnect conflict dialog. When this client reconnects after editing offline and a teammate
 * changed the SAME things in the meantime, the sync session holds the offline edits (rather than
 * silently merging last-writer-wins) and raises the clash here. The dialog shows what each side did and
 * offers two resolutions:
 *   - Take theirs  - drop the offline edits; keep the teammate's version (the shared project).
 *   - Keep mine    - fork a copy of the project containing the offline edits, leaving the shared one on
 *                    the teammate's version.
 * It is modal (no dismiss): a choice must be made, so we never lose edits by accident.
 */
import type { ConflictInfo, ConflictEntry } from "../audio/sync/conflict";
import { authorLabel } from "./authorStyle";

function ChangeList({ title, entries }: { title: string; entries: ConflictEntry[] }): React.ReactElement {
  return (
    <div className="flex-1 min-w-0">
      <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint mb-1.5">{title}</div>
      <ul className="flex flex-col gap-1">
        {entries.map((entry, index) => (
          <li key={index} className="text-[13px] text-ink leading-snug">
            <span className="text-muted">{authorLabel(entry.author)}: </span>
            {entry.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConflictDialog({
  info,
  onTakeTheirs,
  onKeepMine,
}: {
  info: ConflictInfo;
  onTakeTheirs: () => void;
  onKeepMine: () => void;
}): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
    >
      <div className="bg-panel border border-line rounded-2xl p-7 max-w-lg mx-4 flex flex-col gap-4 shadow-2xl">
        <div className="flex flex-col gap-1.5">
          <h2 id="conflict-title" className="text-lg font-semibold text-bright">
            Reconnected with conflicting edits
          </h2>
          <p className="text-sm text-muted leading-relaxed">
            While you were offline, edits were made that overlap with your changes. Choose which to keep - your offline
            work isn't lost either way.
          </p>
        </div>

        <div className="flex gap-5 rounded-lg border border-line bg-ground/50 p-3.5">
          <ChangeList title="Since you left" entries={info.theirs} />
          <div className="w-px bg-line" />
          <ChangeList title="Your offline edits" entries={info.mine} />
        </div>

        <div className="flex items-center justify-end gap-2.5 mt-1">
          <button
            type="button"
            onClick={onTakeTheirs}
            className="font-mono text-[13px] px-4 py-2 rounded-lg border border-line bg-card text-ink cursor-pointer hover:text-bright"
          >
            Take theirs
          </button>
          <button
            type="button"
            onClick={onKeepMine}
            autoFocus
            className="font-mono text-[13px] font-semibold px-4 py-2 rounded-lg bg-you text-ground cursor-pointer"
          >
            Keep mine as a copy
          </button>
        </div>
      </div>
    </div>
  );
}
