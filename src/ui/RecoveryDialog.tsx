/**
 * The project-recovery dialog (DAW-38). Raised when a project's saved state cannot be read: its
 * keyframe is missing or is not a project, or the log would not replay onto it.
 *
 * It offers the rebuild rather than performing it silently, because the user is the one who knows
 * whether this project is worth waiting on - and then it shows a progress indicator rather than a
 * warning, because the measured answer is seconds (DAW-39 put 100k edits at ~129ms on a laptop).
 * The fork appears only once a rebuild has actually failed, so the safe option is never offered as
 * if it were the expected one.
 *
 * Modal with no dismiss, like `ConflictDialog`: there is nothing useful behind it, and closing it
 * would leave a live project the app is deliberately not saving.
 */
import { useState } from "react";

/** What the dialog is doing, which is also what it is offering. */
type Stage = "offer" | "rebuilding" | "failed" | "forking";

const BODY: Record<Stage, string> = {
  offer:
    "This project's saved state could not be read. Its edit history is still here, and replaying it reconstructs the project - usually in a second or two. Nothing is written until you choose.",
  rebuilding: "Replaying the edit history…",
  failed:
    "The history here does not reach far enough back to reconstruct this project. You can start a new project instead - this one is left exactly as it is and stays in your library, so nothing is thrown away.",
  forking: "Setting up the new project…",
};

export function RecoveryDialog({
  detail,
  onRebuild,
  onFork,
}: {
  /** One clause saying which part failed, from `UnreadableProjectError`. */
  detail: string;
  /** Rebuild from the log. Resolves false when nothing here can rebuild it. */
  onRebuild: () => Promise<boolean>;
  /** Start a new project beside this one, leaving the damaged bundle alone. */
  onFork: () => Promise<void>;
}): React.ReactElement {
  const [stage, setStage] = useState<Stage>("offer");
  const busy = stage === "rebuilding" || stage === "forking";

  const rebuild = () => {
    setStage("rebuilding");
    void onRebuild().then(
      (recovered) => {
        // A success reloads into the healed bundle, so this stays on the progress indicator rather
        // than flashing a resolved state at someone for the frame before the page goes.
        if (!recovered) setStage("failed");
      },
      () => setStage("failed"),
    );
  };

  const fork = () => {
    setStage("forking");
    void onFork().catch(() => setStage("failed"));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-title"
    >
      <div className="bg-panel border border-line rounded-2xl p-7 max-w-lg mx-4 flex flex-col gap-4 shadow-2xl">
        <div className="flex flex-col gap-1.5">
          <h2 id="recovery-title" className="text-lg font-semibold text-strong">
            {stage === "failed" ? "This project cannot be rebuilt" : "This project needs rebuilding"}
          </h2>
          <p className="text-sm text-muted leading-relaxed">{BODY[stage]}</p>
        </div>

        <div className="rounded-lg border border-line bg-ground/50 px-3.5 py-3 font-mono text-[12px] text-faint">
          {detail}
        </div>

        <div className="flex items-center justify-end gap-2.5 mt-1">
          {busy && (
            <span
              className="w-4 h-4 mr-auto rounded-full border-2 border-faint border-t-transparent animate-spin"
              role="status"
              aria-label="Working"
            />
          )}
          {stage === "failed" || stage === "forking" ? (
            <button
              type="button"
              onClick={fork}
              disabled={busy}
              autoFocus
              className="font-mono text-[13px] font-semibold px-4 py-2 rounded-lg bg-you text-ground cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              Start a new project
            </button>
          ) : (
            <button
              type="button"
              onClick={rebuild}
              disabled={busy}
              autoFocus
              className="font-mono text-[13px] font-semibold px-4 py-2 rounded-lg bg-you text-ground cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              Rebuild project state
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
