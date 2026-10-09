/**
 * You, as a chip: your initials on your author colour. The touch shell's account button (MOBILE-19)
 * and the account settings header both draw it, so the button you press looks like the person the
 * page then shows.
 *
 * Signed in, the initials come from the account's name or email; signed out (or with auth off), from
 * the handle your edits are stamped with - the same identity the colour already belongs to. The
 * default handle ("you") is nobody's name, so it gets a person glyph rather than "YO".
 */
import { useSyncExternalStore } from "react";
import { authEnabled, readAuthState, subscribeAuth } from "../auth/session";
import { useAuthorPresence } from "./authorColorsContext";
import { authorHex } from "./authorStyle";
import { DEFAULT_USER, readCurrentUser, subscribeCurrentUser } from "./currentUser";
import { initials } from "./initials";

export function AccountAvatar({ size }: { size: number }) {
  const authState = useSyncExternalStore(subscribeAuth, readAuthState, readAuthState);
  const handle = useSyncExternalStore(subscribeCurrentUser, readCurrentUser, readCurrentUser);
  const presence = useAuthorPresence();
  const signedIn = authEnabled && authState.status === "signed-in" ? authState.user : null;
  const name = signedIn ? signedIn.name || signedIn.email || "?" : handle;
  return (
    <span
      aria-hidden="true"
      className="rounded-full flex items-center justify-center font-semibold leading-none shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: authorHex(presence.self, presence),
        color: "var(--color-ground)",
      }}
    >
      {name === DEFAULT_USER ? (
        <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: size * 0.55, height: size * 0.55 }}>
          <circle cx="8" cy="5.5" r="3" />
          <path d="M2.5 14a5.5 5.5 0 0 1 11 0z" />
        </svg>
      ) : (
        initials(name)
      )}
    </span>
  );
}
