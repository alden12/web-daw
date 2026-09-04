/**
 * The account avatar: a round button in the activity rail (above the settings gear) showing the signed-in
 * user's initials on their own colour. Clicking it opens the account panel. Renders nothing when auth is
 * off or nobody is signed in (local/dev), so the rail is unchanged there.
 *
 * The colour is the viewer's own hue via `authorHex` (perspective-relative: teal by default, or a
 * custom self-colour, and re-lit for a light ground so white initials stay legible on it) - so the
 * avatar matches how your edits read in the feed. The initials
 * come from the readable display name (the edit-author id is the email, but the name is nicer here).
 */
import { useSyncExternalStore } from "react";
import { authEnabled, readAuthState, subscribeAuth } from "../auth/session";
import { authorHex } from "./authorStyle";
import { useAuthorPresence } from "./authorColorsContext";
import { initials } from "./initials";

export function AccountAvatar({ onClick }: { onClick: () => void }) {
  const state = useSyncExternalStore(subscribeAuth, readAuthState, readAuthState);
  const presence = useAuthorPresence();
  if (!authEnabled || state.status !== "signed-in") return null;

  const color = authorHex(presence.self, presence);
  return (
    <button
      type="button"
      title="Account"
      aria-label="Account"
      onClick={onClick}
      className="flex items-center justify-center w-full h-11 cursor-pointer"
    >
      <span
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold leading-none"
        style={{ background: color, color: "var(--color-ground)" }}
      >
        {initials(state.user.name || state.user.email || "?")}
      </span>
    </button>
  );
}
