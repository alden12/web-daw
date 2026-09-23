/**
 * The Account section of the settings panel: everyone whose edits this project carries, you first.
 * Your identity, your colour, the agent's and each collaborator's, and the way out.
 *
 * This was three places not long ago - an account modal off the rail avatar, an Authors tab, and a
 * seam between them where your own identity and colour lived in whichever of the two a build flag
 * chose. They are one list now, which is also the honest shape of the thing: the panel answers
 * "who is in this project and how do I tell them apart", and you are simply the first row.
 *
 * The two modes are still different, because the underlying facts are. Signed in, your name is your
 * account's and is not yours to change, so it reads as text beside your avatar and the panel offers
 * a sign-out. In local/dev there is no account, so the name is a handle you type - which is what
 * lets two tabs on `?user=` appear as distinct, differently-coloured authors.
 */
import { useState, useSyncExternalStore } from "react";
import { authEnabled, readAuthState, signOut, subscribeAuth } from "../auth/session";
import { AuthorColorSettings } from "./AuthorColorSettings";
import type { EditLog } from "../audio/commands/editLog";
import { type AuthorColorConfig } from "./authorColors";
import { useAuthorPresence } from "./authorColorsContext";
import { authorHex } from "./authorStyle";
import { readCurrentUser, subscribeCurrentUser, writeCurrentUser, DEFAULT_USER } from "./currentUser";
import { initials } from "./initials";

export function AccountSettings({
  config,
  editLog,
  onClose,
}: {
  config: AuthorColorConfig;
  editLog: EditLog;
  onClose: () => void;
}) {
  const authState = useSyncExternalStore(subscribeAuth, readAuthState, readAuthState);
  const currentUser = useSyncExternalStore(subscribeCurrentUser, readCurrentUser, readCurrentUser);
  const presence = useAuthorPresence();
  const signedIn = authEnabled && authState.status === "signed-in";

  return (
    <div className="flex flex-col gap-4">
      {signedIn ? (
        <SignedInIdentity
          name={authState.status === "signed-in" ? authState.user.name : ""}
          email={authState.status === "signed-in" ? authState.user.email : undefined}
          chip={authorHex(presence.self, presence)}
        />
      ) : (
        <HandleField currentUser={currentUser} />
      )}

      <AuthorColorSettings config={config} editLog={editLog} />

      {signedIn && (
        <button
          type="button"
          onClick={() => {
            void signOut();
            onClose();
          }}
          className="w-full text-sm font-semibold px-4 py-2 rounded-lg border border-line bg-card text-ink hover:border-faint cursor-pointer"
        >
          Sign out
        </button>
      )}
    </div>
  );
}

/** Signed in: the avatar, display name and email, none of which this panel can change. */
function SignedInIdentity({ name, email, chip }: { name: string; email?: string; chip: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold leading-none shrink-0"
        style={{ background: chip, color: "var(--color-ground)" }}
      >
        {initials(name || email || "?")}
      </span>
      <div className="min-w-0">
        <div className="text-[13px] text-ink truncate">{name}</div>
        {email && <div className="text-[11px] text-faint truncate">{email}</div>}
      </div>
    </div>
  );
}

/** Local/dev: the name is a handle you type, and it is what your edits are stamped with. */
function HandleField({ currentUser }: { currentUser: string }) {
  const [draft, setDraft] = useState(currentUser);
  const commit = () => writeCurrentUser(draft);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] text-ink">You are</span>
        <span className="text-[11px] text-faint">edits are stamped with this name</span>
      </div>
      <input
        type="text"
        value={draft}
        placeholder={DEFAULT_USER}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
        aria-label="Your name"
        className="w-full text-[12.5px] text-ink bg-ground border border-line rounded-md px-2 py-1 focus-visible:[outline:2px_solid_var(--color-you)] focus-visible:outline-offset-1"
      />
      <p className="text-[11px] text-faint leading-relaxed">
        Sets who your edits belong to for live collaboration. Also settable with{" "}
        <code className="text-muted">?user=</code> in the URL.
      </p>
    </div>
  );
}
