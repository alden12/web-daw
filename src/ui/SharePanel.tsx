/**
 * The Share panel: a small modal (opened from the project menu) where a project's owner invites and
 * removes collaborators by email. It mirrors `SettingsPanel`'s overlay + card idiom. Owner-only - the
 * trigger in `LibraryHeader` only offers it for a project you own, and the server enforces the same.
 *
 * Sharing is by email (see `src/audio/projects/sharing.ts`): whoever you invite gets access the moment
 * they sign in with a Google/GitHub account whose verified email matches. So there is nothing to "accept"
 * - the invite is the grant.
 */
import { useEffect, useState } from "react";
import { readAuthState } from "../auth/session";
import { addMember, listMembers, removeMember, type MemberEntry } from "../audio/projects/sharing";

/** Turn a thrown sync error into a message for the owner. A 400 is an invalid address; anything else is
 *  a generic failure (network, or a 403 if they somehow aren't the owner). */
function inviteError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("(400")) return "That doesn't look like an email address.";
  return "Could not send that invite. Check the address and try again.";
}

export function SharePanel({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const auth = readAuthState();
  const ownerEmail = auth.status === "signed-in" ? auth.user.email : undefined;

  const refresh = () =>
    listMembers(projectId)
      .then(setMembers)
      .catch(() => setError("Could not load who this is shared with."));

  useEffect(() => {
    void refresh();
    // Re-run only when the project changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const invite = async () => {
    const trimmed = email.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addMember(projectId, trimmed);
      setEmail("");
      await refresh();
    } catch (caught) {
      setError(inviteError(caught));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (memberEmail: string) => {
    setError(null);
    try {
      await removeMember(projectId, memberEmail);
      await refresh();
    } catch {
      setError("Could not remove that person.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-panel border border-line rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h2 id="share-title" className="text-[15px] font-semibold text-bright truncate">
            Share “{projectName}”
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share"
            title="Close"
            className="ml-auto text-lg leading-none text-muted hover:text-ink cursor-pointer px-1"
          >
            ×
          </button>
        </div>

        <p className="text-[12px] text-muted leading-relaxed">
          Invite people by email. They get access as soon as they sign in with a Google or GitHub account using that
          address.
        </p>

        <div className="flex flex-col gap-1.5">
          {ownerEmail && (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-ink truncate">{ownerEmail}</span>
              <span className="ml-auto text-[11px] text-faint">owner</span>
            </div>
          )}
          {members.map((member) => (
            <div key={member.email} className="flex items-center gap-2 text-[13px] group">
              <span className="text-ink truncate">{member.email}</span>
              <span className="ml-auto text-[11px] text-faint">{member.role}</span>
              <button
                type="button"
                onClick={() => void revoke(member.email)}
                aria-label={`Remove ${member.email}`}
                title="Remove"
                className="text-[15px] leading-none text-faint hover:text-claude cursor-pointer px-1 opacity-0 group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          ))}
          {members.length === 0 && <p className="text-[12px] text-faint">Not shared with anyone yet.</p>}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void invite();
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            aria-label="Invite by email"
            className="flex-1 px-2.5 py-1.5 border border-line rounded-md bg-ground text-ink placeholder:text-faint text-xs focus:outline-none focus:border-you"
          />
          <button
            type="submit"
            disabled={busy || email.trim().length === 0}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md bg-you text-ground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Invite
          </button>
        </form>

        {error && <p className="text-claude text-[11px]">{error}</p>}
      </div>
    </div>
  );
}
